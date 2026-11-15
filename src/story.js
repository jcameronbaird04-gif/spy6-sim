// Everything the interface says in words or tables, computed from the two finished runs.
// No number of the comparison is typed in here by hand: change the model and the text follows.
import { A1i, B1_RELEASE, B1i, DISCRIM, GAIN_DB, JAM, NM, RADAR_FULL, SPY1_FACE_CAP, SWARM_N, THREATS, clock, horizonKm, mmss, rangeFor, warnTime } from "./model.js";

const nm0 = v => v == null ? "–" : `${Math.round(v)} nm`;
const T = t => t ? `T+${mmss(t)}` : "–";
const b6 = s => `<b class="s6">${s}</b>`, b1 = s => `<b class="s1">${s}</b>`;

// Sections of the comparison table: [label, explanation, SPY-1D value, SPY-6 value]
export function compareRows(S) {
  const a = S.spy1, b = S.spy6;
  return [
    { sec: "Range", rows: [
      ["Sensitivity", "Published: SPY-6(V)1 is +15 dB over SPY-1D", "0 dB", `+${GAIN_DB.spy6} dB`],
      ["Detection range, 0.1 m² target", "Range grows as the fourth root of sensitivity: 2.37×", nm0(rangeFor(0.1, "spy1") / NM), nm0(rangeFor(0.1, "spy6") / NM)],
      ["Anti-ship ballistic missile first seen", "The missile aimed at the ship", nm0(a.a1DetNm), nm0(b.a1DetNm)],
      ["Warning before it would hit", "First detection to impact", mmss(a.a1Warn), mmss(b.a1Warn)],
    ] },
    { sec: "Capacity", rows: [
      ["Most threats untracked at once", `One SPY-1D face holds ${SPY1_FACE_CAP} tracks; the swarm is ${SWARM_N} drones on one face`, String(a.peakWait), String(b.peakWait)],
      ["Typical wait between track updates", "Mean over the raid", `${a.meanUpd.toFixed(1)} s`, `${b.meanUpd.toFixed(2)} s`],
      ["Longest wait between track updates", "A track is lost after 4 s without one", `${a.maxUpd.toFixed(1)} s`, `${b.maxUpd.toFixed(1)} s`],
      [`All ${SWARM_N} swarm drones destroyed by`, "How long the swarm stays a threat", T(a.swarmClear), T(b.swarmClear)],
    ] },
    { sec: "Jamming", rows: [
      ["Range kept in the jammed sector", "SPY-6 steers a null onto the jammer (illustrative values)", `${Math.round(JAM.loss.spy1 * 100)}%`, `${Math.round(JAM.loss.spy6 * 100)}%`],
      ["Jammed drones first seen at", "Drones flying in under the jammer", nm0(a.jamDetNm), nm0(b.jamDetNm)],
    ] },
    { sec: "Discrimination", rows: [
      ["Warhead picked out of 3 decoys in", "Wider bandwidth, finer range resolution (illustrative values)", `${DISCRIM.spy1} s`, `${DISCRIM.spy6} s`],
      ["Ballistic missile destroyed in space at", "The SM-3 can only launch once the warhead is identified", T(a.b1Kill), T(b.b1Kill)],
    ] },
    { sec: "Outcome", rows: [
      ["Threats stopped", "", `${a.stopped} / ${a.total}`, `${b.stopped} / ${b.total}`],
      ["Raid over at", "Last kill", T(a.lastKill), T(b.lastKill)],
      ...(a.lost + b.lost + a.wasted + b.wasted ? [["Tracks lost / interceptors wasted", "", `${a.lost} / ${a.wasted}`, `${b.lost} / ${b.wasted}`]] : []),
    ] },
  ];
}
export const headlineRows = S => { const r = compareRows(S); return [r[0].rows[2], r[0].rows[3], r[1].rows[0], r[1].rows[3], r[2].rows[1], r[3].rows[1], r[4].rows[1]]; };

export function verdict(S) {
  const a = S.spy1, b = S.spy6, all = a.stopped === a.total && b.stopped === b.total;
  return {
    title: all ? `Both radars stop all ${a.total} threats` : `SPY-6 stops ${b.stopped} of ${b.total}; SPY-1D stops ${a.stopped}`,
    sub: all ? `The difference is margin. SPY-6 sees the first missile ${mmss(a.a1Det - b.a1Det)} sooner, never runs out of tracks, and finishes the raid ${mmss(a.lastKill - b.lastKill)} earlier.`
      : "In this model the older radar lets threats through.",
  };
}

