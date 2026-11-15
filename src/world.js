// One World per radar: its own copy of the scenario state and its own scene. Two Worlds side by side, stepped with
// the same clock and seen through the same camera, are the split-screen comparison.
import * as THREE from "three";
import {
  B1_RELEASE, B1i, DISCRIM, JAM, LAUNCH, LOST_GAP, NM, RADAR_NAME, SPY1_FACE_CAP, STEP, THREATS, WEAPON,
  belowHorizon, decoyPos, doneAt, faceOf, horizonKm, interceptorPos, jamFactor, jammerPos, newState, rangeFor, step, Vec3,
} from "./model.js";
import { Environment, earthDrop, toScene } from "./gfx/env.js";
import { G, waveHeightJS } from "./gfx/glsl.js";
import { Beam, Dome, Particles, ScreenLine, glowSprite, shockRing } from "./gfx/fx.js";
import { buildBallistic, buildCruise, buildDrone, buildInterceptor, buildJammer } from "./gfx/models.js";
import { buildShip, facePositions } from "./gfx/ship.js";

export const COLOR = { spy6: 0x49c8ff, spy1: 0xffb04a, unknown: 0xffd84a, hostile: 0xff4b40, friend: 0x62b8ff, kill: 0x7fe39a, ghost: 0xa9b4be, jam: 0xff8a3a };
const REF_RCS = 0.1;                                // the coverage dome is drawn for a 0.1 m^2 target (drone / cruise missile)
const Z = new THREE.Vector3(0, 0, 1);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), m1 = new Vec3(), m2 = new Vec3();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SHORT = { A1: "Anti-ship ballistic missile", B1: "Ballistic missile", C1: "Cruise missile 1", C2: "Cruise missile 2", D5: "Pop-up drone" };
const nm = km => km / NM;
const fmtAlt = y => y >= 1 ? `${y.toFixed(0)} km` : `${Math.round(y * 1000)} m`;

