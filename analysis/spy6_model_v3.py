"""
Why SPY-6 Sees Farther and Tracks More Than SPY-1 — physics model (v3)
James Baird, PHYS 271

CLAIM: SPY-6 beats SPY-1 because it puts a transmitter and receiver in every
module. More modules -> sensitivity grows ~N^3 -> +15 dB -> twice the range on
a half-size target. And because every module's signal is digitized, one face
can form many beams at once instead of one.

Fig 1  Sensitivity vs number of modules: N^3 theory vs published SPY-6 data
Fig 2  What +15 dB buys: detection range vs target size, SPY-1D vs SPY-6(V)1
Fig 3  Digital beamforming: all targets from one pulse vs one analog beam
Fig A  Validation: model reproduces SPY-1's published 1.7 deg beam width

Equations
  Radar range:   R^4 = P_t G A_e sigma / ((4 pi)^2 S_min)   ->  R ~ (S sigma)^(1/4)
  Scaling:       P_t ~ N, G ~ N, A_e ~ N                    ->  S ~ N^3
  Array factor:  AF(theta) = sum_n w_n exp(i n k d (sin theta - sin theta_0))

Assumptions: 3.3 GHz; 144 modules per RMA in a 12x12 grid (5.08 cm spacing);
ideal elements; no clutter or jamming. Ranges are relative to SPY-1D.

Usage:  python spy6_model_v3.py [--out DIR]     (default: figures/model_v3)
"""
import argparse

import matplotlib.pyplot as plt
import numpy as np
from scipy.signal.windows import taylor

from spy6_common import (BLUE, C, DARK, GREY, SEED, SPY6_GAIN, SPY6_GAIN_DB, TARGETS, array_factor,
                         default_out, detection_range as R, digital_beams, hpbw, one_pulse_scene,
                         save, use_style)

MOD = 144                                         # T/R modules per RMA (NAVSEA)
V1_RMAS = 37


def sensitivity_db(rmas):
    """Sensitivity vs SPY-1D (dB) for a face of `rmas` RMAs, from S ~ N^3 anchored on SPY-6(V)1 = +15 dB."""
    return SPY6_GAIN_DB + 30 * np.log10(np.asarray(rmas) / V1_RMAS)


def spy1_beamwidths(weights, freqs=np.linspace(3.1e9, 3.5e9, 9), N1=72, aperture=3.65):
    """SPY-1 half-power beam width (deg) across its band: ~72 elements across a 3.65 m face."""
    theta = np.radians(np.linspace(-10, 10, 20001))
    return [np.degrees(hpbw(theta, array_factor(theta, N1, aperture / N1, C / f, w=weights))) for f in freqs]


# ---------------------------------------------- Fig 1: sensitivity vs modules
def fig1_sensitivity(out, res):
    N = np.logspace(np.log10(800), np.log10(13000), 200)
    theory = sensitivity_db(N / MOD)
    pub = [("SPY-6(V)2\n9 RMAs", 9 * MOD, 0.0, "published"),
           ("SPY-6(V)1\n37 RMAs\n(Flight III)", 37 * MOD, 15.0, "published"),
           ("69-RMA face\n(proposed)", 69 * MOD, 25.0, "estimate")]
    v4 = sensitivity_db(24)
    res["V4_predicted_dB"] = v4
    res["V2_theory_dB"] = sensitivity_db(9)
    res["69_theory_dB"] = sensitivity_db(69)

    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    ax.axhline(0, color=GREY, ls="--", lw=1)
    ax.text(6500, 0.6, "SPY-1D (Flight I–IIA, e.g. USS Carney)", color=GREY, fontsize=9)
    ax.semilogx(N, theory, color=DARK, lw=1.5, label="Theory: S ∝ N³  (power × gain × area)")
    for lab, n, db, kind in pub:
        filled = kind == "published"
        ax.errorbar(n, db, yerr=1, fmt="o", ms=8, color=BLUE, mfc=BLUE if filled else "white",
                    mew=2, capsize=4)
        ax.annotate(lab, (n, db), xytext=(10, -6), textcoords="offset points", fontsize=8.5, color=BLUE,
                    va="top")
    ax.plot(24 * MOD, v4, "D", ms=8, color="white", mec=DARK, mew=2)
    ax.annotate(f"SPY-6(V)4, 24 RMAs\nour prediction: +{v4:.1f} dB\n(not published)", (24 * MOD, v4),
                xytext=(-118, 14), textcoords="offset points", fontsize=8.5, color=DARK,
                arrowprops=dict(arrowstyle="-", lw=.6, color=DARK))
    ax.set(xlabel="Transmit/receive modules per face (log scale)",
           ylabel="Sensitivity vs SPY-1 (dB)", xlim=(500, 2e4), ylim=(-8, 30),
           title="Adding modules raises sensitivity about as N³:\nthat's where SPY-6's +15 dB comes from")
    ax.legend(loc="upper left", fontsize=8.5, frameon=False)
    ax.grid(alpha=.25, which="both")
    save(fig, out, "fig1_sensitivity_vs_modules")


