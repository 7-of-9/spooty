"""Medley DSP kernels (DESIGN §13): knot lanes at the sample rate, the zero-phase 3-band split,
time-varying HP/LP sweeps, the echo bus and its tail rule, splice crossfades with an offset
search, the varispeed playhead (cubic Hermite, or a Kaiser windowed sinc when |rate| > 1.2) and
BS.1770 short-term loudness.

Everything works on float32 (n, C) arrays. Lanes follow `schema.eval_knots` exactly (`lane_eval`
is its sample-rate twin): dB lanes take None = -inf, Hz lanes None = bypass. Neutral settings are
bit-exact pass-throughs (0 dB gain, 0 dB EQ, bypassed filters, integer positions at rate 1), which
is what lets the engine keep native region edges sample-identical to `render.crop`.
The numba kernels are cached on disk (`cache=True`), so only the first process pays the JIT.
"""

from __future__ import annotations

import numpy as np
from numba import njit
from scipy.interpolate import PchipInterpolator
from scipy.signal import sosfilt

from ..audio import SR, split_bands
from . import CFG
from .schema import eval_knots, ramp_db

_RC = CFG["render"]
_LIM = CFG["limits"]


# ---------------------------------------------------------------------------------------------
# lanes
# ---------------------------------------------------------------------------------------------
def sample_times(n: int, sr: int = SR, t0: float = 0.0) -> np.ndarray:
    """t0 + k/sr for k < n; exact at whole samples when t0 is itself a whole number of samples
    (the region grid t = (i - xf)/sr), so a knot on a sample time switches on that sample."""
    off = t0 * sr
    if abs(off - round(off)) < 1e-6:
        return (np.arange(n) + round(off)) / sr
    return t0 + np.arange(n) / sr


def lane_eval(knots: list, n: int, sr: int = SR, t0: float = 0.0, kind: str = "db") -> np.ndarray:
    """A knot lane at the sample times t0 + k/sr, k < n (float64): the same values as
    schema.eval_knots(knots, t, kind), computed per knot segment. An empty lane is 0 dB ("db"),
    bypass (NaN, "hz") or 0 ("pos")."""
    if not knots:
        return np.full(n, np.nan if kind == "hz" else 0.0)
    ks = sorted(((float(k[0]), i, k) for i, k in enumerate(knots)), key=lambda q: (q[0], q[1]))
    xs = np.array([q[0] for q in ks])
    vals = [q[2][1] for q in ks]
    curves = [q[2][2] for q in ks]
    null = -np.inf if kind == "db" else np.nan

    def num(v):
        return null if v is None else float(v)

    t = sample_times(n, sr, t0)
    cut = np.searchsorted(t, xs, side="left")          # first sample at or after each knot
    out = np.empty(n)
    out[: cut[0]] = num(vals[0])
    out[cut[-1]:] = num(vals[-1])
    for k in range(len(ks) - 1):
        a, b = cut[k], cut[k + 1]
        if b <= a:                                       # no samples (or a splice: equal xs)
            continue
        f = np.clip((t[a:b] - xs[k]) / (xs[k + 1] - xs[k]), 0, 1)
        v0, v1, c = vals[k], vals[k + 1], curves[k]
        if kind == "db":
            out[a:b] = ramp_db(v0, v1, f, c)
        elif kind == "hz":
            if v0 is None or c == "hold" or v1 is None:
                out[a:b] = num(v0)
            else:
                w = f if c in ("lin", "exp") else (1 - np.cos(np.pi * f)) / 2
                out[a:b] = (v0 + (v1 - v0) * w if c == "lin"
                            else np.exp(np.log(v0) + (np.log(v1) - np.log(v0)) * w))
        else:
            out[a:b] = float(v0) if c == "hold" else float(v0) + (float(v1) - float(v0)) * f
    return out


def lane_steps(knots: list) -> list[float]:
    """Times where two knots share x with different values: the lane's splices (§8.6)."""
    by_x: dict[float, list] = {}
    for k in knots:
        by_x.setdefault(float(k[0]), []).append(k[1])
    return sorted(x for x, vs in by_x.items() if len(vs) > 1 and vs[0] != vs[-1])


def db_to_amp(db: np.ndarray) -> np.ndarray:
    """10^(dB/20), with -inf -> 0 exactly and 0 dB -> 1.0 exactly."""
    db = np.asarray(db, dtype=float)
    fin = np.isfinite(db)
    return np.where(fin, 10.0 ** (np.where(fin, db, 0.0) / 20.0), 0.0)


