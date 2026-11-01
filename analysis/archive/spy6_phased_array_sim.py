"""
SPY-6 / SPY-1 Phased-Array Simulation  —  PHYS 271 semester project
Author: James Baird

What this does
--------------
Part 1  Beam steering: pattern of a 12-element line array (one row of a SPY-6
        RMA, assuming a 12x12 grid) steered to 0, 30, 60 degrees.
Part 2  Beam width vs. N: measures the -3 dB beam width of simulated line
        arrays and fits it against theory, HPBW ~ 0.886*lambda/(N*d).
Part 3  Gain vs. N: numerically integrates the 3-D pattern of square planar
        arrays to get directivity, and fits D ~ N^k (theory: k = 1).
Part 4  Radar sensitivity scaling: compares the theory S ~ N^3 against
        published open-source claims for SPY-1D/1F and SPY-6 V1/V2/69-RMA.
Part 5  Sanity check against a real number: SPY-1's published 1.7 deg beam.

Physics
-------
Array factor (line array, element spacing d, phase step dphi):
    AF(theta) = sum_{n=0}^{N-1} w_n * exp(i*n*(k*d*sin(theta) - dphi))
    k = 2*pi/lambda,  steering:  dphi = k*d*sin(theta_0)
Directivity:  D = 4*pi*|AF_max|^2 / integral(|AF|^2 dOmega)
Radar range equation (monostatic):
    R^4 = P_t * G * A_e * sigma / ((4*pi)^2 * S_min)
    For an active array of N T/R modules: P_t ~ N, G ~ N, A_e ~ N
    => sensitivity S ~ N^3,  and range R ~ N^(3/4)

Assumptions (flag these in the report)
--------------------------------------
* 144 T/R modules per 2-ft RMA (NAVSEA) arranged as a 12x12 grid -> 2.0 in
  (5.08 cm) spacing. The grid layout is an assumption; NAVSEA gives the count
  only. 5.08 cm = lambda/2 at 2.95 GHz.
* Operating frequency for SPY-6 is not public beyond "S-band"; 3.3 GHz is used
  (middle of SPY-1's published 3.1-3.5 GHz band).
* Isotropic elements (real elements have their own pattern ~cos(theta)).
"""

import numpy as np
import matplotlib.pyplot as plt
from scipy.signal.windows import taylor
import csv, os

# Earlier draft kept for the record. Writes to figures/model_v1 so it never overwrites the paper figures.
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "figures", "model_v1"))
os.makedirs(OUT, exist_ok=True)
C = 2.998e8                # speed of light, m/s
F = 3.3e9                  # assumed S-band frequency, Hz
LAM = C / F                # wavelength, m (~9.08 cm)
D_ELEM = 0.0508            # element spacing, m (2 in, from 12x12 per 2-ft RMA)

plt.rcParams.update({"figure.dpi": 140, "font.size": 10})


# ---------------------------------------------------------------- core model
def array_factor(theta, N, d, lam, theta0=0.0, weights=None):
    """Normalized |AF| of an N-element line array, beam steered to theta0 (rad)."""
    k = 2 * np.pi / lam
    n = np.arange(N)
    w = np.ones(N) if weights is None else np.asarray(weights)
    psi = k * d * (np.sin(theta)[:, None] - np.sin(theta0))      # phase per element
    af = np.abs((w[None, :] * np.exp(1j * n[None, :] * psi)).sum(axis=1))
    return af / af.max()


def hpbw(theta, af):
    """-3 dB (half-power) beam width in radians, by linear interpolation."""
    p = af ** 2
    i0 = np.argmax(p)
    half = 0.5
    # walk left
    i = i0
    while i > 0 and p[i] > half:
        i -= 1
    tl = np.interp(half, [p[i], p[i + 1]], [theta[i], theta[i + 1]])
    # walk right
    j = i0
    while j < len(p) - 1 and p[j] > half:
        j += 1
    tr = np.interp(half, [p[j], p[j - 1]], [theta[j], theta[j - 1]])
    return tr - tl