export class World {
  constructor(mode, overlay) {
    this.mode = mode; this.overlay = overlay; this.color = COLOR[mode];
    this.scene = new THREE.Scene(); this.env = new Environment(this.scene);
    this.ship = buildShip(mode); this.scene.add(this.ship.root);
    this.FACE = facePositions(this.ship);
    this.st = newState(mode); this.acc = 0; this.realT = 0; this.tags = []; this._swarmC = new THREE.Vector3();
    const add = o => (this.scene.add(o), o);

    this.smoke = new Particles(14000, false); this.fire = new Particles(4000, true); add(this.smoke.points); add(this.fire.points);
    this.vlsLight = add(new THREE.PointLight(0xffc890, 0, 0.6, 1.6)); this.vlsLight.position.set(LAUNCH.x, LAUNCH.y + 0.012, LAUNCH.z); this.vlsHeat = 0;
    this.vlsFlash = add(glowSprite(0xffd2a0, { screen: false, intensity: 5 }));

    // coverage: dome for the reference target, its footprint ring, and the sea-skimmer horizon ring
    this.R = rangeFor(REF_RCS, mode);
    this.dome = new Dome(this.color, this.R); add(this.dome.mesh);
    this.rings = { range: new ScreenLine(260, { color: this.color, width: 1.6, opacity: 0.85, glow: 1.5 }), horizon: new ScreenLine(200, { color: 0xdfe8f0, width: 1.2, opacity: 0.55, dash: 2.4 }) };
    add(this.rings.range.mesh); add(this.rings.horizon.mesh);
    this.setRing(this.rings.horizon, () => horizonKm(0.02));
    this.jamOn = null; this.updateCoverage();
    this.ringTags = [this.tag("ring"), this.tag("ring")];
    this.jamLine = new ScreenLine(2, { color: COLOR.jam, width: 1.4, opacity: 0.7, dash: 3.0 }); add(this.jamLine.mesh);

    // beams
    if (mode === "spy6") { this.trackBeams = THREATS.map(() => { const b = new Beam(this.color); add(b.mesh); return b; }); this.search = [0, 1, 2, 3].flatMap(f => [0, 1, 2, 3, 4].map(k => ({ f, k, beam: new Beam(this.color), t: Math.random() * 0.5, to: new THREE.Vector3() }))); }
    else { this.search = [0, 1, 2, 3].map(f => ({ f, k: 0, beam: new Beam(this.color), t: f * 0.02, tick: f * 3, trk: 0, to: new THREE.Vector3(), onTrack: false })); }
    this.search.forEach(s => add(s.beam.mesh));
    this.faceHeat = [0, 0, 0, 0];

    // threats and the weapons sent against them
    const ic = {};
    this.vis = THREATS.map((d, i) => {
      const model = d.kind === "drone" ? buildDrone() : d.kind === "cruise" ? buildCruise() : buildBallistic(d.len);
      const w = WEAPON[d.weapon], o = { d, i, model, gun: !!w.gun };
      add(model.root); model.root.visible = false;
      o.marker = add(glowSprite(0xffffff, { intensity: 2.2 }));
      o.trail = new ScreenLine(d.kind === "bm" ? 96 : 28, { color: 0xffffff, width: d.swarm ? 1.1 : 1.6, opacity: 0.8, fade: 1.4, glow: 1.3 }); add(o.trail.mesh);
      o.stalk = new ScreenLine(2, { color: 0xffffff, width: 1, opacity: 0.28 }); add(o.stalk.mesh);
      if (d.kind === "bm") { o.pred = new ScreenLine(120, { color: COLOR.unknown, width: 1.3, opacity: 0.6, dash: d.id === "B1" ? 14 : 7 }); add(o.pred.mesh); }
      if (!w.gun) {
        o.w = buildInterceptor(d.weapon); add(o.w.root); o.w.root.visible = false;
        o.wMarker = add(glowSprite(COLOR.friend, { intensity: 2.6 }));
        o.wTrail = new ScreenLine(56, { color: COLOR.friend, width: 1.5, opacity: 0.9, fade: 1.0, glow: 1.6 }); add(o.wTrail.mesh);
        o.wTag = this.tag("friend small");
      } else {
        o.shells = Array.from({ length: w.rounds || 0 }, () => add(glowSprite(0xffe2a0, { intensity: 4 })));
        o.bursts = Array.from({ length: w.rounds || 0 }, () => add(glowSprite(0xffb060, { intensity: 5 })));
        o.muzzle = add(glowSprite(0xffc46b, { screen: false, intensity: 6 }));
        if (!w.rounds) { const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(30 * 6), 3));
          o.tracers = add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(0xffc470).multiplyScalar(5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))); o.tracers.frustumCulled = false; o.tracers.visible = false; }
      }
      o.flash = add(glowSprite(0xffe0b0, { intensity: 6 })); o.ring = add(shockRing(0xffd0a0));
      o.tag = this.tag(d.swarm ? "threat mini" : "threat");
      o.killAge = -1; o.fresh = 0; o.lastSeenUpd = null;
      return o;
    });
    this.jammer = buildJammer(); add(this.jammer.root); this.jamMarker = add(glowSprite(COLOR.jam, { intensity: 2.4 })); this.jamTag = this.tag("jam");
    this.decoys = [0, 1, 2].map(() => { const m = buildBallistic(THREATS[B1i].len); m.body.visible = false; m.rv.visible = true; add(m.root); return { m, marker: add(glowSprite(COLOR.unknown, { intensity: 2 })), tag: this.tag("decoy small") }; });
    this.swarmTag = this.tag("group"); this.shipTag = this.tag("own"); this.shipMarker = add(glowSprite(this.color, { intensity: 2.5 }));
  }

  tag(cls) {
    const e = document.createElement("div"); e.className = "tag " + cls; e.hidden = true;
    e.innerHTML = '<i class="bx"></i><div class="tx"></div>';
    this.overlay.appendChild(e);
    const t = { el: e, tx: e.lastChild, cls, html: "", x: 0, y: 0, f: -1, state: "" }; this.tags.push(t); return t;
  }
  setRing(line, radiusAt) {
    const n = line.max, pts = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { const a = k / (n - 1) * Math.PI * 2, r = radiusAt(a * 180 / Math.PI), x = Math.sin(a) * r, z = -Math.cos(a) * r; pts[k * 3] = x; pts[k * 3 + 1] = 0.02 - earthDrop(x, z); pts[k * 3 + 2] = z; }
    line.set(pts);
  }
  // Footprint of the dome on the sea, notched where jamming cuts the range.
  updateCoverage() {
    const on = this.st.t >= JAM.t0; if (on === this.jamOn) return; this.jamOn = on;
    const loss = JAM.loss[this.mode];
    this.dome.mat.uniforms.uJam.value.set(JAM.brg * Math.PI / 180, JAM.half * Math.PI / 180, loss, on ? 1 : 0);
    this.setRing(this.rings.range, brg => this.R * (on && Math.abs(((brg - JAM.brg + 540) % 360) - 180) < JAM.half ? loss : 1));
  }

  // ---------------------------------------------------------------- time
  reset(t = 0) {
    this.st = newState(this.mode); this.acc = 0;
    while (this.st.t < t - 1e-9) step(this.st, STEP);
    this.smoke.clear(); this.fire.clear(); this.vlsHeat = 0;
    this.vis.forEach(o => { o.killAge = this.st.threats[o.i].deadAt != null ? 99 : -1; o.lastW = null; o.lastB = null; o.launchSeen = this.st.threats[o.i].tLaunch; o.launched = o.launchSeen != null && this.st.t >= o.launchSeen; o.shotSeen = 99; if (this.st.threats[o.i].tLaunch == null) o.shotSeen = 0; });
    this.jamOn = null; this.updateCoverage();
  }
  get done() { return doneAt(this.st); }
  // Advance the scenario by dt seconds and leave behind the smoke and flashes of whatever happened.
  advance(dt) {
    this.acc += dt;
    while (this.acc >= STEP) { step(this.st, STEP); this.acc -= STEP; }
    const st = this.st, t = st.t;
    this.updateCoverage();
    this.vis.forEach(o => {
      const th = st.threats[o.i], d = o.d;
      // booster exhaust of a climbing ballistic missile
      if (d.kind === "bm" && th.alive && t >= d.path.t0 && (t - d.path.t0) / d.path.T < d.path.boost) {
        const p = toScene(th.pos, v1), lp = o.lastB || p.clone(), n = Math.min(10, Math.ceil(lp.distanceTo(p) / 0.35));
        for (let k = 0; k < n; k++) this.smoke.emit(v2.lerpVectors(lp, p, k / n), v3.set(0.003, 0.0008, 0.001), t, 150, 120, 1100, 0.92, 0.9, 0.86, 0.75, 0.08);
        o.lastB = (o.lastB || new THREE.Vector3()).copy(p);
      }
      if (o.gun) return;
      if (th.tLaunch !== o.launchSeen) { o.launchSeen = th.tLaunch; o.lastW = null; o.launched = false; }
      const flying = th.stage >= 4 && th.tLaunch != null && t >= th.tLaunch && !th.deadAt;
      if (!flying) return;
      const age = t - th.tLaunch, p = toScene(interceptorPos(th, t, m1), v1);
      if (!o.launched) { o.launched = true; if (age < 3) this.launchFx(t); }
      if (age < 26 && p.y < 45) {
        const lp = o.lastW || toScene(LAUNCH, new THREE.Vector3()), n = Math.min(14, Math.ceil(lp.distanceTo(p) / 0.07));
        for (let k = 1; k <= n; k++) this.smoke.emit(v2.lerpVectors(lp, p, k / n), v3.set(0.004, 0.0005, 0.0015), t, 75, 5, 70 + Math.min(p.y, 20) * 5, 0.95, 0.95, 0.93, 0.7, 0.003);
      }
      o.lastW = (o.lastW || new THREE.Vector3()).copy(p);
    });
    // kills: fire and smoke at the intercept point
    this.vis.forEach(o => {
      const th = st.threats[o.i];
      if (th.deadAt != null && o.killAge < 0) {
        o.killAge = 0; const p = toScene(th.intPoint, v1), big = o.d.kind === "bm" ? 3 : 1, inAir = th.intPoint.y < 40;
        for (let k = 0; k < 26 * big; k++) { v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.01 + Math.random() * 0.05 * big); this.fire.emit(p, v2, th.deadAt, 2.2 + Math.random() * 3, 14 * big, 2, 1.0 * 4, 0.62 * 4, 0.25 * 4, 1, 0.004); }
        if (inAir) for (let k = 0; k < 22; k++) { v2.set(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).multiplyScalar(0.012); this.smoke.emit(p, v2, th.deadAt, 80, 18, 170, 0.34, 0.33, 0.33, 0.8, 0.03); }
      }
    });
  }
  launchFx(t) {
    const p = toScene(LAUNCH, v1); this.vlsHeat = 1;
    for (let k = 0; k < 46; k++) { v2.set((Math.random() - 0.5) * 0.02, 0.004 + Math.random() * 0.012, (Math.random() - 0.5) * 0.02); this.smoke.emit(p, v2, t, 50, 5, 80, 0.96, 0.95, 0.93, 0.75, 0.01); }
    for (let k = 0; k < 14; k++) { v2.set((Math.random() - 0.5) * 0.02, 0.01 + Math.random() * 0.03, (Math.random() - 0.5) * 0.02); this.fire.emit(p, v2, t, 3, 9, 3, 4, 2.6, 1.2, 1, 0.006); }
  }

  // ---------------------------------------------------------------- per-frame sync
  // view: { w, h } of this world's rectangle in CSS pixels. realDt: wall-clock seconds. active: clock running.
  sync(camera, view, realDt, active) {
    const st = this.st, t = st.t + this.acc, mode = this.mode;
    this.realT += realDt;
    const pxAng = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(view.h, 1);     // radians per CSS pixel
    const camP = camera.position, shipDist = camP.length();
    this.view = view; this.camera = camera;

    // --- own ship rides the swell
    { const ts = G.uTime.value, dr = G.uDrift.value, h = (x, z) => waveHeightJS(x, z, ts, dr) * 0.001;
      const hb = h(0, -0.06), hs = h(0, 0.06), hp = h(-0.009, 0), hq = h(0.009, 0), hm = (hb + hs + hp + hq) / 4;
      const r = this.ship.root; r.position.y = hm * 0.55; r.rotation.x = Math.atan2(hs - hb, 0.12) * 0.45; r.rotation.z = Math.atan2(hp - hq, 0.018) * 0.22;
      r.visible = shipDist < 60;
      const far = shipDist > 2.5;
      this.shipMarker.visible = far; if (far) { this.shipMarker.position.set(0, 0.02, 0); this.shipMarker.scale.setScalar(0.03); }
      this.place(this.shipTag, v1.set(0, 0.03, 0), far, "", `<b>DDG-128</b><span>${RADAR_NAME[mode]}</span>`);
      this.vlsHeat *= Math.exp(-realDt * 3.2); this.vlsLight.intensity = this.vlsHeat * 0.02;
      this.vlsFlash.visible = this.vlsHeat > 0.02; this.vlsFlash.position.copy(this.vlsLight.position); this.vlsFlash.scale.setScalar(0.05 * this.vlsHeat); this.vlsFlash.material.opacity = this.vlsHeat;
    }

    // --- coverage dome and rings: read best from a distance, fade out up close
    { const k = THREE.MathUtils.smoothstep(shipDist, 4, 40);
      this.dome.mesh.visible = k > 0.01; this.dome.mat.uniforms.uOpacity.value = k; this.dome.mat.uniforms.uTime.value = this.realT;
      this.rings.range.mat.uniforms.uOpacity.value = 0.85 * k; this.rings.horizon.mat.uniforms.uOpacity.value = 0.6 * THREE.MathUtils.smoothstep(shipDist, 3, 25);
      const R = this.R, a = -0.62;
      this.place(this.ringTags[0], v1.set(Math.sin(a) * R, -earthDrop(R, 0), -Math.cos(a) * R), k > 0.5, "", `<b>${RADAR_NAME[mode]} detection range</b><span>${nm(R).toFixed(0)} nm on a 0.1 m² target</span>`);
      const H = horizonKm(0.02);
      this.place(this.ringTags[1], v1.set(Math.sin(2.5) * H, 0, -Math.cos(2.5) * H), shipDist > 25 && shipDist < 420, "", `<b>Radar horizon</b><span>sea-skimmers hidden beyond ${nm(H).toFixed(0)} nm</span>`);
    }

    // --- threats
    const held = [[], [], [], []];
    let swarmAir = 0, swarmHeld = 0, swarmWait = 0; const swarmC = this._swarmC.set(0, 0, 0);
    this.vis.forEach(o => {
      const th = st.threats[o.i], d = o.d, path = d.path, air = th.alive && t >= path.t0;
      const m = o.model;
      if (th.deadAt != null || !air) {
        m.root.visible = false; o.marker.visible = false; o.trail.mesh.visible = false; o.stalk.mesh.visible = false; if (o.pred) o.pred.mesh.visible = false;
        if (o.tag.el.hidden === false && th.deadAt == null) o.tag.el.hidden = true;
      } else {
        const mp = path.pos(t, m1), p = toScene(mp, v1), dist = camP.distanceTo(p), px = d.len * 0.001 / (dist * pxAng);
        const tracked = th.stage >= 1, state = th.stage >= 3 ? "hostile" : tracked ? "unknown" : "ghost";
        if (tracked) held[faceOf(mp)].push(o);
        m.root.visible = px > 2;
        if (m.root.visible) {
          m.root.position.copy(p);
          const ah = toScene(path.pos(t + 0.5, m2), v2).sub(p); if (ah.lengthSq() > 1e-14) m.root.quaternion.setFromUnitVectors(Z, ah.normalize());
          if (d.kind === "bm") { const boost = (t - path.t0) / path.T < path.boost; m.body.visible = boost; m.rv.visible = !boost; if (boost) m.plume.scale.set(1, 1, 0.85 + Math.random() * 0.3); }
        }
        // marker: a point of light of constant screen size while the real thing is too small to see
        const mk = o.marker; mk.visible = px < 60; mk.position.copy(p);
        mk.material.color.copy(mk.userData.base.set(COLOR[state])).multiplyScalar(state === "ghost" ? 0.9 : 2.4);
        mk.material.opacity = clamp(1.4 - px / 40, 0, 1) * (state === "ghost" ? 0.55 : 1); mk.scale.setScalar(state === "ghost" ? 0.011 : d.swarm ? 0.016 : 0.021);
        // trail: recent flight path, computed straight from the trajectory
        const span = d.kind === "bm" ? t - path.t0 : d.kind === "cruise" ? 50 : 120, n = o.trail.max, t0 = Math.max(path.t0, t - span);
        const buf = o.trail.buf || (o.trail.buf = new Float32Array(n * 3));
        for (let k = 0; k < n; k++) { toScene(path.pos(t0 + (t - t0) * k / (n - 1), m2), v2); buf[k * 3] = v2.x; buf[k * 3 + 1] = v2.y; buf[k * 3 + 2] = v2.z; }
        o.trail.set(buf); o.trail.mat.uniforms.uColor.value.set(COLOR[state]); o.trail.mat.uniforms.uOpacity.value = state === "ghost" ? 0.3 : 0.8;
        // altitude stalk down to the sea, so height reads in the wide shots
        const showStalk = mp.y > 0.6 && dist > 20;
        if (showStalk) { const b = o.stalk.buf || (o.stalk.buf = new Float32Array(6)); b[0] = p.x; b[1] = p.y; b[2] = p.z; b[3] = p.x; b[4] = -earthDrop(p.x, p.z); b[5] = p.z; o.stalk.set(b); o.stalk.mat.uniforms.uColor.value.set(COLOR[state]); } else o.stalk.mesh.visible = false;
        if (o.pred) {
          o.pred.mesh.visible = tracked;
          if (tracked) { const nP = o.pred.max, pb = o.pred.buf || (o.pred.buf = new Float32Array(nP * 3)), tE = path.t0 + path.T; for (let k = 0; k < nP; k++) { toScene(path.pos(t + (tE - t) * k / (nP - 1), m2), v2); pb[k * 3] = v2.x; pb[k * 3 + 1] = v2.y; pb[k * 3 + 2] = v2.z; } o.pred.set(pb); o.pred.mat.uniforms.uColor.value.set(COLOR[state]); }
        }
        // tag
        if (d.swarm) { swarmAir++; swarmC.add(p); if (tracked) swarmHeld++; else if (th.waiting) swarmWait++; }
        const fresh = tracked ? clamp(1 - (t - th.lastUpd) / LOST_GAP, 0, 1) : 0;
        let html = "";
        if (!d.swarm) {
          const name = SHORT[d.id] || d.name, where = `${nm(mp.length()).toFixed(0)} nm${mp.y > 0.5 ? " · " + fmtAlt(mp.y) : ""}`;
          let line;
          if (!tracked) line = `<em class="no">Not seen: ${this.whyUnseen(th, mp)}</em>`;
          else if (th.stage >= 4) line = `<em class="eng">${WEAPON[d.weapon].label || d.weapon} ${th.stage >= 6 ? "terminal" : t < th.tLaunch ? "assigned" : "in flight"}</em>`;
          else if (th.stage === 3) line = `<em class="hos">Hostile ${d.cls}</em>`;
          else line = o.i === B1i && t >= B1_RELEASE && !st.flags.discrim ? `<em class="unk">4 objects: which is the warhead?</em>` : `<em class="unk">Tracking · identifying</em>`;
          html = `<b>${name}</b><span>${where}</span>${line}`;
        }
        this.place(o.tag, p, true, state + (th.waiting && !tracked ? " full" : ""), html, fresh, d.swarm ? 1 : th.stage >= 3 ? 5 : 3);
      }

      // --- the weapon sent against it
      if (o.gun) this.syncGun(o, th, t, camP, pxAng);
      else {
        const flying = th.stage >= 4 && th.tLaunch != null && t >= th.tLaunch && th.deadAt == null && th.tInt != null;
        o.w.root.visible = false; o.wMarker.visible = flying; o.wTrail.mesh.visible = flying; if (!flying) o.wTag.el.hidden = true;
        if (flying) {
          const p = toScene(interceptorPos(th, t, m1), v1), dist = camP.distanceTo(p), px = o.w.len * 0.001 / (dist * pxAng);
          o.w.root.visible = px > 2;
          if (o.w.root.visible) { o.w.root.position.copy(p); const ah = toScene(interceptorPos(th, t + 0.15, m2), v2).sub(p); if (ah.lengthSq() > 1e-14) o.w.root.quaternion.setFromUnitVectors(Z, ah.normalize());
            const burn = (t - th.tLaunch) < (th.tInt - th.tLaunch) * 0.7; o.w.plume.visible = burn; if (burn) o.w.plume.scale.set(1, 1, 0.8 + Math.random() * 0.4); }
          o.wMarker.position.copy(p); o.wMarker.scale.setScalar(0.017); o.wMarker.material.opacity = clamp(1.4 - px / 40, 0, 1);
          const n = o.wTrail.max, buf = o.wTrail.buf || (o.wTrail.buf = new Float32Array(n * 3)), t0 = Math.max(th.tLaunch, t - (d.weapon === "SM-3" ? 400 : 45));
          for (let k = 0; k < n; k++) { toScene(interceptorPos(th, t0 + (t - t0) * k / (n - 1), m2), v2); buf[k * 3] = v2.x; buf[k * 3 + 1] = v2.y; buf[k * 3 + 2] = v2.z; }
          o.wTrail.set(buf);
          this.place(o.wTag, p, !d.swarm, "", `<b>${d.weapon}</b>`, -1, 2);
        }
      }
      // --- intercept: flash, ring, and a tag that lingers a moment
      if (o.killAge >= 0 && o.killAge < 8 && th.intPoint) {
        if (active) o.killAge += realDt;
        const a = o.killAge, p = toScene(th.intPoint, v1), dist = camP.distanceTo(p);
        o.flash.visible = a < 1.1; o.flash.position.copy(p); o.flash.scale.setScalar((o.d.swarm ? 0.03 : 0.05) + (o.d.swarm ? 0.05 : 0.14) * Math.min(a * 3, 1)); o.flash.material.opacity = clamp(1 - a / 1.1, 0, 1);
        o.ring.visible = a < 1.6; o.ring.position.copy(p); o.ring.scale.setScalar(Math.max(dist * (o.d.swarm ? 0.018 : 0.04) * Math.pow(a / 1.6, 0.6), 1e-5)); o.ring.quaternion.copy(camera.quaternion); o.ring.material.opacity = clamp(1 - a / 1.6, 0, 1) * 0.6;
        this.place(o.tag, p, a < 5 && !o.d.swarm, "kill", `<b>${SHORT[o.d.id] || o.d.name}</b><em class="kill">Destroyed${th.intPoint.y >= 100 ? " in space" : ""} · ${nm(th.intPoint.length()).toFixed(th.intPoint.length() < 20 ? 1 : 0)} nm</em>`, -1, 6);
        if (a >= 5 || o.d.swarm) { if (o.d.swarm && a < 2.5) this.place(o.tag, p, true, "kill", "", -1, 1); else o.tag.el.hidden = true; }
      } else { o.flash.visible = false; o.ring.visible = false; if (th.deadAt != null) o.tag.el.hidden = true; }
    });
    if (swarmAir) {
      swarmC.multiplyScalar(1 / swarmAir); swarmC.y += 0.35;
      const un = swarmAir - swarmHeld;
      this.place(this.swarmTag, swarmC, true, un ? "warn" : "", `<b>Drone swarm</b><span>${swarmHeld} of ${swarmAir} tracked</span>${un ? `<em class="no">${un} untracked${swarmWait ? " · radar full" : ""}</em>` : `<em class="eng">every drone held</em>`}`, -1, 7);
    } else this.swarmTag.el.hidden = true;

    this.syncBeams(held, t, realDt, active);
    this.syncJam(t, camP, pxAng);
    this.declutter();
    this.smoke.flush(t); this.fire.flush(t);
  }

  whyUnseen(th, p) {
    if (belowHorizon(p)) return "below the radar horizon";
    if (p.length() > rangeFor(th.d.rcs, this.mode) * jamFactor(this.st, p)) return jamFactor(this.st, p) < 1 ? "hidden by jamming" : "beyond detection range";
    if (th.waiting) return `radar full (${SPY1_FACE_CAP} tracks on this face)`;
    return "not yet picked up by search";
  }

  // SPY-6: a beam on every track at once, plus several simultaneous search beams per face.
  // SPY-1D: exactly one beam per face, hopping between its tracks and the search raster.
  syncBeams(held, t, realDt, active) {
    const R = this.R, T = this.realT;
    if (this.mode === "spy6") {
      this.vis.forEach((o, i) => {
        const b = this.trackBeams[i], th = this.st.threats[i], on = th.alive && th.stage >= 1 && t >= o.d.path.t0;
        b.level += ((on ? 1 : 0) - b.level) * (1 - Math.exp(-realDt * 8));
        if (b.level > 0.01) { const mp = o.d.path.pos(t, m1), f = faceOf(mp); b.aim(this.FACE[f], toScene(mp, v1)); b.show(b.level * (o.d.swarm ? 0.5 : 0.75), T); this.faceHeat[f] = 1; } else b.show(0, T);
      });
      for (const s of this.search) {
        if (active) s.t -= realDt;
        if (s.t <= 0) { s.t = 0.42 + Math.random() * 0.2; const az = THREE.MathUtils.degToRad(s.f * 90 + 4 + (s.k + Math.random()) * 16.4), el = THREE.MathUtils.degToRad(1 + Math.random() * Math.random() * 42);
          s.to.set(Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, -Math.cos(az) * Math.cos(el) * R); s.beam.aim(this.FACE[s.f], s.to); s.life = s.t; s.max = s.t; }
        s.beam.show(0.16 * Math.sin(Math.PI * clamp(s.t / (s.max || 1), 0, 1)), T); this.faceHeat[s.f] = Math.max(this.faceHeat[s.f], 0.5);
      }
    } else {
      for (const s of this.search) {
        if (active) s.t -= realDt;
        if (s.t <= 0) {
          s.t += 0.085; const slot = s.tick++ % 10, mine = held[s.f];
          if (slot < 2 && mine.length) { const o = mine[s.trk++ % mine.length]; toScene(o.d.path.pos(t, m1), s.to); s.onTrack = true; }
          else { const n = s.k++, az = THREE.MathUtils.degToRad(s.f * 90 + 3 + (n * 7) % 84), el = THREE.MathUtils.degToRad(1.5 + ((n * 5) % 6) * 6.5);
            s.to.set(Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, -Math.cos(az) * Math.cos(el) * R); s.onTrack = false; }
          s.beam.aim(this.FACE[s.f], s.to);
        }
        s.beam.show(s.onTrack ? 0.95 : 0.34, T); this.faceHeat[s.f] = s.onTrack ? 1 : 0.6;
      }
    }
    this.ship.faceGlow.forEach((m, f) => { m.emissiveIntensity += (this.faceHeat[f] * 0.75 - m.emissiveIntensity) * (1 - Math.exp(-realDt * 6)); this.faceHeat[f] *= Math.exp(-realDt * 4); });
  }

  syncJam(t, camP, pxAng) {
    const st = this.st, on = t >= JAM.t0, vis = t >= JAM.t0 - 60, j = this.jammer;
    j.root.visible = false; this.jamMarker.visible = vis; this.jamLine.mesh.visible = on;
    if (vis) {
      const mp = jammerPos(t, m1), p = toScene(mp, v1), dist = camP.distanceTo(p), px = j.len * 0.001 / (dist * pxAng);
      j.root.visible = px > 2; if (j.root.visible) { j.root.position.copy(p); j.root.rotation.y = -t / 60 + Math.PI; }
      this.jamMarker.position.copy(p); this.jamMarker.scale.setScalar(0.02); this.jamMarker.material.opacity = clamp(1.4 - px / 40, 0, 1);
      if (on) { const b = this.jamLine.buf || (this.jamLine.buf = new Float32Array(6)); b[0] = p.x; b[1] = p.y; b[2] = p.z; b[3] = 0; b[4] = 0.02; b[5] = 0; this.jamLine.set(b); this.jamLine.mat.uniforms.uOpacity.value = this.mode === "spy1" ? 0.55 + 0.3 * Math.sin(this.realT * 9) : 0.3; }
      const kept = Math.round(JAM.loss[this.mode] * 100);
      this.place(this.jamTag, p, true, "", `<b>Jamming aircraft</b><span>${nm(mp.length()).toFixed(0)} nm · ${fmtAlt(mp.y)}</span>${on ? (this.mode === "spy6" ? `<em class="eng">Nulled: ${kept}% of range kept</em>` : `<em class="no">Sector blinded: ${kept}% of range left</em>`) : `<em class="unk">Not jamming yet</em>`}`, -1, 4);
    } else this.jamTag.el.hidden = true;
    // decoys around the ballistic missile in space
    const b1 = st.threats[B1i], sorted = t >= B1_RELEASE + DISCRIM[this.mode];
    this.decoys.forEach((dc, k) => {
      const show = t >= B1_RELEASE && (b1.alive || (b1.deadAt != null && t - b1.deadAt < 10));
      dc.m.root.visible = false; dc.marker.visible = show; if (!show) { dc.tag.el.hidden = true; return; }
      const p = toScene(decoyPos(k, t, m1), v1), dist = camP.distanceTo(p), px = dc.m.len * 0.001 / (dist * pxAng);
      dc.m.root.visible = px > 2; if (dc.m.root.visible) dc.m.root.position.copy(p);
      dc.marker.position.copy(p); dc.marker.scale.setScalar(0.014); dc.marker.material.color.set(sorted ? COLOR.ghost : COLOR.unknown).multiplyScalar(sorted ? 0.8 : 2); dc.marker.material.opacity = clamp(1.4 - px / 40, 0, 1);
      this.place(dc.tag, p, b1.stage >= 1 || b1.deadAt != null, sorted ? "ghost" : "unknown", sorted ? "<b>decoy</b>" : "<b>?</b>", -1, 2);
    });
  }

  syncGun(o, th, t, camP, pxAng) {
    const w = WEAPON[o.d.weapon], firing = th.stage >= 4 && th.tLaunch != null, mount = toScene(w.mount, v2);
    if (w.rounds) {
      let flashOn = false;
      for (let k = 0; k < w.rounds; k++) {
        const r = firing && th.rounds ? th.rounds[k] : null, sh = o.shells[k], bu = o.bursts[k];
        sh.visible = !!r && t >= r.tf && t < r.ti; bu.visible = false;
        if (!r) continue;
        if (sh.visible) { sh.position.lerpVectors(mount, toScene(r.p, v1), (t - r.tf) / (r.ti - r.tf)); sh.scale.setScalar(0.008); }
        if (t >= r.tf && t < r.tf + 0.4) flashOn = true;
        const age = t - r.ti;
        if (age >= 0 && age < 1.2) { bu.visible = true; bu.position.copy(toScene(r.p, v1)); bu.scale.setScalar(0.03 + age * 0.05); bu.material.opacity = 1 - age / 1.2; }
        if (age >= 0 && o.shotSeen <= k) { o.shotSeen = k + 1; const p = toScene(r.p, v1); for (let q = 0; q < 10; q++) { v3.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.01); this.smoke.emit(p, v3, r.ti, 40, 8, 60, 0.2, 0.2, 0.2, 0.85, 0.01); } }
      }
      o.muzzle.visible = flashOn; if (flashOn) { o.muzzle.position.copy(mount); o.muzzle.scale.setScalar(0.03); }
    } else {
      const on = firing && t >= th.tLaunch && t < th.tLaunch + w.burst + 0.6 && th.alive;
      o.tracers.visible = on; o.muzzle.visible = on && Math.random() < 0.7;
      if (on) {
        const arr = o.tracers.geometry.attributes.position.array, tgt = toScene(th.pos, v1), L = mount.distanceTo(tgt), dir = v3.copy(tgt).sub(mount).normalize(), N = 30;
        for (let n = 0; n < N; n++) { const f = (t * 7 + n / N) % 1, a = f * L, b = Math.min(a + 0.05, L), j = 0.004 * f;
          arr[n * 6] = mount.x + dir.x * a + (Math.random() - 0.5) * j; arr[n * 6 + 1] = mount.y + dir.y * a + (Math.random() - 0.5) * j; arr[n * 6 + 2] = mount.z + dir.z * a + (Math.random() - 0.5) * j;
          arr[n * 6 + 3] = mount.x + dir.x * b; arr[n * 6 + 4] = mount.y + dir.y * b; arr[n * 6 + 5] = mount.z + dir.z * b; }
        o.tracers.geometry.attributes.position.needsUpdate = true; o.muzzle.position.copy(mount); o.muzzle.scale.setScalar(0.018);
      }
    }
  }

  // ---------------------------------------------------------------- labels
  // Put a tag at a scene position. fresh: 0..1 share of the lost-track time limit left (-1 = no gauge). pri: declutter priority.
  place(tag, p, show, state, html, fresh = -1, pri = 0) {
    const el = tag.el;
    if (!show) { if (!el.hidden) el.hidden = true; return; }
    const cam = this.camera, c = World._c.copy(p).applyMatrix4(cam.matrixWorldInverse);
    if (c.z > -cam.near) { if (!el.hidden) el.hidden = true; return; }
    c.applyMatrix4(cam.projectionMatrix);
    const x = (c.x + 1) / 2 * this.view.w, y = (1 - c.y) / 2 * this.view.h;
    if (x < -30 || y < -30 || x > this.view.w + 30 || y > this.view.h + 30) { if (!el.hidden) el.hidden = true; return; }
    if (el.hidden) el.hidden = false;
    tag.x = x; tag.y = y; tag.pri = pri;
    el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    if (tag.state !== state) { tag.state = state; el.className = `tag ${tag.cls} ${state}`; }
    if (tag.html !== html) { tag.html = html; tag.tx.innerHTML = html; }
    if (fresh >= 0) { const f = Math.round(fresh * 20) / 20; if (f !== tag.f) { tag.f = f; el.style.setProperty("--f", f); } } else if (tag.f !== -1) { tag.f = -1; el.style.removeProperty("--f"); }
  }
  // When text blocks collide, the higher-priority tag keeps its text; the other keeps only its bracket.
  declutter() {
    const shown = this.tags.filter(t => !t.el.hidden && t.html).sort((a, b) => b.pri - a.pri), kept = [];
    for (const t of shown) {
      const hide = kept.some(k => Math.abs(k.x - t.x) < 150 && Math.abs(k.y - t.y) < 44);
      if (hide !== t.quiet) { t.quiet = hide; t.tx.style.visibility = hide ? "hidden" : ""; }
      if (!hide) kept.push(t);
    }
  }
}
World._c = new THREE.Vector3();
