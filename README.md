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
| `index.html` | Interactive 3D kill-chain simulation (three.js r128), served by GitHub Pages |
| `analysis/spy6_five_advantages.py` | The paper's result figures (Fig 1–6) |
| `analysis/spy6_model_v3.py` | Phased-array model and the SPY-1 1.7° validation figure |
| `analysis/spy6_common.py` | Shared constants, plot style and array physics |
| `analysis/archive/` | Earlier drafts (v1, v2), kept for the record |
| `tests/` | Checks against textbook results and the numbers quoted in the paper |
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
