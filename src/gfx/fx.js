// Effects: constant-width lines, radar beams, coverage domes, particles, glow markers.
import * as THREE from "three";
import { LOGDEPTH_F, LOGDEPTH_V, NOISE } from "./glsl.js";
import { sunDir } from "./env.js";

// Size in pixels of the view being drawn; set before each view renders (split screen has two).
export const VIEW = { uViewport: { value: new THREE.Vector2(1280, 720) }, uPxAngle: { value: 0.001 } };

// ------------------------------------------------------------------ lines with a width in pixels
const lineVS = /* glsl */`
  ${LOGDEPTH_V.pars}
  attribute vec3 prev; attribute vec3 next; attribute float side; attribute float along;
  uniform vec2 uViewport; uniform float uWidth;
  varying float vAlong; varying float vSide;
  void main(){
    vAlong = along; vSide = side;
    mat4 vp = projectionMatrix * viewMatrix * modelMatrix;
    vec4 c = vp * vec4(position, 1.0), a = vp * vec4(prev, 1.0), b = vp * vec4(next, 1.0);
    vec2 cs = c.xy / max(abs(c.w), 1e-6) * uViewport, as = a.xy / max(abs(a.w), 1e-6) * uViewport, bs = b.xy / max(abs(b.w), 1e-6) * uViewport;
    vec2 d = bs - as; d = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
    vec2 n = vec2(-d.y, d.x);
    c.xy += n * side * uWidth / uViewport * c.w;
    gl_Position = c;
    ${LOGDEPTH_V.main}
  }`;
const lineFS = /* glsl */`
  ${LOGDEPTH_F.pars}
  uniform vec3 uColor; uniform float uOpacity, uDash, uFade, uLen, uGlow;
  varying float vAlong; varying float vSide;
  void main(){
    ${LOGDEPTH_F.main}
    float a = uOpacity * (1.0 - smoothstep(0.55, 1.0, abs(vSide)));
    if (uDash > 0.0) a *= step(0.5, fract(vAlong / uDash));
    if (uFade > 0.0) a *= pow(clamp(vAlong / max(uLen, 1e-6), 1e-4, 1.0), uFade);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * uGlow, a);
  }`;

export class ScreenLine {
  constructor(maxPoints, { color = 0xffffff, width = 1.5, opacity = 1, dash = 0, fade = 0, glow = 1, additive = false } = {}) {
    this.max = maxPoints; this.n = 0;
    const g = this.geo = new THREE.BufferGeometry(), N = maxPoints * 2;
    this.pos = new Float32Array(N * 3); this.prev = new Float32Array(N * 3); this.next = new Float32Array(N * 3); this.along = new Float32Array(N);
    const side = new Float32Array(N), idx = [];
    for (let i = 0; i < maxPoints; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; if (i < maxPoints - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3)); g.setAttribute("prev", new THREE.BufferAttribute(this.prev, 3)); g.setAttribute("next", new THREE.BufferAttribute(this.next, 3));
    g.setAttribute("side", new THREE.BufferAttribute(side, 1)); g.setAttribute("along", new THREE.BufferAttribute(this.along, 1));
    g.setIndex(idx); g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uViewport: VIEW.uViewport, uColor: { value: new THREE.Color(color) }, uWidth: { value: width }, uOpacity: { value: opacity }, uDash: { value: dash }, uFade: { value: fade }, uLen: { value: 1 }, uGlow: { value: glow } },
      vertexShader: lineVS, fragmentShader: lineFS,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
  }
  // pts: flat array [x,y,z,...] of n points in scene coordinates
  set(pts, n = pts.length / 3) {
    n = Math.min(n, this.max); this.n = n;
    let len = 0;
    for (let i = 0; i < n; i++) {
      const p = i * 3, a = Math.max(i - 1, 0) * 3, b = Math.min(i + 1, n - 1) * 3;
      if (i) len += Math.hypot(pts[p] - pts[p - 3], pts[p + 1] - pts[p - 2], pts[p + 2] - pts[p - 1]);
      for (let s = 0; s < 2; s++) { const k = (i * 2 + s) * 3;
        this.pos[k] = pts[p]; this.pos[k + 1] = pts[p + 1]; this.pos[k + 2] = pts[p + 2];
        this.prev[k] = pts[a]; this.prev[k + 1] = pts[a + 1]; this.prev[k + 2] = pts[a + 2];
        this.next[k] = pts[b]; this.next[k + 1] = pts[b + 1]; this.next[k + 2] = pts[b + 2];
        this.along[i * 2 + s] = len; }
    }
    this.mat.uniforms.uLen.value = len;
    for (const k of ["position", "prev", "next", "along"]) { const at = this.geo.attributes[k]; at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, n * 2 * at.itemSize); }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.mesh.visible = n > 1;
  }
}

