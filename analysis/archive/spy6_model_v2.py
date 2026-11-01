"""
Why SPY-6 Beats SPY-1: a physics model  —  PHYS 271 project demo
James Baird

MAIN FIGURES (the argument)
  Fig 1  Radar horizon vs target altitude: sea-skimmers hide below the horizon,
         ballistic missiles in space do not, so for space targets range is set
         by SENSITIVITY, which is exactly what SPY-6 improves.
  Fig 2  Radar range equation: detection range vs target size for SPY-1D,
         SPY-6(V)1 (+15 dB, published) and SPY-6(V)4 (model prediction).
  Fig 3  Digital beamforming: from ONE received pulse, a digital array forms
         every beam at once and finds all three targets; a single analog beam
         only sees what it is pointed at.
  Fig 4  Bandwidth and range resolution: pulse compression with more bandwidth
         separates a warhead from a nearby decoy (delta_r = c / 2B).
  Fig 5  Graceful degradation: an active array loses a little when modules fail;
         a passive array with one central transmitter loses everything.

APPENDIX FIGURES (proof the model is right)
  Fig A1 Beam width vs number of elements (theory 0.886*lambda/(N d))
  Fig A2 Gain vs number of elements (theory D = 4*pi*A/lambda^2)
  Fig A3 Model reproduces SPY-1's published 1.7 deg beam
  Fig A4 Do published sensitivity claims follow S ~ N^3?

Key equations
  Radar range:   R^4 = P_t G A_e sigma / ((4 pi)^2 S_min)      ->  R ~ (S*sigma)^(1/4)
  Array factor:  AF(theta) = sum_n w_n exp(i n (k d sin(theta) - k d sin(theta_0)))
  Horizon:       d = sqrt(2 k_e R_E h_radar) + sqrt(2 k_e R_E h_target),  k_e = 4/3
  Resolution:    delta_r = c / (2 B)

Assumptions (state these in the report)
  * SPY-6 frequency 3.3 GHz (exact value not public; SPY-1 is 3.1-3.5 GHz)
  * 144 T/R modules per RMA as a 12x12 grid -> 5.08 cm spacing (layout assumed)
  * Radar array height 20 m above the sea (assumed; not published)
  * Bandwidths in Fig 4 are illustrative; SPY-6 bandwidth is not public
  * Isotropic elements, no clutter, no jamming
"""

import numpy as np
import matplotlib.pyplot as plt
from scipy.signal.windows import taylor
import os

# Earlier draft kept for the record. Writes to figures/model_v2 so it never overwrites the paper figures.
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "figures", "model_v2"))
os.makedirs(OUT, exist_ok=True)
C = 2.998e8
F = 3.3e9
LAM = C / F
D_ELEM = 0.0508
rng = np.random.default_rng(271)

GREY, BLUE, RED, GREEN = "#8a8f98", "#1f5fbf", "#c0392b", "#2e8b57"
plt.rcParams.update({"figure.dpi": 150, "font.size": 10, "axes.spines.top": False,
                     "axes.spines.right": False, "axes.titleweight": "bold"})


def array_factor(theta, N, d, lam, theta0=0.0, weights=None):
    k = 2 * np.pi / lam
    n = np.arange(N)
    w = np.ones(N) if weights is None else np.asarray(weights)
    psi = k * d * (np.sin(theta)[:, None] - np.sin(theta0))
    af = np.abs((w[None, :] * np.exp(1j * n[None, :] * psi)).sum(axis=1))
    return af / af.max()


def hpbw(theta, af):
    p = af ** 2
    i0 = np.argmax(p)
    i = i0
    while i > 0 and p[i] > 0.5: i -= 1
    tl = np.interp(0.5, [p[i], p[i + 1]], [theta[i], theta[i + 1]])
    j = i0
    while j < len(p) - 1 and p[j] > 0.5: j += 1
    tr = np.interp(0.5, [p[j], p[j - 1]], [theta[j], theta[j - 1]])
    return tr - tl


