// Pins the kill-chain model to the numbers the paper and AUDIT.md quote.
// Run from the repository root:  node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";

import { GAIN, SPY1_FACE_CAP, SWARM_N, THREATS, headless, horizonKm, mmss, rangeFor, summarize } from "../src/model.js";

const RUNS = { spy1: headless("spy1"), spy6: headless("spy6") };
const S = { spy1: summarize(RUNS.spy1), spy6: summarize(RUNS.spy6) };

test("+15 dB gives the 2.37x range ratio on the same target", () => {
  assert.ok(Math.abs(GAIN.spy6 - 31.62) < 0.01);
  assert.ok(Math.abs(rangeFor(0.1, "spy6") / rangeFor(0.1, "spy1") - 2.371) < 1e-3);
});

test("sea-skimmers at 20 m stay below the radar horizon until about 21 nm", () => {
  assert.equal(Math.round(horizonKm(0.02) / 1.852), 21);
});

test("the raid is 39 threats including a 30-drone swarm", () => {
  assert.equal(THREATS.length, 39);
  assert.equal(THREATS.filter(d => d.swarm).length, SWARM_N);
  assert.equal(SPY1_FACE_CAP, 23);
});

test("both radars stop every threat", () => {
  for (const m of ["spy1", "spy6"]) { assert.equal(S[m].stopped, 39); assert.equal(S[m].leaked, 0); }
});

test("range: anti-ship ballistic missile detected at 215 nm vs 102 nm, warning 7:02 vs 2:41", () => {
  assert.equal(Math.round(S.spy6.a1DetNm), 215);
  assert.equal(Math.round(S.spy1.a1DetNm), 102);
  assert.equal(mmss(S.spy6.a1Warn), "7:02");
  assert.equal(mmss(S.spy1.a1Warn), "2:41");
});

test("capacity: SPY-1D leaves up to 8 drones untracked, SPY-6 none; swarm cleared 10:55 vs 11:45", () => {
  assert.equal(S.spy1.peakWait, 8);
  assert.equal(S.spy6.peakWait, 0);
  assert.equal(mmss(S.spy6.swarmClear), "10:55");
  assert.equal(mmss(S.spy1.swarmClear), "11:45");
});

test("track updates: worst gap 4.0 s vs 0.3 s, and no tracks lost or interceptors wasted", () => {
  assert.equal(S.spy1.maxUpd.toFixed(1), "4.0");
  assert.equal(S.spy6.maxUpd.toFixed(1), "0.3");
  for (const m of ["spy1", "spy6"]) { assert.equal(S[m].lost, 0); assert.equal(S[m].wasted, 0); }
});

test("jamming: drones in the jammed sector first seen at 33 nm vs 18 nm", () => {
  assert.equal(Math.round(S.spy6.jamDetNm), 33);
  assert.equal(Math.round(S.spy1.jamDetNm), 18);
});

test("discrimination: the space intercept comes 70 s sooner with SPY-6", () => {
  assert.equal(Math.round(S.spy1.b1Kill - S.spy6.b1Kill), 70);
});

test("the model is deterministic", () => {
  const again = headless("spy1");
  assert.deepEqual(again.events, RUNS.spy1.events);
});
