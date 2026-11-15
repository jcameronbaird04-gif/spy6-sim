// Arleigh Burke Flight III destroyer (DDG-128 style), built procedurally in metres: bow +x, up +y, starboard +z.
// buildShip(mode) returns a group scaled to km with the bow pointing north (-z).
// The only difference between the two ships is the radar: SPY-6's 37-module faces or SPY-1D's smaller plain octagons.
import * as THREE from "three";

const M = 0.001;
const L = 155, XS = -L / 2;

// ------------------------------------------------------------------ materials
const WEATHER = /* glsl */`
float whash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(whash(i), whash(i + vec2(1.0, 0.0)), f.x), mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), f.x), f.y); }
float wfbm(vec2 p){ float a = 0.0, w = 0.5; for (int i = 0; i < 4; i++){ a += w * wnoise(p); p = p * 2.07 + 3.1; w *= 0.5; } return a; }
`;
// Painted steel as it looks after months at sea: plating dished between frames, welded seams, rain and rust
// streaks, salt near the waterline, grime where a bulkhead meets the deck. All driven by position on the ship, so
// nothing swims, and all faded out before it gets smaller than a pixel, so nothing crawls.
function paint(color, { hull = false, deck = false, rough = 0.5 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0, envMapIntensity: 1.0 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = "attribute float base; varying vec3 vOP; varying vec3 vON; varying float vBase;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vOP = position; vON = normal; vBase = base;");
    sh.fragmentShader = "varying vec3 vOP; varying vec3 vON; varying float vBase;\n" + WEATHER + sh.fragmentShader
      .replace("#include <color_fragment>", /* glsl */`#include <color_fragment>
        vec3 P = vOP; vec3 aN = abs(normalize(vON));
        vec2 uvw = aN.y > 0.7 ? P.xz : (aN.x > aN.z ? P.zy : P.xy);            // dominant-axis projection, metres
        float fw = max(fwidth(uvw.x), fwidth(uvw.y));                            // metres per pixel
        float fineK = 1.0 - smoothstep(0.04, 0.35, fw), wall = 1.0 - step(0.7, aN.y);
        float n = wfbm(uvw * 0.35), fine = wfbm(uvw * 3.0);
        float sx = abs(fract(uvw.x / 3.0) - 0.5) * 3.0, sy = abs(fract(uvw.y / 2.4) - 0.5) * 2.4;
        float seam = max(1.0 - smoothstep(0.0, 0.025 + fw, 1.5 - sx), 1.0 - smoothstep(0.0, 0.025 + fw, 1.2 - sy)) * (1.0 - smoothstep(0.12, 0.5, fw));
        float streak = smoothstep(0.5, 0.95, wnoise(vec2(uvw.x * 1.7, uvw.y * 0.06 + 3.0))) * wall;
        float bleed = smoothstep(0.84, 0.97, wnoise(vec2(floor(uvw.x / 0.55) * 7.3, 2.0)));
        float rust = bleed * smoothstep(0.3, 0.9, wnoise(vec2(uvw.x * 5.0, uvw.y * 0.4))) * wall;
        diffuseColor.rgb *= 0.84 + 0.24 * n + 0.10 * (fine - 0.5) * fineK;
        diffuseColor.rgb *= 1.0 - 0.20 * seam * wall - 0.17 * streak;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.21, 0.085, 0.03), rust * ${hull ? "0.42" : "0.22"});
        ${hull ? /* glsl */`
        float salt = (1.0 - smoothstep(0.9, 3.4, P.y)) * (0.4 + 0.6 * n);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + 0.035, salt * 0.4);
        diffuseColor.rgb *= 1.0 - 0.35 * (1.0 - smoothstep(0.9, 1.5 + 0.5 * n, P.y));                                                // wet band above the boot topping
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.010), (1.0 - smoothstep(0.75, 0.95, P.y)) * smoothstep(-0.55, -0.4, P.y));   // boot topping
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.035, 0.03), (1.0 - smoothstep(-0.55, -0.4, P.y)));                      // anti-fouling red` : deck ? /* glsl */`
        diffuseColor.rgb *= 0.82 + 0.30 * whash(floor(P.xz * 14.0)) * fineK + 0.10 * wfbm(P.xz * 0.12);                               // non-skid grit and wear
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.10, 0.05), smoothstep(0.62, 0.9, wfbm(P.xz * 0.5 + 9.0)) * 0.22);` : /* glsl */`
        diffuseColor.rgb *= mix(1.0, 0.58 + 0.42 * smoothstep(0.0, 3.2 + n, P.y - vBase), wall);                                      // grime and shade where plate meets deck`}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor + (wfbm(uvw * 2.2) - 0.5) * 0.4 - streak * 0.1, 0.22, 1.0);")
      .replace("#include <normal_fragment_maps>", /* glsl */`#include <normal_fragment_maps>
        { float bumpK = (1.0 - smoothstep(0.03, 0.22, fw)) * wall;
          float hgt = (sin(uvw.x * 6.2832 / 1.0) * sin(uvw.y * 6.2832 / 1.2) * 0.0045 + (wfbm(uvw * 1.6) - 0.5) * 0.006 - seam * 0.005) * bumpK * 0.001;   // oil-canning between frames, in km
          vec3 q0 = dFdx(vViewPosition), q1 = dFdy(vViewPosition); vec2 dH = vec2(dFdx(hgt), dFdy(hgt));
          vec3 R1 = cross(q1, normal), R2 = cross(normal, q0); float det = dot(q0, R1);
          if (abs(det) > 0.0) normal = normalize(abs(det) * normal - sign(det) * (dH.x * R1 + dH.y * R2)); }`);
  };
  return m;
}
const MAT = {
  hull: paint(0x7b838a, { hull: true }), sup: paint(0x8a9299), deck: paint(0x3a4044, { deck: true, rough: 0.94 }), door: paint(0x767e85, { rough: 0.45 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa3261c, roughness: 0.6 }), helo: new THREE.MeshStandardMaterial({ color: 0x626a71, roughness: 0.55 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x16191c, roughness: 0.6 }),
  black: new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.45 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x05080b, roughness: 0.06, metalness: 1.0, envMapIntensity: 1.6 }),
  white: new THREE.MeshStandardMaterial({ color: 0xd9dcd8, roughness: 0.45 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xc9541c, roughness: 0.6 }),
  rail: new THREE.LineBasicMaterial({ color: 0x9aa3aa, transparent: true, opacity: 0.75 }),
};
MAT.hull.side = MAT.sup.side = THREE.DoubleSide;

