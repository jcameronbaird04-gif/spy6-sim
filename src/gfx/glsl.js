// Shared shader code: noise, the sky model, aerial perspective, Earth curvature, ocean waves.
// Every environment shader includes these so reflections, haze and the horizon always agree.
import * as THREE from "three";
import { REFF } from "../model.js";

// Uniforms shared by reference across all environment materials; updated once per frame.
export const G = {
  uTime: { value: 0 },                               // real seconds, drives water and clouds
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uCamPos: { value: new THREE.Vector3() },           // camera position in rendered coordinates
  uCamAlt: { value: 0 },                             // camera altitude above the sea, km
  uDrift: { value: new THREE.Vector2() },            // water streaming past the hull (ship under way)
};

export const LOGDEPTH_V = { pars: "#include <common>\n#include <logdepthbuf_pars_vertex>", main: "#include <logdepthbuf_vertex>" };
export const LOGDEPTH_F = { pars: "#include <common>\n#include <logdepthbuf_pars_fragment>", main: "#include <logdepthbuf_fragment>" };

export const NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm4(vec2 p){ float a = 0.0, w = 0.5; for (int i = 0; i < 4; i++){ a += w * vnoise(p); p = p * 2.03 + vec2(17.7, 9.2); w *= 0.5; } return a; }
float fbm6(vec2 p){ float a = 0.0, w = 0.5; for (int i = 0; i < 6; i++){ a += w * vnoise(p); p = p * 2.03 + vec2(17.7, 9.2); w *= 0.5; } return a; }
`;

// The radar horizon in the model uses a 4/3-Earth radius. The scene is drawn on that same curved Earth
// (a paraboloid, exact to first order), so a straight radar beam in the picture is a straight ray in the model.
export const CURVE = /* glsl */`
const float REFF = ${REFF.toFixed(2)};
float earthDrop(vec2 xz){ return dot(xz, xz) / (2.0 * REFF); }
`;

export const SKY = /* glsl */`
uniform vec3 uSunDir; uniform float uCamAlt; uniform float uTime;
const vec3 SKY_ZEN = vec3(0.030, 0.085, 0.250);
const vec3 SKY_HOR = vec3(0.300, 0.430, 0.640);
const vec3 SKY_WARM = vec3(1.350, 0.620, 0.270);
const vec3 SUN_COL = vec3(1.000, 0.780, 0.540);

float lowSun(){ return 1.0 - smoothstep(0.0, 0.45, uSunDir.y); }

// Colour of the haze toward a horizontal direction: what distant things fade into.
vec3 hazeColor(vec3 d){
  float mu = dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), normalize(vec3(uSunDir.x, 0.0, uSunDir.z)));
  float sunward = pow(max(mu * 0.5 + 0.5, 0.0), 3.0);
  return mix(SKY_HOR, SKY_WARM * 0.85, sunward * lowSun() * 0.85);
}

// Sky radiance (linear, HDR) seen along d from altitude alt. Elevation is measured from the true, dipped horizon,
// so the limb stays in the right place as the camera climbs to orbit.
vec3 atmosphere(vec3 d, float alt, float disc){
  float dip = atan(sqrt(2.0 * max(alt, 0.0) / REFF));
  float el = max(asin(clamp(d.y, -1.0, 1.0)) + dip, 0.0);
  float space = smoothstep(14.0, 120.0, alt);
  float mu = dot(d, uSunDir), mup = max(mu, 0.0), ls = lowSun();
  float sunward = pow(max(mu * 0.5 + 0.5, 0.0), 3.0);
  float band = pow(1.0 - clamp(el / 1.5708, 0.0, 1.0), 6.0);
  vec3 hor = mix(SKY_HOR, SKY_WARM * 0.85, sunward * ls * 0.85);
  vec3 col = mix(SKY_ZEN, hor, band);
  col += SKY_WARM * ls * pow(mup, 5.0) * exp(-el * 10.0) * 0.8;                 // the orange strip under a low sun
  col += vec3(0.55, 0.30, 0.42) * ls * (1.0 - sunward) * exp(-el * 7.0) * 0.10; // belt of Venus opposite the sun
  col += SUN_COL * (pow(mup, 48.0) * 0.35 + pow(mup, 700.0) * 2.5);              // forward scattering around the sun
  // from orbit: black sky and a thin blue limb
  vec3 limb = mix(vec3(0.20, 0.42, 0.95), SKY_WARM, sunward * ls * 0.6) * (exp(-el * 30.0) * 1.3 + exp(-el * 7.0) * 0.12);
  col = mix(col, limb, space);
  col += SUN_COL * smoothstep(0.99990, 0.99996, mu) * 70.0 * disc;
  return col;
}

