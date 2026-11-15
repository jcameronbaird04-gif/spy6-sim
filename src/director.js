// The automatic camera: picks the shot that shows what the radar story is about right now, and frames it.
// It looks at every world on screen, so in the side-by-side view the framing always fits both radars.
import * as THREE from "three";
import { sunDir } from "./gfx/env.js";
import { A1i, ACTS, B1i, JAM, THREATS, WEAPON, interceptorPos, jammerPos, Vec3 } from "./model.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const m1 = new Vec3();
const SHIP = V(0, 0.015, 0);
const LABEL = { hero: "Own ship", launch: "Missile launch", arc: "Ballistic missiles", space: "Above the atmosphere", jam: "Jammed sector", theater: "Theater", swarm: "Drone swarm", fan: "Beams on the swarm", gun: "Close-in defence", follow: "Following" };

// Frame a set of points: orbit their centre from (yaw, pitch), far enough back to hold them all.
function fit(points, yaw, pitch, { min = 1, pad = 1.25, fov = 38, lift = 0 } = {}) {
  const c = V(0, 0, 0); points.forEach(p => c.add(p)); c.multiplyScalar(1 / points.length);
  let r = 0; points.forEach(p => { r = Math.max(r, p.distanceTo(c)); });
  c.y = c.y * 0.85 + lift;
  return { target: c, yaw, pitch, dist: Math.max(min, r * pad / Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.min(1, ASPECT)), fov };
}
let ASPECT = 1.6;                                  // width / height of one view: a narrow view needs the camera farther back
export const setAspect = a => { ASPECT = a; };

export class Director {
  constructor(rig) { this.rig = rig; this.shot = "hero"; this.since = 0; this.clock = 0; this.launchUntil = 0; this.seen = new Set(); this.label = LABEL.hero; }
  reset() { this.shot = "hero"; this.since = 0; this.launchUntil = 0; this.seen.clear(); }

  activeGun(worlds, t) {
    for (const w of worlds) for (const th of w.st.threats) { const wp = WEAPON[th.d.weapon]; if (wp.gun && th.tLaunch != null && t >= th.tLaunch - 3 && (th.deadAt == null || t < th.deadAt + 2.5)) return th; }
    return null;
  }
  points(worlds, t, pick) {
    const pts = [];
    for (const w of worlds) w.st.threats.forEach((th, i) => {
      if (!pick(th.d, i)) return;
      if (th.alive && t >= th.d.path.t0) { const p = th.d.path.pos(t, m1); pts.push(V(p.x, p.y, p.z)); }
      if (th.stage >= 4 && th.tLaunch != null && t >= th.tLaunch && th.deadAt == null && th.tInt != null && !WEAPON[th.d.weapon].gun) { const p = interceptorPos(th, t, m1); pts.push(V(p.x, p.y, p.z)); }
    });
    return pts;
  }

  choose(worlds, t, started) {
    const any = f => worlds.some(w => f(w.st));
    if (!started) return "hero";
    if (this.activeGun(worlds, t)) return "gun";
    // a launch of one of the big interceptors earns a look at the ship
    for (const w of worlds) for (const i of [A1i, B1i]) { const th = w.st.threats[i], key = w.mode + i + th.tLaunch; if (th.tLaunch != null && t >= th.tLaunch && t < th.tLaunch + 6 && !this.seen.has(key)) { this.seen.add(key); this.launchUntil = this.clock + 4; } }
    if (this.clock < this.launchUntil) return "launch";
    const act = ACTS.reduce((k, a, i) => a.t <= t ? i : k, 0), phase = this.clock % 22;
    const air = i => any(st => st.threats[i].alive && t >= THREATS[i].path.t0);
    if (act === 0) {
      const b1Up = any(st => st.threats[B1i].alive && st.threats[B1i].stage >= 1 && st.threats[B1i].pos.y > 80) || any(st => st.threats[B1i].deadAt != null && t - st.threats[B1i].deadAt < 12);
      if (b1Up && phase > 12) return "space";
      if (air(A1i) || air(B1i)) return "arc";
      return any(st => st.threats.some(th => th.alive && t >= th.d.path.t0)) ? "theater" : "hero";
    }
    if (act === 1) return t < JAM.t0 + 70 && t >= JAM.t0 - 6 ? "jam" : "theater";
    const swarmUp = any(st => st.threats.some(th => th.d.swarm && th.alive && t >= th.d.path.t0));
    if (swarmUp) return phase < 12 ? "swarm" : "fan";
    return any(st => st.threats.some(th => th.alive && t >= th.d.path.t0)) ? "theater" : "hero";
  }

