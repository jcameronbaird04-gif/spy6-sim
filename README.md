# SPY-6 vs SPY-1D: physics model and kill-chain simulation

PHYS 271 project. James Baird.

Why the AN/SPY-6(V)1 radar on Flight III destroyers outperforms the AN/SPY-1D it replaces: the
phased-array physics behind the published +15 dB sensitivity gain, and an interactive 3D
simulation of the same raid against both radars.

**Live simulation:** https://jcameronbaird04-gif.github.io/spy6-sim/

> Radar ranges, target sizes, jamming loss and discrimination times are illustrative values chosen
> to show the physics. The only number taken from published SPY-6 data is the +15 dB sensitivity
> gain (NAVSEA), which fixes the 2.37× range ratio between the radars.

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `css/`, `src/` | Interactive 3D simulation: the same raid against both radars, side by side. Served by GitHub Pages, no build step |
| `src/model.js` | The kill-chain model on its own: no graphics, runs in the browser and in Node |
| `src/story.js` | Every caption and table in the interface, computed from the two model runs |
| `src/world.js`, `src/gfx/` | Rendering: one scene per radar, ocean, sky, ship, beams, effects (three.js r170) |
| `legacy.html` | The previous single-file simulation, kept for reference |
| `analysis/spy6_five_advantages.py` | The paper's result figures (Fig 1–6) |
| `analysis/spy6_model_v3.py` | Phased-array model and the SPY-1 1.7° validation figure |
| `analysis/spy6_common.py` | Shared constants, plot style and array physics |
| `analysis/archive/` | Earlier drafts (v1, v2), kept for the record |
| `tests/` | Checks against textbook results and the numbers quoted in the paper (`pytest` for the figures, `node --test tests/` for the simulation) |
| `scenario.yaml` | The simulated raid and the numbers behind it |
| `figures/` | Generated PNGs, one folder per script (not committed) |

## Running

```bash
python -m pip install -r requirements.txt
```

```bash
python analysis/spy6_five_advantages.py
```

```bash
python analysis/spy6_model_v3.py
```

```bash
pytest
```

Figures go to `figures/paper/` and `figures/model_v3/`; pass `--out DIR` to change that. Runs are
deterministic (random seed 271).

To view the simulation locally, serve the folder rather than opening the file directly:

```bash
python -m http.server 8000
```

then open http://localhost:8000.

## Physics

- Radar range equation: R⁴ = P_t G A_e σ / ((4π)² S_min), so R ∝ (S σ)^¼
- Active array of N T/R modules: P_t ∝ N, G ∝ N, A_e ∝ N, so S ∝ N³
- Array factor: AF(θ) = Σ wₙ exp(i n k d (sin θ − sin θ₀))
- Range resolution: Δr = c / 2B

Assumptions: 3.3 GHz; 144 modules per RMA as a 12×12 grid (5.08 cm spacing); isotropic elements;
no clutter. See `AUDIT.md` for the review of this code and the open questions it raised.

## The simulation

Open the live link, or serve the folder locally (`python -m http.server 8000`) and open http://localhost:8000.

- **Side by side**: SPY-1D on the left, SPY-6 on the right, same raid, same clock, same camera.
- **Status card** per radar: tracks held, threats in the air it is not tracking, kills, track refresh time, and the
  load on each of the four array faces against what a face can hold.
- **Tags**: a grey tag is a threat this radar is not tracking, with the reason (beyond range, below the horizon,
  jammed, radar full). The arc round a tag drains toward the 4 s lost-track limit and refills on each update.
- **Coverage dome**: where the radar can detect a 0.1 m² target, notched where the jammer cuts its range. The dashed
  ring is the sea-skimmer horizon, the same for both radars.
- **Timeline**: tracks held over the raid for each radar (red: threats it had no track slot for); click or drag to seek.
- **Data**: comparison table, kill chain per threat, charts, event logs, method and assumptions, CSV export.

The Earth is drawn curved with the same 4/3 radius the radar-horizon formula uses, and beams at the model's 1.6°
width. The simulation logic is unchanged from the audited version: `tests/model.test.mjs` pins its results.

```bash
node --test tests/
```
