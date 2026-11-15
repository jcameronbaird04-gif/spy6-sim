// Environment: sky, sun, ocean, the coastline, lighting. One instance per scene; geometry and materials are shared.
import * as THREE from "three";
import { REFF } from "../model.js";
import { CURVE, G, LOGDEPTH_F, LOGDEPTH_V, NOISE, SKY, WAVES, WAVE_HEIGHT_M, WAVE_MEAN8 } from "./glsl.js";

export const SUN_ELEV = 9, SUN_AZIM = 152;               // degrees; azimuth clockwise from north. Early morning, sun to the south-east.
export const sunDir = new THREE.Vector3();
{
  const e = THREE.MathUtils.degToRad(SUN_ELEV), a = THREE.MathUtils.degToRad(SUN_AZIM);
  sunDir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
  G.uSunDir.value.copy(sunDir);
}
export const earthDrop = (x, z) => (x * x + z * z) / (2 * REFF);
// Model position (flat-Earth km) -> rendered position on the curved Earth.
export const toScene = (p, out) => out.set(p.x, p.y - earthDrop(p.x, p.z), p.z);

const shared = extra => Object.assign({ uTime: G.uTime, uSunDir: G.uSunDir, uCamPos: G.uCamPos, uCamAlt: G.uCamAlt, uDrift: G.uDrift }, extra);

