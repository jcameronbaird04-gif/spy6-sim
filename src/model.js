// SPY-6 vs SPY-1D kill-chain model. Pure logic: no rendering, no DOM, runs in the browser and in Node.
// Units: km, seconds. North is -z, east is +x, up is +y, own ship at the origin.
//
// The model is deterministic. tests/model.test.mjs pins its outputs to the numbers the paper quotes,
// so a change here that moves a result fails the tests.

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  distanceTo(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  lerpVectors(a, b, t) { this.x = a.x + (b.x - a.x) * t; this.y = a.y + (b.y - a.y) * t; this.z = a.z + (b.z - a.z) * t; return this; }
}
const V = (x, y, z) => new Vec3(x, y, z);

// ------------------------------------------------------------------ constants
export const RE = 6371, KE = 4 / 3;             // Earth radius (km); 4/3-Earth refraction factor
export const REFF = KE * RE;                    // effective radius the radar horizon is computed with
export const RADAR_H = 0.025;                   // array ~25 m above the waterline
export const R0 = 400;                          // illustrative SPY-1D range on a 1 m^2 target (km)
export const GAIN_DB = { spy1: 0, spy6: 15 };   // published: SPY-6(V)1 is +15 dB over SPY-1D (NAVSEA)
export const GAIN = { spy1: 1, spy6: Math.pow(10, 1.5) };
export const NM = 1.852;
export const ACT2 = 220;                        // low fliers launch after the ballistic act is under way
export const SPY1_TRACKS_PER_SLOT = 3;
export const SWARM_N = 30;
// 23 tracks per face: 6 updates/s keeps each inside the 4 s limit, with a one-track margin
export const SPY1_FACE_CAP = 2 * SPY1_TRACKS_PER_SLOT * 4 - 1;
export const SPY6_UPDATE = 0.25;                // every track, every 0.25 s
export const DECOY_REL = 0.17;                  // fraction of B1's flight when decoys separate
export const DISCRIM = { spy6: 6, spy1: 40 };   // seconds after release to pick out the warhead (illustrative)
export const LOST_GAP = 4;                      // a track not updated for this long is dropped (illustrative)
export const END_T = 1600;
export const STEP = 0.05;
export const STAGES = ["Detect", "Track", "ID", "Engage", "Midcourse", "Terminal", "Assess"];
export const RADAR_NAME = { spy1: "SPY-1D", spy6: "SPY-6" };
export const RADAR_FULL = { spy1: "AN/SPY-1D(V)", spy6: "AN/SPY-6(V)1" };

export const horizonKm = h => Math.sqrt(2 * KE * RE * RADAR_H) + Math.sqrt(2 * KE * RE * Math.max(h, 0));
export const rangeFor = (rcs, mode) => R0 * Math.pow(GAIN[mode] * rcs, 0.25);
export const bearing = p => (Math.atan2(p.x, -p.z) * 180 / Math.PI + 360) % 360;   // 0 = north (-z)
export const faceOf = p => Math.floor(bearing(p) / 90);                             // 0 NE, 1 SE, 2 SW, 3 NW
export const FACE_NAME = ["NE", "SE", "SW", "NW"];
export const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// ------------------------------------------------------------------ flight paths
function straight(start, alt, speed, t0, weave) {
  const dist = Math.hypot(start.x, start.z), T = dist / speed;
  return { t0, T, pos(t, o) {
    const s = Math.min(Math.max((t - t0) / T, 0), 1);
    o.set(start.x * (1 - s), alt, start.z * (1 - s));
    if (weave) { const px = -start.z / dist, pz = start.x / dist, w = Math.sin(s * 14 + start.z) * weave * (1 - s); o.x += px * w; o.z += pz * w; }
    return o;
  } };
}
function ballistic(p0, p1, apex, t0, T) {
  return { t0, T, boost: 0.16, pos(t, o) {
    const s = Math.min(Math.max((t - t0) / T, 0), 1);
    o.lerpVectors(p0, p1, s); o.y = 4 * apex * s * (1 - s); return o;
  } };
}