float starField(vec3 d){
  vec3 p = d * 190.0, i = floor(p), f = fract(p) - 0.5;
  float h = hash13(i);
  return (1.0 - smoothstep(0.0, 0.22, length(f + (vec3(hash13(i + 3.1), hash13(i + 7.7), hash13(i + 1.3)) - 0.5) * 0.5))) * step(0.955, h) * (0.35 + 0.65 * fract(h * 91.7));
}

// How much of a colour survives the air between the camera and a point at altitude hPoint, distance dist (km).
vec3 aerial(vec3 col, vec3 dir, float dist, float hPoint){
  float H = 5.0, h0 = max(uCamAlt, 0.0), h1 = max(hPoint, 0.0), dh = h1 - h0;
  float dens = abs(dh) < 0.01 ? exp(-h0 / H) : H * (exp(-h0 / H) - exp(-h1 / H)) / dh;
  float f = 1.0 - exp(-0.012 * dist * dens);
  return mix(col, hazeColor(dir), f);
}
`;

// Ocean surface: a sum of sharp-crested waves with derivative feedback ("drag") so crests bunch like real chop.
// Heights are in metres, positions in km. The same function runs in the vertex shader (swell), the fragment shader
// (normals) and in JS (ship motion), so the hull rides the water that is drawn.
export const WAVE_DRAG = 0.38, WAVE_BASE_M = 13.0, WAVE_GAIN = 1.18, WAVE_SPEED = 1.9, WAVE_HEIGHT_M = 1.5, WAVE_MEAN8 = 0.39;
export const WAVES = /* glsl */`
uniform vec2 uDrift;
vec2 wavedx(vec2 p, vec2 dir, float freq, float ph){ float x = dot(dir, p) * freq + ph; float w = exp(sin(x) - 1.0); return vec2(w, -w * cos(x)); }
// p in km. iters: how many octaves. cut: octaves with wavelength below this many metres are faded out (anti-aliasing).
float waveHeight(vec2 pk, int iters, float cut){
  vec2 p = (pk + uDrift) * (1000.0 / ${WAVE_BASE_M.toFixed(1)});
  float iter = 0.0, freq = 1.0, tm = ${WAVE_SPEED.toFixed(2)}, w = 1.0, sum = 0.0, norm = 0.0;
  for (int i = 0; i < iters; i++){
    float lambda = ${(2 * Math.PI * WAVE_BASE_M).toFixed(2)} / freq;                 // wavelength in metres
    float keep = smoothstep(cut, cut * 2.5, lambda);
    if (keep <= 0.0) break;
    vec2 dir = vec2(sin(iter), cos(iter));
    vec2 r = wavedx(p, dir, freq, uTime * tm);
    p += dir * r.y * w * ${WAVE_DRAG.toFixed(2)};
    sum += r.x * w * keep; norm += w;
    w *= 0.82; freq *= ${WAVE_GAIN.toFixed(2)}; tm *= 1.07; iter += 1232.399963;
  }
  return norm > 0.0 ? sum / 5.2 : 0.0;                                             // fixed normalisation: no popping as octaves fade
}
`;

// JS twin of waveHeight for the first `iters` octaves (metres of displacement at position x,z in km).
export function waveHeightJS(x, z, time, drift, iters = 8) {
  let px = (x + drift.x) * (1000 / WAVE_BASE_M), pz = (z + drift.y) * (1000 / WAVE_BASE_M);
  let iter = 0, freq = 1, tm = WAVE_SPEED, w = 1, sum = 0;
  for (let i = 0; i < iters; i++) {
    const dx = Math.sin(iter), dz = Math.cos(iter);
    const ph = (dx * px + dz * pz) * freq + time * tm, wv = Math.exp(Math.sin(ph) - 1), d = -wv * Math.cos(ph);
    px += dx * d * w * WAVE_DRAG; pz += dz * d * w * WAVE_DRAG;
    sum += wv * w;
    w *= 0.82; freq *= WAVE_GAIN; tm *= 1.07; iter += 1232.399963;
  }
  return (sum / 5.2 - WAVE_MEAN8) * WAVE_HEIGHT_M;
}