// ------------------------------------------------------------------ sky
function skyMaterial(env) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: shared({ uEnv: { value: env ? 1 : 0 } }),
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = viewMatrix * vec4(position, 0.0); gl_Position = projectionMatrix * vec4(p.xyz, 1.0); gl_Position.z = gl_Position.w * 0.9999; }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir; uniform float uEnv;
      ${NOISE}${CURVE}${SKY}
      void main(){
        vec3 d = normalize(vDir);
        float alt = uEnv > 0.5 ? 0.0 : uCamAlt;
        vec3 col = atmosphere(d, alt, 1.0 - uEnv);
        float space = smoothstep(14.0, 120.0, alt);
        // high cirrus, lit from below by the low sun; gone once the camera climbs through it
        if (d.y > 0.0 && alt < 11.0) {
          vec2 uv = d.xz / (d.y + 0.10) * 0.55 + uTime * vec2(0.0016, 0.0006);
          float n = fbm6(uv * vec2(0.55, 1.5) + fbm4(uv * 0.7) * 0.9);
          float cov = smoothstep(0.50, 0.86, n) * smoothstep(0.015, 0.22, d.y) * (1.0 - smoothstep(4.0, 11.0, alt));
          float mu = max(dot(d, uSunDir), 0.0);
          vec3 lit = mix(vec3(0.52, 0.60, 0.76), SKY_WARM * 1.25, lowSun() * (0.25 + 0.75 * pow(mu, 2.0)));
          col = mix(col, lit, cov * 0.62);
        }
        if (uEnv < 0.5) {
          float dip = atan(sqrt(2.0 * max(alt, 0.0) / REFF));
          float up = smoothstep(0.02, 0.5, asin(clamp(d.y, -1.0, 1.0)) + dip);
          col += vec3(0.9, 0.95, 1.0) * starField(d) * mix(0.05 * up, 1.6, space);
        } else if (d.y < 0.0) col = mix(col, vec3(0.01, 0.035, 0.06), (1.0 - smoothstep(-0.08, 0.0, d.y)));   // sea below, for reflections on the hull
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
const skyGeo = new THREE.SphereGeometry(1, 48, 32);

// ------------------------------------------------------------------ ocean
// A polar grid that follows the camera: fine near the eye, reaching past the horizon even from orbit.
const oceanGeo = (() => {
  const NR = 190, NS = 256, pos = new Float32Array((NR + 1) * NS * 2), idx = [];
  for (let i = 0; i <= NR; i++) {
    const r = 0.0015 * (Math.pow(1.07, i) - 1) / 0.07;
    for (let j = 0; j < NS; j++) { const a = j / NS * Math.PI * 2, k = (i * NS + j) * 2; pos[k] = Math.cos(a) * r; pos[k + 1] = Math.sin(a) * r; }
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) {
    const a = i * NS + j, b = i * NS + (j + 1) % NS, c = a + NS, d = b + NS;
    if (i === 0) idx.push(a, c, d); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((NR + 1) * NS * 3), 3));
  g.setAttribute("xz", new THREE.BufferAttribute(pos, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
})();
const oceanMat = new THREE.ShaderMaterial({
  fog: false, side: THREE.DoubleSide,
  uniforms: shared({ uCenter: { value: new THREE.Vector2() }, uShipHeave: { value: 0 } }),
  vertexShader: /* glsl */`
    ${LOGDEPTH_V.pars}
    attribute vec2 xz; uniform vec2 uCenter; uniform vec3 uCamPos; uniform float uTime;
    varying vec3 vW; varying float vAlt;
    ${CURVE}${WAVES}
    void main(){
      vec2 p = xz + uCenter;
      float d = length(xz);
      float swell = (waveHeight(p, 8, 0.0) - ${WAVE_MEAN8.toFixed(2)}) * ${(WAVE_HEIGHT_M / 1000).toFixed(5)} * (1.0 - smoothstep(0.4, 2.5, d));
      vAlt = swell;
      vW = vec3(p.x, swell - earthDrop(p), p.y);
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      ${LOGDEPTH_V.main}
    }`,
  fragmentShader: /* glsl */`
    ${LOGDEPTH_F.pars}
    uniform vec3 uCamPos; varying vec3 vW; varying float vAlt;
    ${NOISE}${CURVE}${SKY}${WAVES}
    // foam the ship leaves: hull wash, turbulent centre line astern, Kelvin arms
    float shipFoam(vec2 p, float t){
      vec2 q = p * 1000.0;                                   // metres; bow at -z, stern at +z
      float along = q.y, across = abs(q.x);
      float hull = 1.0 - smoothstep(0.0, 1.0, max((across - 10.3) / 4.5, (abs(along) - 78.0) / 9.0) + 0.55 * step(along, 0.0) * smoothstep(20.0, 78.0, -along) * across / 10.3);
      float Y = max(along - 70.0, 0.0);
      float n = fbm4(vec2(q.x * 0.22, (along - t * 7.5) * 0.10)), n2 = fbm4(vec2(q.x * 0.9, (along - t * 7.5) * 0.4));
      float core = exp(-pow(across / (6.0 + 0.012 * Y + 0.9 * sqrt(Y * 0.3)), 2.0)) * exp(-Y / 330.0) * step(70.0, along) * 0.8;
      float arm = abs(across - (9.0 + (along + 62.0) * 0.34));
      float kelvin = exp(-pow(arm / (1.6 + (along + 62.0) * 0.03), 2.0)) * exp(-(along + 62.0) / 260.0) * step(-62.0, along) * 0.45;
      float wash = hull * 0.55;
      return clamp(core * (0.25 + 1.0 * n) * smoothstep(0.25, 0.7, n + core * 0.4) + kelvin * smoothstep(0.35, 0.75, n2) + wash * (0.4 + 0.9 * n2), 0.0, 1.0);
    }
    void main(){
      ${LOGDEPTH_F.main}
      vec3 toCam = uCamPos - vW; float dist = length(toCam); vec3 V = toCam / dist;
      vec2 p = vW.xz;
      // pixel footprint on the water in metres: waves smaller than this are filtered into roughness instead of aliasing
      float foot = dist * 1000.0 * 0.0011 / max(abs(V.y), 0.035);
      float cut = foot * 2.0;
      float e = max(0.00012, foot * 0.0006);
      float h0 = waveHeight(p, 26, cut), hx = waveHeight(p + vec2(e, 0.0), 26, cut), hz = waveHeight(p + vec2(0.0, e), 26, cut);
      float amp = ${WAVE_HEIGHT_M.toFixed(2)} * 1.25;
      vec3 N = normalize(vec3(-(hx - h0) * amp / (e * 1000.0), 1.0, -(hz - h0) * amp / (e * 1000.0)));
      // kilometre-scale wind patches keep the sea alive from altitude
      float patchN = fbm4(p * 0.16 + uTime * 0.0015);
      float rough = clamp(0.028 + 0.11 * smoothstep(6.0, 400.0, foot) + 0.06 * (patchN - 0.5), 0.02, 0.35);
      N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(40.0, 2500.0, foot)));
      float NV = clamp(dot(N, V), 0.0, 1.0);
      float F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
      F = mix(F, 0.02 + 0.98 * pow(1.0 - NV, 5.0) * 0.55, smoothstep(40.0, 2500.0, foot));     // sub-pixel waves flatten grazing reflections
      vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.02; R = normalize(R);
      vec3 refl = atmosphere(R, 0.0, 0.0);
      vec3 deep = vec3(0.004, 0.030, 0.052) + vec3(0.0, 0.050, 0.052) * max(uSunDir.y, 0.0) * 2.0 * (0.4 + 0.6 * patchN);
      deep += vec3(0.0, 0.07, 0.065) * smoothstep(0.52, 0.9, h0) * pow(max(dot(V, -normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);   // light through crests
      vec3 col = mix(deep, refl, F);
      // sun glitter (GGX), widened with distance
      vec3 Hh = normalize(uSunDir + V); float NH = max(dot(N, Hh), 0.0), a2 = rough * rough * rough * rough;
      float D = a2 / (3.14159 * pow(NH * NH * (a2 - 1.0) + 1.0, 2.0));
      col += SUN_COL * min(D, 4000.0) * (0.02 + 0.98 * pow(1.0 - clamp(dot(V, Hh), 0.0, 1.0), 5.0)) * max(dot(N, uSunDir), 0.0) * 5.5 * (1.0 - lowSun() * 0.35);
      // whitecaps and the ship's wake, near field only
      if (dist < 9.0) {
        float crest = smoothstep(0.74, 0.97, h0) * smoothstep(0.45, 0.75, fbm4(p * 420.0 + uDrift * 420.0));
        float foam = crest * 0.5 * (1.0 - smoothstep(2.0, 9.0, dist));
        if (dot(p, p) < 9.0) foam = max(foam, shipFoam(p, uTime) * 0.92);
        vec3 foamCol = (hazeColor(V) * 0.55 + SUN_COL * max(uSunDir.y, 0.0) * 2.2 + 0.12) * vec3(0.92, 0.96, 1.0);
        col = mix(col, foamCol, foam);
      }
      // cloud deck seen from above
      if (uCamAlt > 6.0) {
        vec2 cu = p * 0.011 + uTime * vec2(0.0005, 0.0002);
        float cn = fbm6(cu + fbm4(cu * 0.5) * 1.2);
        float cov = smoothstep(0.62, 0.96, cn) * smoothstep(6.0, 30.0, uCamAlt) * 0.38;
        col = mix(col, hazeColor(V) * 0.7 + SUN_COL * uSunDir.y * 3.2 + 0.05, cov);
      }
      col = aerial(col, -V, dist, 0.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
});

// ------------------------------------------------------------------ coastline
function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - w) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * w;
}
const fbmJS = (x, z, oct = 5) => { let a = 0, f = 1, amp = 0.5; for (let i = 0; i < oct; i++) { a += amp * noise2(x * f, z * f); f *= 2.1; amp *= 0.5; } return a; };
export const coastX = z => 128 + 16 * Math.sin(z / 95) + 7 * Math.sin(z / 29 + 1.3) + 3 * Math.sin(z / 9);
const landGeo = (() => {
  const W = 1500, L = 2600, geo = new THREE.PlaneGeometry(W, L, 420, 700);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, hs = new Float32Array(pos.count);
  const X0 = 96 + W / 2, Z0 = -300;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + X0, z = pos.getZ(i) + Z0, u = x - coastX(z);
    let h;
    if (u < 0) h = Math.max(-0.5, u * 0.02);
    else {
      const ramp = Math.min(u / 46, 1), r = 1 - Math.abs(fbmJS(x / 26 + 7, z / 26, 5) - 0.5) * 2;      // ridged ranges inland
      h = 0.004 + u * 0.004 * (1 - ramp) + ramp * ramp * (0.5 + 2.9 * r * r * fbmJS(x / 70, z / 70, 3) * 2.0) + 0.05 * fbmJS(x / 2.5, z / 2.5, 4) * Math.min(u / 6, 1);
    }
    pos.setXYZ(i, x, h, z); hs[i] = h;
  }
  geo.computeVertexNormals();
  return geo;
})();
const landMat = new THREE.ShaderMaterial({
  fog: false,
  uniforms: shared({}),
  vertexShader: /* glsl */`
    ${LOGDEPTH_V.pars}
    varying vec3 vW; varying vec3 vN; varying float vH;
    ${CURVE}
    void main(){ vH = position.y; vN = normal; vW = vec3(position.x, position.y * 1.0 - earthDrop(position.xz), position.z);
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      ${LOGDEPTH_V.main}
    }`,
  fragmentShader: /* glsl */`
    ${LOGDEPTH_F.pars}
    uniform vec3 uCamPos; varying vec3 vW; varying vec3 vN; varying float vH;
    ${NOISE}${CURVE}${SKY}
    void main(){
      ${LOGDEPTH_F.main}
      if (vH < -0.02) discard;
      vec3 N = normalize(vN); vec2 p = vW.xz;
      float n = fbm6(p * 0.35), n2 = fbm4(p * 0.07 + 3.0);
      vec3 sand = vec3(0.56, 0.44, 0.30), plain = vec3(0.40, 0.31, 0.21), rock = vec3(0.20, 0.155, 0.125), wadi = vec3(0.30, 0.27, 0.19);
      vec3 alb = mix(sand, plain, smoothstep(0.01, 0.25, vH));
      alb = mix(alb, rock, smoothstep(0.35, 1.9, vH + (n - 0.5) * 0.5) * 0.9 + (1.0 - N.y) * 1.6 * smoothstep(0.1, 0.5, vH));
      alb = mix(alb, wadi, smoothstep(0.62, 0.8, n2) * 0.5 * (1.0 - smoothstep(0.3, 1.2, vH)));
      alb *= 0.90 + 0.20 * n;
      float sun = max(dot(N, uSunDir), 0.0);
      vec3 col = alb * (SUN_COL * sun * 2.6 + SKY_HOR * (0.30 + 0.25 * N.y));
      vec3 toP = vW - uCamPos; float dist = length(toP);
      col = aerial(col, toP / dist, dist, vH);
      gl_FragColor = vec4(col, 1.0);
    }`,
});

// ------------------------------------------------------------------ assembly
let envMap = null;
export function buildEnvironmentMap(renderer) {
  const s = new THREE.Scene(), m = new THREE.Mesh(skyGeo, skyMaterial(true)); m.scale.setScalar(100); s.add(m);
  const pm = new THREE.PMREMGenerator(renderer);
  envMap = pm.fromScene(s, 0, 0.1, 1000).texture;
  pm.dispose();
  return envMap;
}

export class Environment {
  constructor(scene) {
    this.sky = new THREE.Mesh(skyGeo, skyMat); this.sky.scale.setScalar(1); this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.ocean = new THREE.Mesh(oceanGeo, oceanMat); this.ocean.frustumCulled = false; this.ocean.renderOrder = -5;
    this.land = new THREE.Mesh(landGeo, landMat); this.land.frustumCulled = false;
    scene.add(this.sky, this.ocean, this.land);
    scene.environment = envMap; scene.environmentIntensity = 0.9;
    scene.fog = new THREE.FogExp2(0x6f8fb4, 0.004);

    const sun = this.sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.76, 0.50), 4.2);
    sun.position.copy(sunDir).multiplyScalar(0.6); sun.target.position.set(0, 0, 0);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -0.12, right: 0.12, top: 0.12, bottom: -0.12, near: 0.1, far: 1.2 });
    sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.00012;
    scene.add(sun, sun.target, new THREE.HemisphereLight(new THREE.Color(0.45, 0.62, 1.0), new THREE.Color(0.03, 0.06, 0.09), 0.55));
  }
}
const skyMat = skyMaterial(false);

const _c = new THREE.Color();
// Once per frame, before any scene renders.
export function updateEnvironment(camera, timeSec, scenes) {
  const alt = camera.position.y + earthDrop(camera.position.x, camera.position.z);
  G.uTime.value = timeSec; G.uCamPos.value.copy(camera.position); G.uCamAlt.value = alt;
  G.uDrift.value.set(0, -timeSec * 0.0072);            // ship making 14 knots north: the sea streams aft
  oceanMat.uniforms.uCenter.value.set(camera.position.x, camera.position.z);
  for (const s of scenes) {
    s.fog.density = 0.004 * Math.exp(-Math.max(alt, 0) / 6);
    s.fog.color.copy(_c.setRGB(0.30, 0.43, 0.64));
  }
}
