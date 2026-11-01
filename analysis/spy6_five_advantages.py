"""
SPY-6 vs SPY-1D: the paper's result figures  (PHYS 271)

Fig 1  Range: +15 dB -> twice the range on a half-size target             (published +15 dB)
Fig 2  Many targets: track update interval vs raid size                    (published ~30x targets)
Fig 3  Many beams at once: digital beamforming finds every target per pulse
Fig 4  Jamming: a digital array steers a deep null onto a jammer
Fig 5  Discrimination: bandwidth separates a warhead from a decoy           (dr = c / 2B)
Fig 6  Availability: an active array degrades gracefully as modules fail

Illustrative values are labelled; published values are cited in the paper.

Usage:  python spy6_five_advantages.py [--out DIR]     (default: figures/paper)
"""
import argparse

import matplotlib.pyplot as plt
import numpy as np
from scipy.signal import fftconvolve
from scipy.signal.windows import taylor

from spy6_common import (BLUE, C, DARK, GREY, RED, SEED, SPY6_GAIN, TARGETS, default_out,
                         detection_range as R, digital_beams, array_factor, one_pulse_scene,
                         save, steering, use_style)

# Fig 2 scheduler (illustrative). SPY-1D: one beam per face, 0.1 s dwells, 20% of dwells on tracks.
# SPY-6: digital beams, every track every 0.25 s up to 30x SPY-1D's capacity
# (published "over 30 times as many targets").
DWELL, TRACK_SHARE, LOST_S, SPY6_UPDATE, CAPACITY_X = 0.1, 0.2, 4.0, 0.25, 30
CAP1 = LOST_S * TRACK_SHARE / DWELL            # tracks per face before SPY-1D updates exceed LOST_S
CAP6 = CAPACITY_X * CAP1


def update_interval_spy1(n):
    return n * DWELL / TRACK_SHARE


def update_interval_spy6(n):
    return np.where(n <= CAP6, SPY6_UPDATE, SPY6_UPDATE * n / CAP6)


def null_steer(w, a):
    """Project weights w so the array has zero response toward steering vector a (w^H a = 0)."""
    return w - (np.vdot(a, w) / np.vdot(a, a)) * a


def pattern_db(w, theta):
    """Array response 20 log10 |w^H a(theta)| (dB, not normalised)."""
    return 20 * np.log10(np.abs((np.conj(w) * steering(len(w), theta)).sum(1)) + 1e-12)


def matched_filter(B, sep=5.0, fs=2.0e9, Tp=10e-6, decoy_amp=0.8, lead=100):
    """Pulse-compressed echo of a warhead plus a decoy `sep` m behind it, for an LFM chirp of bandwidth B.
    Returns (range offset from the warhead in m, |output| normalised to 1)."""
    t = np.arange(0, Tp, 1 / fs)
    chirp = np.exp(1j * np.pi * (B / Tp) * (t - Tp / 2) ** 2)
    lag = int(round(2 * sep / C * fs))
    rx = np.zeros(len(chirp) + lag + 2 * lead, complex)
    rx[lead:lead + len(chirp)] += chirp
    rx[lead + lag:lead + lag + len(chirp)] += decoy_amp * chirp
    mf = np.abs(fftconvolve(rx, np.conj(chirp[::-1])))
    # Zero the range axis on the warhead's true position, not on the tallest peak: when the two
    # echoes overlap (low bandwidth) the tallest peak sits between them.
    r = (np.arange(len(mf)) - (lead + len(chirp) - 1)) / fs * C / 2
    return r, mf / mf.max()


def range_kept(fails_pct, rng, side=73, trials=20):
    """Detection range kept (%) when a random share of an active array's side x side modules fail.
    Two-way coherent gain gives S ~ N_alive^3, and R ~ S^(1/4)."""
    loss_db = [np.mean([30 * np.log10((rng.random(side * side) >= f / 100).sum() / side ** 2)
                        for _ in range(trials)]) for f in fails_pct]
    return 10 ** (np.array(loss_db) / 40) * 100


# ---------------------------------------------------------------- Fig 1 range
def fig1_range(out):
    sig = np.logspace(-2.2, .4, 300); S6 = SPY6_GAIN
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    ax.semilogx(sig, R(1, sig), color=GREY, lw=2.5, label="SPY-1D"); ax.semilogx(sig, R(S6, sig), color=BLUE, lw=2.5, label="SPY-6(V)1 (+15 dB)")
    ax.plot(1, 1, "o", color=GREY, ms=7); ax.plot(.5, R(S6, .5), "o", color=BLUE, ms=7); ax.plot(1 / S6, 1, "o", color=BLUE, ms=7)
    ax.annotate("", (.5, R(S6, .5)), (1, 1), arrowprops=dict(arrowstyle="->", lw=1.2, color=DARK)); ax.text(1.05, 1.45, f"Half the size,\n{R(S6, .5):.2f}× the range", fontsize=9)
    ax.annotate("", (1 / S6 * 1.05, 1), (.95, 1), arrowprops=dict(arrowstyle="->", lw=1.2, color=DARK)); ax.text(.17, .8, f"Same range, a target {S6:.0f}× smaller", fontsize=9, ha="center", va="top")
    ax.set(xlabel="Target radar cross-section (1 = target SPY-1D just detects at its reference range)", ylabel="Detection range (1 = SPY-1D)", ylim=(0, 3.2),
           title="1. Range: +15 dB = twice the range on a half-size target")
    ax.legend(loc="upper left", frameon=False); ax.grid(alpha=.25, which="both"); save(fig, out, "fig1_range")


