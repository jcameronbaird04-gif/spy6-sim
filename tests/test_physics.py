"""Checks that the model reproduces textbook results and the numbers quoted in the paper.
Run from the repository root:  pytest"""
import os
import sys

import numpy as np
import pytest
from scipy.signal.windows import taylor

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "analysis"))

from spy6_common import (C, D_ELEM, LAM, SEED, SPY6_GAIN, TARGETS, array_factor,  # noqa: E402
                         detection_range, digital_beams, hpbw, one_pulse_scene)
import spy6_five_advantages as adv  # noqa: E402
import spy6_model_v3 as v3  # noqa: E402

THETA = np.radians(np.linspace(-90, 90, 18001))


@pytest.mark.parametrize("N", [24, 72, 144])
def test_beamwidth_matches_uniform_array_theory(N):
    bw = hpbw(THETA, array_factor(THETA, N))
    assert bw == pytest.approx(0.886 * LAM / (N * D_ELEM), rel=0.02)


def test_plus_15_db_gives_published_range_ratios():
    assert detection_range(SPY6_GAIN, 1) == pytest.approx(2.371, abs=1e-3)      # same target
    assert detection_range(SPY6_GAIN, 0.5) == pytest.approx(1.994, abs=1e-3)    # half-size target


def test_n_cubed_scaling_anchored_on_v1():
    assert v3.sensitivity_db(37) == pytest.approx(15.0)
    assert v3.sensitivity_db(74) - v3.sensitivity_db(37) == pytest.approx(30 * np.log10(2))


def test_spy1_validation_hits_published_1p7_deg():
    bws = v3.spy1_beamwidths(taylor(72, nbar=5, sll=30), freqs=[3.1e9])
    assert bws[0] == pytest.approx(1.7, abs=0.02)


def test_digital_beamforming_finds_every_target():
    rng = np.random.default_rng(SEED)
    scan = np.radians(np.linspace(-60, 60, 2401))
    dig = digital_beams(one_pulse_scene(rng), scan, taylor(72, nbar=5, sll=30))
    db = 20 * np.log10(dig / dig.max())
    for t, _ in TARGETS:
        near = np.abs(np.degrees(scan) - t) < 1.0
        assert db[near].max() > -10, f"target at {t} deg not found"


def test_null_steering_kills_jammer_and_keeps_main_beam():
    th, pf, pa, jam = adv.jamming_null()
    i = np.argmin(abs(th - jam))
    assert pf[i] > -30                     # the jammer sits on a real sidelobe
    assert pa[i] < -100                    # and the adaptive pattern nulls it
    assert pa[np.argmin(abs(th))] == pytest.approx(0.0)


@pytest.mark.parametrize("B", [10e6, 50e6, 300e6])
def test_matched_filter_axis_is_zeroed_on_the_warhead(B):
    r, mf = adv.matched_filter(B, sep=5.0, decoy_amp=0.0)          # warhead only
    assert abs(r[np.argmax(mf)]) < C / (2 * 2.0e9) + 1e-9            # peak within one range bin of 0


def test_300_mhz_resolves_decoy_5_m_behind():
    r, mf = adv.matched_filter(300e6, sep=5.0)
    assert mf[np.argmin(abs(r - 5.0))] > 0.7                          # a distinct second peak
    assert mf[np.argmin(abs(r - 2.5))] < 0.1                          # with a deep gap between


def test_capacity_model_numbers():
    assert adv.CAP1 == pytest.approx(24)                    # ~100 tracks for 4 faces: published SPY-1 "more than 100 targets"
    assert 4 * adv.CAP1 >= 90
    assert adv.CAP6 == pytest.approx(720)
    assert adv.update_interval_spy1(adv.CAP1) == pytest.approx(adv.LOST_S)


def test_ten_percent_module_loss_keeps_about_92_percent_range():
    kept = adv.range_kept(np.array([0, 10]), np.random.default_rng(SEED))
    assert kept[0] == pytest.approx(100)
    assert kept[1] == pytest.approx(100 * 0.9 ** 0.75, abs=0.5)
