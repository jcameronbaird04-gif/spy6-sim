// Camera rig: orbits a focus point. Shots are poses {target, yaw, pitch, dist, fov}; the rig eases between
// nearby poses and cuts (through a short fade) between distant ones, the way an editor would.
import * as THREE from "three";
import { earthDrop } from "./gfx/env.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Rig {
  constructor(camera, dom, fadeEl) {
    this.camera = camera; this.dom = dom; this.fadeEl = fadeEl;
    this.cur = { target: new THREE.Vector3(0, 0.012, 0), yaw: 2.2, pitch: 0.12, dist: 0.42, fov: 38 };
    this.des = this.clone(this.cur);
    this.free = false; this.onManual = null; this.cutT = 0; this.pending = null;
    this.keys = new Set();
    this.bind();
  }
  clone(p) { return { target: p.target.clone(), yaw: p.yaw, pitch: p.pitch, dist: p.dist, fov: p.fov ?? 38 }; }
  // Pose from a camera position and a look-at point (model coordinates).
  static from(pos, target, fov = 38) { const o = new THREE.Vector3().subVectors(pos, target), d = o.length(); return { target: target.clone(), dist: d, pitch: Math.asin(o.y / d), yaw: Math.atan2(o.x, o.z), fov }; }

  // Aim for a pose. Big changes cut; small ones glide.
  go(pose, { cut = "auto" } = {}) {
    const c = this.cur, jump = c.target.distanceTo(pose.target) / Math.max(c.dist, pose.dist) + Math.abs(Math.log(pose.dist / c.dist)) * 0.6 + Math.abs(wrap(pose.yaw - c.yaw)) * 0.5;
    const doCut = cut === true || (cut === "auto" && jump > 1.6);
    if (doCut) { this.pending = this.clone(pose); if (this.cutT <= 0) this.cutT = 0.36; }
    else if (this.pending && this.cutT > 0.18) this.pending = this.clone(pose);      // a cut is fading out: keep its destination current
    else { this.des = this.clone(pose); this.pending = null; }
  }
  snap(pose) { this.des = this.clone(pose); this.cur = this.clone(pose); this.pending = null; this.cutT = 0; }

  manual() { if (!this.free) { this.free = true; this.onManual?.(); } this.pending = null; }

  bind() {
    const el = this.dom, ptrs = new Map(); let pinch = null;
    el.style.touchAction = "none";
    el.addEventListener("contextmenu", e => e.preventDefault());
    el.addEventListener("pointerdown", e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey, moved: 0 }); });
    el.addEventListener("pointermove", e => {
      const q = ptrs.get(e.pointerId); if (!q) return;
      const dx = e.clientX - q.x, dy = e.clientY - q.y; q.x = e.clientX; q.y = e.clientY; q.moved += Math.abs(dx) + Math.abs(dy);
      if (q.moved < 4) return;
      this.manual();
      const d = this.des;
      if (ptrs.size === 1) {
        if (q.pan) {
          const sc = d.dist * 2 * Math.tan(THREE.MathUtils.degToRad(d.fov / 2)) / Math.max(el.clientHeight, 1);
          const fx = -Math.sin(d.yaw), fz = -Math.cos(d.yaw), rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw);
          d.target.x += -rx * dx * sc + fx * dy * sc; d.target.z += -rz * dx * sc + fz * dy * sc;
        } else { d.yaw -= dx * 0.005; d.pitch = clamp(d.pitch + dy * 0.005, -1.2, 1.52); }
      } else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], dd = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) d.dist = clamp(d.dist * pinch / dd, 0.03, 4000); pinch = dd; }
    });
    const end = e => { const q = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (q && q.moved < 4 && e.type === "pointerup") this.onClick?.(e); };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", e => { e.preventDefault(); this.manual(); this.des.dist = clamp(this.des.dist * Math.pow(1.0016, e.deltaY), 0.03, 4000); }, { passive: false });
    window.addEventListener("keydown", e => { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; const k = e.key.toLowerCase(); if ("wasdqe".includes(k) && k.length === 1) this.keys.add(k); });
    window.addEventListener("keyup", e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }

  update(dt, seaHeight = 0) {
    const d = this.des, c = this.cur;
    if (this.keys.size) {
      this.manual();
      const sp = Math.max(d.dist, 0.05) * 0.9 * dt, fx = -Math.sin(d.yaw), fz = -Math.cos(d.yaw), rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw), k = this.keys;
      const mx = (k.has("w") ? fx : 0) - (k.has("s") ? fx : 0) + (k.has("d") ? rx : 0) - (k.has("a") ? rx : 0), mz = (k.has("w") ? fz : 0) - (k.has("s") ? fz : 0) + (k.has("d") ? rz : 0) - (k.has("a") ? rz : 0);
      d.target.x += mx * sp; d.target.z += mz * sp; d.target.y = Math.max(0, d.target.y + ((k.has("e") ? 1 : 0) - (k.has("q") ? 1 : 0)) * sp);
    }
    // cut through a fade: swap the pose at the darkest frame
    if (this.cutT > 0) {
      const before = this.cutT; this.cutT -= dt;
      if (before > 0.18 && this.cutT <= 0.18 && this.pending) { this.snap(this.pending); this.cutT = 0.18; }
      if (this.fadeEl) this.fadeEl.style.opacity = String(clamp(1 - Math.abs(this.cutT - 0.18) / 0.18, 0, 1));
      if (this.cutT <= 0 && this.fadeEl) this.fadeEl.style.opacity = "0";
    }
    const k = 1 - Math.exp(-dt * (this.free ? 9 : 2.4));
    c.target.lerp(d.target, k); c.yaw += wrap(d.yaw - c.yaw) * k; c.pitch += (d.pitch - c.pitch) * k;
    c.dist = Math.exp(Math.log(c.dist) + (Math.log(d.dist) - Math.log(c.dist)) * k); c.fov += (d.fov - c.fov) * k;

    const cam = this.camera, cp = Math.cos(c.pitch);
    const ox = cp * Math.sin(c.yaw), oy = Math.sin(c.pitch), oz = cp * Math.cos(c.yaw);
    const tx = c.target.x, tz = c.target.z, ty = c.target.y - earthDrop(tx, tz);
    cam.position.set(tx + ox * c.dist, ty + oy * c.dist, tz + oz * c.dist);
    // never let the lens go under the water
    const floor = -earthDrop(cam.position.x, cam.position.z) + seaHeight + 0.0022;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.up.set(0, 1, 0); cam.lookAt(tx, ty, tz);
    if (Math.abs(cam.fov - c.fov) > 0.01) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  }
}