# ---------------------------------------------- Fig 2: range vs target size
def fig2_range(out, res):
    sig = np.logspace(-2.2, 0.4, 300)
    S6 = SPY6_GAIN
    small = 1 / S6                                     # target SPY-6 sees at SPY-1's reference range
    res["half_size_ratio"] = R(S6, .5)
    res["equal_range_size_ratio"] = S6

    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    ax.semilogx(sig, R(1, sig), color=GREY, lw=2.5, label="SPY-1D")
    ax.semilogx(sig, R(S6, sig), color=BLUE, lw=2.5, label="SPY-6(V)1 (+15 dB)")
    ax.plot(1, 1, "o", color=GREY, ms=7)
    ax.plot(.5, R(S6, .5), "o", color=BLUE, ms=7)
    ax.annotate("", (.5, R(S6, .5)), (1, 1), arrowprops=dict(arrowstyle="->", lw=1.2, color=DARK))
    ax.text(1.05, 1.45, f"Half the target size,\n{R(S6, .5):.2f}× the range", fontsize=9, color=DARK)
    ax.plot(small, 1, "o", color=BLUE, ms=7)
    ax.annotate("", (small * 1.05, 1), (0.95, 1), arrowprops=dict(arrowstyle="->", lw=1.2, color=DARK))
    ax.text(0.17, 0.80, f"Same range, a target {S6:.0f}× smaller", fontsize=9, color=DARK, ha="center", va="top")
    ax.set(xlabel="Target radar cross-section (1 = target SPY-1D just detects at its reference range)",
           ylabel="Detection range (1 = SPY-1D reference)", ylim=(0, 3.2),
           title=f"+15 dB: twice the range on a half-size target,\nor the same range on a target {S6:.0f}× smaller")
    ax.legend(loc="upper left", fontsize=9, frameon=False); ax.grid(alpha=.25, which="both")
    save(fig, out, "fig2_range_vs_target_size")


# ---------------------------------------------- Fig 3: digital beamforming
def fig3_beamforming(out, rng, res):
    N3 = 72
    x = one_pulse_scene(rng, N3)
    scan = np.radians(np.linspace(-60, 60, 2401))
    w = taylor(N3, nbar=5, sll=30)
    dig = digital_beams(x, scan, w)
    dig_db = 20 * np.log10(dig / dig.max())
    ana = array_factor(scan, N3, w=w)
    bw = np.degrees(hpbw(scan, ana)); dwells = int(np.ceil(90 / bw))
    res["beam_deg"], res["dwells_pm45"] = bw, dwells

    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    ax.fill_between(np.degrees(scan), -40, 20 * np.log10(ana + 1e-9), color=GREY, alpha=.35,
                    label=f"SPY-1 style: one beam per pulse ({bw:.1f}° wide)")
    ax.plot(np.degrees(scan), dig_db, color=BLUE, lw=1.8, label="SPY-6 style: every beam from the same pulse")
    for t, a in TARGETS:
        ax.annotate(f"target {t}°", (t, dig_db[np.argmin(abs(np.degrees(scan) - t))]),
                    xytext=(22 if t == 4 else 0, 8), textcoords="offset points", ha="center", fontsize=8.5, color=BLUE)
    ax.set(xlim=(-60, 60), ylim=(-40, 8), xlabel="Look angle (deg)", ylabel="Received power (dB)",
           title=f"One pulse: digital beamforming finds all {len(TARGETS)} targets.\n"
                 f"A single beam would need ~{dwells} pulses to search ±45°")
    ax.legend(loc="upper center", bbox_to_anchor=(.5, -.15), ncol=2, frameon=False, fontsize=8.5)
    ax.grid(alpha=.25)
    save(fig, out, "fig3_digital_beamforming")


# ---------------------------------------------- Fig A: SPY-1 validation
def figA_validation(out, res):
    fr = np.linspace(3.1e9, 3.5e9, 9)
    lines = {"Equal-strength elements": None, "Tapered elements (−30 dB sidelobes)": taylor(72, nbar=5, sll=30)}
    fig, ax = plt.subplots(figsize=(7.2, 3.8))
    for (lab, wt), col in zip(lines.items(), (GREY, BLUE)):
        v = spy1_beamwidths(wt, fr)
        ax.plot(fr / 1e9, v, "o-", color=col, label=lab); res[lab] = (round(float(min(v)), 2), round(float(max(v)), 2))
    ax.axhline(1.7, color=DARK, ls="--", lw=1); ax.text(3.28, 1.72, "Published SPY-1 beam width: 1.7°", fontsize=9)
    ax.set(xlabel="Frequency (GHz), SPY-1's published band", ylabel="Beam width (deg)", ylim=(1.0, 1.9),
           title="Model check: our code reproduces SPY-1's real 1.7° beam")
    ax.legend(loc="lower left", fontsize=8.5, frameon=False); ax.grid(alpha=.25)
    save(fig, out, "figA_spy1_validation")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Phased-array model figures (v3).")
    ap.add_argument("--out", default=default_out("model_v3"), help="output folder (default: %(default)s)")
    out = ap.parse_args(argv).out
    use_style()
    rng = np.random.default_rng(SEED)
    res = {}
    fig1_sensitivity(out, res)
    fig2_range(out, res)
    fig3_beamforming(out, rng, res)
    figA_validation(out, res)
    print("\nRESULTS")
    for kk, vv in res.items():
        print(f"  {kk}: {vv.item() if isinstance(vv, np.generic) else vv}")


if __name__ == "__main__":
    main()