// ------------------------------------------------------------------ weapons and the raid
export const WEAPON = {
  "SM-2": { v: 1.1, maxR: 166, len: 4.7, exo: false },
  "SM-6": { v: 1.1, maxR: 240, len: 6.6, exo: false },
  "SM-3": { v: 4.5, maxR: 1000, len: 6.6, exo: true, label: "SM-3 Block IIA" },
  "5-inch": { gun: true, v: 0.8, maxR: 18, rate: 3, rounds: 4, mount: V(0, 0.0100, -0.0665), label: "5-inch gun" },
  "CIWS": { gun: true, v: 1.1, maxR: 2.0, burst: 1.6, mount: V(0, 0.0165, 0.056), label: "Phalanx CIWS" },
};
export const LAUNCH = V(0, 0.008, -0.04);         // forward Mk 41 VLS

export const THREATS = [
  { id: "D1", tn: 1001, name: "Drone 1", cls: "UAV", kind: "drone", rcs: 0.1, len: 3.5, weapon: "SM-2", path: straight(V(70, 0, -26), 0.1, 0.0514, ACT2, 0.6) },
  { id: "D2", tn: 1002, name: "Drone 2", cls: "UAV", kind: "drone", rcs: 0.1, len: 3.5, weapon: "SM-2", path: straight(V(73, 0, 9), 0.1, 0.0514, ACT2, 0.6) },
  { id: "D3", tn: 1003, name: "Drone 3", cls: "UAV", kind: "drone", rcs: 0.1, len: 3.5, weapon: "SM-2", path: straight(V(71, 0, 14), 0.1, 0.0514, ACT2, 0.6) },
  { id: "C1", tn: 1004, name: "Cruise missile 1", cls: "ASCM", kind: "cruise", rcs: 0.1, len: 6, weapon: "SM-2", path: straight(V(92, 0, -10), 0.02, 0.25, ACT2 + 10, 0) },
  { id: "C2", tn: 1005, name: "Cruise missile 2", cls: "ASCM", kind: "cruise", rcs: 0.1, len: 6, weapon: "SM-2", path: straight(V(96, 0, 8), 0.02, 0.25, ACT2 + 55, 0) },
  { id: "A1", tn: 1006, name: "Anti-ship ballistic missile", cls: "ASBM", kind: "bm", rcs: 0.05, len: 12, weapon: "SM-6", path: ballistic(V(390, 0, -110), V(0, 0, 0), 120, 20, 430) },
  { id: "B1", tn: 1007, name: "Ballistic missile (space)", cls: "MRBM", kind: "bm", rcs: 0.2, len: 14, weapon: "SM-3", decoys: 3, path: ballistic(V(250, 0, 350), V(-250, 0, -1450), 250, 40, 720) },
  { id: "D4", tn: 1008, name: "Drone 4", cls: "UAV", kind: "drone", rcs: 0.1, len: 3.5, weapon: "5-inch", path: straight(V(12, 0, -24), 0.03, 0.0514, ACT2 + 300, 0.3) },
  { id: "D5", tn: 1009, name: "Drone 5 (pop-up)", cls: "UAV", kind: "drone", rcs: 0.05, len: 2.5, weapon: "CIWS", path: straight(V(4.5, 0, 4.5), 0.015, 0.06, ACT2 + 420, 0.15) },
  // Drone swarm: 30 Shahed-type drones from one direction, so they all load the same array face (capacity showcase).
  // Heavier than Carney's 19-threat raid on purpose: it is sized past SPY-1D's ~24-tracks-per-face limit.
  ...Array.from({ length: SWARM_N }, (_, k) => 50 + k * 1.3).map((b, k) => {
    const r = 48 + (k % 4) * 0.7, a = b * Math.PI / 180;
    return { id: "S" + (k + 1), tn: 1010 + k, name: `Swarm drone ${k + 1}`, cls: "UAV", kind: "drone", swarm: true, rcs: 0.1, len: 3.5, weapon: "SM-2",
      path: straight(V(Math.sin(a) * r, 0, -Math.cos(a) * r), 0.05, 0.0514, ACT2 + 340 + k * 1.0, 0.4) };
  }),
];
export const idx = id => THREATS.findIndex(d => d.id === id);
export const A1i = idx("A1"), B1i = idx("B1");