// ------------------------------------------------------------------ geometry helpers
const chamfered = (x0, x1, hw, c) => [[x1 - c, -hw], [x1, -hw + c], [x1, hw - c], [x1 - c, hw], [x0 + c, hw], [x0, hw - c], [x0, -hw + c], [x0 + c, -hw]];
// A faceted block: plan outline `pts` [x,z] at y0, shrunk toward (cx,cz) by `top` at y1. Flat-shaded like folded plate.
function block(g, pts, y0, y1, top, mat, cx = 0, cz = 0, topX = top) {
  const n = pts.length, v = [], idx = [];
  const tp = pts.map(([x, z]) => [cx + (x - cx) * topX, cz + (z - cz) * top]);
  pts.forEach(([x, z]) => v.push(x, y0, z)); tp.forEach(([x, z]) => v.push(x, y1, z));
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, n + i, j, j, n + i, n + j); }
  for (let i = 1; i < n - 1; i++) idx.push(n, n + i + 1, n + i);
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); geo.setIndex(idx);
  const flat = geo.toNonIndexed(); flat.computeVertexNormals();
  flat.setAttribute("base", new THREE.Float32BufferAttribute(new Float32Array(flat.attributes.position.count).fill(y0), 1));
  const mesh = new THREE.Mesh(flat, mat); g.add(mesh);
  mesh.userData.face = i => {            // centre and outward normal of side face i (for mounting things on it)
    const j = (i + 1) % n, a = new THREE.Vector3(pts[i][0], y0, pts[i][1]), b = new THREE.Vector3(pts[j][0], y0, pts[j][1]), c = new THREE.Vector3(tp[i][0], y1, tp[i][1]), d = new THREE.Vector3(tp[j][0], y1, tp[j][1]);
    const centre = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize(); if (normal.dot(new THREE.Vector3(centre.x - cx, 0, centre.z - cz)) < 0) normal.negate();
    return { centre, normal };
  };
  return mesh;
}
function box(g, w, h, d, x, y, z, mat, ry = 0) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); b.rotation.y = ry; g.add(b); return b; }
function cyl(g, r0, r1, h, x, y, z, mat, seg = 16) { const c = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); c.position.set(x, y, z); g.add(c); return c; }
function canvasTex(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

// ------------------------------------------------------------------ hull lines
const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const halfWL = t => 9.6 * (t < 0.5 ? 0.80 + 0.20 * sm(0, 0.36, t) : Math.pow(Math.max(Math.cos((t - 0.5) / 0.5 * Math.PI / 2), 0), 0.82));        // waterline half-breadth
const halfDeck = t => 10.2 * (t < 0.5 ? 0.93 + 0.07 * sm(0, 0.3, t) : Math.pow(Math.max(Math.cos((t - 0.5) / 0.5 * Math.PI / 2), 0), 0.50)) + 0.12;  // deck edge: flare keeps it wide forward
export const deckY = t => 6.4 + 0.5 * sm(0.22, 0.3, t) + 3.6 * Math.pow(Math.max((t - 0.42) / 0.58, 0), 1.7);                                       // sheer; fantail a step lower
const stemRake = t => 9.0 * Math.pow(Math.max((t - 0.86) / 0.14, 0), 1.6);
const deckX = t => XS + t * L + stemRake(t);

function buildHull(g) {
  const N = 96, prof = 8, verts = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, b = halfWL(t), bd = halfDeck(t), dy = deckY(t), x0 = XS + t * L;
    const draft = 6.2 * (t > 0.9 ? Math.max(0.12, 1 - (t - 0.9) * 7.5) : 0.86 + 0.14 * sm(0, 0.25, t));
    // half-section from keel up to the deck edge
    const sec = [[0.0, -draft], [b * 0.62, -draft * 0.93], [b * 0.93, -draft * 0.55], [b, 0], [b + (bd - b) * 0.30, dy * 0.30], [b + (bd - b) * 0.62, dy * 0.62], [b + (bd - b) * 0.88, dy * 0.88], [bd, dy]];
    for (const side of [-1, 1]) for (const [hz, y] of sec) verts.push(x0 + stemRake(t) * Math.max(y, 0) / dy, y, side * hz);
  }
  const R = prof * 2;
  for (let i = 0; i < N; i++) for (const s of [0, 1]) for (let k = 0; k < prof - 1; k++) {
    const a = i * R + s * prof + k, b = a + 1, c = a + R, d = c + 1;
    if (s) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, MAT.hull));
  // transom
  { const sec = [], t = 0, b = halfWL(t), bd = halfDeck(t), dy = deckY(t), draft = 6.2 * 0.86;
    [[0.0, -draft], [b * 0.62, -draft * 0.93], [b * 0.93, -draft * 0.55], [b, 0], [bd, dy]].forEach(p => sec.push(p));
    const sh = new THREE.Shape(); sh.moveTo(-sec[4][0], sec[4][1]); [3, 2, 1, 0].forEach(k => sh.lineTo(-sec[k][0], sec[k][1])); [1, 2, 3, 4].forEach(k => sh.lineTo(sec[k][0], sec[k][1])); sh.closePath();
    const tr = new THREE.Mesh(new THREE.ShapeGeometry(sh), MAT.hull); tr.rotation.y = -Math.PI / 2; tr.position.x = XS; g.add(tr); }
  // weather deck following the sheer
  { const v = [], id = [], uv = [];
    for (let i = 0; i <= N; i++) { const t = i / N, bd = Math.max(halfDeck(t) - 0.06, 0.02), y = deckY(t) + 0.02, x = deckX(t); v.push(x, y, -bd, x, y, bd); uv.push(x, -bd, x, bd); }
    for (let i = 0; i < N; i++) { const a = i * 2; id.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); geo.setIndex(id); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, MAT.deck)); }
  // life rails round the deck edge
  { const pts = [];
    for (const side of [-1, 1]) for (let i = 0; i < 150; i++) {
      const t0 = 0.002 + i / 150 * 0.99, t1 = 0.002 + (i + 1) / 150 * 0.99;
      const p = t => [deckX(t), deckY(t), side * Math.max(halfDeck(t) - 0.25, 0.02)];
      const a = p(t0), b = p(t1);
      for (const h of [0.45, 0.8, 1.1]) pts.push(a[0], a[1] + h, a[2], b[0], b[1] + h, b[2]);
      pts.push(a[0], a[1], a[2], a[0], a[1] + 1.1, a[2]);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(geo, MAT.rail)); }
}

