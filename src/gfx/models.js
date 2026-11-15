// Threat and interceptor models, built in metres with the nose along +z, returned scaled to km.
// Generic shapes from public imagery: no dimensions here feed the simulation.
import * as THREE from "three";

const M = 0.001;
const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.1 }, o));
const MAT = {
  white: std(0xdfe1dc, { roughness: 0.38 }), grey: std(0x8d949a), dark: std(0x1c1f22, { roughness: 0.6 }), khaki: std(0x9a917a, { roughness: 0.7 }),
  olive: std(0x5d6348, { roughness: 0.65 }), steel: std(0x3a3d40, { metalness: 0.7, roughness: 0.35 }), band: std(0xb3441e), sand: std(0xb9ab8c, { roughness: 0.7 }),
};
// Body of revolution from a profile [[z, radius], ...] running tail -> nose.
function lathe(profile, mat, seg = 20) {
  const pts = profile.map(([z, r]) => new THREE.Vector2(Math.max(r, 0.0001), z));
  const g = new THREE.LatheGeometry(pts, seg); g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, mat);
}
// Swept fin: root chord along z at radius r0, tip at r1.
function fin(g, z0, rootChord, tipChord, r0, r1, sweep, mat, n = 4, phase = Math.PI / 4, th = 0.035) {
  const sh = new THREE.Shape(); sh.moveTo(0, r0); sh.lineTo(rootChord, r0); sh.lineTo(rootChord - sweep, r1); sh.lineTo(rootChord - sweep - tipChord, r1); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false }); geo.translate(0, 0, -th / 2);
  for (let i = 0; i < n; i++) { const f = new THREE.Mesh(geo, mat), piv = new THREE.Group(); f.rotation.y = -Math.PI / 2; f.position.z = z0; piv.add(f); piv.rotation.z = phase + i * Math.PI * 2 / n; g.add(piv); }
}
function plume(len, rad, color) {
  const geo = new THREE.ConeGeometry(rad, len, 14, 1, true); geo.translate(0, len / 2, 0); geo.rotateX(-Math.PI / 2);     // base at the nozzle (origin), tip trailing to -z
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  m.renderOrder = 8; return m;
}
const wrap = (g, len, extra = {}) => { g.traverse(o => { if (o.isMesh && !o.material.transparent) o.castShadow = true; }); const root = new THREE.Group(); g.scale.setScalar(M); root.add(g); return Object.assign({ root, len }, extra); };