// Stand-off jammer aircraft: orbits east of the ship, noise-jamming one sector.
// Bearing 100: covers the eastern drones, not the anti-ship ballistic missile (bearing 074).
export const JAM = { t0: ACT2 + 190, pos: V(177.3, 8, 31.3), half: 12, loss: { spy1: 0.15, spy6: 0.95 } };
JAM.brg = bearing(JAM.pos);

export const ACTS = [
  { t: 0, key: "bm", title: "Ballistic missiles", sub: "Two missiles launch from the coast. One is aimed at the ship; the other arcs up through space." },
  { t: ACT2 + 185, key: "jam", title: "Jamming and sea-skimmers", sub: "An enemy aircraft floods the radar with noise while drones and cruise missiles fly in low over the water." },
  { t: ACT2 + 335, key: "swarm", title: "Drone swarm", sub: `${SWARM_N} drones arrive together from one direction, more than USS Carney faced. Can the radar keep watching all of them at once?` },
];

// ------------------------------------------------------------------ combat system model
export function newState(mode) {
  return { mode, t: 0, events: [], faces: [0, 1, 2, 3].map(i => ({ i, clock: i * 0.03, slot: 0, rr: 0, searchProg: 0 })), waitNow: 0, peakWait: 0,
    nextSearch6: [0.1, 0.35, 0.6, 0.85], updates: [], callouts: [], flags: {},
    threats: THREATS.map(d => ({ d, stage: 0, looks: 0, alive: true, outcome: null, pos: V(0, -99, 0), seen: null, seenAt: 0,
      tDet: null, tAcq: null, dDet: null, tId: null, lost: 0, wasted: 0, waiting: false, lostAt: null, tLaunch: null, tInt: null, intPoint: null, nextUpd: 0, lastUpd: null, ints: null })) };
}
const tmp = V(0, 0, 0);
const say = (st, msg) => st.events.push({ t: st.t, msg });

export function jamFactor(st, p) { return st.t >= JAM.t0 && angDiff(bearing(p), JAM.brg) < JAM.half ? JAM.loss[st.mode] : 1; }

// A target can be detected when it is inside the radar's range for its size (reduced in a jammed sector)
// and above the radar horizon.
export function covered(th, mode, st) {
  const p = th.pos; if (p.y < 0) return false;
  const d = p.length();
  return d <= rangeFor(th.d.rcs, mode) * jamFactor(st, p) && Math.hypot(p.x, p.z) <= horizonKm(p.y);
}
export const belowHorizon = p => p.y >= 0 && Math.hypot(p.x, p.z) > horizonKm(p.y);

function detect(st, th) {
  const re = th.tDet != null;
  th.stage = 1; th.tAcq = st.t;
  if (re) { say(st, `REACQUIRE track ${th.d.tn}`); return void Object.assign(th, { looks: 1, lastUpd: st.t, seen: th.pos.clone(), seenAt: st.t, nextUpd: st.t + 0.25 }); }
  th.tDet = st.t; th.dDet = th.pos.length(); th.looks = 1; th.lastUpd = st.t; th.seen = th.pos.clone(); th.seenAt = st.t; th.nextUpd = st.t + 0.25;
  say(st, `DETECT track ${th.d.tn}, ${(th.dDet / NM).toFixed(0)} nm, bearing ${bearing(th.pos).toFixed(0).padStart(3, "0")}`);
}
function look(st, th) {
  th.looks++; if (th.lastUpd != null) st.updates.push(st.t - th.lastUpd);
  th.lastUpd = st.t; th.seen = th.pos.clone(); th.seenAt = st.t;
}
// Earliest intercept the weapon can reach, launching so the missile flies at its real speed.
function plan(st, th) {
  const w = WEAPON[th.d.weapon], p = th.d.path, tEnd = p.t0 + p.T;
  for (let tI = st.t + 6; tI < tEnd - 1; tI += 0.5) {
    p.pos(tI, tmp);
    const d = tmp.distanceTo(LAUNCH);
    if (d > w.maxR) continue;
    if (w.exo && tmp.y < 100) continue;
    if (!w.exo && tmp.y > 90) continue;
    const fly = 4 + d * 1.18 / w.v;
    if (fly <= tI - st.t) return { tI, point: tmp.clone(), tL: Math.max(st.t, tI - fly) };
  }
  return null;
}