// ------------------------------------------------------------------ radar faces
// SPY-6(V)1: 37 radar modular assemblies in rows of 3-5-7-7-7-5-3. SPY-1D: one plain octagonal plate.
const ROWS6 = [3, 5, 7, 7, 7, 5, 3];
function faceTexture(mode, emissive) {
  return canvasTex(512, 512, (x, W) => {
    x.fillStyle = emissive ? "#000" : "#1b1f23"; x.fillRect(0, 0, W, W);
    const oct = (r, fill) => { x.beginPath(); for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * Math.PI * 2; x.lineTo(W / 2 + Math.cos(a) * r, W / 2 + Math.sin(a) * r); } x.closePath(); x.fillStyle = fill; x.fill(); };
    if (mode === "spy6") {
      const s = W / 7.6, o = (W - 7 * s) / 2;
      ROWS6.forEach((n, r) => { for (let c = 0; c < n; c++) {
        const cx = o + ((7 - n) / 2 + c) * s, cy = o + r * s;
        x.fillStyle = emissive ? "#bff3ff" : "#3d444b"; x.fillRect(cx + 3, cy + 3, s - 6, s - 6);
        if (!emissive) { x.strokeStyle = "rgba(255,255,255,.07)"; x.lineWidth = 1; for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(cx + 3 + k * (s - 6) / 4, cy + 3); x.lineTo(cx + 3 + k * (s - 6) / 4, cy + s - 3); x.moveTo(cx + 3, cy + 3 + k * (s - 6) / 4); x.lineTo(cx + s - 3, cy + 3 + k * (s - 6) / 4); x.stroke(); } }
      } });
    } else { oct(W * 0.47, emissive ? "#ffd9a0" : "#353b41"); if (!emissive) oct(W * 0.44, "#40474e"); }
  });
}
const faceTex = {};
function radarFace(mode) {
  const size = mode === "spy6" ? 4.6 : 3.7, p = new THREE.Group();
  faceTex[mode] ??= { map: faceTexture(mode, false), em: faceTexture(mode, true) };
  const mat = new THREE.MeshStandardMaterial({ map: faceTex[mode].map, emissiveMap: faceTex[mode].em, emissive: mode === "spy6" ? 0x49c8ff : 0xffa84a, emissiveIntensity: 0, roughness: 0.32, metalness: 0.25 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.22), [MAT.dark, MAT.dark, MAT.dark, MAT.dark, mat, MAT.dark]); plate.position.z = 0.13; p.add(plate);
  const surround = new THREE.Mesh(new THREE.BoxGeometry(size + 0.9, size + 0.9, 0.12), MAT.dark); surround.position.z = 0.02; p.add(surround);
  p.userData.glow = mat;
  return p;
}

