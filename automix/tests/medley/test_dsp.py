"""E3 DSP kernels (DESIGN §13): lanes, bands, sweeps, echo bus + tail rule, splices, varispeed,
loudness. Synthetic signals only."""

import numpy as np
import pytest

from automix.medley import CFG, dsp
from automix.medley import schema as S

SR = 44100


def tone(f, n, amp=0.5, ch=2, phase=0.0):
    x = amp * np.sin(2 * np.pi * f * np.arange(n) / SR + phase)
    return np.repeat(x[:, None], ch, axis=1).astype(np.float32)


def rms_db(x):
    return 10 * np.log10(np.mean(np.asarray(x, float) ** 2) + 1e-30)


def click_ratio(y, i, sr=SR):
    """Click excess at sample i: max |diff(HP 8 kHz)| within ±5 ms over the 99.9th percentile of
    the rest of ±100 ms (a V6-style measure that stays ~1 on stationary broadband audio)."""
    from automix.audio import highpass
    h = np.abs(np.diff(highpass(y.astype(np.float32), 8000.0, sr).mean(axis=1)))
    w, r = int(0.005 * sr), int(0.1 * sr)
    ref = np.percentile(np.r_[h[i - r: i - w], h[i + w: i + r]], 99.9)
    return float(h[i - w: i + w].max() / max(ref, 1e-12))


def hiss(n, amp=0.003, seed=0):
    return (amp * np.random.default_rng(seed).standard_normal((n, 2))).astype(np.float32)


# ------------------------------------------------------------------------------------ lanes
LANES_DB = [
    [[0.1, -12.0, "eqpow"], [0.3, 0.0, "hold"], [0.3, None, "lin"], [0.5, -6.0, "cos"], [0.8, 0.0, "exp"],
     [0.9, None, "hold"]],
    [[0.2, None, "exp"], [0.6, -3.0, "lin"]],
    [[0.25, 0.0, "hold"], [0.25, None, "hold"]],
]


@pytest.mark.parametrize("knots", LANES_DB)
def test_lane_eval_matches_schema_eval_knots_db(knots):
    n, t0 = 50_000, -0.015
    t = t0 + np.arange(n) / SR
    a, b = dsp.lane_eval(knots, n, SR, t0, "db"), S.eval_knots(knots, t, "db")
    assert np.array_equal(np.isinf(a), np.isinf(b))
    assert np.array_equal(a[np.isfinite(a)], b[np.isfinite(b)])


def test_lane_eval_matches_hz_and_pos_and_defaults():
    n, t0 = 30_000, 0.0
    t = t0 + np.arange(n) / SR
    hz = [[0.1, 40.0, "exp"], [0.5, 1000.0, "hold"], [0.6, None, "hold"]]
    a, b = dsp.lane_eval(hz, n, SR, t0, "hz"), S.eval_knots(hz, t, "hz")
    assert np.array_equal(np.isnan(a), np.isnan(b)) and np.array_equal(a[~np.isnan(a)], b[~np.isnan(b)])
    pos = [[0.0, 0.0, "lin"], [0.3, 4.0, "hold"], [0.3, 1.0, "lin"], [0.6, 2.0, "lin"]]
    assert np.array_equal(dsp.lane_eval(pos, n, SR, t0, "pos"), S.eval_knots(pos, t, "pos"))
    assert np.all(dsp.lane_eval([], 10, kind="db") == 0) and np.all(np.isnan(dsp.lane_eval([], 10, kind="hz")))
    assert dsp.lane_steps(LANES_DB[0]) == [0.3] and dsp.lane_steps([[1, 0.0, "hold"], [1, 0.0, "lin"]]) == []


def test_db_to_amp_is_exact_at_the_ends():
    a = dsp.db_to_amp(np.array([0.0, -np.inf, -6.0206]))
    assert a[0] == 1.0 and a[1] == 0.0 and abs(a[2] - 0.5) < 1e-4


def test_soften_step_is_a_raised_cosine_from_the_step():
    amp = np.r_[np.ones(100), np.zeros(100)]
    dsp.soften_step(amp, 100, 20)
    assert np.all(amp[:100] == 1) and np.all(amp[120:] == 0)
    seg = amp[100:120]
    assert np.all(np.diff(seg) < 0) and seg[0] > 0.99 and seg[-1] < 0.01
    w = dsp.raised_cos(20)
    assert np.allclose(w + w[::-1], 1.0)