def planar_directivity(Nside, d, lam, n_theta=2400, n_phi=720):
    """Directivity of an Nside x Nside uniform planar array of isotropic
    elements (broadside), by numerical integration over the full sphere."""
    k = 2 * np.pi / lam
    th = np.linspace(0, np.pi, n_theta)
    ph = np.linspace(0, 2 * np.pi, n_phi, endpoint=False)
    TH, PH = np.meshgrid(th, ph, indexing="ij")
    u = np.sin(TH) * np.cos(PH)
    v = np.sin(TH) * np.sin(PH)
    n = np.arange(Nside)

    def af1(x):
        return np.abs(np.exp(1j * k * d * x[..., None] * n).sum(-1))

    P = (af1(u) * af1(v)) ** 2                    # separable for uniform weights
    dth, dph = th[1] - th[0], ph[1] - ph[0]
    integral = (P * np.sin(TH)).sum() * dth * dph
    return 4 * np.pi * P.max() / integral


# ------------------------------------------------------- Part 1: steering
theta = np.radians(np.linspace(-90, 90, 18001))   # 0.01 deg grid
fig, ax = plt.subplots(figsize=(7, 4))
steer_rows = []
for t0 in (0, 30, 45, 60):
    af = array_factor(theta, 12, D_ELEM, LAM, np.radians(t0))
    ax.plot(np.degrees(theta), 20 * np.log10(af + 1e-12), label=f"steered to {t0}°")
    bw = np.degrees(hpbw(theta, af))
    dphi = np.degrees(2 * np.pi / LAM * D_ELEM * np.sin(np.radians(t0)))
    steer_rows.append([t0, round(float(dphi), 1), round(float(bw), 2),
                       round(float(np.degrees(theta[np.argmax(af)])), 2)])
ax.set(xlabel="Angle from array normal (deg)", ylabel="Relative power (dB)",
       ylim=(-40, 4), title="Beam steering: 12-element row (one RMA), 3.3 GHz")
# Grating lobe: a second full-strength beam appears when d/lambda > 1/(1+|sin theta0|)
th_g = np.degrees(np.arcsin(np.sin(np.radians(60)) - LAM / D_ELEM))
ax.annotate(f"grating lobe at {th_g:.0f}°\n(60° steer breaks the\nd/λ < 1/(1+sin θ₀) limit)",
            xy=(th_g, 0), xytext=(-60, -6), fontsize=8,
            bbox=dict(boxstyle="round", fc="white", ec="gray", alpha=.95),
            arrowprops=dict(arrowstyle="->", lw=.8))
ax.grid(alpha=.3); ax.legend(fontsize=8, loc="lower right")
fig.tight_layout(); fig.savefig(f"{OUT}/fig1_beam_steering.png"); plt.close(fig)

# ------------------------------------------------- Part 2: beam width vs N
Ns = np.array([4, 6, 8, 12, 16, 24, 36, 48, 72, 96, 144])
grid_step = np.radians(0.01)
bw_sim = np.array([hpbw(theta, array_factor(theta, N, D_ELEM, LAM)) for N in Ns])
bw_th = 0.886 * LAM / (Ns * D_ELEM)
slope, logA = np.polyfit(np.log(Ns), np.log(bw_sim), 1)

fig, ax = plt.subplots(figsize=(6, 4))
ax.loglog(Ns, np.degrees(bw_sim), "o", label="simulation")
ax.loglog(Ns, np.degrees(bw_th), "-", label=r"theory $0.886\,\lambda/(Nd)$")
ax.set(xlabel="Number of elements N", ylabel="Half-power beam width (deg)",
       title=f"Beam width vs N (fit slope = {slope:.3f}, theory = -1)")
ax.grid(alpha=.3, which="both"); ax.legend()
fig.tight_layout(); fig.savefig(f"{OUT}/fig2_beamwidth_vs_N.png"); plt.close(fig)

