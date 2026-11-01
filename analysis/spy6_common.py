"""
Shared constants, plot style and phased-array physics for the SPY-6 vs SPY-1 scripts.

Equations
  Radar range:   R^4 = P_t G A_e sigma / ((4 pi)^2 S_min)   ->  R ~ (S sigma)^(1/4)
  Array factor:  AF(theta) = sum_n w_n exp(i n k d (sin theta - sin theta_0))

Assumptions: 3.3 GHz (SPY-6 frequency is not public; SPY-1 is 3.1-3.5 GHz);
144 modules per RMA as a 12x12 grid -> 5.08 cm spacing; isotropic elements.
"""
import os

import matplotlib
matplotlib.use("Agg")                     # scripts only write PNGs; works without a display
import matplotlib.pyplot as plt
import numpy as np

C = 2.998e8                               # speed of light, m/s
F = 3.3e9                                 # assumed S-band frequency, Hz
LAM = C / F                               # wavelength, m (~9.08 cm)
K = 2 * np.pi / LAM                       # wavenumber, rad/m
D_ELEM = 0.0508                           # element spacing, m (2 in)
SPY6_GAIN_DB = 15.0                       # published SPY-6(V)1 sensitivity gain over SPY-1D (NAVSEA)
SPY6_GAIN = 10 ** (SPY6_GAIN_DB / 10)     # 31.6x
SEED = 271

GREY, BLUE, DARK, RED = "#8a8f98", "#1f5fbf", "#333333", "#c0392b"

# The one-pulse scene used by both digital-beamforming figures: (angle deg, amplitude)
TARGETS = [(-28, 1.0), (4, 0.6), (31, 0.8)]


def use_style():
    plt.rcParams.update({"figure.dpi": 150, "font.size": 10, "axes.spines.top": False,
                         "axes.spines.right": False, "axes.titleweight": "bold"})


def default_out(name):
    """figures/<name> at the repository root (one folder per script, so outputs never collide)."""
    return os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "figures", name))


def save(fig, out, name):
    os.makedirs(out, exist_ok=True)
    fig.tight_layout(); fig.savefig(os.path.join(out, f"{name}.png")); plt.close(fig)
    print("saved", name)


def detection_range(S, sigma):
    """Detection range relative to SPY-1D on a unit target: R ~ (S sigma)^(1/4)."""
    return (S * sigma) ** 0.25


def steering(N, theta, d=D_ELEM, lam=LAM):
    """Element phasors of an N-element line array for a plane wave from theta (rad).
    Scalar theta -> shape (N,); array theta -> shape (len(theta), N)."""
    return np.exp(1j * (2 * np.pi / lam) * d * np.multiply.outer(np.sin(theta), np.arange(N)))


def array_factor(theta, N, d=D_ELEM, lam=LAM, theta0=0.0, w=None):
    """Normalised |AF| of an N-element line array with weights w, steered to theta0 (rad)."""
    k = 2 * np.pi / lam
    n = np.arange(N)
    w = np.ones(N) if w is None else np.asarray(w)
    af = np.abs((w * np.exp(1j * n * k * d * (np.sin(theta)[:, None] - np.sin(theta0)))).sum(1))
    return af / af.max()


def hpbw(theta, af):
    """Half-power (-3 dB) beam width of the main lobe, in the units of theta, by linear interpolation."""
    p = af ** 2; i0 = np.argmax(p); i = j = i0
    while i > 0 and p[i] > .5: i -= 1
    while j < len(p) - 1 and p[j] > .5: j += 1
    return (np.interp(.5, [p[j], p[j - 1]], [theta[j], theta[j - 1]])
            - np.interp(.5, [p[i], p[i + 1]], [theta[i], theta[i + 1]]))


def one_pulse_scene(rng, N=72, noise=0.15):
    """Signals on N elements from one pulse returned by the three TARGETS, plus receiver noise."""
    x = sum(a * steering(N, np.radians(t)) for t, a in TARGETS)
    return x + noise * (rng.standard_normal(N) + 1j * rng.standard_normal(N))


def digital_beams(x, scan, w):
    """Digital beamforming: |beam output| for every look angle in scan, all from the same snapshot x."""
    return np.abs((np.conj(steering(len(x), scan)) * w * x).sum(1))
