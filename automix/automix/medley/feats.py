"""Per-track medley features (DESIGN §4, §15): compute, cache, load; exact BS.1770 loudness of
any window; the tau_key calibration; `prep` for the whole folder.

Cache: <data_dir>/medley/feats/<mp3 stem>.json + .npz. The JSON holds the Feats minus its long
arrays (beats.*, onsets.t/strength, kblocks.ms), which live in the .npz with the raw
(un-centred) bar chroma used for key comparisons. A cache entry is valid while its `sig`
("<size>:<mtime>:<analysis version>") and FEATS_VERSION match; it is refreshed (a cheap
re-derivation, no re-analysis) when a complete stem set appears later (AMENDMENTS 2).
`FeatStore.get` returns the Feats with those arrays as numpy arrays (allowed by schema.Feats).

Nothing here runs inside plan(): `prep` (CLI `automix medley prep`) computes the features, one
track per process and at most CFG ops.max_cpu_procs processes, CPU only. It never writes
outside the feats directory.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time

import numpy as np

from . import CFG, FEATS_VERSION
from . import grid as G

SR = 44100
SR22 = 22050
A = CFG["analysis"]
NPZ_KEYS = {"beats": ("t", "refined", "pos", "vox_db", "vox_stem_db"), "onsets": ("t", "strength"),
            "kblocks": ("ms",)}


def _r(x, n=3):
    return None if x is None else round(float(x), n)


def default_data_dir() -> str:
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    return os.environ.get("AUTOMIX_DATA", os.path.join(repo, "data", "automix"))


def _stem_name(path: str) -> str:
    return os.path.splitext(os.path.basename(path))[0]


def stems_dir(data_dir: str, path: str) -> str:
    return os.path.join(data_dir, CFG["stems"]["dir"], _stem_name(path))


def stems_available(data_dir: str, path: str) -> bool:
    """All four stem files exist (each is written atomically by the stems job)."""
    d = stems_dir(data_dir, path)
    return all(os.path.isfile(os.path.join(d, n + CFG["stems"]["ext"])) for n in CFG["stems"]["names"])


def load_structure(data_dir: str, path: str) -> dict | None:
    sp = os.path.join(data_dir, "structure", _stem_name(path) + ".json")
    try:
        with open(sp) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def track_sig(t: dict) -> str:
    st = os.stat(t["path"])
    return f"{st.st_size}:{int(st.st_mtime)}:{t.get('version', 1)}"


# ---------------------------------------------------------------------------------------------
# loudness (§15)
# ---------------------------------------------------------------------------------------------
def kblocks(y: np.ndarray, sr: int = SR) -> np.ndarray:
    """K-weighted mean square (summed over channels, G = 1) of every 400 ms block, 100 ms hop."""
    import pyloudnorm
    meter = pyloudnorm.Meter(sr)
    x = np.atleast_2d(np.asarray(y, np.float64).T).T.copy()
    for f in meter._filters.values():                 # BS.1770 pre-filter + RLB high-pass
        for ch in range(x.shape[1]):
            x[:, ch] = f.apply_filter(x[:, ch])
    p = (x ** 2).sum(axis=1)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    blk, hop = int(round(A["kblock_s"] * sr)), int(round(A["kblock_hop_s"] * sr))
    starts = np.arange(0, len(p) - blk + 1, hop)
    return (cs[starts + blk] - cs[starts]) / blk


def lufs_window(kb, t0: float, t1: float) -> float:
    """BS.1770 integrated loudness (LUFS) over [t0, t1]: the blocks pyloudnorm would use on the
    crop (400 ms every 100 ms from t0, round((T - 0.4) / 0.1) + 1 of them, the last ones truncated
    at t1), each interpolated from the cached 100 ms grid; absolute gate -70 LUFS, relative gate
    -10 LU. `kb` is a KBlocks dict or its `ms` array. -70.0 when nothing passes the gate."""
    if isinstance(kb, dict):
        ms, bs, hs = np.asarray(kb["ms"], float), float(kb["block_s"]), float(kb["hop_s"])
    else:
        ms, bs, hs = np.asarray(kb, float), A["kblock_s"], A["kblock_hop_s"]
    L = CFG["loudness"]
    n = max(1, int(np.round((t1 - t0 - bs) / hs)) + 1)
    st = t0 + hs * np.arange(n)
    z = np.interp(st / hs, np.arange(len(ms)), ms) * np.clip((t1 - st) / bs, 0.0, 1.0)

    def lk(v):
        return -0.691 + 10 * np.log10(np.maximum(v, 1e-20))

    z = z[lk(z) >= L["abs_gate_lufs"]]
    if not len(z):
        return float(L["abs_gate_lufs"])
    rel = lk(z.mean()) + L["rel_gate_lu"]
    z = z[lk(z) > rel]
    return float(lk(z.mean()))


# ---------------------------------------------------------------------------------------------
# HPSS: librosa.decompose.hpss(S, margin=1.0) with an exact numba running median (10x faster)
# ---------------------------------------------------------------------------------------------
_MEDFILT = None


def _medfilt_kernel():
    global _MEDFILT
    if _MEDFILT is None:
        import numba

        @numba.njit(cache=True)
        def refl(i, n):                    # scipy.ndimage mode "reflect": (d c b a | a b c d | d c b a)
            while i < 0 or i >= n:
                i = -i - 1 if i < 0 else 2 * n - i - 1
            return i

        @numba.njit(cache=True)
        def medfilt_rows(x, k):
            m, n = x.shape
            h = k // 2
            out = np.empty_like(x)
            buf = np.empty(k, x.dtype)
            for r in range(m):
                row = x[r]
                for j in range(k):
                    buf[j] = row[refl(j - h, n)]
                buf.sort()
                out[r, 0] = buf[h]
                for i in range(1, n):
                    old = row[refl(i - 1 - h, n)]
                    new = row[refl(i + h, n)]
                    p = np.searchsorted(buf, old)
                    for j in range(p, k - 1):
                        buf[j] = buf[j + 1]
                    q = np.searchsorted(buf[:k - 1], new)
                    for j in range(k - 1, q, -1):
                        buf[j] = buf[j - 1]
                    buf[q] = new
                    out[r, i] = buf[h]
            return out

        _MEDFILT = medfilt_rows
    return _MEDFILT


def hpss(S: np.ndarray, kernel: int = 31) -> tuple[np.ndarray, np.ndarray]:
    """Harmonic / percussive magnitudes, identical to librosa.decompose.hpss(S, margin=1.0)
    (median filters of `kernel` along time / frequency, "reflect" edges, soft masks power 2)."""
    import librosa
    S = np.ascontiguousarray(S, np.float32)
    try:
        med = _medfilt_kernel()
        harm = med(S, kernel)
        perc = np.ascontiguousarray(med(np.ascontiguousarray(S.T), kernel).T)
    except ImportError:
        return librosa.decompose.hpss(S, margin=1.0)
    mh = librosa.util.softmask(harm, perc, power=2.0, split_zeros=False)
    mp = librosa.util.softmask(perc, harm, power=2.0, split_zeros=False)
    return S * mh, S * mp


# ---------------------------------------------------------------------------------------------
# compute
# ---------------------------------------------------------------------------------------------
def _db(v):
    return np.maximum(10 * np.log10(np.maximum(v, 1e-30)), A["db_floor"])


def _seg_means(x: np.ndarray, ft: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """Mean of x[..., frames] over each [edges[i], edges[i+1]) (nearest frame when empty)."""
    lo = np.searchsorted(ft, edges[:-1])
    hi = np.searchsorted(ft, edges[1:])
    cs = np.concatenate([np.zeros(x.shape[:-1] + (1,)), np.cumsum(x, axis=-1)], axis=-1)
    out = np.empty(x.shape[:-1] + (len(lo),))
    for i, (a, b) in enumerate(zip(lo, hi)):
        if b > a:
            out[..., i] = (cs[..., b] - cs[..., a]) / (b - a)
        else:
            k = min(a, x.shape[-1] - 1)
            out[..., i] = x[..., k]
    return out


def _sample_means(cs: np.ndarray, edges_s: np.ndarray, sr: int) -> np.ndarray:
    idx = np.clip(np.round(edges_s * sr).astype(int), 0, len(cs) - 1)
    n = np.maximum(idx[1:] - idx[:-1], 1)
    return (cs[idx[1:]] - cs[idx[:-1]]) / n


def vocal_runs(frames_db: np.ndarray, frame_s: float, beats: np.ndarray, bars_t: np.ndarray,
               thr_db: float, pause_s: float = 0.06, pre_s: float = 0.1) -> np.ndarray:
    """Per bar X: how long (s) the sung line runs on past A's air point t_X - 1/4 beat (where the
    R6 fade ends): 0 when the vocal stem is under thr_db over the pre_s before that point,
    else the time to its first pause of >= pause_s under thr_db (fixer, review v1 musical #4;
    verify V12 measures the same on the rendered join)."""
    on = np.asarray(frames_db, float) >= thr_db
    n = len(on)
    k_pause = max(1, int(round(pause_s / frame_s)))
    out = np.zeros(len(bars_t))
    for k, t in enumerate(np.asarray(bars_t, float)):
        b = int(np.searchsorted(beats, t - 1e-6))
        before = t - beats[b - 1] if b >= 1 else (beats[1] - beats[0] if len(beats) > 1 else 0.5)
        i = int(round((t - 0.25 * before) / frame_s))
        if not 0 < i < n or not on[max(0, i - int(round(pre_s / frame_s))):i].any():
            continue
        quiet = 0
        j = i
        while j < n:
            quiet = quiet + 1 if not on[j] else 0
            if quiet >= k_pause:
                j -= k_pause - 1
                break
            j += 1
        out[k] = (j - i) * frame_s
    return out


def _stem_feats(data_dir: str, path: str, beats: np.ndarray, bar_edges: np.ndarray, mix_ref_db: float
                ) -> tuple[dict, np.ndarray, np.ndarray] | None:
    """stem_rms per bar, vocal-stem level per beat (dB relative to the mix p90 bar level) and the
    vocal run-on past every bar's air point (vocal_runs)."""
    import soundfile as sf
    d = stems_dir(data_dir, path)
    rms, vox_beat, gaps = {}, None, None
    dur = bar_edges[-1]
    beat_edges = np.r_[beats, dur]
    hl = CFG["highlight"]
    try:
        for n in CFG["stems"]["names"]:
            x, sr = sf.read(os.path.join(d, n + CFG["stems"]["ext"]), dtype="float32", always_2d=True)
            m = x.mean(axis=1).astype(np.float64)
            cs = np.concatenate([[0.0], np.cumsum(m * m)])
            rms[n] = [_r(v, 2) for v in _db(_sample_means(cs, bar_edges, sr)) - mix_ref_db]
            if n == "vocals":
                vox_beat = _db(_sample_means(cs, beat_edges, sr)) - mix_ref_db
                fs = float(hl["vocal_gap_frame_s"])
                fr = _db(_sample_means(cs, np.arange(0.0, len(m) / sr + fs, fs), sr)) - mix_ref_db
                gaps = vocal_runs(fr, fs, np.asarray(beats, float), bar_edges[:-1], float(hl["vocal_run_db"]))
    except (OSError, RuntimeError, ValueError):
        return None
    return {k: rms[k] for k in ("drums", "bass", "vocals", "other")}, vox_beat, gaps