// ------------------------------------------------------------------ the ship
export function buildShip(mode) {
  const g = new THREE.Group(), out = { group: g, faces: [], faceGlow: [], lights: [] };
  buildHull(g);
  const dk = x => deckY((x - XS) / L);

  // forecastle: breakwater, 5-inch gun, 32-cell VLS
  { const y = dk(54);
    const tur = block(g, chamfered(51, 57.5, 2.5, 1.5), y, y + 2.7, 0.62, MAT.sup, 54, 0);
    const brl = cyl(g, 0.11, 0.16, 8.6, 61.2, y + 1.75, 0, MAT.dark, 10); brl.rotation.z = -Math.PI / 2 + 0.05;
    cyl(g, 2.9, 3.0, 0.25, 54, y + 0.12, 0, MAT.deck, 24);
    for (const s of [-1, 1]) { const bw = box(g, 0.25, 1.0, 7.4, 62.5, dk(62.5) + 0.5, s * 3.3, MAT.sup, s * -0.5); bw.rotation.z = 0.25; }
    const yv = dk(40) + 0.05;
    const vls = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.5, 6.4), [MAT.dark, MAT.dark, new THREE.MeshStandardMaterial({ map: vlsTexture(4, 8), roughness: 0.7 }), MAT.dark, MAT.dark, MAT.dark]); vls.position.set(40, yv + 0.25, 0); g.add(vls);
    // anchor and capstans
    cyl(g, 0.5, 0.6, 0.8, 68, dk(68) + 0.4, 1.6, MAT.dark, 10); cyl(g, 0.5, 0.6, 0.8, 68, dk(68) + 0.4, -1.6, MAT.dark, 10);
  }

  // forward deckhouse with the four array faces on its chamfered corners
  const FY = dk(20), FH = 13.2;
  const house = block(g, chamfered(3, 34, 9.3, 5.6), FY - 0.3, FY + FH, 0.80, MAT.sup, 17, 0, 0.84);
  // chamfer faces of this outline: 2 = starboard-forward (NE), 4 = starboard-aft (SE), 6 = port-aft (SW), 0 = port-forward (NW)
  [[2, 0], [4, 1], [6, 2], [0, 3]].forEach(([fi, k]) => {
    const f = house.userData.face(fi);
    const rf = radarFace(mode); rf.position.copy(f.centre).addScaledVector(f.normal, 0.02).add(new THREE.Vector3(0, 0.6, 0));
    rf.lookAt(rf.position.clone().add(f.normal)); g.add(rf);
    out.faces[k] = rf; out.faceGlow[k] = rf.userData.glow;
  });
  // 02/03 levels, pilothouse with a wraparound window band, bridge wings
  const BY = FY + FH;
  block(g, chamfered(6, 31, 7.4, 3.8), BY, BY + 2.9, 0.92, MAT.sup, 18, 0);
  const pilot = block(g, chamfered(17, 31.5, 6.6, 3.4), BY + 2.9, BY + 5.6, 0.90, MAT.sup, 24, 0);
  { const band = block(g, chamfered(17.2, 31.27, 6.40, 3.3), BY + 3.9, BY + 5.0, 0.958, MAT.glass, 24, 0, 0.959);
    for (const s of [-1, 1]) { box(g, 4.6, 0.35, 3.4, 21, BY + 3.0, s * 8.6, MAT.sup); box(g, 4.6, 1.1, 0.12, 21, BY + 3.7, s * 10.25, MAT.sup); }
    // SLQ-32 electronic warfare sponsons
    for (const s of [-1, 1]) { box(g, 3.4, 2.8, 2.2, 12.5, BY + 1.6, s * 8.2, MAT.sup); box(g, 2.6, 1.7, 0.2, 12.5, BY + 1.8, s * 9.35, MAT.dark); }
  }
  // mast: raked tripod-less pole with yards, SPQ-9B and antennas
  { const my = BY + 5.6, mast = new THREE.Group(); mast.position.set(13.5, my, 0); mast.rotation.z = 0.13; g.add(mast);
    block(mast, chamfered(-2.6, 2.6, 2.1, 0.9), 0, 17.5, 0.34, MAT.sup, 0, 0);
    box(mast, 3.8, 0.45, 4.2, 0, 8.0, 0, MAT.sup); box(mast, 3.0, 0.4, 3.4, 0, 12.6, 0, MAT.sup);
    [[6.2, 13], [10.4, 9.5], [14.4, 6]].forEach(([y, w]) => { box(mast, 0.4, 0.34, w, 0.4, y, 0, MAT.sup); for (const s of [-1, 1]) cyl(mast, 0.045, 0.045, 2.2, 0.4, y + 1.1, s * (w / 2 - 0.3), MAT.dark, 6); });
    const spq = box(mast, 0.5, 1.5, 3.6, 0, 9.5, 0, MAT.dark); out.spq = spq;
    cyl(mast, 0.55, 0.55, 1.2, 0, 13.6, 0, MAT.white, 14); cyl(mast, 0.11, 0.2, 8.5, 0, 21.7, 0, MAT.dark, 8);
    cyl(mast, 0.035, 0.035, 5, -0.6, 19.6, 0.9, MAT.dark, 5); cyl(mast, 0.035, 0.035, 5, -0.6, 19.6, -0.9, MAT.dark, 5);
    out.lights.push({ pos: new THREE.Vector3(14.6, my + 16.0, 0), color: 0xfff2d0 }); }

  // stacks and the midships house
  const stack = (x, h) => { const s = block(g, chamfered(x - 5.2, x + 5.2, 4.6, 1.8), dk(x) - 0.2, dk(x) + h, 0.68, MAT.sup, x - 0.6, 0, 0.74);
    block(g, chamfered(x - 4.2, x + 2.4, 2.8, 1.1), dk(x) + h, dk(x) + h + 1.3, 0.92, MAT.black, x - 0.9, 0);
    for (const s2 of [-1, 1]) box(g, 3.0, 2.0, 0.14, x - 0.5, dk(x) + h * 0.55, s2 * 4.05, MAT.dark).rotation.x = s2 * 0.19; return s; };
  const st1 = stack(-7, 15.5), st2 = stack(-33, 14.0);
  block(g, chamfered(-42, 5, 7.4, 2.4), dk(-18) - 0.2, dk(-18) + 3.3, 0.94, MAT.sup, -18, 0);
  // boats, torpedo tubes, 25 mm guns, life rafts between the stacks
  for (const s of [-1, 1]) {
    const rh = new THREE.Group(); rh.position.set(-20, dk(-20) + 4.3, s * 5.2); g.add(rh);
    const hullR = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 5.6, 4, 10), MAT.dark); hullR.rotation.z = Math.PI / 2; hullR.scale.set(1, 1, 1.25); rh.add(hullR); box(rh, 1.5, 0.9, 1.2, -0.8, 0.9, 0, MAT.orange);
    cyl(g, 0.75, 0.85, 1.1, -26.5, dk(-26) + 3.9, s * 5.6, MAT.sup, 12); const mb = cyl(g, 0.06, 0.06, 2.6, -25.4, dk(-26) + 4.5, s * 5.6, MAT.dark, 6); mb.rotation.z = Math.PI / 2;
    for (let k = 0; k < 3; k++) { const tt = cyl(g, 0.22, 0.22, 3.4, -14, dk(-14) + 3.9 + (k === 2 ? 0.42 : 0), s * (6.0 + (k === 2 ? 0.22 : k * 0.46)), MAT.sup, 10); tt.rotation.z = Math.PI / 2; }
    for (let k = 0; k < 5; k++) { const can = cyl(g, 0.42, 0.42, 1.4, 8 - k * 1.25, dk(8) + 0.75, s * 9.2, MAT.white, 10); can.rotation.x = Math.PI / 2; }
    out.lights.push({ pos: new THREE.Vector3(22, BY + 4.3, s * 10.3), color: s > 0 ? 0x33ff7a : 0xff3030 });
  }

  // aft deckhouse: 64-cell VLS between twin hangars, CIWS on top, flight deck to the stern
  { const y = dk(-50), AH = 7.6;
    const aft = block(g, chamfered(-60.5, -41, 9.0, 2.6), y - 0.2, y + AH, 0.93, MAT.sup, -50, 0); out.aft = aft;
    const vls = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.5, 6.6), [MAT.dark, MAT.dark, new THREE.MeshStandardMaterial({ map: vlsTexture(8, 8), roughness: 0.7 }), MAT.dark, MAT.dark, MAT.dark]); vls.position.set(-48, y + AH + 0.2, 0); g.add(vls);
    for (const s of [-1, 1]) { box(g, 0.18, 5.4, 6.0, -60.52, y + 2.9, s * 4.7, MAT.dark); for (let k = 1; k < 6; k++) box(g, 0.22, 0.06, 6.0, -60.54, y + 0.3 + k * 0.9, s * 4.7, MAT.sup); }
    // Phalanx CIWS
    const cw = new THREE.Group(); cw.position.set(-56, y + AH, 0); g.add(cw); out.ciws = cw;
    cyl(cw, 1.15, 1.35, 1.3, 0, 0.65, 0, MAT.sup, 16); cyl(cw, 0.72, 0.72, 2.2, 0, 2.4, 0, MAT.white, 16);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.white); dome.position.y = 3.5; cw.add(dome);
    const brl = cyl(cw, 0.11, 0.11, 2.2, -1.5, 1.75, 0, MAT.dark, 8); brl.rotation.z = Math.PI / 2;
    // SATCOM domes
    for (const s of [-1, 1]) { const d = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 12), MAT.white); d.position.set(-43.5, y + AH + 1.9, s * 5.6); g.add(d); cyl(g, 0.9, 1.0, 1.0, -43.5, y + AH + 0.5, s * 5.6, MAT.sup, 12); }
    // flight deck markings
    const fd = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ map: flightDeckTexture(), transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    fd.rotation.x = -Math.PI / 2; fd.position.set(-68.6, dk(-68.6) + 0.06, 0); g.add(fd);
    out.lights.push({ pos: new THREE.Vector3(-77, dk(-77) + 1.4, 0), color: 0xffffff });
  }

  // hull number on both bows and the stern
  { const tex = canvasTex(256, 128, x => { x.font = "bold 104px 'Arial Narrow', Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "rgba(0,0,0,.55)"; x.fillText("128", 133, 71); x.fillStyle = "#e9ece8"; x.fillText("128", 128, 66); });
    const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const s of [-1, 1]) { const t = 0.865, p = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.2), m);
      const hw = halfWL(t) + (halfDeck(t) - halfWL(t)) * 0.52; p.position.set(XS + t * L + stemRake(t) * 0.5 + 0.2, deckY(t) * 0.55, s * (hw + 0.3));
      p.rotation.order = "YXZ"; p.rotation.y = (s > 0 ? 0 : Math.PI) + s * 0.30; p.rotation.x = 0.20; g.add(p); } }

  dress(g, { house, pilot, st1, st2, aft: out.aft, dk, BY });
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // running lights: small emissive points that bloom
  out.lights.forEach(l => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(l.color).multiplyScalar(5) })); s.position.copy(l.pos); g.add(s); });

  const root = new THREE.Group(); g.scale.setScalar(M); g.rotation.y = Math.PI / 2; root.add(g);
  out.root = root; out.inner = g;
  return out;
}