def raised_cos(n: int) -> np.ndarray:
    """0 -> 1 over n samples (mid-sample raised cosine, symmetric: w + w[::-1] == 1)."""
    if n <= 0:
        return np.zeros(0)
    return 0.5 - 0.5 * np.cos(np.pi * (np.arange(n) + 0.5) / n)


def soften_step(amp: np.ndarray, i: int, n: int) -> None:
    """In place: replace the step of `amp` at sample i by a raised-cosine move from the value just
    before it over [i, i + n) (the splice convention: a transition starts at its time)."""
    if n <= 1 or i <= 0 or i >= len(amp):
        return
    j = min(len(amp), i + n)
    w = raised_cos(n)[: j - i]
    amp[i:j] = amp[i - 1] * (1 - w) + amp[i:j] * w


# ---------------------------------------------------------------------------------------------
# bands and filters
# ---------------------------------------------------------------------------------------------
def bands3(x: np.ndarray, sr: int = SR, lo_hz: float | None = None,
           hi_hz: float | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Zero-phase complementary split at 150 Hz, then 2500 Hz on the upper part:
    lo + mid + hi == x (to float rounding)."""
    lo, up = split_bands(x, lo_hz or CFG["crossover_low_hz"], sr)
    mid, hi = split_bands(up, hi_hz or CFG["crossover_high_hz"], sr)
    return lo, mid, hi


def biquad_coefs(kind: str, fc: np.ndarray, sr: int = SR) -> np.ndarray:
    """Second-order Butterworth (Q = 1/sqrt 2) low/high-pass coefficients per cutoff:
    rows [b0, b1, b2, a1, a2], normalised by a0 (bilinear transform, RBJ form)."""
    w0 = 2 * np.pi * np.asarray(fc, dtype=float) / sr
    cw, alpha = np.cos(w0), np.sin(w0) / np.sqrt(2.0)
    a0 = 1 + alpha
    if kind == "lp":
        b0 = b2 = (1 - cw) / 2
        b1 = 1 - cw
    else:
        b0 = b2 = (1 + cw) / 2
        b1 = -(1 + cw)
    return np.stack([b0 / a0, b1 / a0, b2 / a0, -2 * cw / a0, (1 - alpha) / a0], axis=-1)


@njit(cache=True)
def _biquad_tv(x, co, block):
    """Transposed direct form II with per-block coefficients `co` (nb, 5), state carried."""
    n, nc = x.shape
    y = np.empty_like(x)
    for c in range(nc):
        z1 = 0.0
        z2 = 0.0
        for i in range(n):
            j = i // block
            xi = x[i, c]
            yi = co[j, 0] * xi + z1
            z1 = co[j, 1] * xi - co[j, 3] * yi + z2
            z2 = co[j, 2] * xi - co[j, 4] * yi
            y[i, c] = yi
    return y


def _fill_nan(v: np.ndarray) -> np.ndarray:
    """NaNs replaced by the nearest finite value (so a bypassed stretch keeps the filter warm)."""
    ok = np.isfinite(v)
    idx = np.arange(len(v))
    return np.interp(idx, idx[ok], v[ok]) if ok.any() else v


def sweep(x: np.ndarray, kind: str, hz_knots: list | None, sr: int = SR, t0: float = 0.0,
          block: int | None = None) -> np.ndarray:
    """Time-varying second-order Butterworth HP ("hp") or LP ("lp"): the cutoff comes from the
    log-interpolated Hz lane (region seconds; t0 = time of x[0]) once per `block` samples, with the
    state carried between blocks. Bypassed stretches (null knots) return x bit-exactly; where the
    filter engages or releases, a splice_xf_low_ms ramp starting there crossfades dry and filtered
    (the filter runs warm through bypass, so both sides are continuous)."""
    block = int(block or _RC["filter_block"])
    n = len(x)
    if not hz_knots or n == 0:
        return x
    nb = -(-n // block)
    centres = t0 + (np.arange(nb) * block + block / 2) / sr
    fc = eval_knots(hz_knots, centres, "hz")
    active = np.isfinite(fc)
    if not active.any():
        return x
    fc = np.clip(_fill_nan(fc), 10.0, 0.45 * sr)
    y = _biquad_tv(np.ascontiguousarray(x, dtype=np.float64), biquad_coefs(kind, fc, sr), block)
    if active.all():
        return y.astype(np.float32)
    # engage/release: the per-block on/off, ramped causally over R samples from each change
    R = max(block, int(round(CFG["splice_xf_low_ms"] * sr / 1000)))
    on = np.repeat(active.astype(float), block)[:n]
    cs = np.concatenate([np.zeros(R), np.cumsum(on)])
    mix = (cs[R:] - cs[:-R]) / R                        # mean of on[i - R + 1 .. i]
    mix[np.isclose(mix, 0.0, atol=1e-12)] = 0.0
    mix[np.isclose(mix, 1.0, atol=1e-12)] = 1.0
    return (x + mix[:, None] * (y - x)).astype(np.float32)


# ---------------------------------------------------------------------------------------------
# echo bus
# ---------------------------------------------------------------------------------------------
@njit(cache=True)
def _echo_kernel(x, d, fb, hp_a, lp_b, block, n_out):
    """w[n] = LP(HP(v[n - d])), v[n] = x[n] + fb * w[n]: one-pole HP (per-block coefficient) and
    one-pole LP inside the feedback loop, so every repeat is filtered again."""
    nx, nc = x.shape
    w = np.zeros((n_out, nc), np.float32)
    v = np.zeros((n_out, nc))
    for c in range(nc):
        hx = 0.0
        hy = 0.0
        ly = 0.0
        for i in range(n_out):
            s = v[i - d, c] if i >= d else 0.0
            a = hp_a[i // block]
            h = a * (hy + s - hx)
            hx = s
            hy = h
            ly = ly + lp_b * (h - ly)
            w[i, c] = ly
            v[i, c] = (x[i, c] if i < nx else 0.0) + fb * ly
    return w


def echo_bus(x: np.ndarray, delay_s: float, fb: float, tail_s: float, hp_knots: list | None,
             lp_hz: float | None, sr: int = SR, t0: float = 0.0,
             hp_floor: tuple[float, float] | None = None) -> np.ndarray:
    """The wet output of a feedback delay fed with x (the captured slice, send gain applied by the
    caller): len(x) + tail_s of repeats, the first at `delay_s` with gain 1, each later one times
    fb and filtered again by the HP lane (region seconds, t0 = time of x[0]; null = bypass) and
    the fixed LP inside the loop. The HP coefficient updates every min(delay, 1024) samples.
    hp_floor = (t, hz) keeps the loop HP at >= hz from region time t (the tail rule)."""
    d = max(1, int(round(delay_s * sr)))
    n_out = len(x) + max(0, int(round(tail_s * sr)))
    block = max(1, min(d, 1024))
    nb = -(-n_out // block)
    dt = 1.0 / sr
    tb = t0 + (np.arange(nb) * block + block / 2) / sr
    hz = eval_knots(hp_knots, tb, "hz") if hp_knots else np.full(nb, np.nan)
    if hp_floor is not None:
        hz = np.where(tb >= hp_floor[0], np.fmax(hz, hp_floor[1]), hz)
    rc = 1.0 / (2 * np.pi * np.where(np.isfinite(hz), np.maximum(hz, 1e-3), 1.0))
    hp_a = np.where(np.isfinite(hz), rc / (rc + dt), 1.0)             # a = 1: pass-through
    lp_b = 1.0 if lp_hz is None or lp_hz >= sr / 2 else dt / (1.0 / (2 * np.pi * lp_hz) + dt)
    xx = np.ascontiguousarray(x, dtype=np.float32).reshape(len(x), -1)
    return _echo_kernel(xx, d, float(fb), hp_a, float(lp_b), block, n_out)


def tail_rule_fb(delay_s: float, send_db: float, delta_s: float, fb_max: float | None = None,
                 floor_db: float | None = None) -> float:
    """§9 echo tail rule: fb <= 10^((floor - send_db) * delay / (20 * delta)), capped at fb_max;
    delta = seconds from the throw to B's second beat."""
    fb_max = CFG["echo_fb_max"] if fb_max is None else fb_max
    floor_db = CFG["tail_floor_db"] if floor_db is None else floor_db
    if delta_s <= 0 or delay_s <= 0:
        return 0.0
    return float(min(fb_max, 10 ** ((floor_db - send_db) * delay_s / (20 * delta_s))))


# ---------------------------------------------------------------------------------------------
# splices
# ---------------------------------------------------------------------------------------------
def splice_offset(a: np.ndarray, b: np.ndarray, xf: int, search: int) -> int:
    """The offset d in [-search, search] that best continues the outgoing a (from the splice
    point) with the incoming b (which starts `search` samples before the splice point): least
    squared difference of the mono sums over the crossfade window, ties to the smallest |d|."""
    n = min(xf, len(a), len(b) - 2 * search)
    if search <= 0 or n <= 0:
        return 0
    am = a[:n].mean(axis=1) if a.ndim == 2 else a[:n]
    bm = b.mean(axis=1) if b.ndim == 2 else b
    win = np.lib.stride_tricks.sliding_window_view(bm[: n + 2 * search].astype(np.float64), n)
    ssd = ((win - am) ** 2).sum(axis=1)
    d = np.arange(-search, search + 1)
    return int(d[np.lexsort((np.abs(d), ssd))[0]])


def splice_xf(a: np.ndarray, b: np.ndarray, xf: int, search: int = 0) -> np.ndarray:
    """Splice the outgoing a (audio from the splice point on, >= xf samples) into the incoming b
    (from `search` samples before the splice point, length L + 2*search): b is moved by
    splice_offset(...) and a raised-cosine crossfade of xf samples joins them. Returns L samples."""
    d = splice_offset(a, b, xf, search)
    y = b[search + d: len(b) - search + d].copy()
    n = min(xf, len(a), len(y))
    w = raised_cos(n).astype(np.float32)
    w = w[:, None] if y.ndim == 2 else w
    y[:n] = a[:n] * (1 - w) + y[:n] * w
    return y


# ---------------------------------------------------------------------------------------------
# varispeed playhead
# ---------------------------------------------------------------------------------------------
_KTAB: dict[float, np.ndarray] = {}


def _kaiser_table(beta: float, n: int = 4097) -> np.ndarray:
    if beta not in _KTAB:
        u = np.linspace(0.0, 1.0, n)
        _KTAB[beta] = np.i0(beta * np.sqrt(1.0 - u ** 2)) / np.i0(beta)
    return _KTAB[beta]


@njit(cache=True)
def _vary_kernel(W, pos, rate, hmax, half_taps, max_half, ktab):
    """Read W at fractional sample positions: 4-point cubic Hermite where |rate| <= hmax, else a
    Kaiser windowed sinc with cutoff min(1, 1/|rate|) (its width grows as 1/cutoff, capped)."""
    n = pos.shape[0]
    nw, nc = W.shape
    out = np.zeros((n, nc), np.float32)
    nt = ktab.shape[0] - 1
    acc = np.zeros(nc)
    for j in range(n):
        p = pos[j]
        if not np.isfinite(p):
            continue
        i = int(np.floor(p))
        f = p - i
        r = abs(rate[j])
        if r <= hmax:
            for c in range(nc):
                ym1 = W[i - 1, c] if 0 <= i - 1 < nw else 0.0
                y0 = W[i, c] if 0 <= i < nw else 0.0
                y1 = W[i + 1, c] if 0 <= i + 1 < nw else 0.0
                y2 = W[i + 2, c] if 0 <= i + 2 < nw else 0.0
                c1 = 0.5 * (y1 - ym1)
                c2 = ym1 - 2.5 * y0 + 2.0 * y1 - 0.5 * y2
                c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1)
                out[j, c] = ((c3 * f + c2) * f + c1) * f + y0
        else:
            fc = min(1.0, 1.0 / r)
            hw = min(max_half, int(np.ceil(half_taps / fc)))
            for c in range(nc):
                acc[c] = 0.0
            wsum = 0.0
            for k in range(i - hw + 1, i + hw + 1):
                x = k - p
                q = abs(x) / hw * nt
                if q >= nt:
                    continue
                qi = int(q)
                win = ktab[qi] + (ktab[qi + 1] - ktab[qi]) * (q - qi)
                arg = np.pi * x * fc
                s = fc if arg == 0.0 else fc * np.sin(arg) / arg
                wgt = s * win
                wsum += wgt
                if 0 <= k < nw:
                    for c in range(nc):
                        acc[c] += wgt * W[k, c]
            if wsum != 0.0:
                for c in range(nc):
                    out[j, c] = acc[c] / wsum
    return out