export function step(st, dt) {
  st.t += dt;
  const mode = st.mode;
  for (const th of st.threats) {
    if (!th.alive) continue;
    const p = th.d.path;
    if (st.t >= p.t0) p.pos(st.t, th.pos); else th.pos.set(0, -99, 0);
    if (st.t >= p.t0 + p.T && th.stage < 6) {
      th.alive = false; th.outcome = th.d.id === "B1" ? "Out of range" : "Hit ship";
      say(st, `${th.d.name}: ${th.outcome.toLowerCase()}`);
    }
  }
  const live = th => th.alive && th.stage >= 1;
  if (st.t >= JAM.t0 && !st.flags.jam) { st.flags.jam = true; say(st, `JAMMING from bearing ${JAM.brg.toFixed(0).padStart(3, "0")}: stand-off jammer`); st.callouts.push({ t: st.t, key: "jam" }); }
  { const a1 = st.threats[A1i]; if (a1.tDet != null && !st.flags.range) { st.flags.range = true; st.callouts.push({ t: st.t, key: "range" }); } }
  if (!st.flags.swarm && st.threats.filter(t => t.d.swarm && t.stage >= 1).length >= 5) { st.flags.swarm = true; st.callouts.push({ t: st.t, key: "swarm" }); }

  if (mode === "spy6") {
    // Digital beamforming: every track gets its own look every 0.25 s; each face completes a search frame every 1 s.
    for (const th of st.threats) if (live(th) && st.t >= th.nextUpd) { look(st, th); th.nextUpd += 0.25; }
    for (let f = 0; f < 4; f++) if (st.t >= st.nextSearch6[f]) {
      st.nextSearch6[f] += 1.0;
      for (const th of st.threats) if (th.alive && th.stage === 0 && st.t >= th.d.path.t0 && faceOf(th.pos) === f && covered(th, mode, st)) detect(st, th);
    }
  } else {
    // One beam per face, 0.1 s scheduling slots: 2 of every 10 slots go to tracks (3 track updates per slot), the rest
    // to search; a search frame needs 10 search slots. 6 track updates/s per face keeps ~24 tracks per face (~100 for
    // the ship) inside the 4 s lost-track limit, matching the published SPY-1 "more than 100 targets".
    // Same numbers as Fig 2 (analysis/spy6_five_advantages.py).
    for (const face of st.faces) {
      face.clock += dt;
      while (face.clock >= 0.1) {
        face.clock -= 0.1;
        let mine = st.threats.filter(th => live(th) && faceOf(th.pos) === face.i);
        if (mine.length > SPY1_FACE_CAP) {
          // Track management: keep engaged threats first, then the closest; the rest are dropped until capacity frees up.
          mine.sort((a, b) => (b.stage >= 4) - (a.stage >= 4) || a.pos.length() - b.pos.length());
          for (const th of mine.slice(SPY1_FACE_CAP)) {
            if (th.stage >= 4) { if (st.t >= th.tLaunch) th.wasted++; Object.assign(th, { tLaunch: null, tInt: null, intPoint: null, saidAway: false }); }
            th.stage = 0; th.looks = 0; th.waiting = true; say(st, `RADAR FULL: face track load at limit, ${th.d.tn} dropped until capacity frees`);
          }
          mine = mine.slice(0, SPY1_FACE_CAP);
        }
        const slot = face.slot++ % 10;
        if (slot < 2 && mine.length) {
          // Least-recently-updated first, so no track is skipped when the list changes.
          mine.slice().sort((a, b) => a.lastUpd - b.lastUpd).slice(0, SPY1_TRACKS_PER_SLOT).forEach(th => look(st, th));
        } else {
          if (++face.searchProg >= 10) {
            face.searchProg = 0;
            let held = mine.length;
            for (const th of st.threats) if (th.alive && th.stage === 0 && st.t >= th.d.path.t0 && faceOf(th.pos) === face.i && covered(th, mode, st)) {
              if (held < SPY1_FACE_CAP) { detect(st, th); th.waiting = false; held++; }
              else if (!th.waiting) { th.waiting = true; say(st, `RADAR FULL: ${th.d.tn} seen in search but no track capacity on this face`); }
            }
          }
        }
      }
    }
  }
  st.waitNow = st.threats.filter(th => th.alive && th.waiting && th.stage === 0).length; st.peakWait = Math.max(st.peakWait, st.waitNow);
  if (st.waitNow && !st.flags.full) { st.flags.full = true; st.callouts.push({ t: st.t, key: "full" }); }

  for (const th of st.threats) {
    if (th.stage === 1 && th.looks >= 3) { th.stage = 2; say(st, `TRACK ${th.d.tn} firm, ${(th.pos.length() / NM).toFixed(0)} nm`); }
    if (th.stage === 2 && th.d.decoys) {
      const tRel = th.d.path.t0 + DECOY_REL * th.d.path.T, tDis = tRel + DISCRIM[mode];
      if (st.t >= tRel && !st.flags.decoysOut) { st.flags.decoysOut = true; say(st, `${th.d.tn}: ${th.d.decoys} decoys released, 4 objects in space`); }
      if (st.t >= tDis && !st.flags.discrim) { st.flags.discrim = true; say(st, `DISCRIMINATE ${th.d.tn}: warhead picked out of 4 objects`); st.callouts.push({ t: st.t, key: "discrim" }); }
    }
    if (th.stage === 2 && th.looks >= 6 && st.t >= th.tAcq + 4 && (!th.d.decoys || st.flags.discrim)) { th.stage = 3; th.tId = st.t; say(st, `ID ${th.d.tn} HOSTILE ${th.d.cls}`); }
    const w = WEAPON[th.d.weapon];
    // Until its own seeker takes over (terminal), a missile needs the ship's track for midcourse uplink, so engaged
    // tracks can be lost too. Guns are left out: they fire within seconds of engaging.
    const needsTrack = th.stage >= 1 && (th.stage <= 3 || (th.stage <= 5 && !w.gun));
    if (th.alive && needsTrack && st.t - th.lastUpd > LOST_GAP) {
      if (th.stage >= 4) {
        const flying = st.t >= th.tLaunch;
        if (flying) th.wasted++;
        say(st, flying ? `ABORT ${th.d.weapon} at ${th.d.tn}: no track to guide it, interceptor lost` : `HOLD FIRE ${th.d.tn}: track lost before launch`);
        Object.assign(th, { tLaunch: null, tInt: null, intPoint: null, saidAway: false });
      }
      th.stage = 0; th.looks = 0; th.lost++; th.lostAt = st.t;
      say(st, `TRACK LOST ${th.d.tn}: no update for ${(st.t - th.lastUpd).toFixed(1)} s`);
      if (!st.flags.lost) { st.flags.lost = true; st.callouts.push({ t: st.t, key: "lost" }); }
    }
    if (th.stage === 3 && st.t >= th.tId + 2 && th.alive) {
      if (w.gun) {
        const r0 = th.pos.distanceTo(w.mount);
        if (r0 <= w.maxR) {
          th.stage = 4; th.tLaunch = st.t; th.rounds = [];
          if (w.rounds) {
            for (let k = 0; k < w.rounds; k++) {
              const tf = st.t + k * w.rate;
              let ti = tf + th.d.path.pos(tf, tmp).distanceTo(w.mount) / w.v; ti = tf + th.d.path.pos(ti, tmp).distanceTo(w.mount) / w.v;
              const p = th.d.path.pos(ti, V(0, 0, 0));
              if (k < w.rounds - 1) p.add(V((k - 1) * 0.04, 0.03 + k * 0.012, 0.035 * (k % 2 ? 1 : -1))); // near misses, then a hit
              th.rounds.push({ tf, ti, p });
            }
            th.tInt = th.rounds[w.rounds - 1].ti;
            say(st, `ENGAGE ${th.d.tn}: 5-inch gun opens fire, ${(r0 / NM).toFixed(1)} nm`);
          } else {
            th.tInt = st.t + w.burst + r0 / w.v;
            say(st, `ENGAGE ${th.d.tn}: Phalanx CIWS opens fire, ${Math.round(r0 * 1000)} m`);
          }
          th.intPoint = th.d.path.pos(th.tInt, V(0, 0, 0));
        }
      } else {
        const pl = plan(st, th);
        if (pl) { th.stage = 4; th.tLaunch = pl.tL; th.tInt = pl.tI; th.intPoint = pl.point; say(st, pl.tL - st.t > 2 ? `ENGAGE ${th.d.tn}: firing solution, ${th.d.weapon} launches in ${Math.round(pl.tL - st.t)} s` : `ENGAGE ${th.d.tn}: ${th.d.weapon} away from Mk 41 VLS`); }
      }
    }
    if (th.stage === 4 && !w.gun && !th.saidAway && st.t >= th.tLaunch && th.tLaunch - th.tId > 4) { th.saidAway = true; say(st, `LAUNCH ${th.d.weapon} away from Mk 41 VLS at ${th.d.tn}`); }
    if (th.stage === 4 && st.t >= th.tLaunch + (w.gun ? 0.3 : 4)) { th.stage = 5; if (!w.gun) say(st, `MIDCOURSE ${th.d.weapon} on uplink to ${th.d.tn}`); }
    if (th.stage === 5 && st.t >= th.tInt - (w.gun ? 0.5 : 4)) { th.stage = 6; if (!w.gun) say(st, `TERMINAL ${th.d.weapon} homing on ${th.d.tn}`); }
    if (th.stage === 6 && st.t >= th.tInt && !th.deadAt) {
      th.alive = false; th.deadAt = st.t;
      const alt = th.intPoint.y < 1 ? `${Math.round(th.intPoint.y * 1000)} m` : `${th.intPoint.y.toFixed(0)} km`;
      const rng = th.intPoint.length() < 5 ? `${Math.round(th.intPoint.length() * 1000)} m` : `${(th.intPoint.length() / NM).toFixed(0)} nm`;
      say(st, `INTERCEPT ${th.d.tn} by ${w.label || th.d.weapon} at ${rng}, ${alt} altitude${th.intPoint.y >= 100 ? " (in space)" : ""}`);
    }
    if (th.stage === 6 && th.deadAt && st.t >= th.deadAt + 3) { th.stage = 7; th.outcome = "Destroyed"; say(st, `ASSESS ${th.d.tn}: kill`); }
  }
}