// ------------------------------------------------------------------ radar beams
// A beam is drawn at its true angular width (the model's 1.6 degree pencil beam), with a floor of a few pixels so
// it never vanishes at a distance. Energy pulses travel outward along it.
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 16, true); beamGeo.translate(0, 0.5, 0); beamGeo.rotateX(Math.PI / 2);   // axis +z, base at origin
export const BEAM_HALF = THREE.MathUtils.degToRad(0.8);
export class Beam {
  constructor(color) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uTime: { value: 0 }, uLen: { value: 1 }, uTan: { value: Math.tan(BEAM_HALF) }, uPxAngle: VIEW.uPxAngle, uMinPx: { value: 1.6 } },
      vertexShader: /* glsl */`
        ${LOGDEPTH_V.pars}
        uniform float uLen, uTan, uPxAngle, uMinPx;
        varying float vZ; varying vec3 vN; varying vec3 vV; varying float vThin;
        void main(){
          float z = position.z * uLen; vZ = z;
          vec4 axis = modelViewMatrix * vec4(0.0, 0.0, z, 1.0);
          float rTrue = max(z * uTan, 0.0006), rMin = -axis.z * uPxAngle * uMinPx, r = max(rTrue, rMin);
          vThin = clamp(rTrue / max(rMin, 1e-6), 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position.xy * r, z, 1.0);
          vN = normalize(normalMatrix * vec3(position.xy, 0.0)); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          ${LOGDEPTH_V.main}
        }`,
      fragmentShader: /* glsl */`
        ${LOGDEPTH_F.pars}
        uniform vec3 uColor; uniform float uOpacity, uTime, uLen;
        varying float vZ; varying vec3 vN; varying vec3 vV; varying float vThin;
        void main(){
          ${LOGDEPTH_F.main}
          float face = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
          float core = mix(1.0, pow(face, 1.8), vThin);                       // soft-edged tube once it is wider than a few pixels
          float pulse = 0.72 + 0.28 * pow(0.5 + 0.5 * sin(log(vZ + 0.02) * 9.0 - uTime * 7.0), 3.0);
          float nearFade = smoothstep(0.004, 0.08, vZ);
          float a = uOpacity * core * pulse * nearFade * mix(1.0, 0.45, vThin);
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(beamGeo, this.mat); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 6;
    this.level = 0;
  }
  aim(from, to) { this.mesh.position.copy(from); this.mesh.lookAt(to); this.mat.uniforms.uLen.value = from.distanceTo(to); }
  show(opacity, time) { this.mat.uniforms.uOpacity.value = opacity; this.mat.uniforms.uTime.value = time; this.mesh.visible = opacity > 0.004; }
}

// ------------------------------------------------------------------ coverage dome
// The volume in which the radar can detect a reference target: a sphere of the detection range, standing on the
// plane of the radar horizon. Inside a jammed sector the radius shrinks by the model's loss factor.
const domeGeo = new THREE.SphereGeometry(1, 144, 40, 0, Math.PI * 2, 0, Math.PI / 2);
export class Dome {
  constructor(color, radius) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uR: { value: radius }, uTime: { value: 0 }, uJam: { value: new THREE.Vector4(0, 0, 1, 0) } },   // bearing rad, half-width rad, range kept, on
      vertexShader: /* glsl */`
        ${LOGDEPTH_V.pars}
        uniform float uR; uniform vec4 uJam;
        varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vJam;
        void main(){
          vec3 p = position;
          float brg = abs(p.x) + abs(p.z) < 1e-5 ? 0.0 : atan(p.x, -p.z), dj = abs(atan(sin(brg - uJam.x), cos(brg - uJam.x)));   // atan(0,0) is undefined at the zenith
          float inJam = uJam.w * (1.0 - smoothstep(uJam.y * 0.92, uJam.y * 1.08, dj));
          vJam = inJam;
          float r = uR * mix(1.0, uJam.z, inJam);
          vP = p; vec4 mv = modelViewMatrix * vec4(p * r, 1.0);
          vN = normalize(normalMatrix * p); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          ${LOGDEPTH_V.main}
        }`,
      fragmentShader: /* glsl */`
        ${LOGDEPTH_F.pars}
        uniform vec3 uColor; uniform float uOpacity, uTime;
        varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vJam;
        void main(){
          ${LOGDEPTH_F.main}
          float rim = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.6);
          float el = asin(clamp(vP.y, 0.0, 1.0)), az = abs(vP.x) + abs(vP.z) < 1e-5 ? 0.0 : atan(vP.x, -vP.z);
          float grid = max((1.0 - smoothstep(0.0, 0.035, abs(fract(el * 5.7296) - 0.5) - 0.465)), (1.0 - smoothstep(0.0, 0.035, abs(fract(az * 3.8197) - 0.5) - 0.48)) * (1.0 - smoothstep(1.2, 1.45, el)));
          float base = (1.0 - smoothstep(0.0, 0.05, vP.y));
          float a = uOpacity * (rim * 0.34 + grid * 0.045 + base * 0.20 + 0.012);
          vec3 col = mix(uColor, vec3(1.0, 0.45, 0.2), vJam * 0.75);
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(domeGeo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
  }
}