def save(fig, name):
    fig.tight_layout()
    fig.savefig(f"{OUT}/{name}.png")
    plt.close(fig)
    print("saved", name)


results = {}

# =========================================================== Fig 1: horizon
RE, KE, H_RADAR = 6.371e6, 4 / 3, 20.0
h_t = np.logspace(0, 6, 400)                      # 1 m to 1000 km
d_hor = (np.sqrt(2 * KE * RE * H_RADAR) + np.sqrt(2 * KE * RE * h_t)) / 1e3
d_skim = (np.sqrt(2 * KE * RE * H_RADAR) + np.sqrt(2 * KE * RE * 5)) / 1e3
d_bm = (np.sqrt(2 * KE * RE * H_RADAR) + np.sqrt(2 * KE * RE * 100e3)) / 1e3
results["horizon_seaskimmer_km"] = d_skim
results["horizon_100km_alt_km"] = d_bm

fig, ax = plt.subplots(figsize=(7, 4))
ax.loglog(h_t, d_hor, color=GREY, lw=2)
for h, d, lab, c in [(5, d_skim, f"Sea-skimming missile (5 m)\nvisible only inside {d_skim:.0f} km", GREY),
                     (100e3, d_bm, f"Ballistic missile in space (100 km)\nvisible out to {d_bm:,.0f} km", BLUE)]:
    ax.plot(h, d, "o", color=c, ms=8)
    ax.annotate(lab, (h, d), xytext=(14, 18) if h < 100 else (14, -40), textcoords="offset points",
                fontsize=9, color=c)
ax.set(xlabel="Target altitude (m)", ylabel="Farthest line-of-sight range (km)",
       title="Space targets are not hidden by the horizon,\nso SPY-6's extra sensitivity is what limits how far it sees")
ax.grid(alpha=.25, which="both")
save(fig, "fig1_horizon_vs_altitude")

# ============================================= Fig 2: range vs target size
# R ~ (S * sigma)^(1/4), normalized to SPY-1D on a reference target (sigma = 1)
sig = np.logspace(-2, 1, 300)
S_spy1, S_v1 = 1.0, 10 ** (15 / 10)
# V4 (24 RMAs) is NOT published: predict from V1 with S ~ N^k, k = 2.44 (V1/V2 data) to 3 (theory)
S_v4_lo = S_v1 * (24 / 37) ** 3
S_v4_hi = S_v1 * (24 / 37) ** 2.44
R = lambda S, s: (S * s) ** 0.25
results["V4_pred_dB"] = (10 * np.log10(S_v4_lo), 10 * np.log10(S_v4_hi))

fig, ax = plt.subplots(figsize=(7, 4.2))
ax.semilogx(sig, R(S_spy1, sig), color=GREY, lw=2, label="SPY-1D (Flight I–IIA, e.g. USS Carney)")
ax.fill_between(sig, R(S_v4_lo, sig), R(S_v4_hi, sig), color=BLUE, alpha=.18,
                label=f"SPY-6(V)4, 24 RMAs: model prediction (+{10*np.log10(S_v4_lo):.1f} to +{10*np.log10(S_v4_hi):.1f} dB)")
ax.semilogx(sig, R(S_v1, sig), color=BLUE, lw=2.5, label="SPY-6(V)1, 37 RMAs (+15 dB, published)")
# the "half the size at twice the distance" check
ax.plot([1, 0.5], [R(S_spy1, 1), R(S_v1, 0.5)], "o", color="k", ms=6)
ax.annotate("", xy=(0.5, R(S_v1, .5)), xytext=(1, 1), arrowprops=dict(arrowstyle="->", lw=1))
ax.text(0.55, 1.45, f"half the target size,\n{R(S_v1, .5):.2f}x the range", fontsize=9)
ax.set(xlabel="Target radar cross-section (relative to a reference target)",
       ylabel="Detection range (relative to SPY-1D on reference)",
       title="+15 dB lets SPY-6 see a target half the size at twice the distance")