export function doneAt(st) { return st.threats.every(th => th.outcome) && st.t > Math.max(...st.threats.map(th => (th.deadAt || 0))) + 8; }

// ------------------------------------------------------------------ derived quantities (read-only)
// Interceptor flight path: a cubic Bezier from the launcher, lofted, to the planned intercept point.
export function interceptorPos(th, t, out) {
  const T = th.tInt - th.tLaunch, s = Math.min(Math.max((t - th.tLaunch) / T, 0), 1);
  const e = Math.pow(s, 1.25), u = 1 - e;
  const a = LAUNCH, b = th.intPoint, d = a.distanceTo(b);
  const c1y = a.y + Math.min(d * 0.35, 60), c2x = b.x * 0.55, c2y = Math.max(b.y, a.y) + Math.min(d * 0.18, 40), c2z = b.z * 0.55;
  const k0 = u * u * u, k1 = 3 * u * u * e, k2 = 3 * u * e * e, k3 = e * e * e;
  return out.set(a.x * k0 + a.x * k1 + c2x * k2 + b.x * k3, a.y * k0 + c1y * k1 + c2y * k2 + b.y * k3, a.z * k0 + a.z * k1 + c2z * k2 + b.z * k3);
}
const DECOY_DIR = [[1, 0.35, 0.2], [-0.8, 0.5, 0.45], [0.15, -0.3, -1]].map(([x, y, z]) => { const l = Math.hypot(x, y, z); return V(x / l, y / l, z / l); });
export const B1_RELEASE = THREATS[B1i].path.t0 + DECOY_REL * THREATS[B1i].path.T;
export function decoyPos(k, t, out) {
  const s = Math.min(9, 0.15 * (t - B1_RELEASE)), d = DECOY_DIR[k];
  THREATS[B1i].path.pos(t - 1.5 * (k + 1), out);
  return out.set(out.x + d.x * s, out.y + d.y * s, out.z + d.z * s);
}
export const jammerPos = (t, out) => out.set(JAM.pos.x + 4 * Math.sin(t / 60), JAM.pos.y, JAM.pos.z + 4 * Math.cos(t / 60));
export const warnTime = th => th.tDet == null ? null : th.d.path.t0 + th.d.path.T - th.tDet;   // first detection to when it would arrive
export const tracksHeld = st => st.threats.filter(th => th.alive && th.stage >= 1).length;
export const kills = st => st.threats.filter(th => th.deadAt != null).length;
export const airborne = (st, th) => th.alive && st.t >= th.d.path.t0;