def read_varispeed(W: np.ndarray, w_of_t: np.ndarray, sr: int = SR,
                   rate: np.ndarray | None = None) -> np.ndarray:
    """Read W (n, C) at per-output-sample positions w_of_t (W seconds, W[0] at 0; out of range
    reads zeros). `rate` = dw/dt per sample (derived from w_of_t when omitted) picks Hermite or
    the anti-aliased sinc. Pitch follows the rate (vinyl). Integer positions at |rate| <= 1.2
    return the samples bit-exactly."""
    pos = np.ascontiguousarray(np.asarray(w_of_t, dtype=float) * sr)
    if rate is None:
        rate = np.gradient(pos) if len(pos) > 1 else np.ones_like(pos)
    Wc = np.ascontiguousarray(W, dtype=np.float32).reshape(len(W), -1)
    taps = int(_RC["sinc_taps"])
    return _vary_kernel(Wc, pos, np.ascontiguousarray(rate, dtype=float), float(_RC["hermite_max_rate"]),
                        taps // 2, 16 * taps, _kaiser_table(float(_RC["sinc_beta"])))


def upsample_positions(w: list | np.ndarray, step_s: float, t0: float,
                       t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """A `vary` pos segment's positions (W seconds every step_s from t0) at the times t, by
    monotone-preserving cubic (PCHIP) interpolation, so a rate that reaches 0 never overshoots;
    linear extrapolation outside. Returns (w(t), dw/dt)."""
    w = np.asarray(w, dtype=float)
    t = np.asarray(t, dtype=float)
    if len(w) < 2:
        return np.full(t.shape, w[0] if len(w) else 0.0), np.zeros(t.shape)
    tk = t0 + np.arange(len(w)) * step_s
    f = PchipInterpolator(tk, w, extrapolate=False)
    df = f.derivative()
    pos, rate = f(t), df(t)
    for sel, k in ((t < tk[0], 0), (t > tk[-1], -1)):
        if sel.any():
            s = float(df(tk[k]))
            pos[sel] = w[k] + (t[sel] - tk[k]) * s
            rate[sel] = s
    return pos, rate


def vinyl_laws(rate: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """§9 gesture laws for a rate curve: gain = min(1, |r|/0.3)^(1/2) (as dB) and an LP that
    closes from 20 kHz (|r| >= 1) to 2 kHz (r = 0), log-interpolated. For compilers and tests."""
    r = np.abs(np.asarray(rate, dtype=float))
    g = np.minimum(1.0, r / float(_LIM["backspin_gain_rate"]))
    with np.errstate(divide="ignore"):
        gain_db = np.where(g > 0, 10.0 * np.log10(np.maximum(g, 1e-300)), -np.inf)
    f_open, f_closed = _LIM["gesture_lp_hz"]
    return gain_db, f_closed * (f_open / f_closed) ** np.minimum(1.0, r)


# ---------------------------------------------------------------------------------------------
# loudness (BS.1770 K-weighting) and a light onset finder
# ---------------------------------------------------------------------------------------------
_KSOS: dict[int, np.ndarray] = {}


def _k_sos(sr: int) -> np.ndarray:
    """BS.1770 K-weighting: the high shelf and the RLB high-pass, designed for any rate
    (the same formulas pyloudnorm uses)."""
    if sr not in _KSOS:
        def rbj(kind, g_db, q, fc):
            A = 10 ** (g_db / 40)
            w0 = 2 * np.pi * fc / sr
            cw, alpha = np.cos(w0), np.sin(w0) / (2 * q)
            if kind == "shelf":
                sa = 2 * np.sqrt(A) * alpha
                b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw),
                     A * ((A + 1) + (A - 1) * cw - sa)]
                a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
            else:
                b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
                a = [1 + alpha, -2 * cw, 1 - alpha]
            return np.r_[np.array(b) / a[0], np.array(a) / a[0]]
        _KSOS[sr] = np.stack([rbj("shelf", 3.999843853973347, 0.7071752369554196, 1681.974450955533),
                              rbj("hp", 0.0, 0.5003270373253953, 38.13547087613982)])
    return _KSOS[sr]


def k_weight(x: np.ndarray, sr: int = SR) -> np.ndarray:
    return sosfilt(_k_sos(sr), np.asarray(x, dtype=float), axis=0)


def lufs(x: np.ndarray, sr: int = SR) -> float:
    """Ungated K-weighted loudness of the whole of x (LUFS; -inf for silence)."""
    if len(x) == 0:
        return -np.inf
    ms = float((k_weight(x, sr) ** 2).mean(axis=0).sum())
    return -0.691 + 10 * np.log10(ms) if ms > 0 else -np.inf


def short_term_lufs(x: np.ndarray, sr: int = SR, win_s: float = 3.0,
                    hop_s: float = 0.1) -> tuple[np.ndarray, np.ndarray]:
    """Sliding ungated K-weighted loudness: (window centre sample indices, LUFS)."""
    n, win, hop = len(x), int(round(win_s * sr)), max(1, int(round(hop_s * sr)))
    if n < win:
        return np.zeros(0, int), np.zeros(0)
    z = (k_weight(x, sr) ** 2).reshape(n, -1).sum(axis=1)
    cs = np.concatenate([[0.0], np.cumsum(z)])
    starts = np.arange(0, n - win + 1, hop)
    ms = (cs[starts + win] - cs[starts]) / win
    with np.errstate(divide="ignore"):
        L = np.where(ms > 0, -0.691 + 10 * np.log10(np.maximum(ms, 1e-300)), -np.inf)
    return starts + win // 2, L


def rise_onsets(x: np.ndarray, sr: int = SR, hz: float = 150.0, hop_ms: float = 2.0,
                rise_db: float = 6.0, floor_db: float = -40.0, gap_s: float = 0.08) -> np.ndarray:
    """Onset times (s from x[0]) where the band below `hz` rises >= rise_db over the preceding
    20 ms: a light kick finder for echo ducking when the program lists no key onsets."""
    lo = split_bands(np.asarray(x, dtype=np.float32).reshape(len(x), -1), hz, sr)[0].mean(axis=1)
    hop = max(1, int(sr * hop_ms / 1000))
    m = len(lo) // hop
    if m < 12:
        return np.zeros(0)
    env = np.sqrt((lo[: m * hop].astype(float) ** 2).reshape(m, hop).mean(axis=1)) + 1e-12
    db = 20 * np.log10(env)
    ref = np.array([db[max(0, i - 10): i].max() if i else db[0] for i in range(m)])
    out, last = [], -1e9
    for i in np.nonzero((db - ref >= rise_db) & (db > floor_db))[0]:
        if i * hop / sr - last >= gap_s:
            out.append(i * hop / sr)
            last = out[-1]
    return np.asarray(out)


# ---------------------------------------------------------------------------------------------
# true-peak limiter (medley output)
# ---------------------------------------------------------------------------------------------
def true_peak_env(y: np.ndarray, over: int = 4) -> np.ndarray:
    """Per-sample true-peak estimate: max |x| over the channels and the `over`x polyphase
    oversampled phases around each sample (float32, length len(y))."""
    from scipy.signal import resample_poly
    x = np.asarray(y, np.float32)
    if x.ndim == 1:
        x = x[:, None]
    if len(x) < 16:
        return np.abs(x).max(axis=1)
    up = np.abs(resample_poly(x.astype(np.float64), over, 1, axis=0)).max(axis=1)
    n = len(x)
    up = up[: n * over]
    return np.maximum(up.reshape(n, over).max(axis=1), np.abs(x).max(axis=1)).astype(np.float32)


def tp_limiter(y: np.ndarray, ceiling_db: float = -1.0, release_s: float = 0.08, sr: int = SR,
               over: int = 4) -> np.ndarray:
    """audio.limiter's block look-ahead gain computer driven by the 4x true-peak envelope
    instead of sample peaks, so inter-sample overs stay under the ceiling too (V7 measures
    <= -0.8 dBTP after the limiter; the sample-peak limiter clips at -1 dBFS and overshoots
    by up to ~0.5 dB on dense masters). A final sample clip at the ceiling is only a guard.
    Material under the ceiling passes bit-exact."""
    from scipy.ndimage import minimum_filter1d
    y = np.asarray(y, np.float32)
    if len(y) == 0:
        return y
    ceiling = 10 ** (ceiling_db / 20)
    peak = true_peak_env(y, over)
    if peak.max() <= ceiling:
        return y
    blk = 64
    nb = -(-len(peak) // blk)
    padded = np.pad(peak, (0, nb * blk - len(peak)))
    need = np.minimum(1.0, ceiling / np.maximum(padded.reshape(nb, blk).max(axis=1), 1e-9))
    need = minimum_filter1d(need, size=2 * max(1, int(0.004 * sr / blk)) + 3)
    rel = 1 - np.exp(-blk / (release_s * sr))
    g = _release(need.astype(np.float64), float(rel))
    centers = np.arange(nb) * blk + blk / 2
    gs = np.interp(np.arange(len(peak)), centers, g).astype(np.float32)
    out = y * (gs[:, None] if y.ndim == 2 else gs)
    return np.clip(out, -ceiling, ceiling).astype(np.float32)


@njit(cache=True)
def _release(need, rel):
    g = np.empty(len(need))
    cur = 1.0
    for i in range(len(need)):
        cur = cur + (1.0 - cur) * rel
        if need[i] < cur:
            cur = need[i]
        g[i] = cur
    return g