// ------------------------------------------------------------------ fittings
// The small things that give a ship its scale: doors, vents, ladders, fire stations, window mullions, bollards,
// mast gear, an anchor, and a helicopter on the pad.
function onFace(g, mesh, i) { const f = mesh.userData.face(i), p = new THREE.Group(); p.position.copy(f.centre); p.lookAt(f.centre.clone().add(f.normal)); g.add(p); return p; }
function door(p, u, v) { box(p, 1.15, 2.2, 0.06, u, v, 0.03, MAT.dark); box(p, 0.95, 2.0, 0.1, u, v, 0.05, MAT.door); const w = cyl(p, 0.16, 0.16, 0.05, u, v + 0.1, 0.12, MAT.dark, 10); w.rotation.x = Math.PI / 2; }
function vent(p, u, v, w, h) { box(p, w, h, 0.08, u, v, 0.03, MAT.black); const n = Math.max(2, Math.round(h / 0.22)); for (let k = 0; k < n; k++) box(p, w, 0.05, 0.12, u, v - h / 2 + (k + 0.5) * h / n, 0.06, MAT.sup).rotation.x = 0.5; }
function ladder(p, u, v0, v1) { for (const s of [-1, 1]) box(p, 0.05, v1 - v0, 0.05, u + s * 0.22, (v0 + v1) / 2, 0.1, MAT.dark); for (let v = v0 + 0.2; v < v1; v += 0.32) box(p, 0.44, 0.04, 0.04, u, v, 0.1, MAT.dark); }
function rib(p, v, w) { box(p, w, 0.14, 0.12, 0, v, 0.05, MAT.sup); }
function dress(g, { house, pilot, st1, st2, aft, dk, BY }) {
  // forward deckhouse: sides (faces 3, 7), front (1), aft (5)
  for (const i of [3, 7]) { const p = onFace(g, house, i), s = i === 3 ? 1 : -1;
    rib(p, -2.6, 18.6); rib(p, 2.2, 17.6);
    door(p, -6.5 * s, -5.5); door(p, 5.5 * s, -5.5); door(p, 0.5, -1.4); ladder(p, -3.4 * s, -6.6, -2.6); ladder(p, 7.6 * s, -2.5, 2.2);
    vent(p, 2.6 * s, -4.9, 2.2, 1.3); vent(p, -8.2 * s, 0.6, 1.6, 1.0); vent(p, 4.4 * s, 4.2, 2.6, 0.9);
    box(p, 0.5, 0.75, 0.3, -1.2 * s, -5.6, 0.16, MAT.red); box(p, 0.9, 0.5, 0.35, 8.4 * s, -5.9, 0.18, MAT.dark);
    for (let k = 0; k < 3; k++) { const pipe = cyl(p, 0.05, 0.05, 9, (-0.4 + k * 0.16) * s - 5 * s, 1.4, 0.08, MAT.sup, 6); pipe.castShadow = false; }
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.09, 6, 14), MAT.orange); buoy.position.set(3.6 * s, -5.3, 0.1); p.add(buoy); }
  { const p = onFace(g, house, 1); rib(p, -2.6, 6.6); door(p, -1.6, -5.5); vent(p, 1.6, -4.9, 2.0, 1.2); vent(p, 0, 1.0, 3.2, 1.0); ladder(p, 2.6, -2.5, 2.4); }
  { const p = onFace(g, house, 5); rib(p, -2.6, 6.6); door(p, 1.6, -5.5); vent(p, -1.4, -1.0, 2.4, 1.4); }
  // pilothouse: mullions over the window band, wipers' shadow line, searchlights and whip antennas on the roof
  { const y = BY + 4.45;
    for (let z = -2.9; z <= 2.91; z += 0.97) box(g, 0.1, 1.15, 0.09, 31.15, y, z, MAT.sup).rotation.z = 0.1;
    for (const s of [-1, 1]) { for (let x = 19.2; x < 28.5; x += 1.15) box(g, 0.09, 1.15, 0.1, x, y, s * 6.24, MAT.sup); for (let k = 0; k < 3; k++) box(g, 0.09, 1.15, 0.1, 29.2 + k * 0.72, y, s * (5.55 - k * 0.72), MAT.sup, s * -0.785); }
    box(g, 14.2, 0.18, 13.0, 24.2, BY + 5.68, 0, MAT.sup);
    for (const s of [-1, 1]) { cyl(g, 0.28, 0.28, 0.5, 29.4, BY + 6.1, s * 3.6, MAT.dark, 12).rotation.z = Math.PI / 2; cyl(g, 0.03, 0.05, 6.5, 19.5, BY + 9.0, s * 5.4, MAT.dark, 5).rotation.x = s * 0.12; cyl(g, 0.5, 0.6, 0.9, 22.5, BY + 6.2, s * 4.6, MAT.white, 12); }
    cyl(g, 0.9, 1.0, 0.5, 26, BY + 6.0, 0, MAT.sup, 14); box(g, 0.25, 0.6, 3.0, 26, BY + 6.6, 0, MAT.white); }
  // stacks: uptake ribs, intake louvres, soot round the caps
  for (const st of [st1, st2]) for (const i of [3, 7]) { const p = onFace(g, st, i); rib(p, -3.4, 7.0); rib(p, 3.2, 5.6); vent(p, -1.6, -5.2, 2.8, 1.6); vent(p, 2.0, -5.2, 1.6, 1.6); ladder(p, 3.2, -6.5, 3.0); }
  for (const st of [st1, st2]) { const p = onFace(g, st, 1); vent(p, 0, -1.5, 4.2, 2.4); rib(p, 3.2, 4.4); const q = onFace(g, st, 5); vent(q, 0, -3.5, 3.6, 1.8); door(q, 1.9, -6.3); }
  // aft deckhouse sides
  for (const i of [3, 7]) { const p = onFace(g, aft, i), s = i === 3 ? 1 : -1; rib(p, 0.6, 14.2); door(p, -4.5 * s, -2.6); door(p, 4.8 * s, -2.6); vent(p, 0.4 * s, -2.2, 2.4, 1.3); vent(p, -1.5 * s, 2.2, 3.0, 0.9); ladder(p, 6.6 * s, -3.6, 3.6); box(p, 0.5, 0.75, 0.3, 2.4 * s, -2.7, 0.16, MAT.red); }
  // weather deck: bollards and chocks along both sides, capstans and chain on the forecastle, jackstaff, flagstaff
  for (const s of [-1, 1]) for (const x of [-72, -44, -22, 2, 38, 60]) { const t = (x - XS) / L, z = s * (halfDeck(t) - 1.0), y = dk(x);
    for (const d of [-0.45, 0.45]) cyl(g, 0.2, 0.24, 0.55, x + d, y + 0.28, z, MAT.dark, 8); box(g, 1.5, 0.12, 0.5, x, y + 0.06, z, MAT.dark); }
  for (const s of [-1, 1]) { const ch = box(g, 9.5, 0.1, 0.3, 72.5, dk(72.5) + 0.07, s * 1.2, MAT.black); ch.rotation.z = Math.atan2(dk(77) - dk(68), 9); ch.rotation.y = s * 0.08; }
  cyl(g, 0.04, 0.05, 3.2, deckX(0.992), dk(XS + 0.992 * L) + 1.6, 0, MAT.dark, 5); cyl(g, 0.04, 0.05, 4.2, XS + 0.6, dk(XS + 0.6) + 2.1, 0, MAT.dark, 5);
  // anchor housed on the starboard bow, with the rust it weeps
  { const t = 0.945, x = XS + t * L + stemRake(t) * 0.75, y = deckY(t) * 0.74, z = halfWL(t) + (halfDeck(t) - halfWL(t)) * 0.74 + 0.25;
    const a = new THREE.Group(); a.position.set(x, y, z); a.rotation.y = 0.5; g.add(a);
    box(a, 1.5, 0.3, 0.3, 0, 0, 0, MAT.black); box(a, 0.3, 1.5, 0.3, 0, -0.5, 0, MAT.black); box(a, 0.5, 0.5, 0.5, 0, 0.4, -0.1, MAT.black); }
  // mast: IFF ring, TACAN dome, navigation radars, signal halyards
  { const mast = new THREE.Group(); mast.position.set(13.5, BY + 5.6, 0); mast.rotation.z = 0.13; g.add(mast);
    cyl(mast, 0.7, 0.7, 0.9, 0, 18.0, 0, MAT.white, 16); const dome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.white); dome.position.y = 18.45; mast.add(dome);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.07, 6, 28), MAT.dark); ring.rotation.x = Math.PI / 2; ring.position.y = 16.2; mast.add(ring);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; cyl(mast, 0.035, 0.035, 0.9, Math.cos(a) * 1.5, 16.6, Math.sin(a) * 1.5, MAT.dark, 5); }
    box(mast, 0.3, 0.35, 2.6, 2.3, 4.4, 0, MAT.white); cyl(mast, 0.2, 0.25, 0.6, 2.3, 4.0, 0, MAT.dark, 8); box(mast, 2.0, 0.3, 1.6, 1.6, 3.6, 0, MAT.sup);
    box(mast, 0.3, 0.3, 2.0, -2.2, 7.2, 0, MAT.white); box(mast, 1.6, 0.25, 1.4, -1.6, 6.7, 0, MAT.sup);
    for (const s of [-1, 1]) { cyl(mast, 0.4, 0.4, 0.5, 0.6, 11.4, s * 2.4, MAT.white, 12); box(mast, 0.5, 0.9, 0.5, 0.4, 7.0, s * 5.6, MAT.dark); }
    const pts = []; for (const s of [-1, 1]) for (const [y, z] of [[6.2, 6.2], [10.4, 4.4], [14.4, 2.7]]) pts.push(0.4, y, s * z, -3.5, -5.2, s * (z + 1.5));
    const hal = new THREE.BufferGeometry(); hal.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); mast.add(new THREE.LineSegments(hal, MAT.rail)); }
  // MH-60 on the pad, rotors spread
  { const h = new THREE.Group(); h.position.set(-67.5, dk(-67.5) + 1.75, 0); g.add(h);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 4.6, 6, 14), MAT.helo); body.rotation.z = Math.PI / 2; body.scale.set(1.15, 1, 1); h.add(body);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 10), MAT.glass); nose.scale.set(1.25, 0.8, 0.95); nose.position.set(2.75, 0.18, 0); h.add(nose);
    const boom = cyl(h, 0.28, 0.6, 5.6, -5.4, 0.55, 0, MAT.helo, 10); boom.rotation.z = Math.PI / 2 - 0.1;
    box(h, 1.5, 2.4, 0.2, -8.3, 1.75, 0, MAT.helo).rotation.z = -0.6; box(h, 0.9, 0.12, 3.0, -7.6, 0.9, 0, MAT.helo);
    box(h, 3.4, 0.7, 1.5, 0.2, 1.25, 0, MAT.helo); cyl(h, 0.2, 0.2, 0.7, 0.2, 1.9, 0, MAT.dark, 8);
    for (let k = 0; k < 4; k++) { const b = box(h, 8.0, 0.06, 0.5, 0, 2.28, 0, MAT.dark); b.rotation.y = k * Math.PI / 2 + 0.5; b.translateX(4.1); b.rotation.z = -0.03; }
    const tr = cyl(h, 1.3, 1.3, 0.05, -8.8, 2.4, 0.3, MAT.dark, 16); tr.rotation.x = Math.PI / 2; tr.material = new THREE.MeshStandardMaterial({ color: 0x15181b, transparent: true, opacity: 0.4 });
    for (const [x, z] of [[1.4, 1.3], [1.4, -1.3], [-6.4, 0]]) { cyl(h, 0.06, 0.06, 1.0, x, -1.15, z, MAT.dark, 6); const w = cyl(h, 0.3, 0.3, 0.2, x, -1.5, z, MAT.black, 10); w.rotation.x = Math.PI / 2; } }
}