# ---------------------------------------------------------------- Fig 2 capacity
def fig2_capacity(out):
    N = np.logspace(0, np.log10(400), 400)
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    ax.loglog(N, update_interval_spy1(N), color=GREY, lw=2.5, label="SPY-1D: one beam per face, shared")
    ax.loglog(N, update_interval_spy6(N), color=BLUE, lw=2.5, label=f"SPY-6: digital beams, every track every {SPY6_UPDATE} s")
    ax.axhline(LOST_S, color=RED, ls="--", lw=1); ax.text(1.1, LOST_S * 1.12, f"Track updates this slow risk losing a fast missile (illustrative {LOST_S:.0f} s)", color=RED, fontsize=8.5)
    ax.axvline(19, color=DARK, ls=":", lw=1); ax.text(19 * 1.08, 20, "USS Carney,\nOct 19, 2023:\n19 threats", fontsize=8.5, color=DARK)
    ax.plot(CAP1, LOST_S, "o", color=GREY, ms=7); ax.annotate(f"SPY-1D saturates\n~{CAP1:.0f} tracks per face", (CAP1, LOST_S), xytext=(-110, 22), textcoords="offset points", fontsize=8.5,
                                                             arrowprops=dict(arrowstyle="-", lw=.6))
    ax.plot(CAP6, SPY6_UPDATE, "o", color=BLUE, ms=7); ax.annotate(f"~{CAPACITY_X}× more: ~{CAP6:.0f}", (CAP6, SPY6_UPDATE), xytext=(-60, 26), textcoords="offset points", fontsize=8.5, color=BLUE, arrowprops=dict(arrowstyle="-", lw=.6, color=BLUE))
    ax.set(xlabel="Targets on one array face", ylabel="Time between updates of each track (s)", ylim=(0.08, 60),
           title="2. Capacity: SPY-1D slows as the raid grows; SPY-6 doesn't")
    ax.legend(loc="center right", frameon=False, fontsize=8.5); ax.grid(alpha=.25, which="both"); save(fig, out, "fig2_capacity")


# ---------------------------------------------------------------- Fig 3 digital beamforming (one pulse)
def fig3_digital_beamforming(out, rng):
    N3 = 72
    x = one_pulse_scene(rng, N3)
    scan = np.radians(np.linspace(-60, 60, 2401)); w = taylor(N3, nbar=5, sll=30)
    dig = digital_beams(x, scan, w); ddb = 20 * np.log10(dig / dig.max())
    ana = array_factor(scan, N3, w=w)
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    ax.fill_between(np.degrees(scan), -40, 20 * np.log10(ana + 1e-9), color=GREY, alpha=.35, label="SPY-1 style: one beam per pulse")
    ax.plot(np.degrees(scan), ddb, color=BLUE, lw=1.8, label="SPY-6 style: every beam from the same pulse")
    for t, a in TARGETS: ax.annotate(f"target {t}°", (t, ddb[np.argmin(abs(np.degrees(scan) - t))]), xytext=(22 if t == 4 else 0, 8), textcoords="offset points", ha="center", fontsize=8.5, color=BLUE)
    ax.set(xlim=(-60, 60), ylim=(-40, 8), xlabel="Look angle (deg)", ylabel="Received power (dB)", title="3. Many beams at once: one pulse, all three targets found")
    ax.legend(loc="upper center", bbox_to_anchor=(.5, -.15), ncol=2, frameon=False, fontsize=8.5); ax.grid(alpha=.25); save(fig, out, "fig3_digital_beamforming")


# ---------------------------------------------------------------- Fig 4 jamming null
def jamming_null(NJ=24, look_deg=0.0):
    """24-element row (one sub-array) so the sidelobes are easy to see; the jammer sits on the
    first sidelobe peak beyond 25 deg. Returns angles, fixed and adaptive patterns (dB re main beam), jammer angle."""
    th = np.radians(np.linspace(-90, 90, 9001)); look = np.radians(look_deg)
    w0 = steering(NJ, look) / NJ
    pf = pattern_db(w0, th)
    i = np.arange(1, len(pf) - 1)
    pk = i[(pf[i] > pf[i - 1]) & (pf[i] > pf[i + 1]) & (np.degrees(th[i]) > 25)]
    jam = th[pk[0]]
    pa = pattern_db(null_steer(w0, steering(NJ, jam)), th)
    i_look = np.argmin(abs(th - look))
    return th, pf - pf[i_look], pa - pa[i_look], jam