def bar_peaks(y: np.ndarray, bars_t: np.ndarray, dur: float) -> list[float]:
    """True peak (4x oversampled, dBFS) of every bar (fixer, review v1 timing #1: the excerpt
    gain must leave the output limiter little to do, see forms.excerpt_gain)."""
    from .dsp import true_peak_env
    env = true_peak_env(y)
    idx = np.clip(np.round(np.r_[bars_t, dur] * SR).astype(int), 0, len(env))
    return [_r(20 * np.log10(max(float(env[a:b].max()) if b > a else 1e-6, 1e-6)), 2)
            for a, b in zip(idx[:-1], idx[1:])]


def compute(t: dict, y: np.ndarray | None = None, data_dir: str | None = None, base: dict | None = None
            ) -> tuple[dict, dict]:
    """Features of one analysed track `t` (an analysis dict with path/id/beats/downbeats/bpm/...).
    Returns (Feats, extras) where extras = {"key_chroma": (nbars, 12) raw bar chroma}.
    `base` = a cached (Feats, extras) of the same file: only the stem features and the landings
    are re-derived (used when stems appear after the first prep)."""
    from .highlights import landings, novelty_sections
    from ..audio import decode
    data_dir = data_dir or default_data_dir()
    path = t["path"]
    have_stems = stems_available(data_dir, path)
    if base is not None:
        F, extras = base
        F = json.loads(json.dumps(_to_lists(F)))
        return _finish(F, extras, t, data_dir, np.asarray(F["beats"]["t"], float),
                       np.asarray(F["bars"]["t"], float), float(F["duration"]), float(extras["mix_ref_db"]),
                       have_stems, landings)
    if y is None:
        y = decode(path)
    dur = len(y) / SR

    s = load_structure(data_dir, path)
    cs = G.consensus(t, s)
    mono = y.mean(axis=1).astype(np.float32)

    # bar features: one HPSS pass at the prototype resolution (22.05 kHz, 2048 / 512). Onsets use
    # the unweighted fine flux: an HPSS mask at this resolution files kick bodies as harmonic and
    # misses most kicks, and the full-rate percussive waveform is 15x slower for the same
    # precision (measured, see grid.py).
    import librosa
    m22 = librosa.resample(mono, orig_sr=SR, target_sr=SR22, res_type="soxr_hq")
    S = np.abs(librosa.stft(m22, n_fft=2048, hop_length=512))
    Hh, Pp = hpss(S)
    on_t, on_s = G.onsets(mono, SR)

    pos = cs["pos"]
    bt, refined, lag = G.refine_with_onsets(cs["beats"], on_t, on_s, pos=pos)
    bar_beat = np.where(pos == 0)[0]
    bars_t = bt[bar_beat]
    nb = len(bars_t)
    if nb < 16:
        raise ValueError(f"only {nb} bars")
    edges = np.r_[bars_t, dur]

    fr = librosa.fft_frequencies(sr=SR22, n_fft=2048)
    ft = librosa.frames_to_time(np.arange(S.shape[1]), sr=SR22, hop_length=512)
    pw, h2, p2 = S ** 2, Hh ** 2, Pp ** 2
    tot, low = pw.sum(0), pw[fr < A["low_hz"]].sum(0)
    vox = h2[(fr > A["vox_hz"][0]) & (fr < A["vox_hz"][1])].sum(0)
    perc, harm = p2.sum(0), h2.sum(0)
    chroma = librosa.feature.chroma_stft(S=h2, sr=SR22, n_fft=2048)
    B = _seg_means(np.vstack([tot, low, vox, perc, harm]), ft, edges)
    rel_d = _db(B[0])
    rel = rel_d - np.percentile(rel_d, 90)
    lrel = _db(B[1]) - np.percentile(_db(B[1]), 90)
    vref = np.percentile(_db(B[2]), 90)
    vrel = _db(B[2]) - vref
    prel = _db(B[3] / np.maximum(B[4], 1e-30))
    Craw = _seg_means(chroma, ft, edges).T                     # (nb, 12)
    C = Craw - Craw[rel > np.percentile(rel, A["chroma_floor_pct"])].mean(0)
    C = C / (np.linalg.norm(C, axis=1, keepdims=True) + 1e-9)
    beat_vox = _db(_seg_means(vox[None], ft, np.r_[bt, dur])[0]) - vref

    # sections, labels, phrase grid
    segs = [x for x in ((s or {}).get("segments") or []) if x["label"] not in ("start", "end")] \
        if G.structure_ok(t, s) else []
    if segs:
        sections = [{"start": _r(x["start"]), "end": _r(x["end"]), "label": x["label"],
                     "bar": int(np.argmin(np.abs(bars_t - x["start"])))} for x in segs]
    else:
        sections = novelty_sections(bars_t, dur, rel, lrel, prel, vrel, C)
    label = ["unlabelled"] * nb
    for x in sections:
        for i in range(nb):
            if x["start"] - 0.1 <= bars_t[i] < x["end"] - 0.1:
                label[i] = x["label"]
    bar_s = float(np.median(np.diff(bars_t)))
    P = 1
    while P * bar_s < CFG["phrase_min_s"]:
        P *= 2
    votes = np.zeros(P)
    for x in sections:
        if x["bar"] > 0:
            votes[x["bar"] % P] += 1
    phase = int(np.argmax(votes))
    conf = float(votes[phase] / max(1.0, votes.sum()))
    loud = np.where(rel > A["last_loud_db"])[0]
    last_loud = int(loud[-1]) if len(loud) else nb - 1
    active = (float(bars_t[loud[0]]) if len(loud) else 0.0, float(edges[last_loud + 1]))

    # time-domain bar level: the reference for stem levels
    msq = np.concatenate([[0.0], np.cumsum(mono.astype(np.float64) ** 2)])
    mix_ref = float(np.percentile(_db(_sample_means(msq, edges, SR)), 90))

    # onset strength at body downbeats
    win = CFG["refine_win_s"]
    ds = []
    for x in bars_t[(bars_t >= active[0]) & (bars_t < active[1])]:
        k = np.where(np.abs(on_t - x) <= win)[0]
        if len(k):
            ds.append(on_s[k].max())
    med_down = float(np.median(ds)) if ds else 1.0

    st = os.stat(path)
    F = {
        "version": FEATS_VERSION, "track": t["id"], "file": os.path.basename(path),
        "sig": f"{st.st_size}:{int(st.st_mtime)}:{t.get('version', 1)}", "duration": _r(dur),
        "bpb": int(cs["bpb"]), "bpm": float(t["bpm"]), "bpm_bt": float(t["bpm"]), "bpm_a1": cs["bpm_a1"],
        "meter_ok": cs["meter_ok"], "octave_ok": cs["octave_ok"], "grid_src": cs["src"],
        "grid_class": "free", "fit": None, "active": [_r(active[0]), _r(active[1])],
        "beats": {"t": [float(x) for x in np.round(bt, 3)], "refined": [int(x) for x in refined], "pos": [int(x) for x in pos],
                  "vox_db": [_r(x, 2) for x in beat_vox]},
        "bars": {"t": [_r(x) for x in bars_t], "beat": [int(x) for x in bar_beat],
                 "rel_db": [_r(x, 2) for x in rel], "low_db": [_r(x, 2) for x in lrel],
                 "perc_db": [_r(x, 2) for x in prel], "vox_db": [_r(x, 2) for x in vrel],
                 "chroma": [[_r(v, 4) for v in row] for row in C], "label": label},
        "sections": sections, "phrase": {"P": P, "phase": phase, "conf": _r(conf, 3)},
        "last_loud_bar": last_loud,
        "onsets": {"t": [_r(x) for x in on_t], "strength": [float(f"{v:.6g}") for v in on_s],
                   "median_down_strength": float(f"{med_down:.6g}")},
        "kblocks": {"block_s": A["kblock_s"], "hop_s": A["kblock_hop_s"],
                    "ms": [float(f"{v:.6g}") for v in kblocks(y)]},
        "stems": False, "landings": [],
    }
    # bars.t == beats.t[bars.beat] exactly, after rounding
    F["bars"]["t"] = [F["beats"]["t"][k] for k in F["bars"]["beat"]]
    fit = G.fit_grid(F["beats"]["t"], G.beat_weights(refined), *active, pos=pos, bpb=cs["bpb"])
    F["fit"] = fit
    F["grid_class"] = G.classify(fit, F)
    if fit:
        F["bpm"] = _r(60 / fit["period_s"], 3)
    extras = {"key_chroma": Craw.astype(np.float32), "mix_ref_db": mix_ref,
              "lag_ms": _r(lag * 1000, 2), "filled": cs["filled"], "dropped": cs["dropped"]}
    return _finish(F, extras, t, data_dir, np.asarray(F["beats"]["t"]), np.asarray(F["bars"]["t"]),
                   dur, mix_ref, have_stems, landings, y)