// ------------------------------------------------------------------ particles
// GPU point sprites: smoke (alpha-blended, lit by the sun) and fire (additive). Time is scenario time.
export class Particles {
  constructor(count, additive) {
    this.count = count; this.cur = 0; this.dirty = false;
    const g = this.geo = new THREE.BufferGeometry();
    this.a = { position: new Float32Array(count * 3), vel: new Float32Array(count * 3), life: new Float32Array(count * 2), size: new Float32Array(count * 2), color: new Float32Array(count * 4) };
    this.a.life.fill(-1e9);
    g.setAttribute("position", new THREE.BufferAttribute(this.a.position, 3)); g.setAttribute("vel", new THREE.BufferAttribute(this.a.vel, 3));
    g.setAttribute("life", new THREE.BufferAttribute(this.a.life, 2)); g.setAttribute("size", new THREE.BufferAttribute(this.a.size, 2)); g.setAttribute("color", new THREE.BufferAttribute(this.a.color, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uNow: { value: 0 }, uPxAngle: VIEW.uPxAngle, uSun: { value: sunDir }, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: /* glsl */`
        ${LOGDEPTH_V.pars}
        attribute vec3 vel; attribute vec2 life; attribute vec2 size; attribute vec4 color;
        uniform float uNow, uPxAngle;
        varying float vAge; varying vec4 vColor; varying float vSeed;
        void main(){
          float age = (uNow - life.x) / life.y; vAge = age; vColor = color; vSeed = fract(life.x * 7.31 + position.x * 91.7);
          if (age < 0.0 || age > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          float t = age * life.y;
          vec3 p = position + vel * t * (1.0 - 0.45 * age);                      // drag
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float sz = mix(size.x, size.y, sqrt(age)) * 0.001;
          gl_PointSize = clamp(sz / (max(-mv.z, 1e-4) * uPxAngle), 1.0, 420.0);
          gl_Position = projectionMatrix * mv;
          ${LOGDEPTH_V.main}
        }`,
      fragmentShader: /* glsl */`
        ${LOGDEPTH_F.pars}
        ${NOISE}
        uniform vec3 uSun; uniform float uAdd;
        varying float vAge; varying vec4 vColor; varying float vSeed;
        void main(){
          ${LOGDEPTH_F.main}
          vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
          float soft = 1.0 - r * r; soft *= soft;
          if (uAdd > 0.5) { float a = soft * pow(1.0 - vAge, 1.5) * vColor.a; gl_FragColor = vec4(vColor.rgb * a, a); return; }
          float n = fbm4(c * 3.2 + vSeed * 40.0 + vAge * 0.6);
          float a = soft * smoothstep(0.18 + vAge * 0.35, 0.75, n + soft * 0.45) * pow(1.0 - vAge, 1.3) * vColor.a;
          float lit = 0.55 + 0.45 * clamp(0.5 - c.y * 1.2 + (n - 0.5), 0.0, 1.0);
          vec3 col = vColor.rgb * (vec3(0.30, 0.38, 0.52) * 0.42 + vec3(1.0, 0.74, 0.5) * 0.95 * lit * max(uSun.y * 3.0, 0.25));
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 8 : 7;
  }
  // p: position, v: velocity km/s, t: birth time, life seconds, s0/s1: size in metres at birth/death, rgb + alpha
  emit(p, v, t, life, s0, s1, r, g, b, alpha, jitter = 0) {
    const i = this.cur; this.cur = (this.cur + 1) % this.count; const A = this.a, J = () => (Math.random() - 0.5) * jitter;
    A.position[i * 3] = p.x + J(); A.position[i * 3 + 1] = p.y + J(); A.position[i * 3 + 2] = p.z + J();
    A.vel[i * 3] = v.x; A.vel[i * 3 + 1] = v.y; A.vel[i * 3 + 2] = v.z;
    A.life[i * 2] = t; A.life[i * 2 + 1] = life * (0.75 + Math.random() * 0.5);
    A.size[i * 2] = s0; A.size[i * 2 + 1] = s1 * (0.75 + Math.random() * 0.5);
    A.color[i * 4] = r; A.color[i * 4 + 1] = g; A.color[i * 4 + 2] = b; A.color[i * 4 + 3] = alpha;
    this.dirty = true;
  }
  clear() { this.a.life.fill(-1e9); this.dirty = true; }
  flush(now) { this.mat.uniforms.uNow.value = now; if (!this.dirty) return; this.dirty = false; for (const k in this.a) this.geo.attributes[k].needsUpdate = true; }
}

// ------------------------------------------------------------------ glow sprites
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  [[0, "rgba(255,255,255,1)"], [0.12, "rgba(255,255,255,.85)"], [0.3, "rgba(255,255,255,.28)"], [0.6, "rgba(255,255,255,.06)"], [1, "rgba(255,255,255,0)"]].forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return glowTex = new THREE.CanvasTexture(c);
}
// A glow whose size is fixed on screen (fraction of the view height) or in the world.
export function glowSprite(color, { screen = true, intensity = 1 } = {}) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, sizeAttenuation: !screen });
  const s = new THREE.Sprite(m); s.visible = false; s.renderOrder = 9; s.userData.base = new THREE.Color(color); return s;
}

// Expanding ring for intercepts (always faces the camera).
const ringGeo = new THREE.RingGeometry(0.86, 1, 64);
export function shockRing(color) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.visible = false; m.renderOrder = 9; return m;
}