# --------------------------------------------- Part 3: directivity vs N
sides = np.array([2, 3, 4, 6, 8, 10, 12, 16, 20, 24])
Dsim = np.array([planar_directivity(s, D_ELEM, LAM) for s in sides])
Ntot = sides ** 2
kD, logB = np.polyfit(np.log(Ntot[3:]), np.log(Dsim[3:]), 1)   # fit N>=36
# Aperture theory: D = 4*pi*A/lambda^2, halved because isotropic elements with
# no ground plane radiate equally forward and backward
Dth = 0.5 * 4 * np.pi * Ntot * D_ELEM ** 2 / LAM ** 2

fig, ax = plt.subplots(figsize=(6, 4))
ax.loglog(Ntot, Dsim, "o", label="simulation (numerical integration)")
ax.loglog(Ntot, Dth, "-", label=r"theory $\frac{1}{2}\cdot 4\pi A/\lambda^2$")
ax.set(xlabel="Total elements N (square array)", ylabel="Directivity (linear)",
       title=f"Gain vs N (fit exponent k = {kD:.3f}, theory = 1)")
ax.grid(alpha=.3, which="both"); ax.legend()
fig.tight_layout(); fig.savefig(f"{OUT}/fig3_directivity_vs_N.png"); plt.close(fig)

# ------------------------------------ Part 4: sensitivity scaling vs claims
# Each pair -> implied exponent k in S ~ N^k (theory: k = 3).
def k_from_db(dB, n_ratio):
    return dB / (10 * np.log10(n_ratio))

pairs = []
# (a) SPY-1F vs SPY-1D: 1,856 vs ~4,100-4,350 elements, range ratio 0.54
#     S ratio = (R ratio)^4.  Uncertainty: element count range + rounding of 54%.
ks = [4 * np.log(r) / np.log(1856 / nD) for r in (0.535, 0.545) for nD in (4100, 4350)]
k_mid = 4 * np.log(0.54) / np.log(1856 / 4350)
pairs.append(["SPY-1F vs SPY-1D (range 54%)", "1856 / ~4350 elements", k_mid,
              k_mid - min(ks), max(ks) - k_mid, "Wikipedia AN/SPY-1 (trace to its cited source)"])
# (b) SPY-6 V1 vs V2: 37 vs 9 RMAs, +15 dB (NAVSEA), +/-1 dB on each claim
for label, dB, src in [("SPY-6 V1 vs V2 (+15 dB)", 15, "NAVSEA exhibit"),
                       ("SPY-6 V1 vs V2 (+20 dB, '100x')", 20, "DSIAC quoting Raytheon")]:
    k = k_from_db(dB, 37 / 9); e = k_from_db(np.sqrt(2), 37 / 9)
    pairs.append([label, "37 / 9 RMAs", k, e, e, src])
# (c) 69-RMA vs V1: +25 dB vs +15 dB
k = k_from_db(10, 69 / 37); e = k_from_db(np.sqrt(2), 69 / 37)
pairs.append(["69-RMA vs V1 (+25 vs +15 dB)", "69 / 37 RMAs", k, e, e,
              "Wikipedia AN/SPY-6 (estimate, trace source)"])

fig, ax = plt.subplots(figsize=(7, 4))
y = np.arange(len(pairs))
ax.errorbar([p[2] for p in pairs], y,
            xerr=[[p[3] for p in pairs], [p[4] for p in pairs]],
            fmt="o", capsize=4)
ax.axvline(3, ls="--", color="gray", label="theory k = 3  (P·G·Aₑ ∝ N³)")
ax.axvline(2, ls=":", color="gray", label="k = 2  (power-aperture only)")
ax.set_yticks(y, [p[0] for p in pairs]); ax.invert_yaxis()
ax.set(xlabel="Implied exponent k in  S ∝ Nᵏ",
       title="Do published claims follow N³ scaling?")
ax.set_xlim(1.8, 4.4)
ax.grid(alpha=.3); ax.legend(loc="upper right", fontsize=8)
fig.tight_layout(); fig.savefig(f"{OUT}/fig4_sensitivity_scaling.png"); plt.close(fig)