def _finish(F, extras, t, data_dir, bt, bars_t, dur, mix_ref, have_stems, landings, y=None):
    F["stems"] = False
    F["bars"].pop("stem_rms", None)
    F["bars"].pop("vox_gap_s", None)
    F["bars"].pop("vox_run_s", None)
    F["beats"].pop("vox_stem_db", None)
    F.pop("vocal_track", None)
    if have_stems:
        got = _stem_feats(data_dir, t["path"], bt, np.r_[bars_t, dur], mix_ref)
        if got is not None:
            F["bars"]["stem_rms"] = got[0]
            F["beats"]["vox_stem_db"] = [_r(v, 2) for v in got[1]]
            F["bars"]["vox_run_s"] = [_r(v, 2) for v in got[2]]
            v = np.asarray(got[0]["vocals"], float)
            loud = np.asarray(F["bars"]["rel_db"], float) > -10
            F["vocal_track"] = bool(len(v) and np.percentile(v[loud] if loud.any() else v, 75)
                                    >= CFG["highlight"]["vocal_track_db"])
            F["stems"] = True
    F["bars"].pop("peak_db", None)
    if y is None:
        from ..audio import decode
        try:
            y = decode(t["path"])
        except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError):
            y = None
    if y is not None and len(y):
        F["bars"]["peak_db"] = bar_peaks(y, np.asarray(bars_t, float), float(dur))
    F["landings"] = landings(t, F)
    return F, extras


