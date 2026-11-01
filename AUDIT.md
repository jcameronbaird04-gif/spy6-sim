# Code audit (31 Oct 2026)

Covers the five programs in the report's source-code appendix. Every number the paper quotes was
re-run before and after the changes: they are unchanged unless listed under "Bugs fixed".

## Bugs fixed

1. **Fig 5 (discrimination) range axis was zeroed on the tallest peak, not the warhead.**
   When the two echoes overlap, the tallest peak sits between them, so the curve was shifted against
   the "warhead" and "decoy" marker lines by +2.2 m at 10 MHz and −0.4 m at 50 MHz (0 m at 300 MHz).
   The axis is now zeroed on the warhead's known delay, so the 10 MHz panel correctly shows one
   merged blob between the two objects. The same bug is in the archived v2 draft (its Fig 4), left as is.
2. **Fig 5 title was cut off** at the right edge. It now wraps onto two lines.
3. **Scripts overwrote each other's figures.** `spy6_five_advantages.py`, `spy6_model_v3.py` and
   `spy6_model_v2.py` all wrote `fig3_digital_beamforming.png` (and v2/v3 both wrote
   `fig2_range_vs_target_size.png`) into the same folder, so whichever ran last replaced the paper
   figure. Each script now writes to its own `figures/<name>/` folder.
4. **Simulation end card was hard-coded** to "Attack defeated" and "Both radars stop all 17
   threats". Both runs do stop all 17 today, but the text is now computed from the runs, so it stays
   true if a parameter changes.
5. **Simulation summary could print `NaN` / `-Infinity`**: warning time and kill time were not
   guarded for a threat that is never intercepted, and the CSV's worst-update column used
   `Math.max(...[])`. All guarded now.

## Model change (author approved): engaged tracks can now be lost

Before, the 4 s lost-track rule applied only up to identification, so in the SPY-1D run an engaged
track could go 10 s without an update and the intercept still succeeded. Now, until the
interceptor's own seeker takes over (terminal phase), a missile engagement needs the ship's track for
midcourse uplink. If that track goes 4 s without an update, the engagement is dropped: a missile
already in flight is lost ("ABORT" in the log) and the threat must be found, identified and engaged
again. Gun engagements are exempt because they fire within seconds.

| SPY-1D run | Before | After |
| --- | --- | --- |
| Tracks lost | 42 | 153 |
| Interceptors wasted | (not modelled) | 23 |
| Worst track-update gap | 10.0 s | 5.0 s |
| Last swarm drone destroyed | T+11:30 | T+13:57 |
| Threats stopped | 17 / 17 | 17 / 17 |

The SPY-6 run is unchanged (its worst update gap is 0.3 s). The summary, end card and CSV now report
interceptors wasted. If the paper quotes the SPY-1D tracks-lost figure, update it to 153.

## Cleanups (no change to results)

- `analysis/spy6_common.py` holds the constants, plot style, array factor, beam width and
  beamforming code that were copied between scripts.
- Figure scripts are split into one function per figure behind `main()`, so the physics can be
  imported and tested without drawing anything. `--out` sets the output folder.
- The matched filter uses `fftconvolve` (identical output, about 100× faster).
- Fig 2's legend no longer sits on top of the "USS Carney" label; v3 Fig 1's x-axis no longer
  starts at 1 module.
- Labels that restated a computed value ("32×", "~92%") now come from the computation.
- Simulation: removed the `dwells` array (a vector cloned on every radar look, never read) and other
  unused variables; one `A1i` index instead of three plus a hard-coded `[5]`; fixed a comment that
  said SPY-6 updates each track every 0.5 s (the code does 0.25 s); the 21 nm sea-skimmer horizon in
  the summary is computed; `<style>` moved into `<head>`. The headless model output was diffed before
  and after: identical.
- Added `tests/` (14 checks: beam width vs 0.886λ/Nd, the 2.37×/1.99× range ratios, N³ scaling,
  the 1.7° SPY-1 match, null depth, matched-filter alignment, capacity numbers, 92% availability),
  `requirements.txt`, `.gitignore` and a GitHub Actions workflow that runs them.

## Open questions for the author (not changed)

These are modelling or wording choices, so they are yours to decide.

1. **v3 Fig 1:** SPY-6(V)2 is plotted at 0 dB as "published", but the N³ line predicts −3.4 dB, and
   the ±1 dB error bar does not reach it. The v2 draft computed the implied exponent from this pair
   as k = 2.44. The title says "about as N³"; a sentence in the paper acknowledging the gap would
   pre-empt a reader's question.
2. **Fig A title** says the model reproduces SPY-1's 1.7° beam. With −30 dB Taylor weighting the
   model gives 1.51–1.70° across 3.1–3.5 GHz, so 1.7° is matched at the bottom of the band only.
3. **The appendix says the code is "reproduced in full and unedited".** If you regenerate Fig 5 for
   the paper, update the appendix to match this version.

## Re-audit (1 Nov 2026)

A second pass over the audited code, checked against published sources.

### Fixed

1. **SPY-1D track capacity was far below published figures.** The scheduler (Fig 2 and the
   simulation) let SPY-1D hold about 8 tracks per face, about 32 for the ship. Published sources put
   SPY-1 at "more than 100 targets" ([Missile Defense Advocacy Alliance](https://missiledefenseadvocacy.org/defense-systems/anspy-1-radar);
   [Aegis Combat System, citing the Warfighter Encyclopedia](https://en.wikipedia.org/wiki/Aegis_Combat_System)).
   Each SPY-1D track slot now updates 3 tracks, so a face holds about 24 tracks (about 96 for the ship)
   inside the 4 s limit. SPY-6 stays at 30× that ("over 30 times as many targets", CSIS): about 720 per face.
   Fig 2 and its test were updated. Carney's 19-threat raid now sits inside SPY-1D's capacity, which fits
   Carney's real success.
2. **Swarm resized so the capacity difference still shows honestly.** It is now 30 drones from one direction,
   sized past SPY-1D's per-face limit and heavier than Carney's raid. The chapter text says so.
3. **SPY-1D track management prioritizes instead of starving every track.** With a full face, plain
   round-robin skipped tracks whenever the list changed and collapsed into thousands of lost tracks. SPY-1D
   now updates the least-recently-updated tracks first, keeps engaged threats first, and leaves the
   overflow untracked until a slot frees ("RADAR FULL" in the log). The engaged-track-loss rule is kept;
   with prioritization it no longer triggers in either run.
4. **"Warning time" now means detection to impact.** It was detection to kill. The end card, captions,
   summary and CSV (`warning_before_impact_s`, plus `detect_to_kill_s`) use the new definition.
5. **v3 Fig 1:** the 9-RMA point is now marked as a reported estimate (hollow marker); no primary source
   gives its sensitivity. **Fig A title** now says the model gives 1.5–1.7°, consistent with 1.7°.
6. The event caption no longer shows through the end card.

### Results after the re-audit

| | SPY-1D | SPY-6 |
| --- | --- | --- |
| Threats stopped | 39 / 39 | 39 / 39 |
| Anti-ship ballistic missile first detected | 102 nm | 215 nm |
| Warning before it would hit | 2:41 | 7:02 |
| Most threats untracked at once (radar full) | 8 | 0 |
| 30-drone swarm destroyed by | T+11:45 | T+10:55 |
| Tracks lost / interceptors wasted | 0 / 0 | 0 / 0 |
| Worst track-update gap | 4.0 s | 0.3 s |
| Jammed drones first seen at | 18 nm | 33 nm |

This supersedes the "153 tracks lost / 23 interceptors wasted" figures above: those came from the
under-capacity scheduler.