ax.grid(alpha=.25, which="both"); ax.legend(fontsize=8, loc="upper left")
results["half_size_range_ratio"] = R(S_v1, .5)
save(fig, "fig2_range_vs_target_size")

# ============================================ Fig 3: digital beamforming
# 72-element row, three targets, one pulse, receiver noise
N3 = 72
k = 2 * np.pi / LAM
targets = [(-28, 1.0), (4, 0.6), (31, 0.8)]           # (angle deg, amplitude)
n = np.arange(N3)
x = sum(a * np.exp(1j * k * D_ELEM * n * np.sin(np.radians(t))) for t, a in targets)
x = x + 0.15 * (rng.standard_normal(N3) + 1j * rng.standard_normal(N3))   # noise
scan = np.radians(np.linspace(-60, 60, 2401))
steer = np.exp(1j * k * D_ELEM * n[None, :] * np.sin(scan)[:, None])
w_t = taylor(N3, nbar=5, sll=30)
digital = np.abs((np.conj(steer) * w_t * x).sum(1))
digital_db = 20 * np.log10(digital / digital.max())
# analog: one beam pointed at 0 deg -> its pattern
analog = array_factor(scan, N3, D_ELEM, LAM, 0.0, w_t)
beam_deg = np.degrees(hpbw(scan, analog))
dwells = int(np.ceil(90 / beam_deg))
results["beamwidth_72_taylor_deg"] = beam_deg
results["analog_dwells_to_cover_90deg"] = dwells

fig, ax = plt.subplots(figsize=(7.4, 4.2))
ax.fill_between(np.degrees(scan), -40, 20 * np.log10(analog + 1e-9), color=GREY, alpha=.25,
                label=f"Analog: ONE beam per pulse ({beam_deg:.1f}° wide)")
ax.plot(np.degrees(scan), digital_db, color=BLUE, lw=1.8,
        label="Digital: every beam at once, from the same pulse")
for t, a in targets:
    ax.axvline(t, color=BLUE, ls=":", lw=.8)
    ax.text(t, 1.2, f"target\n{t}°", ha="center", fontsize=8, color=BLUE)
ax.set(xlim=(-60, 60), ylim=(-40, 6), xlabel="Look angle (deg)", ylabel="Received power (dB)",
       title=f"From one pulse, digital beamforming finds all three targets;\n"
             f"one analog beam would need ~{dwells} pulses to cover ±45°")
ax.grid(alpha=.25); ax.legend(fontsize=8, loc="upper center", bbox_to_anchor=(0.5, -0.16), ncol=2, frameon=False)
save(fig, "fig3_digital_beamforming")

# ========================================== Fig 4: range resolution
# Two point scatterers 5 m apart (warhead + decoy), linear-FM chirp, matched filter
sep = 5.0
fs = 2.0e9
Tp = 10e-6
t = np.arange(0, Tp, 1 / fs)
r_axis = None
fig, axs = plt.subplots(3, 1, figsize=(7, 5.6), sharex=True)
res_rows = []
for ax, B, col in zip(axs, (10e6, 50e6, 300e6), (GREY, "#6b8fc9", BLUE)):
    chirp = np.exp(1j * np.pi * (B / Tp) * (t - Tp / 2) ** 2)
    delay = int(round(2 * sep / C * fs))
    rx = np.zeros(len(chirp) + delay + 200, complex)
    rx[100:100 + len(chirp)] += chirp
    rx[100 + delay:100 + delay + len(chirp)] += 0.8 * chirp
    mf = np.abs(np.convolve(rx, np.conj(chirp[::-1]), mode="same"))
    mf /= mf.max()
    r = (np.arange(len(mf)) - np.argmax(mf)) / fs * C / 2
    m = (r > -20) & (r < 25)
    ax.plot(r[m], mf[m], color=col, lw=1.8)
    dr = C / (2 * B)
    res_rows.append((B / 1e6, dr))
    ax.text(0.99, 0.80, f"B = {B/1e6:.0f} MHz  →  Δr = c/2B = {dr:.1f} m",
            transform=ax.transAxes, ha="right", fontsize=9, color=col)
    ax.axvline(0, color="k", ls=":", lw=.7); ax.axvline(sep, color="k", ls=":", lw=.7)
    ax.set_ylim(0, 1.3); ax.set_ylabel("Echo"); ax.grid(alpha=.25)
