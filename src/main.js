// Entry point: builds the two worlds, runs the shared clock, draws one or both views.
import * as THREE from "three";
import { Rig } from "./camera.js";
import { Director, PRESET, setAspect } from "./director.js";
import { buildEnvironmentMap, updateEnvironment } from "./gfx/env.js";
import { VIEW } from "./gfx/fx.js";
import { Pipeline } from "./gfx/post.js";
import { THREATS, WEAPON, headless, summarize, Vec3 } from "./model.js";
import { UI } from "./ui.js";
import { World } from "./world.js";

const PLAYBACK = 8;                               // 1x playback is 8x real time
const app = document.getElementById("app"), canvas = document.getElementById("scene");

// The whole raid, both radars, before anything is drawn: the source of every number in the interface.
const RUNS = { spy1: headless("spy1"), spy6: headless("spy6") };
const S = { spy1: summarize(RUNS.spy1), spy6: summarize(RUNS.spy6) };

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
const PR_MAX = Math.min(window.devicePixelRatio || 1, 2); let pixelRatio = Math.min(PR_MAX, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
buildEnvironmentMap(renderer);

const camera = new THREE.PerspectiveCamera(38, 1, 0.002, 60000);
const rig = new Rig(camera, canvas, document.getElementById("fade"));
const director = new Director(rig);
const pipeline = new Pipeline(renderer);

const paneOf = m => document.querySelector(`.pane[data-mode="${m}"]`);
const worlds = { spy1: new World("spy1", paneOf("spy1").querySelector(".overlay")), spy6: new World("spy6", paneOf("spy6").querySelector(".overlay")) };
const ALL = [worlds.spy1, worlds.spy6];

const state = { view: window.innerWidth >= 900 ? "split" : "spy6", playing: false, started: false, ended: false, speed: 1, t: 0, cam: "auto", follow: null, tempo: 1 };
const shown = () => state.view === "split" ? ALL : [worlds[state.view]];
const endT = () => Math.max(...shown().map(w => S[w.mode].lastKill)) + 9;

const ui = new UI({ RUNS, S, worlds: ALL, on: {
  view: setView, speed: s => { state.speed = s; }, cam: setCam, play: () => { if (!state.started) return start(); if (state.ended) return restart(); setPlaying(!state.playing); },
  restart, start, seek, follow,
} });
ALL.forEach(w => w.vis.forEach(o => o.tag.el.addEventListener("click", () => follow(o.i))));

function setPlaying(p) { state.playing = p; ui.setPlaying(p); }
function start() { state.started = true; app.classList.add("started"); document.getElementById("start").classList.add("gone"); setPlaying(true); }
function seek(t) { state.t = Math.max(0, t); ALL.forEach(w => w.reset(state.t)); state.ended = false; document.getElementById("end").hidden = true; ui.resetStory(state.t); if (!state.started) { state.started = true; app.classList.add("started"); document.getElementById("start").classList.add("gone"); } }
function restart() { seek(0); director.reset(); setCam("auto"); setPlaying(true); }
function setView(v) { state.view = v; ui.setView(v); resize(); }
function setCam(c) {
  state.cam = c; state.follow = null; ui.followRow(null); rig.free = c !== "auto";
  if (c === "auto") director.since = -99;
  else if (PRESET[c]) rig.go(PRESET[c](), { cut: true });
  ui.setCam(c, c === "auto" ? director.label : ({ theater: "Theater", ship: "Ship", space: "Space", map: "Map" })[c] || "Free camera");
}
function follow(i) {
  state.cam = "follow"; state.follow = i; rig.free = true; ui.setCam(null, `Following ${THREATS[i].name}`); ui.followRow(i);
  const d = THREATS[i]; rig.des.dist = d.kind === "bm" ? 70 : d.kind === "cruise" ? 2.4 : 0.9; rig.des.pitch = 0.2; rig.cur.dist = rig.des.dist; rig.cur.pitch = 0.2;
  const p = followPoint(i); if (p) { rig.des.target.copy(p); rig.cur.target.copy(p); rig.des.yaw = rig.cur.yaw = Math.atan2(-p.x, -p.z) + 0.7; }
}
const fp = new Vec3();
function followPoint(i) {
  const w = shown().at(-1), th = w.st.threats[i], d = THREATS[i];
  if (th.deadAt != null) return th.intPoint;
  return d.path.pos(Math.max(state.t, d.path.t0), fp);
}
rig.onManual = () => { if (state.cam === "auto" || PRESET[state.cam] || state.cam === "theater") { state.cam = "free"; ui.setCam(null, "Free camera"); } };

function resize() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false); pipeline.setSize(w, h, pixelRatio);
  ui._tlW = 0;
}
window.addEventListener("resize", resize);

