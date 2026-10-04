"""Consensus beat grid, onset refinement, fitted grids and window classes (DESIGN §4.1-4.2, R3, R12).

Pipeline for one track:
  consensus()      all-in-one beats + bar positions (Beat This when there is no structure), each
                   beat snapped to the nearest Beat This beat within grid_snap_s; small gaps and
                   duplicate beats of regular tracks are repaired so beat indices stay contiguous
                   (Fit.k indexes Feats.beats.t).
  onsets()         percussive spectral flux (n_fft 1024, hop 64 at 44.1 kHz, weighted by an HPSS
                   percussive mask), clear peaks (median + 3 MAD over 1 s), timed at the steepest
                   point of the rising edge, parabolic sub-hop, lag-corrected -> 1 ms.
  refine()         every beat moves to the strongest clear onset within +-refine_win_s of the
                   detector-lag-corrected beat; unrefined beats keep the detector time corrected
                   by the track's median detector lag (the detectors run 15-30 ms late).
  fit_grid()       weighted LSQ of beat time vs beat index with a per-bar-position groove term
                   (anchored at the downbeat), 40 ms outliers dropped over 3 passes.
  classify()       locked / verify / free (§4.2), free on any R12 condition.

Times are native track seconds. Everything returned for persistence is JSON-native.
"""

from __future__ import annotations

import math

import numpy as np

from . import CFG

SR = 44100
A = CFG["analysis"]

# The centred 1024-point flux rises as the window's leading edge meets an attack, so the steepest
# point of its rising edge precedes the attack. Calibrated on synth kicks/snares/clicks
# (tests/medley/test_grid.py::test_onsets_are_sample_accurate keeps it honest).
ONSET_LAG_S = 0.0105
# Local-consistency pass of the refinement (not in Appendix A; proposed CFG analysis keys
# consist_ms / consist_half): a refined beat further than this from the local line through its
# refined neighbours (+-half beats) is re-picked or unrefined.
CONSIST_MS = A.get("consist_ms", 15)
CONSIST_HALF = A.get("consist_half", 16)
# fit_grid groove offsets per bar position: kept when 5-25 ms (proposed CFG analysis keys
# groove_min_ms / groove_max_ms). Smaller is jitter; larger is a mislabelled position.
GROOVE_MIN_S = A.get("groove_min_ms", 5) / 1000
GROOVE_MAX_S = A.get("groove_max_ms", 25) / 1000


# ---------------------------------------------------------------------------------------------
# consensus beats (§4.1 step 1, R12 meter/octave)
# ---------------------------------------------------------------------------------------------
def structure_ok(t: dict, s: dict | None) -> bool:
    """The all-in-one structure is usable: segments tile this file (same guard as session.py)
    and there are enough beats."""
    if not s:
        return False
    segs = s.get("segments") or []
    return bool(segs) and abs(segs[-1]["end"] - t["duration"]) <= 2.5 and len(s.get("beats") or []) > 16


def _bt_positions(beats: np.ndarray, downbeats: np.ndarray, bpb: int) -> np.ndarray:
    """In-bar positions from Beat This downbeats (0 at a downbeat, counting up after it)."""
    pos = np.zeros(len(beats), int)
    k = -1
    for i, x in enumerate(beats):
        if len(downbeats) and np.min(np.abs(downbeats - x)) < 0.03:
            k = 0
        elif k >= 0:
            k += 1
        pos[i] = k if k >= 0 else 0
    first = int(np.argmax(pos == 0)) if np.any(pos == 0) else 0
    for i in range(first):                     # pickup beats before the first downbeat
        pos[i] = (bpb - (first - i)) % bpb
    return pos


def _span_period(b: np.ndarray, good: np.ndarray, i0: int, i1: int) -> float | None:
    """Mean period over the longest all-good run of intervals inside [i0, i1) (>= 8 of them)."""
    best = None
    k = i0
    while k < i1:
        if not good[k]:
            k += 1
            continue
        e = k
        while e < i1 and good[e]:
            e += 1
        if e - k >= 8 and (best is None or e - k > best[1] - best[0]):
            best = (k, e)
        k = e
    return None if best is None else float((b[best[1]] - b[best[0]]) / (best[1] - best[0]))