def _to_lists(F: dict) -> dict:
    out = dict(F)
    for grp, keys in NPZ_KEYS.items():
        if grp in F:
            out[grp] = dict(F[grp])
            for k in keys:
                if k in F[grp] and isinstance(F[grp][k], np.ndarray):
                    out[grp][k] = F[grp][k].tolist()
    return out


# ---------------------------------------------------------------------------------------------
# store
# ---------------------------------------------------------------------------------------------
class FeatStore:
    """Read/write the feats cache. get(t) -> Feats | None (never computes)."""

    def __init__(self, root: str, data_dir: str | None = None):
        self.root = root
        self.data_dir = data_dir or os.path.dirname(os.path.dirname(os.path.abspath(root)))
        self._memo: dict[str, tuple[int, dict, dict]] = {}

    def paths(self, t) -> tuple[str, str]:
        stem = _stem_name(t["path"] if isinstance(t, dict) else t)
        return os.path.join(self.root, stem + ".json"), os.path.join(self.root, stem + ".npz")

    def _load(self, t) -> tuple[dict, dict] | None:
        jp, npz = self.paths(t)
        try:
            mt = os.stat(jp).st_mtime_ns
        except OSError:
            return None
        hit = self._memo.get(jp)
        if hit and hit[0] == mt:
            return hit[1], hit[2]
        try:
            with open(jp) as fh:
                F = json.load(fh)
            z = np.load(npz)
        except (OSError, ValueError):
            return None
        for grp, keys in NPZ_KEYS.items():
            for k in keys:
                name = f"{grp}.{k}"
                if name in z.files:
                    F[grp][k] = z[name]
        extras = {"key_chroma": z["key_chroma"] if "key_chroma" in z.files else None,
                  **F.pop("_extras", {})}
        self._memo[jp] = (mt, F, extras)
        if extras["key_chroma"] is not None:
            _KEY_CHROMA[(F["track"], F["sig"])] = extras["key_chroma"]
        return F, extras

    def get(self, t) -> dict | None:
        """Cached Feats for track dict `t` (or an mp3 path) when current, else None."""
        got = self._load(t)
        if got is None:
            return None
        F = got[0]
        if F.get("version") != FEATS_VERSION:
            return None
        if isinstance(t, dict) and "path" in t:
            try:
                if F.get("sig") != track_sig(t):
                    return None
            except OSError:
                return None
        return F

    def extras(self, t) -> dict | None:
        got = self._load(t)
        return got[1] if got else None

    def key_chroma(self, t) -> np.ndarray | None:
        ex = self.extras(t)
        return None if ex is None else ex.get("key_chroma")

    def fresh(self, t: dict) -> bool:
        """Current and in step with the stems on disk (a stem set that appeared since)."""
        F = self.get(t)
        return F is not None and bool(F["stems"]) == stems_available(self.data_dir, t["path"])

    def missing(self, tracks: list[dict]) -> list[str]:
        """Ids of tracks with no usable features (they are excluded; §4 medley.needs_prep)."""
        return [t["id"] for t in tracks if self.get(t) is None]

    def stale(self, tracks: list[dict]) -> list[dict]:
        return [t for t in tracks if not self.fresh(t)]

    def put(self, F: dict, extras: dict) -> None:
        """Atomic write: .npz first, then the JSON that makes the entry visible."""
        os.makedirs(self.root, exist_ok=True)
        jp, npz = self.paths(F["file"])
        arrays = {}
        J = json.loads(json.dumps(_to_lists(F)))
        for grp, keys in NPZ_KEYS.items():
            for k in keys:
                if k in J[grp]:
                    v = np.asarray(J[grp].pop(k))
                    arrays[f"{grp}.{k}"] = v.astype(np.int32 if v.dtype.kind in "iub" else np.float64)
        arrays["key_chroma"] = np.asarray(extras["key_chroma"], np.float32)
        J["_extras"] = {k: v for k, v in extras.items() if k != "key_chroma"}
        tmp = npz + ".tmp.npz"
        np.savez_compressed(tmp, **arrays)
        os.replace(tmp, npz)
        with open(jp + ".tmp", "w") as fh:
            json.dump(J, fh, separators=(",", ":"))
        os.replace(jp + ".tmp", jp)
        self._memo.pop(jp, None)

    def version(self) -> str:
        """Changes whenever any cache entry changes (part of the plan key)."""
        try:
            ents = sorted((e.name, e.stat().st_mtime_ns) for e in os.scandir(self.root) if e.name.endswith(".json"))
        except OSError:
            ents = []
        return hashlib.sha1(json.dumps([FEATS_VERSION, ents]).encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------------------------
# tau_key calibration (§7 key rule)
# ---------------------------------------------------------------------------------------------
def _key_vec(kc: np.ndarray, bars: slice) -> np.ndarray | None:
    """Pitch-class profile of some bars, centred across its 12 bins and unit-normed, so the
    cosine of two profiles is their Pearson correlation (key-profile matching)."""
    v = np.asarray(kc, float)[bars]
    if not len(v):
        return None
    v = v.mean(0)
    v = v - v.mean()
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else None


# raw (un-centred) bar chroma of every Feats a FeatStore has loaded in this process, keyed by
# (track, sig): relation() compares key profiles with it (the track-centred Feats bar chroma
# carries no key information: AUC 0.51 against Camelot compatibility on this folder)
_KEY_CHROMA: dict[tuple[str, str], np.ndarray] = {}


def key_chroma_of(F: dict) -> np.ndarray | None:
    return _KEY_CHROMA.get((F.get("track"), F.get("sig")))


def key_chroma_cos(kca: np.ndarray, kcb: np.ndarray, a_bars: slice, b_bars: slice) -> float | None:
    va, vb = _key_vec(kca, a_bars), _key_vec(kcb, b_bars)
    return None if va is None or vb is None else float(va @ vb)


def calibrate_tau_key(store: FeatStore, tracks: list[dict], report: dict | None = None) -> float:
    """tau_key = the chroma cosine that separates Camelot-compatible pairs (distance <= 1) from
    clashing ones (distance >= 3), measured over every pair of tracks on their best landing's
    body (A = the 4 body bars before its exit, B = the 4 bars from its landing): the threshold
    maximising Youden's J, clamped to [0.1, 0.9]. Falls back to tau_key_default with fewer than
    20 pairs in either group. `report` (a dict) receives the distributions."""
    from ..plan import camelot_distance
    prof = {}
    for t in tracks:
        F, kc = store.get(t), store.key_chroma(t)
        if F is None or kc is None or not F["landings"] or "?" in (t.get("camelot") or "?"):
            continue
        ld = F["landings"][0]
        X = ld["exits"][0]["bar"]
        prof[t["id"]] = (t["camelot"], _key_vec(kc, slice(max(0, X - 4), X)), _key_vec(kc, slice(ld["bar"], ld["bar"] + 4)))
    ok, clash = [], []
    ids = sorted(prof)
    for a in ids:
        for b in ids:
            if a == b:
                continue
            ca, va, _ = prof[a]
            cb, _, vb = prof[b]
            if va is None or vb is None:
                continue
            d = camelot_distance(ca, cb)
            cos = float(va @ vb)
            if d <= 1:
                ok.append(cos)
            elif d >= 3:
                clash.append(cos)
    tau, how = CFG["tau_key_default"], "default (too few pairs)"
    if len(ok) >= 20 and len(clash) >= 20:
        cand = np.linspace(-0.5, 0.95, 146)
        ok_a, cl_a = np.asarray(ok), np.asarray(clash)
        J = [(np.mean(ok_a >= x) - np.mean(cl_a >= x), x) for x in cand]
        best = max(J)
        tau, how = float(np.clip(round(best[1], 2), 0.1, 0.9)), f"Youden J {best[0]:.2f}"
    if report is not None:
        def q(v):
            return {k: _r(np.percentile(v, p), 3) for k, p in (("p10", 10), ("p50", 50), ("p90", 90))} if v else {}
        auc = None
        if ok and clash:
            o, cl = np.asarray(ok), np.asarray(clash)
            auc = _r(np.mean(o[:, None] > cl[None, :]) + 0.5 * np.mean(o[:, None] == cl[None, :]), 3)
        report.update({"tau_key": tau, "method": how, "pairs_compatible": len(ok), "pairs_clash": len(clash),
                       "cos_compatible": q(ok), "cos_clash": q(clash), "auc": auc,
                       "accept_compatible": _r(np.mean(np.asarray(ok) >= tau), 3) if ok else None,
                       "accept_clash": _r(np.mean(np.asarray(clash) >= tau), 3) if clash else None})
    return tau


def tau_key(store: FeatStore) -> float:
    """The calibrated tau_key recorded by prep in feats/README.json (CFG default otherwise)."""
    try:
        with open(os.path.join(store.root, "README.json")) as fh:
            return float(json.load(fh)["tau_key"]["tau_key"])
    except (OSError, ValueError, KeyError, TypeError):
        return float(CFG["tau_key_default"])


# ---------------------------------------------------------------------------------------------
# prep (CLI) and the calibration record
# ---------------------------------------------------------------------------------------------
def _prep_one(t: dict, root: str, data_dir: str, force: bool) -> dict:
    """Worker: compute (or refresh for new stems) one track and write its cache entry."""
    import warnings
    warnings.filterwarnings("ignore")
    t0, c0 = time.time(), time.process_time()
    store = FeatStore(root, data_dir)
    base = None
    if not force:
        F0 = store.get(t)
        if F0 is not None:
            base = (F0, store.extras(t))
    F, extras = compute(t, data_dir=data_dir, base=base)
    from .schema import validate_feats
    iss = validate_feats(F)
    if iss:
        raise ValueError(f"invalid feats: {iss[:3]}")
    store.put(F, extras)
    return {"id": t["id"], "file": F["file"], "cls": F["grid_class"], "seconds": round(time.time() - t0, 1),
            "cpu": round(time.process_time() - c0, 1),
            "refresh": base is not None, "stems": F["stems"]}


def grid_report(store: FeatStore, tracks: list[dict]) -> dict:
    """Class histogram, free reasons and the refined-fit rms distribution (§4.2 gate)."""
    hist = {"locked": 0, "verify": 0, "free": 0}
    reasons: dict[str, int] = {}
    rms, rows = [], []
    for t in tracks:
        F = store.get(t)
        if F is None:
            continue
        hist[F["grid_class"]] += 1
        fit = F["fit"]
        if fit:
            rms.append(fit["rms_ms"])
        why = []
        if F["grid_class"] == "free":
            if not F["meter_ok"]:
                why.append("meter")
            if not F["octave_ok"]:
                why.append("octave")
            if F["bpb"] != 4:
                why.append(f"bpb{F['bpb']}")
            if fit is None:
                why.append("no_fit")
            elif not why:
                why.append("fit")
            for w in why:
                reasons[w] = reasons.get(w, 0) + 1
        ex = store.extras(t) or {}
        rows.append({"file": F["file"], "cls": F["grid_class"], "bpm": F["bpm"], "bpb": F["bpb"],
                     "rms_ms": fit and fit["rms_ms"], "max_ms": fit and fit["max_ms"], "keep": fit and fit["keep"],
                     "refined": _r(np.mean(np.asarray(F["beats"]["refined"])), 3), "lag_ms": ex.get("lag_ms"),
                     "free_why": why, "stems": F["stems"]})
    # the gate's binding criterion and the classes joins actually use (§7 windows)
    only_max, win_b, win_a = [], {"locked": 0, "verify": 0, "free": 0}, {"locked": 0, "verify": 0, "free": 0}
    for t in tracks:
        F = store.get(t)
        if F is None:
            continue
        fit = F["fit"]
        if F["grid_class"] == "verify" and fit and fit["rms_ms"] <= CFG["locked_rms_ms"] \
                and fit["keep"] >= CFG["keep_locked"] and fit["max_ms"] > CFG["locked_max_ms"]:
            only_max.append(F["file"])
        if F["landings"]:
            win_b[F["landings"][0]["win"]["cls"]] += 1
            win_a[F["landings"][0]["exits"][0]["win"]["cls"]] += 1
    edges = [0, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40]
    counts = np.histogram(rms, bins=edges + [1e9])[0].tolist() if rms else []
    return {"class_hist": hist, "free_reasons": reasons,
            "verify_only_by_max_ms": {"n": len(only_max), "files": sorted(only_max)},
            "window_class_hist": {"b_landing_best": win_b, "a_exit_best": win_a},
            "rms_ms_hist": {f"{a}-{b}" if b < 1e9 else f">{a}": n
                            for a, b, n in zip(edges, edges[1:] + [1e9], counts)},
            "rms_ms_quantiles": {k: _r(np.percentile(rms, p), 2) for k, p in (("p25", 25), ("p50", 50), ("p75", 75), ("p90", 90))} if rms else {},
            "tracks": sorted(rows, key=lambda r: r["file"])}


def write_readme(store: FeatStore, tracks: list[dict], run: dict | None = None) -> dict:
    rep = grid_report(store, tracks)
    runs = []
    try:
        with open(os.path.join(store.root, "README.json")) as fh:
            runs = list(json.load(fh).get("runs") or [])
    except (OSError, ValueError):
        pass
    if run and run.get("computed"):
        runs = (runs + [{**run, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}])[-10:]
    kr: dict = {}
    calibrate_tau_key(store, tracks, kr)
    n_locked = rep["class_hist"]["locked"]
    doc = {
        "feats_version": FEATS_VERSION, "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "thresholds": {k: CFG[k] for k in ("locked_rms_ms", "locked_max_ms", "verify_rms_ms", "keep_locked", "keep_verify")},
        "locked_rms_ms_chosen": CFG["locked_rms_ms"],
        "gate": {"min_locked": 30, "locked": n_locked, "passed": n_locked >= 30,
                 "note": ("locked_rms_ms kept at 6: it sits at the knee of the rms histogram (p75 ~6 ms); "
                          "the binding criterion is max_ms <= 15 over the whole active span (hundreds of "
                          "beats), see verify_only_by_max_ms; join windows are mostly locked, see "
                          "window_class_hist. No threshold changed.")},
        "method": ("fit = weighted LSQ with a per-bar-position groove term anchored on the downbeat; "
                   "unrefined beats corrected by the track's median detector lag and weighted 0.25; "
                   "rms weighted, max over refined beats"),
        **rep, "tau_key": kr, "run": run, "runs": runs,
    }
    os.makedirs(store.root, exist_ok=True)
    with open(os.path.join(store.root, "README.json.tmp"), "w") as fh:
        json.dump(doc, fh, indent=1)
    os.replace(os.path.join(store.root, "README.json.tmp"), os.path.join(store.root, "README.json"))
    return doc


_THREAD_VARS = ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "MKL_NUM_THREADS",
                "NUMBA_NUM_THREADS")