# ------------------------------- Part 5: check vs SPY-1 published 1.7 deg
# SPY-1: 3.65 m face, ~4,100-4,350 elements, 3.1-3.5 GHz, published HPBW 1.7 deg.
# Octagon with ~4350 elements -> ~72 elements across. Real radars taper the
# element amplitudes (Taylor weighting) to cut sidelobes, which widens the beam.
N1 = 72; d1 = 3.65 / N1
spy1_rows = []
for f in (3.1e9, 3.3e9, 3.5e9):
    lam = C / f
    for name, w in [("uniform", None),
                    ("Taylor -30 dB", taylor(N1, nbar=5, sll=30)),
                    ("Taylor -40 dB", taylor(N1, nbar=5, sll=40))]:
        bw = np.degrees(hpbw(theta, array_factor(theta, N1, d1, lam, weights=w)))
        spy1_rows.append([f / 1e9, name, round(float(bw), 2)])

fig, ax = plt.subplots(figsize=(6, 3.6))
for name, m in [("uniform", "o"), ("Taylor -30 dB", "s"), ("Taylor -40 dB", "^")]:
    xs = [r[0] for r in spy1_rows if r[1] == name]
    ys = [r[2] for r in spy1_rows if r[1] == name]
    ax.plot(xs, ys, m + "-", label=name)
ax.axhline(1.7, color="k", ls="--", label="published SPY-1: 1.7°")
ax.set(xlabel="Frequency (GHz)", ylabel="Half-power beam width (deg)",
       title="Model vs real SPY-1 beam width (3.65 m face)")
ax.grid(alpha=.3); ax.legend(fontsize=8)
fig.tight_layout(); fig.savefig(f"{OUT}/fig5_spy1_beamwidth_check.png"); plt.close(fig)

# ------------------------------------------------------------- write data
with open(f"{OUT}/data_beamwidth_vs_N.csv", "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["N", "HPBW_sim_deg", "HPBW_theory_deg", "pct_diff", "grid_uncert_deg"])
    for N, s, t in zip(Ns, bw_sim, bw_th):
        w.writerow([N, f"{np.degrees(s):.3f}", f"{np.degrees(t):.3f}",
                    f"{100*(s-t)/t:+.2f}", f"{np.degrees(grid_step):.3f}"])
with open(f"{OUT}/data_directivity_vs_N.csv", "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["side", "N_total", "D_sim", "D_theory", "D_sim_dBi"])
    for s, n, ds, dt in zip(sides, Ntot, Dsim, Dth):
        w.writerow([s, n, f"{ds:.2f}", f"{dt:.2f}", f"{10*np.log10(ds):.2f}"])
with open(f"{OUT}/data_sensitivity_claims.csv", "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["comparison", "N ratio", "implied_k", "minus", "plus", "source"])
    for p in pairs:
        w.writerow([p[0], p[1], f"{p[2]:.2f}", f"{p[3]:.2f}", f"{p[4]:.2f}", p[5]])

with open(f"{OUT}/results_summary.txt", "w") as fh:
    fh.write(f"Assumed f = {F/1e9} GHz, lambda = {LAM*100:.2f} cm, d = {D_ELEM*100:.2f} cm "
             f"(d/lambda = {D_ELEM/LAM:.3f})\n\n")
    fh.write("Part 1 steering (12 elements): steer_deg, phase_step_deg, HPBW_deg, peak_at_deg\n")
    for r in steer_rows: fh.write(f"  {r}\n")
    fh.write(f"\nPart 2 beam width fit slope = {slope:.4f} (theory -1)\n")
    fh.write(f"Part 3 directivity fit exponent = {kD:.4f} (theory 1)\n")
    fh.write("\nPart 4 implied sensitivity exponents (theory 3):\n")
    for p in pairs: fh.write(f"  {p[0]}: k = {p[2]:.2f} (-{p[3]:.2f}/+{p[4]:.2f})\n")
    fh.write("\nPart 5 SPY-1 beam width model (published 1.7 deg): f_GHz, weighting, HPBW_deg\n")
    for r in spy1_rows: fh.write(f"  {r}\n")

print(open(f"{OUT}/results_summary.txt").read())