def repair(beats: np.ndarray, pos: np.ndarray, bpb: int) -> tuple[np.ndarray, np.ndarray, int, int]:
    """Keep beat indices contiguous where the detector lost the beat for a while (a gap, a split
    beat, a breakdown tracked at the wrong spacing): an interior stretch of irregular intervals
    (> 15 % off the dominant period, stretches < 4 good intervals apart merged) is re-gridded
    evenly between its two good anchor beats, but only when the anchors are a whole number of
    local periods apart (+-1/4 beat), i.e. the tempo and phase really held through it. Genuine
    tempo changes and stretches at the file edges are left alone. Re-gridded positions continue
    the bar count from the first anchor. Returns (beats, pos, n_inserted, n_replaced)."""
    b, p = np.asarray(beats, float), np.asarray(pos, int)
    if len(b) < 24:
        return b, p, 0, 0
    ibi = np.diff(b)
    P = float(np.median(ibi))
    good = np.abs(ibi / P - 1) <= 0.15
    if good.mean() < 0.5:
        return b, p, 0, 0
    runs, k = [], 0
    while k < len(ibi):                               # runs of bad intervals [a, e)
        if good[k]:
            k += 1
            continue
        e = k
        while e < len(ibi) and not good[e]:
            e += 1
        if runs and k - runs[-1][1] < 4:
            runs[-1][1] = e
        else:
            runs.append([k, e])
        k = e
    out_b, out_p, last, added, removed = [], [], 0, 0, 0
    for a, e in runs:
        s0, s1 = a, e                                 # anchor beats: b[a] and b[e]
        if s0 == 0 or s1 >= len(b) - 1:
            continue
        pb = _span_period(b, good, max(0, s0 - 32), s0)
        pa = _span_period(b, good, s1, min(len(ibi), s1 + 32))
        per = np.mean([x for x in (pb, pa) if x]) if (pb or pa) else None
        if per is None:
            continue
        n = (b[s1] - b[s0]) / per
        N = int(round(n))
        if N < 1 or abs(n - N) >= 0.25:
            continue
        out_b.append(b[last:s0 + 1])
        out_p.append(p[last:s0 + 1])
        q = np.arange(1, N)
        out_b.append(b[s0] + (b[s1] - b[s0]) * q / N)
        out_p.append((p[s0] + q) % bpb)
        added += N - 1
        removed += s1 - s0 - 1
        last = s1
    if not out_b:
        return b, p, 0, 0
    out_b.append(b[last:])
    out_p.append(p[last:])
    return np.concatenate(out_b), np.concatenate(out_p).astype(int), added, removed


def consensus(t: dict, s: dict | None, c: dict = CFG) -> dict:
    """Consensus beats for track `t` (analysis dict) and its all-in-one structure `s` (or None).

    Returns {beats, pos, src, bpb, meter_ok, octave_ok, bpm_a1, filled, dropped}: all-in-one beats
    snapped to the nearest Beat This beat within grid_snap_s, positions from all-in-one's
    beat_positions; Beat This alone (downbeat-counted positions) without a usable structure."""
    bt_b = np.asarray(t["beats"], float)
    bt_d = np.asarray(t["downbeats"], float)
    bpb_bt = int(t.get("beats_per_bar") or 4)
    if structure_ok(t, s):
        b = np.asarray(s["beats"], float)
        pos = np.asarray(s["beat_positions"], int) - 1
        if len(bt_b) > 1:
            j = np.clip(np.searchsorted(bt_b, b), 1, len(bt_b) - 1)
            near = np.where(np.abs(bt_b[j - 1] - b) < np.abs(bt_b[j] - b), bt_b[j - 1], bt_b[j])
            b = np.where(np.abs(near - b) <= c["grid_snap_s"], near, b)
        ends = pos[np.r_[pos[1:] == 0, False]]            # position of the beat before a downbeat
        bpb = int(np.bincount(ends + 1).argmax()) if len(ends) else bpb_bt
        bpm_a1 = float(s["bpm"]) if s.get("bpm") else None
        src, meter_ok = "a1", bpb == bpb_bt
    else:
        b, bpb, src, meter_ok, bpm_a1 = bt_b, bpb_bt, "bt", True, None
        pos = _bt_positions(b, bt_d, bpb)
    octave_ok = bpm_a1 is None or abs(math.log(max(t["bpm"], 1e-6) / bpm_a1)) < c["analysis"]["octave_tol_ln"]
    order = np.argsort(b, kind="stable")
    b, pos = b[order], pos[order]
    keep = np.r_[True, np.diff(b) > 1e-3]
    b, pos = b[keep], pos[keep]
    b, pos, filled, dropped = repair(b, np.clip(pos, 0, max(bpb - 1, 0)), max(bpb, 1))
    return {"beats": b, "pos": pos, "src": src, "bpb": bpb, "meter_ok": bool(meter_ok),
            "octave_ok": bool(octave_ok), "bpm_a1": bpm_a1, "filled": filled, "dropped": dropped}


def consensus_downbeats(t: dict, s: dict | None = None) -> np.ndarray:
    """Consensus downbeat times (§4.1 step 1), before onset refinement."""
    cs = consensus(t, s)
    return cs["beats"][cs["pos"] == 0]


# ---------------------------------------------------------------------------------------------
# percussive onsets (§4.1 step 2)
# ---------------------------------------------------------------------------------------------
def percussive_mask(mono22: np.ndarray, H: np.ndarray | None = None, P: np.ndarray | None = None
                    ) -> np.ndarray:
    """Soft HPSS percussive mask P^2 / (H^2 + P^2) on the 22.05 kHz, n_fft 2048 / hop 512 grid
    (the bar-feature resolution). Pass H, P when they are already computed."""
    if H is None or P is None:
        import librosa
        S = np.abs(librosa.stft(mono22, n_fft=2048, hop_length=512))
        H, P = librosa.decompose.hpss(S, margin=1.0)
    h2, p2 = H.astype(np.float32) ** 2, P.astype(np.float32) ** 2
    return p2 / (h2 + p2 + 1e-12)


def onset_flux(mono: np.ndarray, sr: int = SR, pmask: np.ndarray | None = None
               ) -> tuple[np.ndarray, float]:
    """Positive log-spectral flux at n_fft 1024 / hop 64 (44.1 kHz), each bin weighted by the
    percussive mask (coarse 22.05 kHz 2048/512 frames, nearest in time; bins above the mask's
    10 kHz row reuse that row). Returns (flux, seconds per flux sample); flux[k] is the rise
    into frame k (centred at k * hop / sr)."""
    import librosa
    n_fft, hop = A["onset_n_fft"], A["onset_hop"]
    chunk = (20 * sr) // hop * hop
    nf = n_fft // 2 + 1
    fine_hz = np.arange(nf) * sr / n_fft
    if pmask is not None:
        rows = np.minimum(np.round(np.minimum(fine_hz, 10000.0) / (22050 / 2048)).astype(int), pmask.shape[0] - 1)
        ratio = (512 / 22050) / (hop / sr)                     # fine frames per coarse frame
    out, prev = [], None
    for s0 in range(0, len(mono), chunk):
        lo = max(0, s0 - n_fft)
        x = mono[lo: s0 + chunk + n_fft]
        S_ = np.log1p(100 * np.abs(librosa.stft(x, n_fft=n_fft, hop_length=hop, center=True)))
        off = (s0 - lo) // hop
        S_ = S_[:, off: off + chunk // hop]
        d = np.maximum(np.diff(S_, axis=1, prepend=S_[:, :1] if prev is None else prev), 0)
        if pmask is not None:
            fr = np.minimum(np.round((s0 // hop + np.arange(S_.shape[1])) / ratio).astype(int), pmask.shape[1] - 1)
            d *= pmask[rows][:, fr]
        out.append(d.sum(axis=0))
        prev = S_[:, -1:]
    return np.concatenate(out)[: len(mono) // hop + 1], hop / sr


def pick_onsets(flux: np.ndarray, dt: float) -> tuple[np.ndarray, np.ndarray]:
    """Clear peaks (>= median + k MAD over 1 s, local max within 30 ms), each timed at the
    steepest point of its rising edge (parabolic sub-sample) plus ONSET_LAG_S. Returns
    (t rounded to 1 ms, strength = peak flux)."""
    from scipy.ndimage import maximum_filter1d, median_filter
    w = int(round(A["onset_mad_win_s"] / dt)) | 1
    dec = 8                                    # running median/MAD on a decimated envelope (fast)
    fd = flux[::dec]
    wd = max(3, (w // dec) | 1)
    md = median_filter(fd, size=wd, mode="nearest")
    madd = median_filter(np.abs(fd - md), size=wd, mode="nearest")
    med = np.repeat(md, dec)[: len(flux)]
    mad = np.repeat(madd, dec)[: len(flux)]
    thr = med + A["onset_mad_k"] * 1.4826 * mad + 1e-9
    peak = (flux >= maximum_filter1d(flux, size=int(0.03 / dt) | 1)) & (flux > thr)
    idx = np.where(peak)[0]
    d = np.diff(flux, prepend=flux[0])
    t, s = [], []
    back = int(0.02 / dt)
    for i in idx:
        lo = max(1, i - back)
        k = lo + int(np.argmax(d[lo: i + 1]))
        frac = 0.0
        if 0 < k < len(d) - 1:
            y0, y1, y2 = d[k - 1], d[k], d[k + 1]
            den = y0 - 2 * y1 + y2
            if den < 0:
                frac = float(np.clip(0.5 * (y0 - y2) / den, -0.5, 0.5))
        t.append((k + frac - 0.5) * dt + ONSET_LAG_S)
        s.append(float(flux[i]))
    t = np.round(np.asarray(t, float), 3)
    s = np.asarray(s, float)
    keep = np.r_[True, np.diff(t) > 0.005] if len(t) else np.zeros(0, bool)
    return t[keep], s[keep]


def onsets(mono: np.ndarray, sr: int = SR, pmask: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Percussive onsets of a mono 44.1 kHz signal: (t, strength)."""
    flux, dt = onset_flux(mono, sr, pmask)
    return pick_onsets(flux, dt)


# ---------------------------------------------------------------------------------------------
# refinement
# ---------------------------------------------------------------------------------------------
def _consistency(t: np.ndarray, ref: np.ndarray, center: np.ndarray, pos: np.ndarray | None,
                 on_t: np.ndarray, on_s: np.ndarray) -> None:
    """In place: a refined beat more than consist_ms off the local line through its refined
    neighbours (+-consist_half beats, per-position groove removed) caught a fill, flam or vocal
    onset instead of the beat. It is re-picked as the strongest clear onset within consist_ms
    of the local prediction, or left unrefined at the lag-corrected detector time. A local line
    (not the global fit) keeps genuine slow tempo drift intact."""
    tol, half = CONSIST_MS / 1000, int(CONSIST_HALF)
    n = len(t)
    idx = np.arange(n, dtype=float)
    ok = ref == 1
    if ok.sum() < 16:
        return
    # global groove: median residual per bar position against a plain line over refined beats
    g = np.zeros(int(pos.max()) + 1 if pos is not None and len(pos) else 1)
    if pos is not None:
        cf = np.polyfit(idx[ok], t[ok], 1)
        res = t - np.polyval(cf, idx)
        for q in range(len(g)):
            m = ok & (pos == q) & (np.abs(res) < 0.04)
            if m.sum() >= 8:
                g[q] = np.median(res[m])
        g -= g[0]
        g[(np.abs(g) > GROOVE_MAX_S) | (np.abs(g) < GROOVE_MIN_S)] = 0.0
    gp = g[pos] if pos is not None else np.zeros(n)
    y = t - gp
    for i in np.where(ok)[0]:
        lo, hi = max(0, i - half), min(n, i + half + 1)
        J = np.r_[lo:i, i + 1:hi]
        J = J[ok[J]]
        if len(J) < 6:
            continue
        cf = np.polyfit(idx[J], y[J], 1)
        r = y[J] - np.polyval(cf, idx[J])
        if np.sum(np.abs(r) < 0.02) >= 6:                  # one robust pass
            J = J[np.abs(r) < 0.02]
            cf = np.polyfit(idx[J], y[J], 1)
        pred = float(np.polyval(cf, i)) + gp[i]
        if abs(t[i] - pred) <= tol:
            continue
        lo_o, hi_o = np.searchsorted(on_t, pred - tol), np.searchsorted(on_t, pred + tol)
        if hi_o > lo_o:
            t[i] = on_t[lo_o + int(np.argmax(on_s[lo_o:hi_o]))]
        else:
            t[i], ref[i] = center[i], 0


def refine_with_onsets(times: np.ndarray, on_t: np.ndarray, on_s: np.ndarray,
                       win_s: float | None = None, pos=None) -> tuple[np.ndarray, np.ndarray, float]:
    """Move each beat to the strongest clear onset within +-win_s. Two passes: the first
    measures the detectors' median lag behind the onsets, the second searches around the
    lag-corrected beat; then a local-consistency pass (see _consistency). Unrefined beats get
    the lag correction too. Returns (t, refined 0/1, lag_s); t stays strictly increasing (a
    colliding refinement is undone)."""
    win = CFG["refine_win_s"] if win_s is None else win_s
    times = np.asarray(times, float)
    on_t, on_s = np.asarray(on_t, float), np.asarray(on_s, float)

    def pick(center: np.ndarray) -> np.ndarray:
        out = np.full(len(center), -1)
        if not len(on_t):
            return out
        lo = np.searchsorted(on_t, center - win - 1e-9)
        hi = np.searchsorted(on_t, center + win + 1e-9)
        for i in np.where(hi > lo)[0]:
            out[i] = lo[i] + int(np.argmax(on_s[lo[i]:hi[i]]))
        return out

    k1 = pick(times)
    ok = k1 >= 0
    lag = float(np.median(on_t[k1[ok]] - times[ok])) if ok.sum() >= 8 else 0.0
    center = times + lag
    k2 = pick(center)
    ref = (k2 >= 0).astype(int)
    t = np.where(ref == 1, on_t[np.maximum(k2, 0)] if len(on_t) else center, center)
    _consistency(t, ref, center, None if pos is None else np.asarray(pos, int), on_t, on_s)
    for _ in range(3):                        # undo refinements that collide with a neighbour
        bad = np.where(np.diff(t) <= 0.05)[0]
        if not len(bad):
            break
        for i in bad:
            for q in (i, i + 1):
                if ref[q]:
                    ref[q], t[q] = 0, center[q]
    if np.any(np.diff(t) <= 0):                # pathological: keep the detector beats
        t, ref = center.copy(), np.zeros(len(t), int)
    return np.round(t, 4), ref, lag


def refine_beats(mono: np.ndarray, sr: int, times, win_s: float | None = None,
                 on: tuple[np.ndarray, np.ndarray] | None = None, pos=None) -> tuple[np.ndarray, np.ndarray]:
    """§4.1 step 2 (contract signature): (refined times, refined flags). `on` = precomputed
    onsets, `pos` = bar positions (enables the groove-aware consistency pass)."""
    on_t, on_s = on if on is not None else onsets(mono, sr)
    t, ref, _ = refine_with_onsets(np.asarray(times, float), on_t, on_s, win_s, pos)
    return t, ref


# ---------------------------------------------------------------------------------------------
# fitted grids and classes (§4.2)
# ---------------------------------------------------------------------------------------------
def fit_grid(times, w, t0: float, t1: float, bpm_hint: float | None = None,
             pos=None, bpb: int | None = None, c: dict = CFG) -> dict | None:
    """Weighted least squares of beat time against beat index over the beats in [t0, t1].

    Model: t_k = phase + k * period + g[pos_k] with g[0] = 0 (a per-bar-position groove, e.g.
    claps on 2 and 4 landing a steady 15-20 ms off the kick line); `pos`/`bpb` None fits the
    plain line. The returned grid (phase + k * period) is therefore anchored on the downbeat
    position, which is what landings and exits use. Outliers > fit_outlier_ms are dropped over
    fit_iters passes. rms_ms is weighted (unrefined beats are 20 ms frame-quantised and weigh
    0.25); max_ms is over kept refined beats (all kept beats when none is refined).
    Returns a Fit (k0..k1 = beat index range used) or None (< min_fit_beats, or a period that
    disagrees with bpm_hint by more than 10 %)."""
    bt = np.asarray(times, float)
    ww = np.asarray(w, float)
    nmin = c["relation"]["min_fit_beats"]
    k = np.where((bt >= t0 - 1e-6) & (bt <= t1 + 1e-6))[0]
    if len(k) < nmin:
        return None
    x, y, wk = k.astype(float), bt[k], ww[k]
    cols = [np.ones(len(k)), x]
    if pos is not None and bpb and bpb > 1:
        pk = np.asarray(pos, int)[k]
        for q in range(1, bpb):
            m = pk == q
            if m.sum() >= 4:
                cols.append(m.astype(float))
    X = np.vstack(cols).T
    tol = c["analysis"]["fit_outlier_ms"] / 1000
    # robust start: the median 64-beat-span period and the median phase, so that a stretch the
    # detector tracked at the wrong spacing cannot drag the first least-squares pass
    m = min(64, len(k) // 2)
    per0 = float(np.median((y[m:] - y[:-m]) / (x[m:] - x[:-m])))
    ph0 = float(np.median(y - x * per0))
    init = np.abs(y - (ph0 + x * per0)) <= tol
    if init.sum() < nmin:
        init = np.ones(len(k), bool)

    def solve(X: np.ndarray):
        # hard-EM on the groove: a beat follows its position's groove offset or sits on the line
        # (the clap that makes the groove is absent in breakdowns), whichever is closer
        L, Gm = X[:, :2], X[:, 2:]
        keep = init.copy()
        on_g = np.ones(len(k), bool)
        iters = c["analysis"]["fit_iters"] + (3 if Gm.shape[1] else 0)   # + assignment passes
        for it in range(iters + 1):
            if keep.sum() < nmin:
                return None
            Xa = np.hstack([L, Gm * on_g[:, None]])
            sw = np.sqrt(wk[keep])
            coef, *_ = np.linalg.lstsq(Xa[keep] * sw[:, None], y[keep] * sw, rcond=None)
            res_l = y - L @ coef[:2]
            res_g = res_l - Gm @ coef[2:]
            og = np.abs(res_g) <= np.abs(res_l)
            res = np.where(og, res_g, res_l)
            new = np.abs(res) <= tol
            if ((new == keep).all() and (og == on_g).all()) or it == iters:
                return coef, res, keep
            keep, on_g = new, og

    out = solve(X)
    if X.shape[1] > 2 and (out is None or np.max(np.abs(out[0][2:])) > GROOVE_MAX_S):
        X = X[:, :2]                           # offsets that large are not a groove: plain line
        out = solve(X)
    while out is not None and X.shape[1] > 2 and np.min(np.abs(out[0][2:])) < GROOVE_MIN_S:
        # an offset below GROOVE_MIN_S is jitter, not groove: drop it (else the either/or
        # assignment would shrink plain jitter) and refit
        X = np.delete(X, 2 + int(np.argmin(np.abs(out[0][2:]))), axis=1)
        out = solve(X)
    if out is None:
        return None
    coef, res, keep = out
    if keep.sum() < nmin:
        return None
    period, phase = float(coef[1]), float(coef[0])
    if period <= 0 or (bpm_hint and abs(math.log((60 / period) / bpm_hint)) > 0.1):
        return None
    r = res[keep] * 1000
    wr = wk[keep]
    refd = wr >= c["analysis"]["fit_w_refined"] - 1e-9
    return {"period_s": round(period, 7), "phase_s": round(phase, 6),
            "rms_ms": round(float(np.sqrt(np.sum(wr * r ** 2) / np.sum(wr))), 3),
            "max_ms": round(float(np.max(np.abs(r[refd] if refd.any() else r))), 3),
            "keep": round(float(keep.mean()), 4), "n": int(keep.sum()),
            "k0": int(k[0]), "k1": int(k[-1])}


def classify(fit: dict | None, F: dict, c: dict = CFG) -> str:
    """locked / verify / free (§4.2). F: anything with meter_ok, octave_ok and bpb (a Feats)."""
    if fit is None or not F.get("meter_ok", True) or not F.get("octave_ok", True) or F.get("bpb", 4) != 4:
        return "free"
    if fit["rms_ms"] <= c["locked_rms_ms"] and fit["max_ms"] <= c["locked_max_ms"] and fit["keep"] >= c["keep_locked"]:
        return "locked"
    if fit["rms_ms"] <= c["verify_rms_ms"] and fit["keep"] >= c["keep_verify"]:
        return "verify"
    return "free"


def beat_weights(refined, c: dict = CFG) -> np.ndarray:
    r = np.asarray(refined)
    return np.where(r == 1, c["analysis"]["fit_w_refined"], c["analysis"]["fit_w_unrefined"])


def fit_window(F: dict, t0: float, t1: float, c: dict = CFG) -> dict:
    """WinFit over [t0, t1] (s) on the track's consensus beats."""
    b = F["beats"]
    fit = fit_grid(b["t"], beat_weights(b["refined"], c), t0, t1, pos=b["pos"], bpb=F["bpb"], c=c)
    return {"t0": round(float(t0), 3), "t1": round(float(t1), 3), "fit": fit, "cls": classify(fit, F, c)}


def fit_bars(F: dict, j0: int, j1: int, c: dict = CFG) -> dict:
    """WinFit over bars [j0, j1] (clamped; bar j1 = its start time, the file end past the last)."""
    bars = np.asarray(F["bars"]["t"], float)
    nb = len(bars)
    t0 = float(bars[min(max(0, j0), nb - 1)])
    t1 = float(bars[j1]) if 0 <= j1 < nb else float(F["duration"])
    return fit_window(F, t0, t1, c)


# ---------------------------------------------------------------------------------------------
# time lookups
# ---------------------------------------------------------------------------------------------
def grid_time(ref, u):
    """Fitted grid: ref_t + u * period_s. `ref` = (ref_t, period_s) or a dict with period_s and
    one of t / land_t / exit_t."""
    if isinstance(ref, dict):
        rt = ref.get("t", ref.get("land_t", ref.get("exit_t")))
        per = ref["period_s"]
    else:
        rt, per = ref
    return rt + np.asarray(u, float) * per if np.ndim(u) else rt + float(u) * per


def refined_time(beats, ref_idx: float, u):
    """Piecewise-linear refined beats τ(ref_idx + u) (the `a_refined`/`b_refined` clock),
    extrapolated at both ends with the mean period of the 4 nearest beats."""
    b = np.asarray(beats, float)
    x = ref_idx + np.asarray(u, float)
    idx = np.arange(len(b), dtype=float)
    y = np.interp(x, idx, b)
    p0 = (b[min(4, len(b) - 1)] - b[0]) / max(min(4, len(b) - 1), 1)
    p1 = (b[-1] - b[max(len(b) - 5, 0)]) / max(min(4, len(b) - 1), 1)
    y = np.where(x < 0, b[0] + x * p0, y)
    y = np.where(x > len(b) - 1, b[-1] + (x - (len(b) - 1)) * p1, y)
    return float(y) if np.ndim(u) == 0 else y


def bar_time(F: dict, j: int, win: dict | None = None) -> float:
    """Native time of bar j: on the window's fitted grid when it is locked/verify, else the
    refined consensus downbeat. Bars past the end are extrapolated by the median bar length."""
    bars = np.asarray(F["bars"]["t"], float)
    bidx = np.asarray(F["bars"]["beat"], int)
    nb = len(bars)
    fit = win.get("fit") if win else None
    if fit and win["cls"] != "free":
        if 0 <= j < nb:
            k = bidx[j]
        else:                                  # past either end: continue the beat count
            k = bidx[-1] + (j - (nb - 1)) * F["bpb"] if j >= nb else bidx[0] + j * F["bpb"]
        return float(fit["phase_s"] + k * fit["period_s"])
    if 0 <= j < nb:
        return float(bars[j])
    bar_s = float(np.median(np.diff(bars))) if nb > 1 else 2.0
    return float(bars[-1] + (j - nb + 1) * bar_s) if j >= nb else float(bars[0] + j * bar_s)