// Per-face load for the scheduler read-out: tracks held, tracks waiting, seconds between updates of each track.
export function faceLoad(st) {
  return [0, 1, 2, 3].map(f => {
    const held = st.threats.filter(th => th.alive && th.stage >= 1 && faceOf(th.pos) === f);
    const waiting = st.threats.filter(th => th.alive && th.waiting && th.stage === 0 && faceOf(th.pos) === f).length;
    const n = held.length;
    const interval = st.mode === "spy6" ? (n ? SPY6_UPDATE : 0) : n / (2 * SPY1_TRACKS_PER_SLOT);   // 6 track updates per second per face
    let worst = 0; for (const th of held) worst = Math.max(worst, st.t - th.lastUpd);
    return { n, waiting, interval, worst, cap: st.mode === "spy6" ? 30 * (SPY1_FACE_CAP + 1) : SPY1_FACE_CAP };
  });
}

// Run the whole raid without drawing anything. `sample` seconds between rows of the time series (0 = none).
export function headless(mode, { until = END_T, sample = 1 } = {}) {
  const st = newState(mode), series = [];
  let next = 0, gapMax = 0, gapN = 0;
  while (st.t < until && !doneAt(st)) {
    const before = st.updates.length;
    step(st, STEP);
    for (let i = before; i < st.updates.length; i++) gapMax = Math.max(gapMax, st.updates[i]);
    gapN += st.updates.length - before;
    if (sample && st.t >= next) {
      next += sample;
      let stale = 0; for (const th of st.threats) if (th.alive && th.stage >= 1) stale = Math.max(stale, st.t - th.lastUpd);
      series.push({ t: st.t, held: tracksHeld(st), waiting: st.waitNow, kills: kills(st), gap: gapN ? gapMax : stale, airborne: st.threats.filter(th => airborne(st, th)).length });
      gapMax = 0; gapN = 0;
    }
  }
  st.series = series;
  return st;
}