  pose(id, worlds, t) {
    const drift = Math.sin(this.clock / 9) * 0.07;
    switch (id) {
      case "hero": return { target: SHIP.clone(), yaw: -2.2 + this.clock * 0.022, pitch: 0.085, dist: 0.37, fov: 36 };
      case "launch": return { target: V(0, 0.04, -0.03), yaw: 2.35, pitch: 0.03, dist: 0.3, fov: 46 };
      case "arc": { const pts = this.points(worlds, t, (d, i) => i === A1i || i === B1i).filter(p => p.length() < 900); return fit([SHIP, ...pts], -0.62 + drift, 0.17, { min: 60, pad: 1.2 }); }
      case "space": {
        const w = worlds.find(x => x.st.threats[B1i].alive) || worlds[0], b = w.st.threats[B1i], p = b.alive ? THREATS[B1i].path.pos(t, m1) : b.intPoint, c = V(p.x, p.y, p.z);
        const pts = [c]; if (b.alive && b.tLaunch != null && t >= b.tLaunch && b.tInt != null) { const q = interceptorPos(b, t, m1); pts.push(V(q.x, q.y, q.z)); }
        return fit(pts, -2.55 + drift, 0.16, { min: 230, pad: 1.5, fov: 42, lift: 30 });
      }
      case "jam": { const j = jammerPos(t, m1); return fit([SHIP, V(j.x, 0, j.z), V(-120, 0, 0), V(0, 0, 150), ...this.points(worlds, t, d => d.kind !== "bm" && !d.swarm)], -1.75 + drift, 0.62, { min: 420, pad: 1.15 }); }
      case "swarm": return fit([SHIP, ...this.points(worlds, t, d => d.swarm)], -1.22 + drift, 0.34, { min: 6, pad: 1.2 });
      case "fan": return { target: V(0.25, 0.05, -0.12), yaw: -1.18 + drift * 0.5, pitch: 0.13, dist: 1.5, fov: 34 };
      case "gun": { const th = this.activeGun(worlds, t), p = th ? (th.alive ? th.d.path.pos(t, m1) : th.intPoint) : SHIP, brg = Math.atan2(p.x, p.z);
        const L = Math.hypot(p.x, p.z) || 1;
        const sunYaw = Math.atan2(sunDir.x, sunDir.z), side = Math.cos(brg + Math.PI + 0.55 - sunYaw) >= Math.cos(brg + Math.PI - 0.55 - sunYaw) ? 0.55 : -0.55;      // stand on the sunlit side
        const close = th && th.d.weapon === "CIWS";
        return { target: V(p.x / L * (close ? 0.05 : 0.07), 0.022, p.z / L * (close ? 0.05 : 0.07) + (close ? 0.04 : 0)), yaw: brg + Math.PI + side, pitch: 0.11, dist: close ? 0.3 : 0.46, fov: 42 }; }   // behind the ship, looking out along the line of fire
      default: { const pts = this.points(worlds, t, d => true).filter(p => p.length() < 620); return fit([SHIP, ...pts], -1.38 + drift, 0.52, { min: 24, pad: 1.18 }); }
    }
  }

  update(worlds, t, realDt, started) {
    this.clock += realDt;
    let want = this.choose(worlds, t, started);
    const urgent = want === "gun" || want === "launch";
    if (want !== this.shot && !urgent && this.clock - this.since < 4.5 && this.shot !== "hero") want = this.shot;       // let a shot breathe
    const changed = want !== this.shot;
    if (changed) { this.shot = want; this.since = this.clock; }
    this.label = LABEL[want] || "";
    this.rig.go(this.pose(want, worlds, t), { cut: changed ? "auto" : false });
  }
}

// Fixed viewpoints for the camera buttons.
export const PRESET = {
  ship: () => ({ target: SHIP.clone(), yaw: -2.2, pitch: 0.1, dist: 0.4, fov: 36 }),
  space: () => ({ target: V(60, 60, -260), yaw: -1.25, pitch: 0.34, dist: 1500, fov: 40 }),
  map: () => ({ target: V(40, 0, -10), yaw: 0, pitch: 1.5, dist: 620, fov: 38 }),
};