def _run_pool(todo, slim, root, data_dir, force, workers, log, done, failed) -> None:
    from concurrent.futures import ProcessPoolExecutor, as_completed
    import multiprocessing as mp
    if not todo:
        return
    with ProcessPoolExecutor(workers, mp_context=mp.get_context("spawn")) as ex:
        futs = {ex.submit(_prep_one, t, root, data_dir, force): t for t in slim}
        for i, f in enumerate(as_completed(futs), 1):
            t = futs[f]
            try:
                r = f.result()
                done.append(r)
                log(f"[{i}/{len(todo)}] {r['cls']:6s} {r['seconds']:5.1f}s ({r['cpu']:4.1f}s cpu)"
                    f"{' refresh' if r['refresh'] else ''}"
                    f"{' stems' if r['stems'] else ''}  {r['file']}")
            except Exception as exc:  # keep going: a failed track is reported, never fatal
                failed.append({"id": t["id"], "file": t["file"], "error": str(exc)[:300]})
                log(f"[{i}/{len(todo)}] FAILED {t['file']}: {exc}")


def prep(folder: str, data_dir: str | None = None, workers: int = 3, log=print, force: bool = False,
         only: list[str] | None = None, rederive: bool = False) -> dict:
    """`automix medley prep <folder>`: compute and cache features for every analysed track of
    the folder (resumable: current entries are skipped, entries whose stems appeared since are
    refreshed), at most CFG ops.max_cpu_procs worker processes, then write feats/README.json
    (class histogram, rms distribution, tau_key). force = recompute everything; rederive = re-derive
    stem features and landings of every cached track (no audio analysis: after a highlights
    change). Returns the README document."""
    from .load import load_tracks
    data_dir = data_dir or default_data_dir()
    root = os.path.join(data_dir, "medley", "feats")
    store = FeatStore(root, data_dir)
    tracks = load_tracks(folder, data_dir, metadata=False)
    todo = [t for t in tracks if force or rederive or not store.fresh(t)]
    if only:
        todo = [t for t in todo if any(o in t["id"] or o in t["file"] for o in only)]
    workers = max(1, min(int(workers), CFG["ops"]["max_cpu_procs"]))
    log(f"medley prep: {len(tracks)} tracks, {len(todo)} to compute, {workers} worker(s)")
    t0, done, failed = time.time(), [], []
    slim = [{k: v for k, v in t.items() if k in ("path", "id", "file", "beats", "downbeats", "beats_per_bar", "bpm",
                                                  "duration", "version", "title", "artist")} for t in todo]
    env0 = {k: os.environ.get(k) for k in _THREAD_VARS}
    os.environ.update({k: "1" for k in _THREAD_VARS})       # one core per worker process
    try:
        _run_pool(todo, slim, root, data_dir, force, workers, log, done, failed)
    finally:
        for k, v in env0.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    run = {"computed": len(done), "refreshed": sum(r["refresh"] for r in done), "failed": failed,
           "wall_s": round(time.time() - t0, 1), "cpu_s": round(sum(r["cpu"] for r in done), 1),
           "workers": workers}
    doc = write_readme(store, tracks, run)
    h = doc["class_hist"]
    log(f"classes: locked {h['locked']}, verify {h['verify']}, free {h['free']}; "
        f"tau_key {doc['tau_key'].get('tau_key')}; {run['wall_s']} s wall, {run['cpu_s']} s worker CPU")
    return doc