axs[0].set_title("More bandwidth splits a warhead from a decoy 5 m away")
axs[0].text(-0.3, 1.14, "warhead", fontsize=8, ha="right"); axs[0].text(sep + 0.3, 1.14, "decoy", fontsize=8, ha="left")
axs[-1].set_xlabel("Range offset (m)")
results["resolution"] = res_rows
save(fig, "fig4_bandwidth_resolution")

# ========================================== Fig 5: graceful degradation
# 2-D face: 73x73 elements ~ one SPY-6(V)1 face-sized array (5,328 modules)
side = 73
fails = np.array([0, 2, 5, 10, 15, 20, 30])
trials = 20
loss_mean, loss_sd = [], []
for f in fails:
    L = []
    for _ in range(trials):
        alive = rng.random(side * side) >= f / 100
        Na = alive.sum()
        # two-way (transmit power x tx gain x rx area) ~ N^3 for coherent broadside
        L.append(30 * np.log10(Na / side ** 2))
    loss_mean.append(np.mean(L)); loss_sd.append(np.std(L))
loss_mean = np.array(loss_mean)
results["degradation_dB"] = dict(zip(fails.tolist(), np.round(loss_mean, 2).tolist()))
range_left = 10 ** (loss_mean / 40) * 100

fig, ax = plt.subplots(figsize=(7, 4))
ax.plot(fails, range_left, "o-", color=BLUE, lw=2, label="Active array (SPY-6): modules fail one by one")
ax.text(30, 30, "Passive array (SPY-1): every element is fed by\none central transmitter, so a transmitter\nfailure takes the whole face down",
        ha="right", fontsize=9, color=RED)
for f, r in zip(fails, range_left):
    if f in (5, 10, 20): ax.annotate(f"{r:.0f}%", (f, r), xytext=(0, 8), textcoords="offset points",
                                     ha="center", fontsize=9, color=BLUE)
ax.set(xlabel="Share of modules failed (%)", ylabel="Detection range left (%)", ylim=(-5, 110),
       title="With 10% of its modules dead, an active array keeps ~92% of its range")
ax.grid(alpha=.25); ax.legend(fontsize=8, loc="lower left")
save(fig, "fig5_graceful_degradation")

# ================================================ Appendix A1-A4
theta = np.radians(np.linspace(-90, 90, 18001))
Ns = np.array([4, 6, 8, 12, 16, 24, 36, 48, 72, 96, 144])
bw = np.array([hpbw(theta, array_factor(theta, N, D_ELEM, LAM)) for N in Ns])
slope = np.polyfit(np.log(Ns), np.log(bw), 1)[0]
fig, ax = plt.subplots(figsize=(6, 3.6))
ax.loglog(Ns, np.degrees(bw), "o", color=BLUE, label="simulation")
ax.loglog(Ns, np.degrees(0.886 * LAM / (Ns * D_ELEM)), color=GREY, label="theory 0.886λ/(Nd)")
ax.set(xlabel="Number of elements N", ylabel="Beam width (deg)", title=f"A1. Beam width ∝ 1/N (fit slope {slope:.3f})")
ax.grid(alpha=.25, which="both"); ax.legend(fontsize=8)
save(fig, "figA1_beamwidth_vs_N"); results["A1_slope"] = slope


def planar_D(s, d, lam, nt=2000, npf=600):
    kk = 2 * np.pi / lam
    th = np.linspace(0, np.pi, nt); ph = np.linspace(0, 2 * np.pi, npf, endpoint=False)
    TH, PH = np.meshgrid(th, ph, indexing="ij")
    u, v = np.sin(TH) * np.cos(PH), np.sin(TH) * np.sin(PH)
    m = np.arange(s)
    af = lambda q: np.abs(np.exp(1j * kk * d * q[..., None] * m).sum(-1))
    P = (af(u) * af(v)) ** 2
    return 4 * np.pi * P.max() / ((P * np.sin(TH)).sum() * (th[1] - th[0]) * (ph[1] - ph[0]))