// Headline numbers for one finished run. Everything the scoreboard, end card, CSV and tests use comes from here.
export function summarize(run) {
  const th = run.threats, a1 = th[A1i], b1 = th[B1i];
  const sum = (f) => th.reduce((s, t) => s + f(t), 0);
  const upd = run.updates;
  let maxUpd = 0, sumUpd = 0; for (const u of upd) { sumUpd += u; if (u > maxUpd) maxUpd = u; }
  const jammed = THREATS.map((d, i) => i).filter(i => THREATS[i].kind === "drone" && !THREATS[i].swarm && th[i].dDet != null && angDiff(bearing(THREATS[i].path.pos(JAM.t0 + 60, V(0, 0, 0))), JAM.brg) < JAM.half);
  return {
    mode: run.mode, endT: run.t, total: th.length,
    stopped: th.filter(t => t.outcome === "Destroyed").length,
    leaked: th.filter(t => t.outcome === "Hit ship").length,
    a1DetNm: a1.dDet == null ? null : a1.dDet / NM, a1Det: a1.tDet, a1Warn: warnTime(a1), a1Kill: a1.tInt,
    b1Kill: b1.tInt, b1Det: b1.tDet, discrim: DISCRIM[run.mode],
    lost: sum(t => t.lost), wasted: sum(t => t.wasted), peakWait: run.peakWait,
    meanUpd: upd.length ? sumUpd / upd.length : 0, maxUpd,
    swarmClear: Math.max(...th.filter(t => t.d.swarm).map(t => t.tInt || 0)),
    jamDetNm: jammed.length ? Math.min(...jammed.map(i => th[i].dDet)) / NM : null,
    lastKill: Math.max(...th.map(t => t.tInt || 0)),
  };
}

export const mmss = t => { const r = Math.max(0, Math.round(t)); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`; };
export const clock = t => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `T+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };
