// Interface: per-radar status cards and radar pictures, the timeline, captions, the data drawer, title and end cards.
import { ACTS, FACE_NAME, JAM, NM, RADAR_NAME, THREATS, WEAPON, clock, faceLoad, horizonKm, interceptorPos, kills, rangeFor, tracksHeld, Vec3 } from "./model.js";
import { METHOD_HTML, captions, compareRows, csv, headlineRows, verdict } from "./story.js";
import { coastX } from "./gfx/env.js";

const $ = id => document.getElementById(id);
const COL = { spy1: "#ffb454", spy6: "#4fd0ff", unk: "#ffd84a", hos: "#ff5a4f", fr: "#6cbcff", kill: "#7fe39a" };
function fit(c, w, h) { const dpr = Math.min(window.devicePixelRatio || 1, 2); if (c._w !== w || c._h !== h || c._d !== dpr) { c._w = w; c._h = h; c._d = dpr; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + "px"; c.style.height = h + "px"; } const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); return x; }
const tmp = new Vec3();

export class UI {
  constructor({ RUNS, S, worlds, on }) {
    this.RUNS = RUNS; this.S = S; this.worlds = worlds; this.on = on;
    this.D = Math.max(S.spy1.endT, S.spy6.endT) + 6;
    this.caps = captions(RUNS, S); this.capI = 0; this.capLeft = 0; this.chapI = -1; this.chapLeft = 0;
    this.panes = {}; document.querySelectorAll(".pane").forEach(p => {
      const m = p.dataset.mode, faces = p.querySelector(".faces");
      faces.innerHTML = FACE_NAME.map(n => `<div class="face"><div class="n"><span>${n}</span><b>0</b></div><div class="m"><i></i></div><span class="w"></span></div>`).join("");
      this.panes[m] = { el: p, overlay: p.querySelector(".overlay"), ppi: p.querySelector(".ppi"), stat: Object.fromEntries([...p.querySelectorAll("[data-k]")].map(e => [e.dataset.k, e])), faces: [...faces.children] };
    });
    this.buildStatic(); this.bind();
  }

  buildStatic() {
    const { S } = this;
    $("facts").innerHTML = [["+15 dB", "SPY-6 sensitivity gain (published)"], ["2.37×", "the range on the same target"], [String(S.spy6.total), "threats in the raid"]].map(([b, s]) => `<li><b>${b}</b><span>${s}</span></li>`).join("");
    $("cmpBody").innerHTML = compareRows(S).map(sec => `<tr class="sec"><td colspan="3">${sec.sec}</td></tr>` + sec.rows.map(r => `<tr><td>${r[0]}${r[1] ? `<small>${r[1]}</small>` : ""}</td><td class="s1">${r[2]}</td><td class="s6">${r[3]}</td></tr>`).join("")).join("");
    $("cmpNote").innerHTML = `Sea-skimmers outside the jammed sector stay below the radar horizon until about ${Math.round(horizonKm(0.02) / NM)} nm, so both radars first see those at the same range: that limit is geometry, not radar power.`;
    $("pMethod").innerHTML = METHOD_HTML;
    const v = verdict(S); $("endH").textContent = v.title; $("endSub").textContent = v.sub;
    $("endBody").innerHTML = headlineRows(S).map(r => `<tr><td>${r[0]}${r[1] ? `<small>${r[1]}</small>` : ""}</td><td class="s1">${r[2]}</td><td class="s6">${r[3]}</td></tr>`).join("");
    // kill chain rows: the nine named threats, then the swarm as one row
    const groups = [...THREATS.map((d, i) => ({ d, ids: [i] })).filter(g => !g.d.swarm), { d: { name: `Drone swarm (${THREATS.filter(d => d.swarm).length})` }, ids: THREATS.map((d, i) => d.swarm ? i : -1).filter(i => i >= 0) }];
    this.chain = groups.map(g => {
      const span = m => { const th = g.ids.map(i => this.RUNS[m].threats[i]).filter(t => t.tDet != null); return th.length ? [Math.min(...th.map(t => t.tDet)), Math.max(...th.map(t => t.tInt || t.tDet)), Math.max(...th.map(t => t.dDet)) / NM] : null; };
      const a = span("spy1"), b = span("spy6"), pct = t => (t / this.D * 100).toFixed(2) + "%";
      const bar = (s, cls) => `<div class="ln ${cls}">${s ? `<i style="left:${pct(s[0])};width:${pct(s[1] - s[0])}"></i>` : ""}<u></u></div>`;
      const row = document.createElement("div"); row.className = "row";
      row.innerHTML = `<div class="hd"><span class="nm">${g.d.name}</span><span class="rg">seen at ${a ? Math.round(a[2]) : "–"} / <span class="s6">${b ? Math.round(b[2]) : "–"} nm</span></span></div>${bar(a, "a")}${bar(b, "b")}`;
      row.addEventListener("click", () => this.on.follow(g.ids[0]));
      $("chain").appendChild(row); return { row, marks: [...row.querySelectorAll("u")], ids: g.ids };
    });
  }

  bind() {
    const on = this.on;
    document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => on.view(b.dataset.view)));
    document.querySelectorAll("#speed button").forEach(b => b.addEventListener("click", () => { on.speed(+b.dataset.s); document.querySelectorAll("#speed button").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
    document.querySelectorAll("#cams button").forEach(b => b.addEventListener("click", () => on.cam(b.dataset.cam)));
    $("play").addEventListener("click", () => on.play()); $("restart").addEventListener("click", () => on.restart());
    $("go").addEventListener("click", () => on.start());
    $("dataBtn").addEventListener("click", () => this.drawer());
    document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => this.tab(b.dataset.pane)));
    $("dlcsv").addEventListener("click", () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv(this.RUNS, this.S)], { type: "text/csv" })); a.download = "spy6_vs_spy1d_results.csv"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); });
    $("endAgain").addEventListener("click", () => { $("end").hidden = true; on.restart(); });
    $("endData").addEventListener("click", () => { $("end").hidden = true; this.drawer(true); this.tab("pCompare"); });
    $("endClose").addEventListener("click", () => { $("end").hidden = true; });
    const tl = $("tl"); let drag = false;
    const seek = e => { const r = tl.getBoundingClientRect(); on.seek(Math.min(Math.max((e.clientX - r.left - this.tlX0) / (r.width - this.tlX0 - 4), 0), 1) * this.D); };
    tl.addEventListener("pointerdown", e => { drag = true; tl.setPointerCapture(e.pointerId); seek(e); });
    tl.addEventListener("pointermove", e => { if (drag) seek(e); });
    tl.addEventListener("pointerup", () => { drag = false; }); tl.addEventListener("pointercancel", () => { drag = false; });
    window.addEventListener("keydown", e => { if (e.code === "Space" && !/BUTTON|INPUT/.test(e.target.tagName)) { e.preventDefault(); on.play(); } });
  }
  drawer(open) { const d = $("drawer"), o = open ?? d.classList.contains("closed"); d.classList.toggle("closed", !o); $("dataBtn").setAttribute("aria-pressed", o); }
  tab(id) { document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.pane === id)); document.querySelectorAll("#drawer .tab").forEach(t => { t.hidden = t.id !== id; }); }
  setView(view) { document.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", b.dataset.view === view)); $("app").classList.toggle("split", view === "split"); for (const m in this.panes) this.panes[m].el.hidden = view !== "split" && view !== m; }
  setCam(cam, label) { document.querySelectorAll("#cams button").forEach(b => b.setAttribute("aria-pressed", b.dataset.cam === cam)); $("shot").textContent = label || ""; }
  setPlaying(p) { $("app").classList.toggle("playing", p); $("play").setAttribute("aria-label", p ? "Pause" : "Play"); }
  showEnd() { $("end").hidden = false; $("caption").classList.remove("on"); }
  resetStory(t) { this.capI = this.caps.findIndex(c => c.t > t); if (this.capI < 0) this.capI = this.caps.length; this.capLeft = 0; $("caption").classList.remove("on"); this.chapI = ACTS.reduce((k, a, i) => a.t <= t ? i : k, -1); this.chapLeft = 0; $("chapter").classList.remove("on"); this.syncAct(); }
  syncAct() { const a = ACTS[this.chapI]; $("act").textContent = a ? `Act ${this.chapI + 1} of ${ACTS.length} · ${a.title}` : ""; }

  // Captions and act titles follow the scenario clock; they hold for a fixed real time so they can be read at any speed.
  story(t, realDt, playing) {
    const cap = $("caption"), ch = $("chapter");
    if (this.capLeft > 0) { this.capLeft -= realDt; if (this.capLeft <= 0) cap.classList.remove("on"); }
    while (this.capI < this.caps.length && this.caps[this.capI].t <= t) {
      const c = this.caps[this.capI++]; if (t - c.t > 12 || !playing) continue;
      cap.querySelector(".k").textContent = c.k; cap.querySelector("p").innerHTML = c.html; cap.classList.add("on"); this.capLeft = c.hold;
    }
    const ci = ACTS.reduce((k, a, i) => a.t <= t ? i : k, -1);
    if (ci !== this.chapI) { this.chapI = ci; this.syncAct(); if (playing && ci >= 0) { ch.querySelector(".t").textContent = `Act ${ci + 1} of ${ACTS.length}`; ch.querySelector("h2").textContent = ACTS[ci].title; ch.querySelector("p").textContent = ACTS[ci].sub; ch.classList.add("on"); this.chapLeft = 5.5; } }
    if (this.chapLeft > 0) { this.chapLeft -= realDt; if (this.chapLeft <= 0) ch.classList.remove("on"); }
    return this.capLeft > 0 || this.chapLeft > 0;
  }

  // ---------------------------------------------------------------- ~10 Hz refresh
  refresh(t, tempoText) {
    $("clock").textContent = clock(t); $("tempo").textContent = tempoText;
    for (const w of this.worlds) {
      const p = this.panes[w.mode], st = w.st, load = faceLoad(st);
      const held = tracksHeld(st), unseen = st.threats.filter(th => th.alive && st.t >= th.d.path.t0 && th.stage === 0).length, worst = Math.max(...load.map(f => f.interval));
      const set = (k, v, cls = "") => { const e = p.stat[k]; if (e._v !== v) { e._v = v; e.textContent = v; } if (e._c !== cls) { e._c = cls; e.className = cls; } };
      set("held", String(held)); set("unseen", String(unseen), st.waitNow ? "bad" : ""); set("kills", `${kills(st)}/${st.threats.length}`, kills(st) === st.threats.length ? "good" : "");
      set("refresh", held ? `${worst.toFixed(worst < 1 ? 2 : 1)} s` : "–", worst > 3.5 ? "bad" : "");
      load.forEach((f, i) => { const e = p.faces[i], full = w.mode === "spy1" && f.n >= f.cap, txt = `${f.n}/${f.cap}`, wd = f.n ? Math.max(4, f.n / f.cap * 100) : 0;
        if (e._t !== txt) { e._t = txt; e.querySelector("b").textContent = txt; e.querySelector("i").style.width = wd + "%"; }
        const wt = f.waiting ? `+${f.waiting} waiting` : ""; if (e._w !== wt) { e._w = wt; e.querySelector(".w").textContent = wt; }
        if (e._f !== full) { e._f = full; e.classList.toggle("full", full); } });
      if (!p.el.hidden) this.drawPPI(p.ppi, w);
    }
    this.chain.forEach(c => c.marks.forEach(u => { u.style.left = (Math.min(t, this.D) / this.D * 100).toFixed(2) + "%"; }));
    if (!$("drawer").classList.contains("closed")) { if (!$("pCharts").hidden) this.drawCharts(t); if (!$("pLog").hidden) this.drawLogs(); }
  }
  followRow(i) { this.chain.forEach(c => c.row.classList.toggle("following", i != null && c.ids.includes(i))); }

  // The radar's own picture: only what it currently holds a track on, at the position it last measured.
  drawPPI(c, w) {
    const W = 168, x = fit(c, W, W), st = w.st, mid = W / 2, rMax = mid - 6, full = 250, k = rMax / (full * NM), col = COL[w.mode];
    x.clearRect(0, 0, W, W); x.beginPath(); x.arc(mid, mid, mid, 0, 7); x.fillStyle = "rgba(5,10,15,.74)"; x.fill();
    x.save(); x.beginPath(); x.arc(mid, mid, rMax, 0, 7); x.clip();
    x.lineWidth = 1; x.strokeStyle = "rgba(255,255,255,.10)"; x.fillStyle = "rgba(255,255,255,.36)"; x.font = "9px JetBrains Mono, monospace";
    for (let i = 1; i <= 5; i++) { x.beginPath(); x.arc(mid, mid, rMax * i / 5, 0, 7); x.stroke(); }
    x.strokeStyle = "rgba(255,205,150,.30)"; x.beginPath(); for (let z = -700; z <= 700; z += 10) { const X = mid + coastX(z) * k, Y = mid + z * k; z === -700 ? x.moveTo(X, Y) : x.lineTo(X, Y); } x.stroke();
    const jam = st.t >= JAM.t0, R = rangeFor(0.1, w.mode), b = JAM.brg * Math.PI / 180, h = JAM.half * Math.PI / 180;
    if (jam && w.mode === "spy1") { x.beginPath(); x.moveTo(mid, mid); x.arc(mid, mid, rMax, b - h - Math.PI / 2, b + h - Math.PI / 2); x.closePath(); x.fillStyle = `rgba(255,120,50,${0.16 + 0.07 * Math.sin(st.t * 6)})`; x.fill(); }
    x.setLineDash([3, 3]); x.strokeStyle = col; x.globalAlpha = 0.65; x.beginPath();
    for (let a = 0; a <= 360; a += 2) { const ar = a * Math.PI / 180, inJ = jam && Math.abs(((a - JAM.brg + 540) % 360) - 180) < JAM.half, r = R * (inJ ? JAM.loss[w.mode] : 1) * k, X = mid + Math.sin(ar) * r, Y = mid - Math.cos(ar) * r; a ? x.lineTo(X, Y) : x.moveTo(X, Y); }
    x.stroke(); x.setLineDash([]); x.globalAlpha = 1;
    const sym = (X, Y, kind, c2) => { x.strokeStyle = c2; x.lineWidth = 1.5; x.beginPath();
      if (kind === "hos") { x.moveTo(X - 4.5, Y + 1); x.lineTo(X, Y - 4.5); x.lineTo(X + 4.5, Y + 1); } else if (kind === "fr") x.arc(X, Y + 1, 3.5, Math.PI, 0); else { x.moveTo(X - 4, Y + 1); x.lineTo(X - 4, Y - 3.5); x.lineTo(X + 4, Y - 3.5); x.lineTo(X + 4, Y + 1); } x.stroke(); };
    for (const th of st.threats) {
      if (!th.alive || th.stage < 1 || !th.seen) continue;
      const kind = th.stage >= 3 ? "hos" : "unk", X = mid + th.seen.x * k, Y = mid + th.seen.z * k; sym(X, Y, kind, COL[kind]);
      if (th.stage >= 4 && th.tLaunch != null && st.t >= th.tLaunch && !WEAPON[th.d.weapon].gun) { const ip = interceptorPos(th, st.t, tmp); sym(mid + ip.x * k, mid + ip.z * k, "fr", COL.fr); }
    }
    x.restore();
    x.fillStyle = col; x.beginPath(); x.arc(mid, mid, 2.2, 0, 7); x.fill();
    x.fillStyle = "rgba(255,255,255,.5)"; x.font = "9px JetBrains Mono, monospace"; x.textAlign = "center"; x.fillText("N", mid, 13); x.font = "8px JetBrains Mono, monospace"; x.fillText(`radar picture · ${full} nm`, mid, W - 16);
  }

  // Timeline: one lane per radar, tracks held over time (filled), threats it could not track (red), kills (ticks).
  drawTimeline(t) {
    const c = $("tl"), W = c.parentElement.clientWidth, H = c.parentElement.clientHeight || 54, x = fit(c, W, H), x0 = this.tlX0 = 52, x1 = W - 4, tx = s => x0 + (x1 - x0) * s / this.D;
    if (this._tlW !== W || this._tlH !== H) {
      this._tlW = W; this._tlH = H; const off = this._tlBg = document.createElement("canvas"), o = fit(off, W, H), laneH = (H - 14) / 2, peak = Math.max(...this.RUNS.spy1.series.map(r => r.held), ...this.RUNS.spy6.series.map(r => r.held), 1);
      o.font = "9px JetBrains Mono, monospace"; o.textBaseline = "middle";
      ACTS.forEach((a, i) => { const X = tx(a.t), X2 = tx(ACTS[i + 1]?.t ?? this.D); o.fillStyle = i % 2 ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.07)"; o.fillRect(X, 12, X2 - X, H - 12); o.fillStyle = "rgba(255,255,255,.5)"; o.textAlign = "left"; const fits = s => o.measureText(s).width < X2 - X - 8, lab = [a.title.toUpperCase(), ["BALLISTIC", "JAMMING", "SWARM"][i], `ACT ${i + 1}`, String(i + 1)].find(fits); if (lab) o.fillText(lab, X + 4, 6); });
      for (let m = 0; m * 60 <= this.D; m += 2) { o.fillStyle = "rgba(255,255,255,.14)"; o.fillRect(tx(m * 60), 12, 1, H - 12); }
      ["spy1", "spy6"].forEach((m, li) => {
        const run = this.RUNS[m], y1 = 14 + (li + 1) * laneH - 1, hgt = laneH - 3, S = this.S[m];
        o.fillStyle = COL[m]; o.textAlign = "left"; o.fillText(RADAR_NAME[m], 0, y1 - hgt / 2);
        const area = (key, fill) => { o.beginPath(); o.moveTo(tx(0), y1); for (const r of run.series) o.lineTo(tx(r.t), y1 - Math.min(r[key] / peak, 1) * hgt); o.lineTo(tx(run.series.at(-1).t), y1); o.closePath(); o.fillStyle = fill; o.fill(); };
        o.globalAlpha = 0.6; area("held", COL[m]); o.globalAlpha = 1; area("waiting", "#ff5a4f");
        o.fillStyle = "rgba(255,255,255,.85)"; for (const th of run.threats) if (th.tInt) o.fillRect(tx(th.tInt) - 0.5, y1 - hgt, 1, 3);
        { const X = tx(S.lastKill), room = X + 4 + o.measureText("done").width < x1; o.fillStyle = COL[m]; o.fillRect(X, y1 - hgt, 1.5, hgt); o.textAlign = room ? "left" : "right"; o.fillText("done", room ? X + 4 : X - 4, y1 - hgt / 2); o.textAlign = "left"; }
      });
    }
    x.clearRect(0, 0, W, H); x.drawImage(this._tlBg, 0, 0, W, H);
    const X = tx(Math.min(t, this.D)); x.fillStyle = "#fff"; x.fillRect(X - 0.75, 10, 1.5, H - 10); x.beginPath(); x.moveTo(X - 4, 6); x.lineTo(X + 4, 6); x.lineTo(X, 12); x.closePath(); x.fill();
  }

  drawCharts(t) {
    const line = (id, f, { limit, unit = "" } = {}) => {
      const c = $(id), W = c.parentElement.clientWidth, H = 120, x = fit(c, W, H), x0 = 26, y0 = H - 16, sA = this.RUNS.spy1.series, sB = this.RUNS.spy6.series;
      const max = Math.max(1, limit || 0, ...sA.map(f), ...sB.map(f)) * 1.1, tx = s => x0 + (W - x0 - 4) * s / this.D, ty = v => y0 - (y0 - 6) * v / max;
      x.clearRect(0, 0, W, H); x.font = "9px JetBrains Mono, monospace"; x.fillStyle = "rgba(255,255,255,.42)"; x.strokeStyle = "rgba(255,255,255,.09)"; x.lineWidth = 1;
      for (let i = 0; i <= 2; i++) { const v = max / 1.1 * i / 2, Y = ty(v); x.beginPath(); x.moveTo(x0, Y); x.lineTo(W, Y); x.stroke(); x.textAlign = "right"; x.fillText(v.toFixed(v < 10 && v % 1 ? 1 : 0), x0 - 4, Y + 3); }
      for (let m = 0; m * 60 <= this.D; m += 4) { x.textAlign = "center"; x.fillText(m + "m", tx(m * 60), H - 3); }
      if (limit) { x.setLineDash([4, 3]); x.strokeStyle = COL.hos; x.beginPath(); x.moveTo(x0, ty(limit)); x.lineTo(W, ty(limit)); x.stroke(); x.setLineDash([]); x.fillStyle = COL.hos; x.textAlign = "right"; x.fillText(`track lost at ${limit} s`, W - 2, ty(limit) - 4); }
      [[sA, COL.spy1], [sB, COL.spy6]].forEach(([s, col]) => { x.strokeStyle = col; x.lineWidth = 1.6; x.beginPath(); s.forEach((r, i) => { const X = tx(r.t), Y = ty(f(r)); i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.stroke(); });
      x.fillStyle = "rgba(255,255,255,.8)"; x.fillRect(tx(Math.min(t, this.D)), 4, 1, y0 - 4);
    };
    line("chHeld", r => r.held); line("chUnseen", r => r.airborne - r.held); line("chGap", r => r.gap, { limit: 4 });
    // detection range, one pair of bars per named threat
    const c = $("chRange"), W = c.parentElement.clientWidth, named = THREATS.map((d, i) => i).filter(i => !THREATS[i].swarm), H = named.length * 17 + 18, x = fit(c, W, H), x0 = 92;
    const nmOf = (m, i) => this.RUNS[m].threats[i].dDet == null ? 0 : this.RUNS[m].threats[i].dDet / NM, max = Math.max(...named.map(i => nmOf("spy6", i)), 1);
    x.clearRect(0, 0, W, H); x.font = "10px Inter, sans-serif"; x.textBaseline = "middle";
    named.forEach((i, r) => { const y = r * 17; x.fillStyle = "rgba(255,255,255,.7)"; x.textAlign = "left"; x.fillText(({ A1: "Anti-ship BM", B1: "BM (space)", D5: "Pop-up drone" })[THREATS[i].id] || THREATS[i].name, 0, y + 8);
      [["spy1", 2], ["spy6", 9]].forEach(([m, o]) => { const v = nmOf(m, i), w = (W - x0 - 34) * v / max; x.fillStyle = COL[m]; x.fillRect(x0, y + o, Math.max(w, 1), 5); if (m === "spy6") { x.font = "9px JetBrains Mono, monospace"; x.fillText(`${Math.round(nmOf("spy1", i))} / ${Math.round(v)}`, x0 + w + 4, y + 9); x.font = "10px Inter, sans-serif"; } }); });
  }
  drawLogs() {
    for (const w of this.worlds) { const ul = $(w.mode === "spy1" ? "log1" : "log6"), n = w.st.events.length; if (ul._n === n) continue; ul._n = n;
      ul.innerHTML = n ? w.st.events.slice(-16).reverse().map(e => `<li><b>${clock(e.t)}</b>${e.msg}</li>`).join("") : "<li>Waiting for first detection.</li>"; }
  }
}