sides = np.array([2, 4, 6, 8, 12, 16, 20, 24])
Dsim = np.array([planar_D(s, D_ELEM, LAM) for s in sides])
kD = np.polyfit(np.log(sides[2:] ** 2), np.log(Dsim[2:]), 1)[0]
fig, ax = plt.subplots(figsize=(6, 3.6))
ax.loglog(sides ** 2, Dsim, "o", color=BLUE, label="simulation")
ax.loglog(sides ** 2, 2 * np.pi * sides ** 2 * D_ELEM ** 2 / LAM ** 2, color=GREY, label="theory ½·4πA/λ²")
ax.set(xlabel="Total elements N", ylabel="Directivity", title=f"A2. Gain ∝ N (fit exponent {kD:.3f})")
ax.grid(alpha=.25, which="both"); ax.legend(fontsize=8)
save(fig, "figA2_gain_vs_N"); results["A2_exponent"] = kD

N1 = 72; d1 = 3.65 / N1
fr = np.array([3.1, 3.3, 3.5]) * 1e9
rows = {nm: [np.degrees(hpbw(theta, array_factor(theta, N1, d1, C / f, weights=w))) for f in fr]
        for nm, w in [("uniform", None), ("Taylor −30 dB", taylor(N1, nbar=5, sll=30)),
                      ("Taylor −40 dB", taylor(N1, nbar=5, sll=40))]}
fig, ax = plt.subplots(figsize=(6, 3.6))
for (nm, v), c in zip(rows.items(), (GREY, BLUE, "#6b8fc9")):
    ax.plot(fr / 1e9, v, "o-", color=c, label=nm)
ax.axhline(1.7, color="k", ls="--", lw=1, label="published SPY-1: 1.7°")
ax.set(xlabel="Frequency (GHz)", ylabel="Beam width (deg)", title="A3. Model reproduces SPY-1's real beam width")
ax.grid(alpha=.25); ax.legend(fontsize=8)
save(fig, "figA3_spy1_check"); results["A3"] = {k_: np.round(v, 2).tolist() for k_, v in rows.items()}

kd = lambda dB, r: dB / (10 * np.log10(r))
pairs = [("SPY-1F vs SPY-1D (54% range)", 4 * np.log(.54) / np.log(1856 / 4350), .04, .26),
         ("SPY-6 V1 vs V2 (+15 dB, NAVSEA)", kd(15, 37 / 9), kd(2 ** .5, 37 / 9), kd(2 ** .5, 37 / 9)),
         ("SPY-6 V1 vs V2 (+20 dB, '100x')", kd(20, 37 / 9), kd(2 ** .5, 37 / 9), kd(2 ** .5, 37 / 9)),
         ("69-RMA vs V1 (+25 vs +15 dB)", kd(10, 69 / 37), kd(2 ** .5, 69 / 37), kd(2 ** .5, 69 / 37))]
fig, ax = plt.subplots(figsize=(7, 3.6))
y = np.arange(len(pairs))
ax.errorbar([p[1] for p in pairs], y, xerr=[[p[2] for p in pairs], [p[3] for p in pairs]], fmt="o", color=BLUE, capsize=4)
ax.axvline(3, ls="--", color=GREY, label="theory k = 3")
ax.set_yticks(y, [p[0] for p in pairs]); ax.invert_yaxis(); ax.set_xlim(1.8, 4.4)
ax.set(xlabel="Implied exponent k in S ∝ N^k", title="A4. Do published claims follow S ∝ N³?")
ax.grid(alpha=.25); ax.legend(fontsize=8, loc="upper right")
save(fig, "figA4_scaling_claims"); results["A4"] = [(p[0], round(p[1], 2)) for p in pairs]

print("\nRESULTS")
for k_, v in results.items():
    print(f"  {k_}: {v}")