function vlsTexture(cols, rows) {
  return canvasTex(256, 256, (x, W) => {
    x.fillStyle = "#2b3034"; x.fillRect(0, 0, W, W);
    const cw = W / cols, ch = W / rows;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      x.fillStyle = "#4a5157"; x.fillRect(c * cw + 3, r * ch + 3, cw - 6, ch - 6);
      x.strokeStyle = "#1a1d20"; x.lineWidth = 2; x.strokeRect(c * cw + 3, r * ch + 3, cw - 6, ch - 6);
      x.fillStyle = "#2b3034"; x.fillRect(c * cw + cw / 2 - 1, r * ch + 5, 2, ch - 10);
    }
  });
}
function flightDeckTexture() {
  return canvasTex(512, 512, (x, W) => {
    x.clearRect(0, 0, W, W); x.strokeStyle = "rgba(236,238,232,.9)"; x.lineWidth = 6;
    x.beginPath(); x.arc(W / 2, W / 2, 130, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(40, W / 2); x.lineTo(W - 40, W / 2); x.stroke();
    x.lineWidth = 4; x.strokeRect(30, 60, W - 60, W - 120);
    x.lineWidth = 6; x.beginPath(); x.moveTo(W / 2, 60); x.lineTo(W / 2, W - 60); x.setLineDash([18, 14]); x.stroke();
  });
}

// World positions (km) of the centres of the four array faces, in model face order NE, SE, SW, NW.
export function facePositions(ship) {
  ship.root.updateMatrixWorld(true);
  return ship.faces.map(f => f.getWorldPosition(new THREE.Vector3()));
}