// One-way attack drone: delta wing, pusher propeller (Shahed-136 class).
export function buildDrone() {
  const g = new THREE.Group();
  g.add(lathe([[-1.5, 0.12], [-1.35, 0.26], [0.2, 0.27], [1.1, 0.2], [1.65, 0.07], [1.72, 0]], MAT.sand));
  const sh = new THREE.Shape(); sh.moveTo(0, 1.25); sh.lineTo(1.25, -1.2); sh.lineTo(1.25, -1.55); sh.lineTo(-1.25, -1.55); sh.lineTo(-1.25, -1.2); sh.closePath();
  const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.05, bevelSegments: 2 }), MAT.sand); wing.rotation.x = Math.PI / 2; wing.position.y = 0.035; g.add(wing);
  for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.62, 0.55), MAT.sand); t.position.set(s * 1.23, 0, -1.3); g.add(t); }
  const prop = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })); prop.position.z = -1.56; g.add(prop);
  return wrap(g, 3.5);
}
// Sea-skimming anti-ship cruise missile.
export function buildCruise() {
  const g = new THREE.Group();
  g.add(lathe([[-2.9, 0.2], [-2.7, 0.27], [1.9, 0.27], [2.6, 0.18], [3.0, 0.05], [3.05, 0]], MAT.white));
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.035, 0.5), MAT.white); w.position.set(s * 0.82, 0, 0.1); w.rotation.y = s * -0.22; g.add(w); }
  fin(g, -2.8, 0.5, 0.25, 0.25, 0.75, 0.2, MAT.white);
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 1.1), MAT.dark); intake.position.set(0, -0.32, -1.6); g.add(intake);
  const pl = plume(1.6, 0.13, 0xffb070); pl.position.z = -2.9; g.add(pl);
  return wrap(g, 6);
}
// Ballistic missile: booster stack during boost, bare re-entry vehicle afterwards.
export function buildBallistic(len) {
  const g = new THREE.Group(), body = new THREE.Group(), rv = new THREE.Group(), h = len / 2;
  body.add(lathe([[-h, 0.38], [-h + 0.3, 0.44], [h * 0.45, 0.44], [h * 0.55, 0.36], [h * 0.8, 0.3], [h * 0.97, 0.06], [h, 0]], MAT.olive, 24));
  const bandM = lathe([[h * 0.42, 0.445], [h * 0.47, 0.445]], MAT.dark, 24); body.add(bandM);
  fin(body, -h, 1.1, 0.5, 0.42, 1.05, 0.45, MAT.olive, 4, 0, 0.05);
  const pl = plume(len * 1.7, 0.42, 0xffa860); pl.position.z = -h; body.add(pl);
  rv.add(lathe([[-1.3, 0.0], [-1.25, 0.4], [1.2, 0.05], [1.3, 0]], MAT.steel, 20));
  g.add(body, rv); rv.visible = false;
  return wrap(g, len, { body, rv, plume: pl });
}
// Standard Missile family. SM-2: single stage. SM-6 / SM-3: with a booster stage.
export function buildInterceptor(kind) {
  const g = new THREE.Group(), long = kind !== "SM-2", len = long ? 6.6 : 4.7, h = len / 2, r = 0.17, rb = kind === "SM-3" ? 0.27 : long ? 0.25 : r;
  const body = long ? [[-h, rb * 0.8], [-h + 0.15, rb], [-h + 1.7, rb], [-h + 1.9, r], [h - 0.9, r], [h - 0.25, 0.06], [h, 0]] : [[-h, r * 0.85], [-h + 0.1, r], [h - 0.9, r], [h - 0.25, 0.06], [h, 0]];
  g.add(lathe(body, MAT.white, 18));
  g.add(lathe([[h - 1.5, r + 0.004], [h - 1.38, r + 0.004]], MAT.band, 18));
  fin(g, -h + (long ? 1.95 : 0.1), 0.55, 0.3, r, 0.52, 0.2, MAT.white);                 // tail control fins
  fin(g, -h + (long ? 2.7 : 0.9), 1.7, 1.2, r, 0.3, 0.45, MAT.white);                   // long dorsal strakes
  if (long) fin(g, -h + 0.05, 0.5, 0.3, rb, 0.6, 0.15, MAT.grey);
  const pl = plume(len * 1.5, rb * 0.85, 0xffd9a0); pl.position.z = -h; g.add(pl);
  return wrap(g, len, { plume: pl });
}
// Stand-off jamming aircraft: generic twin-engine airframe with antenna fairings.
export function buildJammer() {
  const g = new THREE.Group();
  g.add(lathe([[-13, 0.3], [-11, 1.0], [-4, 1.45], [8, 1.45], [11.5, 1.0], [13.2, 0.35], [13.6, 0]], MAT.grey, 20));
  const wingShape = new THREE.Shape(); wingShape.moveTo(-14, -1.2); wingShape.lineTo(-14, 0.2); wingShape.lineTo(-1.6, 3.4); wingShape.lineTo(1.6, 3.4); wingShape.lineTo(14, 0.2); wingShape.lineTo(14, -1.2); wingShape.lineTo(1.6, -1.4); wingShape.lineTo(-1.6, -1.4); wingShape.closePath();
  const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.15, bevelSegments: 2 }), MAT.grey); wing.rotation.x = Math.PI / 2; wing.position.set(0, -0.3, 0.5); g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.25, 2.3), MAT.grey); tail.position.set(0, 0.6, -11.3); g.add(tail);
  const finV = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.6, 3.2), MAT.grey); finV.position.set(0, 2.9, -11); finV.rotation.x = -0.35; g.add(finV);
  for (const s of [-1, 1]) { const e = lathe([[-2.4, 0.5], [-2.0, 0.75], [1.8, 0.8], [2.4, 0.6]], MAT.dark, 14); e.position.set(s * 5, -1.3, 2); g.add(e);
    const pod = lathe([[-2.2, 0.05], [-1.2, 0.4], [1.4, 0.4], [2.2, 0.05]], MAT.dark, 10); pod.position.set(s * 13.6, -0.3, -0.2); g.add(pod); }
  const canoe = lathe([[-5, 0.05], [-3, 0.6], [3, 0.6], [5, 0.05]], MAT.dark, 12); canoe.position.set(0, -1.6, 0); canoe.scale.set(1, 0.6, 1); g.add(canoe);
  return wrap(g, 28);
}