// Captions on the scenario clock. Each compares the two radars, so they read the same in any view.
export function captions(RUNS, S) {
  const a = S.spy1, b = S.spy6, out = [];
  const at = (t, k, html, hold = 9) => { if (t != null && isFinite(t)) out.push({ t, k, html, hold }); };
  const cue = (run, key) => run.callouts.find(c => c.key === key)?.t;
  at(b.a1Det + 1, "Range", `${b6("SPY-6")} picks up the missile aimed at the ship ${b6(nm0(b.a1DetNm))} out, seconds after launch. ${b1("SPY-1D")} will not see it for another ${mmss(a.a1Det - b.a1Det)}.`);
  at(B1_RELEASE + 2, "Discrimination", `The missile in space has released 3 decoys. ${b6("SPY-6")} finds the real warhead in ${b6(DISCRIM.spy6 + " s")}; ${b1("SPY-1D")} needs ${b1(DISCRIM.spy1 + " s")}, and the SM-3 cannot launch until it knows.`);
  at(b.b1Kill + 1, "Discrimination", `${b6("SPY-6")}: ballistic missile destroyed in space. ${b1("SPY-1D")}'s intercept is still ${Math.round(a.b1Kill - b.b1Kill)} s away.`, 7);
  at(a.a1Det + 1, "Range", `${b1("SPY-1D")} only now detects the missile aimed at the ship, at ${b1(nm0(a.a1DetNm))}: ${b1(mmss(a.a1Warn))} of warning instead of ${b6(mmss(b.a1Warn))}.`);
  at(JAM.t0 + 2, "Jamming", `An aircraft is flooding the radars with noise from the east. ${b6("SPY-6")} steers a null onto it and keeps ${b6(Math.round(JAM.loss.spy6 * 100) + "%")} of its range there. ${b1("SPY-1D")} keeps ${b1(Math.round(JAM.loss.spy1 * 100) + "%")}: look at the notch in its coverage.`, 10);
  at(cue(RUNS.spy6, "swarm"), "Capacity", `${SWARM_N} drones on one bearing. ${b6("SPY-6")} forms a beam for every drone at once. ${b1("SPY-1D")} has one beam per array face and must share it between searching and tracking.`, 10);
  at(cue(RUNS.spy1, "full"), "Capacity", `${b1("SPY-1D")}'s north-east face is full at ${b1(SPY1_FACE_CAP + " tracks")}. Up to ${b1(String(a.peakWait))} drones fly in untracked and cannot be engaged until a slot frees. ${b6("SPY-6")} is tracking all ${SWARM_N}.`, 10);
  at(b.swarmClear + 1, "Capacity", `${b6("SPY-6")} has destroyed the whole swarm at ${b6(T(b.swarmClear))}. ${b1("SPY-1D")} finishes at ${b1(T(a.swarmClear))}.`, 7);
  at(b.lastKill + 4, "Outcome", `${b6("SPY-6")}: raid over, ${b.stopped} of ${b.total} stopped. ${b1("SPY-1D")} is still working through drones it saw late under jamming, at ${b1(nm0(a.jamDetNm))} instead of ${b6(nm0(b.jamDetNm))}.`, 10);
  return out.sort((x, y) => x.t - y.t);
}

export function csv(RUNS, S) {
  const q = v => v == null ? "" : (typeof v === "number" ? +v.toFixed(2) : `"${String(v).replace(/"/g, '""')}"`);
  const out = [["# SPY-6 vs SPY-1D kill-chain simulation results. Times in seconds of scenario time; ranges in nautical miles; altitudes in km. Model outputs, not real performance."],
    ["radar", "track", "name", "class", "rcs_m2", "launch_s", "first_detect_s", "detect_range_nm", "identified_s", "weapon", "weapon_launch_s", "intercept_s", "intercept_range_nm", "intercept_alt_km", "detect_to_kill_s", "warning_before_impact_s", "tracks_lost", "interceptors_wasted", "outcome"]];
  for (const m of ["spy1", "spy6"]) for (const t of RUNS[m].threats) out.push([RADAR_FULL[m], t.d.tn, t.d.name, t.d.cls, t.d.rcs, t.d.path.t0, t.tDet, t.dDet == null ? null : t.dDet / NM, t.tId, t.d.weapon, t.tLaunch, t.tInt,
    t.intPoint ? Math.hypot(t.intPoint.x, t.intPoint.z) / NM : null, t.intPoint ? t.intPoint.y : null, t.tDet != null && t.tInt != null ? t.tInt - t.tDet : null, t.tDet != null && t.d.id !== "B1" ? warnTime(t) : null, t.lost, t.wasted, t.outcome].map(q));
  out.push([], ["radar", "mean_track_update_s", "worst_track_update_s", "tracks_lost_total", "interceptors_wasted_total", "peak_untracked_radar_full", "swarm_cleared_s", "last_kill_s"]);
  for (const m of ["spy1", "spy6"]) { const s = S[m]; out.push([RADAR_FULL[m], q(s.meanUpd), q(s.maxUpd), s.lost, s.wasted, s.peakWait, q(s.swarmClear), q(s.lastKill)]); }
  out.push([], ["radar", "time_s", "tracks_held", "untracked_radar_full", "destroyed", "threats_airborne", "worst_update_gap_s"]);
  for (const m of ["spy1", "spy6"]) for (const r of RUNS[m].series) out.push([RADAR_FULL[m], q(r.t), r.held, r.waiting, r.kills, r.airborne, q(r.gap)]);
  out.push([], ["radar", "time_s", "event"]);
  for (const m of ["spy1", "spy6"]) for (const e of RUNS[m].events) out.push([RADAR_FULL[m], q(e.t), q(e.msg)]);
  return out.map(r => r.join(",")).join("\n");
}

export const METHOD_HTML = `
<p>The same raid is run twice through one combat-system model, once per radar. Only the radar's parameters differ. Both runs are deterministic, so every number here is reproducible; <code>tests/model.test.mjs</code> pins them.</p>
<dl>
  <dt>Range</dt><dd>Radar range equation: R ∝ (S·σ)<sup>¼</sup>. SPY-6(V)1's sensitivity S is +15 dB (31.6×) over SPY-1D <span class="pill pub">published</span>, so it sees the same target 2.37× farther. SPY-1D's 400 km on a 1 m² target is <span class="pill">illustrative</span>.</dd>
  <dt>Horizon</dt><dd>4/3-Earth radar horizon from a 25 m array: about ${Math.round(horizonKm(0.02) / NM)} nm for a sea-skimmer at 20 m. The same for both radars: geometry, not power. The scene is drawn on that curved Earth.</dd>
  <dt>Capacity</dt><dd>SPY-1D: one beam per face in 0.1 s slots, 2 in 10 for tracks, 3 updates per slot, so about ${SPY1_FACE_CAP + 1} tracks per face inside the 4 s limit (about 100 for the ship <span class="pill pub">published "100+"</span>). SPY-6: every track every 0.25 s, 30× the capacity <span class="pill pub">published "over 30×"</span>.</dd>
  <dt>Jamming</dt><dd>Stand-off noise jammer, ±${JAM.half}° sector. Range kept: SPY-1D ${Math.round(JAM.loss.spy1 * 100)}%, SPY-6 ${Math.round(JAM.loss.spy6 * 100)}% with an adaptive null <span class="pill">illustrative</span>.</dd>
  <dt>Decoys</dt><dd>Time to pick the warhead out of 4 objects: ${DISCRIM.spy1} s vs ${DISCRIM.spy6} s <span class="pill">illustrative</span>, standing in for range resolution c/2B.</dd>
  <dt>Lost track</dt><dd>A track with no update for 4 s is dropped <span class="pill">illustrative</span>.</dd>
</dl>
<p><b>What you are looking at.</b> Beams are drawn at the model's 1.6° width. The translucent dome is where the radar can detect a 0.1 m² target; the dashed ring is the sea-skimmer horizon. A grey tag is a threat that is in the air but that this radar is not tracking, with the reason. The arc round a tag drains toward the 4 s lost-track limit and refills on each radar update. Playback 1× is 8× real time. Models are only drawn at true size; at a distance each object is a point of light.</p>
<p>Speeds: Shahed-class drone 185 km/h, SM-2/SM-6 about Mach 3, SM-3 Block IIA about 4.5 km/s (open sources). Weapon ranges, target sizes and the raid itself are illustrative. See <code>scenario.yaml</code> and <code>AUDIT.md</code> in the repository.</p>`;

export { clock, THREATS, A1i, B1i };