// Nothing tracked and nothing in flight on screen: run ahead. Guns firing: slow down to watch.
function tempo(story) {
  const ws = shown(), t = state.t;
  const gun = ws.some(w => w.st.threats.some(th => WEAPON[th.d.weapon].gun && th.tLaunch != null && t >= th.tLaunch - 2 && (th.deadAt == null || t < th.deadAt + 1.5)));
  if (gun) return 0.4;
  const busy = ws.some(w => w.st.threats.some(th => (th.alive && th.stage >= 1) || (th.deadAt != null && t - th.deadAt < 6)));
  return !busy && !story && t > 3 ? 3 : 1;
}

let last = performance.now(), uiT = 0, ft = 16, perfT = 0, story = false;
const theaterDir = new Director(rig);
function frame(now) {
  const raw = (now - last) / 1000, realDt = Math.min(raw, 0.1); last = now;
  const ws = shown(), W = app.clientWidth, H = app.clientHeight, vw = W / ws.length;

  if (state.playing) {
    state.tempo = tempo(story);
    const dt = realDt * PLAYBACK * state.speed * state.tempo;
    ALL.forEach(w => w.advance(dt)); state.t += dt;
    if (state.t >= endT()) { setPlaying(false); state.ended = true; ui.showEnd(); }
  }
  story = ui.story(state.t, realDt, state.playing);

  // camera
  setAspect(vw / H);
  if (state.cam === "auto") { director.update(ws, state.t, realDt, state.started); if (now - uiT > 90) ui.setCam("auto", director.label); }
  else if (state.cam === "theater") { rig.free = false; rig.go(theaterDir.pose("theater", ws, state.t), { cut: false }); theaterDir.clock += realDt; }
  else if (state.cam === "follow" && state.follow != null) { const p = followPoint(state.follow); if (p) rig.des.target.copy(p); }
  if (camera.aspect !== vw / H) { camera.aspect = vw / H; camera.updateProjectionMatrix(); }
  rig.update(realDt, 0.0015);
  camera.updateMatrixWorld(true);

  updateEnvironment(camera, now / 1000, ALL.map(w => w.scene));
  const near = camera.position.length() < 6;
  const views = ws.map((w, i) => {
    w.env.sun.castShadow = near;
    w.sync(camera, { w: vw, h: H }, realDt, state.playing);
    return { scene: w.scene, camera, x0: i / ws.length, x1: (i + 1) / ws.length };
  });
  VIEW.uViewport.value.set(vw, H);
  VIEW.uPxAngle.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (H * pixelRatio);
  pipeline.render(views, now / 1000, ws.length > 1 ? 0.5 : -1);

  if (now - uiT > 90) { uiT = now; ui.refresh(state.t, state.playing ? (state.tempo > 1 ? "fast-forward: nothing on the scope" : state.tempo < 1 ? "slow motion" : `${state.speed * PLAYBACK}× real time`) : state.started ? "paused" : ""); }
  ui.drawTimeline(state.t);

  // keep the frame rate up on slower machines by trading resolution
  if (raw < 0.5) ft = ft * 0.95 + raw * 1000 * 0.05;
  if (now - perfT > 1500) { perfT = now;
    if (ft > 26 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.2); resize(); }
    else if (ft < 13 && pixelRatio < Math.min(PR_MAX, 1.5)) { pixelRatio = Math.min(PR_MAX, 1.5, pixelRatio + 0.1); resize(); } }
  requestAnimationFrame(frame);
}

setView(state.view); ui.resetStory(0);
rig.snap(director.pose("hero", ALL, 0));
requestAnimationFrame(now => { last = now; frame(now); app.classList.remove("loading"); });

// Handles for testing and for taking figures from the console.
window.sim = { state, worlds, rig, pipeline, director, RUNS, S, seek, setView, setCam, follow, setPlaying };