def fig4_jamming_null(out):
    th, pf, pa, jam = jamming_null()
    j0 = pf[np.argmin(abs(th - jam))]; ja = pa[np.argmin(abs(th - jam))]
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    ax.plot(np.degrees(th), np.maximum(pf, -70), color=GREY, lw=2.2, label="Fixed pattern (analog array)")
    ax.plot(np.degrees(th), np.maximum(pa, -70), color=BLUE, lw=1.6, label="Digital array: null steered onto the jammer")
    jd = np.degrees(jam); ax.axvline(jd, color=RED, ls="--", lw=1); ax.text(jd + 1.5, -4, f"jammer {jd:.0f}°", color=RED, fontsize=9)
    ax.annotate(f"jammer gets in at {j0:.0f} dB", (jd, j0), xytext=(18, 10), textcoords="offset points", color=DARK, fontsize=9, arrowprops=dict(arrowstyle="-", lw=.6))
    ax.annotate(f"null: {max(ja, -70):.0f} dB or lower", (jd, -68), xytext=(16, 8), textcoords="offset points", color=BLUE, fontsize=9, arrowprops=dict(arrowstyle="-", lw=.6, color=BLUE))
    ax.set(xlim=(-90, 90), ylim=(-72, 5), xlabel="Angle from where the beam is looking (deg)", ylabel="Gain vs main beam (dB)",
           title="4. Jamming: a digital array points a null at the jammer")
    ax.legend(loc="upper left", frameon=False, fontsize=8.5); ax.grid(alpha=.25); save(fig, out, "fig4_jamming_null")
    print(f"jammer at {jd:.2f} deg: fixed pattern {j0:.1f} dB, adaptive {ja:.1f} dB")


# ---------------------------------------------------------------- Fig 5 discrimination
def fig5_discrimination(out, sep=5.0):
    fig, axs = plt.subplots(3, 1, figsize=(7.2, 5.4), sharex=True)
    for ax, B, col in zip(axs, (10e6, 50e6, 300e6), (GREY, "#6b8fc9", BLUE)):
        r, mf = matched_filter(B, sep); m = (r > -20) & (r < 25)
        ax.plot(r[m], mf[m], color=col, lw=1.8); ax.text(.99, .78, f"B = {B/1e6:.0f} MHz → Δr = c/2B = {C/2/B:.1f} m", transform=ax.transAxes, ha="right", fontsize=9, color=col)
        ax.axvline(0, color="k", ls=":", lw=.7); ax.axvline(sep, color="k", ls=":", lw=.7); ax.set_ylim(0, 1.3); ax.set_ylabel("Echo"); ax.grid(alpha=.25)
    axs[0].set_title(f"5. Discrimination: more bandwidth splits a warhead\nfrom a decoy {sep:.0f} m away")
    axs[0].text(-.3, 1.14, "warhead", fontsize=8, ha="right"); axs[0].text(sep + .3, 1.14, "decoy", fontsize=8); axs[-1].set_xlabel("Range offset (m)  ·  bandwidths illustrative")
    save(fig, out, "fig5_discrimination")


# ---------------------------------------------------------------- Fig 6 availability
def fig6_availability(out, rng):
    fails = np.array([0, 2, 5, 10, 15, 20, 30])
    left = range_kept(fails, rng)
    fig, ax = plt.subplots(figsize=(7.2, 4.0))
    ax.plot(fails, left, "o-", color=BLUE, lw=2, label="Active array (SPY-6): modules fail independently")
    for f, r in zip(fails, left):
        if f in (5, 10, 20): ax.annotate(f"{r:.0f}%", (f, r), xytext=(0, 8), textcoords="offset points", ha="center", fontsize=9, color=BLUE)
    ax.text(30, 32, "Passive array (SPY-1): every element is fed by\none central transmitter, and the radar is down\n2 hours every 2 days for calibration (CSIS)", ha="right", fontsize=9, color=RED)
    ax.set(xlabel="Share of modules failed (%)", ylabel="Detection range kept (%)", ylim=(-5, 110),
           title=f"6. Availability: lose 10% of the modules, keep ~{left[fails == 10][0]:.0f}% of the range")
    ax.legend(loc="lower left", frameon=False, fontsize=8.5); ax.grid(alpha=.25); save(fig, out, "fig6_availability")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Generate the paper's result figures.")
    ap.add_argument("--out", default=default_out("paper"), help="output folder (default: %(default)s)")
    out = ap.parse_args(argv).out
    use_style()
    rng = np.random.default_rng(SEED)        # Fig 3 and Fig 6 draw from it in this order
    fig1_range(out)
    fig2_capacity(out)
    fig3_digital_beamforming(out, rng)
    fig4_jamming_null(out)
    fig5_discrimination(out)
    fig6_availability(out, rng)


if __name__ == "__main__":
    main()