# ------------------------------------------------------------------------------------ bands, sweeps
def test_bands3_reconstructs_and_separates():
    n = SR
    x = tone(60, n) + tone(1000, n) + tone(6000, n)
    lo, mid, hi = dsp.bands3(x)
    assert np.abs(lo + mid + hi - x).max() < 1e-6
    core = slice(SR // 4, 3 * SR // 4)
    ref = rms_db(tone(60, n)[core])
    for band, f_in in ((lo, 60), (mid, 1000), (hi, 6000)):
        assert abs(rms_db(band[core] - tone(f_in, n)[core] * 0) - ref) < 1.5   # mostly its own tone


def test_sweep_bypass_is_bit_exact_and_filters_act():
    x = tone(100, SR) + tone(5000, SR)
    assert dsp.sweep(x, "lp", None) is x
    assert np.array_equal(dsp.sweep(x, "lp", [[0.0, None, "hold"]]), x)
    y = dsp.sweep(x, "lp", [[0.0, 500.0, "hold"]])
    core = slice(SR // 4, SR)
    lo, hi = dsp.bands3(y[core], lo_hz=1000, hi_hz=3000)[0], dsp.bands3(y[core], lo_hz=1000, hi_hz=3000)[2]
    assert rms_db(lo) > rms_db(tone(100, SR)[core]) - 0.5
    assert rms_db(hi) < rms_db(tone(5000, SR)[core]) - 30
    # HP 40 -> 1000 Hz: a 200 Hz tone passes at the start and is cut by the end
    hpk = [[0.0, 40.0, "exp"], [1.0, 1000.0, "hold"]]
    z = dsp.sweep(tone(200, SR), "hp", hpk)
    assert rms_db(z[2000:6000]) > rms_db(tone(200, SR)) - 1
    assert rms_db(z[-4000:]) < rms_db(tone(200, SR)) - 12


def test_sweep_engages_without_a_click():
    x = tone(300, SR) + tone(2000, SR, 0.2) + hiss(SR)
    lane = [[0.0, None, "hold"], [0.5, 800.0, "hold"]]         # bypass, then HP 800 Hz from 0.5 s
    y = dsp.sweep(x, "hp", lane)
    i = SR // 2
    assert np.array_equal(y[: i - 64], x[: i - 64])             # bit-exact while bypassed
    assert click_ratio(y, i) < 2


# ------------------------------------------------------------------------------------ echo bus
def test_echo_bus_repeats_decay_by_fb():
    d_s, fb = 0.1, 0.5
    x = np.zeros((200, 2), np.float32)
    x[0] = 1.0
    w = dsp.echo_bus(x, d_s, fb, 1.0, None, None)
    d = int(round(d_s * SR))
    assert len(w) == 200 + SR and np.abs(w[:d]).max() == 0
    peaks = [w[k * d, 0] for k in range(1, 6)]
    assert np.allclose(peaks, [fb ** (k - 1) for k in range(1, 6)], rtol=1e-6)


def test_echo_bus_filters_inside_the_loop():
    d_s, fb = 0.05, 0.9
    x = tone(80, int(0.02 * SR))
    lp = dsp.echo_bus(x, d_s, fb, 0.5, [[0.0, 1000.0, "hold"]], None)
    plain = dsp.echo_bus(x, d_s, fb, 0.5, None, None)
    d = int(d_s * SR)

    def rep(w, k):
        return rms_db(w[k * d: k * d + int(0.02 * SR)])
    # the HP cuts every pass again: 80 Hz decays much faster than fb alone
    assert rep(plain, 4) - rep(plain, 1) > -4
    assert rep(lp, 4) - rep(lp, 1) < rep(plain, 4) - rep(plain, 1) - 30
    # floor from 0.1 s: plain loop HP raised to 1 kHz only after that time
    fl = dsp.echo_bus(x, d_s, fb, 0.5, None, None, hp_floor=(0.1, 1000.0))
    assert abs(rep(fl, 1) - rep(plain, 1)) < 0.5 and rep(fl, 5) < rep(plain, 5) - 20


def test_tail_rule_bound():
    delay, send, delta = 0.75 * 0.5, -4.0, 2 * 0.5
    fb = dsp.tail_rule_fb(delay, send, delta, fb_max=1.0)
    level = send + 20 * np.log10(fb) * delta / delay          # dB at B's second beat
    assert abs(level - CFG["tail_floor_db"]) < 1e-9
    assert dsp.tail_rule_fb(delay, send, 100.0) == CFG["echo_fb_max"]
    assert dsp.tail_rule_fb(delay, send, 0.0) == 0.0


# ------------------------------------------------------------------------------------ splices
def test_splice_offset_finds_a_known_shift_and_prefers_zero():
    rng = np.random.default_rng(0)
    base = rng.standard_normal((4000, 2)).astype(np.float32)
    a = base[1000:1200]
    search = 40
    for true in (-17, 0, 23):
        b = base[1000 + true - search: 1000 + true + 400 + search]
        assert dsp.splice_offset(a, b, 132, search) == -true    # b is displaced by +true
    flat = np.zeros((600, 2), np.float32)
    assert dsp.splice_offset(flat[:200], flat, 132, 40) == 0


def test_splice_xf_joins_two_sines_without_a_click():
    n, i = SR // 2, SR // 4
    a = tone(220, n) + hiss(n, seed=1)
    b = tone(220, n, phase=2.0) + hiss(n, seed=2)       # same pitch, far out of phase
    xf, search = int(0.003 * SR), int(0.0015 * SR)
    hard = np.concatenate([a[:i], b[i:]])
    y = np.concatenate([a[:i], dsp.splice_xf(a[i:], b[i - search: n], xf, search)])
    assert len(y) == n - search
    assert click_ratio(hard, i) > 4                     # the metric sees the raw splice
    assert click_ratio(y, i) < 2
    assert click_ratio(np.concatenate([a[:i], dsp.splice_xf(a[i:], b[i - search: n], xf, 0)]), i) < 2


# ------------------------------------------------------------------------------------ varispeed
def ramp_track(n):
    """Left channel = sample index / 2^20 (exact in float32): reading it returns the position."""
    x = np.zeros((n, 2), np.float32)
    x[:, 0] = np.arange(n, dtype=np.float32) / 2 ** 20
    x[:, 1] = np.sin(np.arange(n) * 0.01)
    return x


def test_varispeed_integer_positions_are_bit_exact():
    W = tone(440, 5000) + np.float32(0.1)
    pos = (np.arange(100, 4000) / SR)
    out = dsp.read_varispeed(W, pos, SR, np.ones(len(pos)))
    assert np.array_equal(out, W[100:4000])


def test_varispeed_hermite_reproduces_positions():
    W = ramp_track(20_000)
    p = 5000 + np.cumsum(np.linspace(1.0, 0.2, 8000))     # slowing down, |rate| <= 1.2: Hermite
    out = dsp.read_varispeed(W, p / SR, SR)
    assert np.abs(out[:, 0] * 2 ** 20 - p).max() < 1e-3


def test_varispeed_sinc_follows_fast_reverse_and_antialiases():
    W = ramp_track(60_000)
    p = 50_000 - 3.5 * np.arange(10_000)                   # backspin speed: sinc path
    out = dsp.read_varispeed(W, p / SR, SR, np.full(len(p), -3.5))
    assert np.abs(out[:, 0] * 2 ** 20 - p).max() < 0.05
    # a 12 kHz tone read at rate 3 would alias; the cutoff scales with 1/rate
    Wt = tone(12_000, 60_000)
    q = 100 + 3.0 * np.arange(15_000)
    y = dsp.read_varispeed(Wt, q / SR, SR, np.full(len(q), 3.0))
    assert rms_db(y[1000:-1000]) < rms_db(Wt) - 30
    # a 200 Hz tone read at rate 3 plays at 600 Hz, level kept
    Wl = tone(200, 60_000)
    y = dsp.read_varispeed(Wl, q / SR, SR, np.full(len(q), 3.0))
    ref = 0.5 * np.sin(2 * np.pi * 200 * q / SR)
    assert np.abs(y[1000:-1000, 0] - ref[1000:-1000]).max() < 2e-3


def test_upsample_positions_tape_stop_reaches_zero_on_time():
    beat, L, k = 0.5, 2.0, 1.5                           # tape_stop len 2 beats, k 1.5
    step = CFG["compile"]["vary_step_s"]
    tk = np.arange(0, L * beat + 0.2, step)
    x = np.minimum(tk / beat, L)
    w = 1.0 + beat * (L / (k + 1)) * (1 - (1 - x / L) ** (k + 1))    # W s; travel len/(k+1) beats
    t = np.arange(0, int((L * beat + 0.2) * SR)) / SR
    pos, rate = dsp.upsample_positions(w, step, 0.0, t)
    stop = L * beat
    assert abs(rate[0] - 1.0) < 1e-3
    assert np.all(np.abs(rate[t >= stop]) < 1e-3)
    assert np.all(np.diff(pos) >= -1e-12)               # PCHIP: no overshoot, never backwards
    assert abs(pos[-1] - (1.0 + beat * L / (k + 1))) < 1e-9


def test_vinyl_laws():
    g, lp = dsp.vinyl_laws(np.array([0.0, 0.075, 0.3, 1.0, -3.5]))
    assert g[0] == -np.inf and abs(g[1] - 10 * np.log10(0.25)) < 1e-9 and g[2] == 0 and g[4] == 0
    assert abs(lp[0] - 2000) < 1e-6 and abs(lp[3] - 20000) < 1e-6 and abs(lp[4] - 20000) < 1e-6


# ------------------------------------------------------------------------------------ loudness
def test_k_weighted_loudness_matches_pyloudnorm():
    import pyloudnorm
    rng = np.random.default_rng(3)
    x = (0.1 * rng.standard_normal((3 * SR, 2))).astype(np.float32)
    ref = pyloudnorm.Meter(SR).integrated_loudness(x.astype(float))
    assert abs(dsp.lufs(x) - ref) < 0.1
    c, L = dsp.short_term_lufs(np.concatenate([x, x]), SR, 3.0, 0.5)
    assert len(L) == 7 and np.all(np.abs(L - ref) < 0.2)


def test_rise_onsets_find_kicks():
    import synth
    s = synth.make_track(120, [("k", 4, {"kick"})])
    on = dsp.rise_onsets(s.y)
    kicks = s.onsets["kick"]
    assert len(on) == len(kicks)
    assert np.abs(on - kicks).max() < 0.006
