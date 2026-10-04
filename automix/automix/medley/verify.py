"""Verification of rendered medley joins (DESIGN §16) and of the whole mix (V13).

Everything here runs on the CPU. Beat This is used through `automix.analyze._beats`, with a
CPU model installed first (never MPS/Metal); `bt_beats` below is the only entry point. Onsets
come from E1's grid.onsets (the Feats detector), so strengths and times compare with Feats.

Inputs of `verify_join` are what `engine.render_join(..., sink=...)` leaves behind: the region
`out` and its parts `pa` / `pb` (unlimited, track gains applied, covering region seconds
[-XF, T + XF], so sample i <-> t = i / sr - xf / sr) and the compiled `Program`. Optional
context makes the loudness and Beat This checks exact:
  pre / post  native, gained audio just before the region (ends at A's `a_out_start`) and just
              after it (starts at B's `b_in_end`), i.e. what render_clip puts around the region;
  ref         {"a" | "b": body_ref(...)}: body levels measured on the native excerpts.
Without them the checks fall back to what the region itself shows (documented per check).

Check codes are "V1".."V13" (§16.1). `hard` selects the checks whose failure fails the join;
a failing check outside `hard` is reported as a warn. HARD_PHASE1 is the Phase 1 set; HARD_ALL
is every hard check of §16.1 (V5 fails only below 0, V12 is warn-only, V13 is set level).

Interpretations of the §16.1 table (documented deviations are marked "note"):
  V1  note: "B's onset nearest t(0)" is the strongest B onset within +-50 ms of t(0) (else the
      nearest): the clip opening 3 ms early on sustained material is an onset of its own.
  V3  note: a cross-part pair 20-90 ms apart is not a flam when either onset also has a
      coincident (< flam_ms[0] / 2) partner in the other part: two kits locked on one grid
      always produce such pairs from 32nd/swing elements.
  V6  the "median over +-100 ms" is the median of 10 ms-window maxima of |diff(HP 8 kHz)|,
      so a noise-like signal scores about 1 and a click scores >> 4; a splice is exempt when
      a *source* onset (splice.onset or expected onsets) lies within 5 ms of it.
  V8  planned step = short-term loudness (3 s, K-weighted) of B's native landing window minus
      A's native window before the region, both from the Feats kblocks plus the track gains,
      unless Program.expect.step_planned_lu is set. note: a momentary jump compares beat-long
      maxima of the 400 ms momentary series (a bare 400 ms window swings ~7 LU as it gains
      and loses a kick); only upward, unplanned jumps count.
  V2a/V10 note: "strong" onsets are >= max(median, 5 % of the p95 strength).
  V10 the bar tempo is the median ratio of measured to planned inter-onset intervals on the
      output grid, so planned ramps and steps cancel out; ramp and silence bars are skipped.
  V11 note: A's part is measured over the last quarter beat [t(-1/4), t(0)), the window where
      R6's two sanctioned air shapes meet (the low kill at -1/2 + the top fade over the last
      beat is ~-17 dB there; a gesture or cut ending by -1/4 is silent). The literal RMS over
      [-1, 0) fails both: a cut at -1/4 (cut_on_one, the universal fallback) measures ~-1.3 dB
      and a kick on beat -1 under the cos fade ~-3 dB. V9 accepts silence in [-1, 0) as air.
"""

from __future__ import annotations

import copy
import json
import os
import subprocess
import tempfile
import threading

import numpy as np

from . import CFG
from . import schema as S
from ..audio import FFMPEG, SR

V = CFG["verify"]
DB_FLOOR = float(CFG["analysis"]["db_floor"])
CODES = ("V1", "V2a", "V2b", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12")
# fixer (review v1 musical #4): V12 is hard once it runs on the stems (build passes them); it
# fails only a cut through a sung line with no echo throw, which §5.3 forbids
HARD_ALL = ("V1", "V2a", "V2b", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12")
HARD_PHASE1 = ("V1", "V3", "V4", "V6", "V7", "V8", "V11", "V12")


# ---------------------------------------------------------------------------------------------
# small DSP helpers
# ---------------------------------------------------------------------------------------------
def _mono(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    return x.mean(axis=1) if x.ndim == 2 else x


def _db(v: float) -> float:
    return float(max(DB_FLOOR, 20 * np.log10(max(float(v), 1e-12))))


def rms_db(x: np.ndarray) -> float:
    """RMS level of the mono sum in dBFS (floored)."""
    m = _mono(x)
    return _db(np.sqrt(np.mean(m.astype(np.float64) ** 2))) if len(m) else DB_FLOOR


_sos: dict[tuple, np.ndarray] = {}


def _filt(x: np.ndarray, kind: str, hz, order: int = 4, sr: int = SR) -> np.ndarray:
    """Zero-phase Butterworth filter ("lowpass" / "highpass" / "bandpass")."""
    from scipy.signal import butter, sosfiltfilt
    key = (kind, tuple(np.atleast_1d(hz)), order, sr)
    if key not in _sos:
        _sos[key] = butter(order, hz, btype=kind, fs=sr, output="sos")
    if len(x) < 64:
        return np.zeros_like(x)
    return sosfiltfilt(_sos[key], x, axis=0).astype(np.float32)


def block_db(x: np.ndarray, block: int) -> np.ndarray:
    """RMS dB of consecutive non-overlapping blocks of the mono sum."""
    m = _mono(x).astype(np.float64)
    n = len(m) // block
    if n == 0:
        return np.zeros(0)
    ms = (m[: n * block].reshape(n, block) ** 2).mean(axis=1)
    return np.maximum(DB_FLOOR, 10 * np.log10(np.maximum(ms, 1e-24)))


def kweight(y: np.ndarray, sr: int = SR) -> np.ndarray:
    """BS.1770 K-weighted signal (pre-filter + RLB), per channel, float64."""
    import pyloudnorm
    x = np.atleast_2d(np.asarray(y, dtype=np.float64).T).T.copy()
    for f in pyloudnorm.Meter(sr)._filters.values():
        for ch in range(x.shape[1]):
            x[:, ch] = f.apply_filter(x[:, ch])
    return x


def _loud(ms: float) -> float:
    return float(-0.691 + 10 * np.log10(max(ms, 1e-12)))


def kblocks(y: np.ndarray, sr: int = SR, block_s: float | None = None,
            hop_s: float | None = None) -> list[float]:
    """K-weighted mean square (sum over channels) per block, the Feats `kblocks` layout."""
    block_s = block_s or float(CFG["analysis"]["kblock_s"])
    hop_s = hop_s or float(CFG["analysis"]["kblock_hop_s"])
    p = (kweight(y, sr) ** 2).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    blk, hop = int(round(block_s * sr)), int(round(hop_s * sr))
    st = np.arange(0, max(0, len(p) - blk + 1), hop)
    return ((c[st + blk] - c[st]) / blk).tolist()


def kblock_short(kb: dict, t0: float, t1: float) -> float | None:
    """Loudness (LUFS, ungated) of the Feats kblocks fully inside [t0, t1]."""
    ms = kb.get("ms")                            # a list (JSON) or an array (FeatStore .npz)
    ms = np.asarray([] if ms is None else ms, dtype=float)
    blk, hop = float(kb.get("block_s", 0.4)), float(kb.get("hop_s", 0.1))
    i0 = max(0, int(np.ceil(t0 / hop - 1e-9)))
    i1 = int(np.floor((t1 - blk) / hop + 1e-9))
    z = ms[i0: i1 + 1]
    return _loud(float(z.mean())) if len(z) else None


def true_peak_db(y: np.ndarray, over: int = 4) -> float:
    """True peak (dBTP) with `over`x polyphase oversampling."""
    from scipy.signal import resample_poly
    if len(y) == 0:
        return DB_FLOOR
    up = resample_poly(np.asarray(y, dtype=np.float64), over, 1, axis=0)
    return _db(np.max(np.abs(up)))


# ---------------------------------------------------------------------------------------------
# onsets: E1's detector (grid.onsets), the one the Feats onsets come from
# ---------------------------------------------------------------------------------------------
def hpss(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(harmonic, percussive) mono components (librosa HPSS, margin 1): V3 levels, V5 chroma."""
    import librosa
    m = _mono(x)
    if len(m) < 4096:
        return m.copy(), m.copy()
    h, p = librosa.effects.hpss(np.ascontiguousarray(m), margin=1.0)
    return h.astype(np.float32), p.astype(np.float32)


def onsets(x: np.ndarray, sr: int = SR) -> tuple[np.ndarray, np.ndarray]:
    """Onsets of x (a part, or its drums stem): (times in s from the array start, strengths).
    note: this is grid.onsets, the positive log flux (n_fft 1024, hop 64) that the Feats onsets
    and median_down_strength come from, so V1 strengths and V2b times compare like with like.
    §16 asks for the percussive component; E1 measured that an HPSS mask misses kick bodies
    and a full-rate percussive signal is 15x slower, so the Feats use the plain flux."""
    from .grid import onsets as _grid_onsets
    assert sr == SR, "onsets expect 44.1 kHz"
    return _grid_onsets(np.ascontiguousarray(_mono(x)), sr)


# ---------------------------------------------------------------------------------------------
# Beat This on the CPU (reuses automix.analyze._beats)
# ---------------------------------------------------------------------------------------------
_bt_lock = threading.Lock()
_bt_own = None


def bt_model():
    """The private CPU Beat This tracker (REVIEW-external-1 #7): never analyze._beat_model, so
    the server's own analysis keeps the device it chose."""
    global _bt_own
    with _bt_lock:
        if _bt_own is None:
            from beat_this.inference import Audio2Beats
            _bt_own = Audio2Beats(checkpoint_path="final0", device="cpu")
        return _bt_own


def bt_beats(mono: np.ndarray, sr: int = SR) -> tuple[np.ndarray, np.ndarray]:
    """(beats, downbeats) in s from Beat This on the CPU (a private model instance)."""
    assert sr == SR
    m = bt_model()
    b, d = m(np.ascontiguousarray(_mono(mono)), SR)
    return np.asarray(b, float), np.asarray(d, float)


def bt_lag(track: dict | None, F: dict | None) -> float:
    """Beat This's systematic lag on a track (lead addition B): the median of (the analysis
    cache's Beat This beat - the nearest Feats refined beat) in s, over refined beats only.
    Beat This beats are 20 ms-quantised and run 15-30 ms late on attack-time beats; V1 and
    V13 subtract this before comparing. 0 when either side is missing."""
    try:
        bt = np.asarray((track or {}).get("beats") or [], float)
        rb = np.asarray(F["beats"]["t"], float)
        ref = np.asarray(F["beats"].get("refined", np.ones(len(rb))), float) > 0
        rb = rb[ref]
    except (KeyError, TypeError, ValueError):
        return 0.0
    if len(bt) < 8 or len(rb) < 8:
        return 0.0
    k = np.clip(np.searchsorted(rb, bt), 1, len(rb) - 1)
    near = np.where(np.abs(bt - rb[k - 1]) <= np.abs(bt - rb[k]), rb[k - 1], rb[k])
    d = bt - near
    d = d[np.abs(d) <= 0.06]
    return float(np.median(d)) if len(d) >= 8 else 0.0


# ---------------------------------------------------------------------------------------------
# body references
# ---------------------------------------------------------------------------------------------
def body_ref(y: np.ndarray, F: dict | None, t0: float, t1: float, gain: float = 1.0,
             sr: int = SR) -> dict:
    """Levels of a native excerpt body [t0, t1] (s) at track gain `gain`:
    bar_db = median bar RMS dBFS (Feats bars when given, else 2 s blocks);
    low_p90_db = p90 of the < 120 Hz level in 50 ms blocks (V4)."""
    i0, i1 = max(0, int(t0 * sr)), min(len(y), int(t1 * sr))
    x = _mono(y[i0:i1]) * np.float32(gain)
    bars = []
    if F is not None:
        bt = np.asarray(F["bars"]["t"], float)
        edges = bt[(bt >= t0 - 1e-6) & (bt <= t1 + 1e-6)]
        bars = [rms_db(x[int((a - t0) * sr): int((b - t0) * sr)]) for a, b in zip(edges[:-1], edges[1:])
                if b - a > 0.2]
    if not bars:
        bars = block_db(x, 2 * sr).tolist()
    low = block_db(_filt(x, "lowpass", float(V["dbl_bass_hz"]), sr=sr), int(float(V["rms_ms"]) / 1000 * sr))
    return {"bar_db": float(np.median(bars)) if bars else DB_FLOOR,
            "low_p90_db": float(np.percentile(low, 90)) if len(low) else DB_FLOOR}


# ---------------------------------------------------------------------------------------------
# the join verifier
# ---------------------------------------------------------------------------------------------
def _program(prog) -> S.Program:
    return prog if isinstance(prog, S.Program) else S.from_json(prog, S.Program)


def _r(x: float | None, nd: int = 2) -> float | None:
    if x is None:
        return None
    x = float(x)
    return round(x, nd) if np.isfinite(x) else (999.0 if x > 0 else DB_FLOOR)


class _Join:
    """Region arrays + program, with time helpers and cached onsets/HPSS per part."""

    def __init__(self, out, pa, pb, prog, fa, fb, pre, post, stems_parts, ref, gains=None, lag=None):
        self.prog = _program(prog)
        self.sr, self.xf = int(self.prog.sr), int(self.prog.xf)
        self.out, self.pa, self.pb = (np.asarray(v, dtype=np.float32) for v in (out, pa, pb))
        self.fa, self.fb = fa or {}, fb or {}
        self.pre, self.post = pre, post
        self.stems_parts = stems_parts or {}
        self.T, self.tl = float(self.prog.T), float(self.prog.t_land)
        self.cm = np.asarray(self.prog.clock_m, float)
        self.ct = np.asarray(self.prog.clock_t, float)
        self.exp = self.prog.expect or {}
        m1 = 1.0 if self.cm[-1] >= 1.0 else 0.0
        self.beat = max(1e-3, float(self.t_of_m(m1) - self.t_of_m(m1 - 1.0)))   # B's beat at 0
        downs = [k for k, g in enumerate(self.prog.grid) if g[1]]
        self.bpb = int(np.median(np.diff(downs))) if len(downs) > 1 else 4
        self.bar = self.bpb * self.beat
        self.ref = ref or {}
        self.land: dict | None = None                # B's Feats landing (drop criteria for V1)
        self.gains = gains or {"a": 1.0, "b": 1.0}   # track gains: onsets are measured at unity
        self.lag = lag or {}                         # Beat This lag per side (s), bt_lag
        self.notes: list[str] = []
        self._hp: dict[str, tuple] = {}
        self._on: dict[str, tuple] = {}
        self._ctx = None

    # time <-> samples / beats
    def i(self, t: float) -> int:
        return int(round(t * self.sr)) + self.xf

    def seg(self, x: np.ndarray, t0: float, t1: float) -> np.ndarray:
        return x[max(0, self.i(t0)): max(0, self.i(t1))]

    def t_of_m(self, m):
        m = np.asarray(m, float)
        t = np.interp(m, self.cm, self.ct)
        lo, hi = m < self.cm[0], m > self.cm[-1]          # extrapolate with the edge tempo
        t = np.where(lo, self.ct[0] + (m - self.cm[0]) * (self.ct[1] - self.ct[0]) / (self.cm[1] - self.cm[0]), t)
        return np.where(hi, self.ct[-1] + (m - self.cm[-1]) * (self.ct[-1] - self.ct[-2]) / (self.cm[-1] - self.cm[-2]), t)

    def part(self, which: str) -> np.ndarray:
        return {"a": self.pa, "b": self.pb, "out": self.out}[which]

    def hp(self, which: str) -> tuple[np.ndarray, np.ndarray]:
        """(harmonic, percussive) mono of a part (V3 levels, V5); the drums stem replaces the
        percussive part when given. HPSS runs only over the part's audible span (+ 1 s)."""
        if which not in self._hp:
            x = _mono(self.part(which))
            h, p = np.zeros_like(x), np.zeros_like(x)
            live = np.where(np.abs(x) > 1e-5)[0]
            if len(live):
                i0, i1 = max(0, live[0] - self.sr), min(len(x), live[-1] + self.sr)
                h[i0:i1], p[i0:i1] = hpss(x[i0:i1])
            drums = (self.stems_parts.get(which) or {}).get("drums")
            if drums is not None:
                p = _mono(drums)
            self._hp[which] = (h, p)
        return self._hp[which]

    def ons(self, which: str) -> tuple[np.ndarray, np.ndarray]:
        """Onsets of a part in region seconds ("out" = the union of both parts' onsets)."""
        if which not in self._on:
            if which == "out":
                (ta, sa), (tb, sb) = self.ons("a"), self.ons("b")
                t, s = np.concatenate([ta, tb]), np.concatenate([sa, sb])
                k = np.argsort(t, kind="stable")
                self._on[which] = (t[k], s[k])
            else:
                # at the native level (the part / its track gain): the log1p(100 |S|) flux is
                # not gain invariant, and Feats strengths are measured at unity gain
                drums = (self.stems_parts.get(which) or {}).get("drums")
                x = self.part(which) if drums is None else drums
                t, s = onsets(x / np.float32(max(float(self.gains.get(which, 1.0)), 1e-3)), self.sr)
                self._on[which] = (t - self.xf / self.sr, s)
        return self._on[which]

    def ctx_audio(self) -> tuple[np.ndarray, float]:
        """pre + region core + post, and the offset (s) of region t = 0 in it."""
        if self._ctx is None:
            self._ctx = self._build_ctx()
        return self._ctx

    def _build_ctx(self) -> tuple[np.ndarray, float]:
        n_core = self.i(self.T) - self.xf
        parts, off = [], 0.0
        if self.pre is not None and len(self.pre):
            parts.append(np.asarray(self.pre, np.float32))
            off = len(self.pre) / self.sr
            core = self.out[self.xf: self.xf + n_core]
        else:
            core = self.out[: self.xf + n_core]
            off = self.xf / self.sr
        parts.append(core)
        if self.post is not None and len(self.post):
            parts.append(np.asarray(self.post, np.float32))
        else:
            parts.append(self.out[self.xf + n_core:])
        return np.concatenate([p.reshape(-1, 2) if p.ndim == 2 else np.repeat(p[:, None], 2, 1)
                               for p in parts]), off

    def ref_of(self, src: str) -> dict:
        """Body reference of A or B; falls back to the region's full-level edge bar."""
        if src in self.ref:
            return self.ref[src]
        x = self.seg(self.pa, 0.0, min(self.t_of_m(self.cm[0] + self.bpb), self.tl)) if src == "a" \
            else self.seg(self.pb, self.tl, self.T)
        low = block_db(_filt(_mono(x), "lowpass", float(V["dbl_bass_hz"])), int(float(V["rms_ms"]) / 1000 * self.sr))
        return {"bar_db": rms_db(x), "low_p90_db": float(np.percentile(low, 90)) if len(low) else DB_FLOOR}

    def windows(self, key: str) -> list[tuple[float, float]]:
        return [(float(a), float(b)) for a, b in (self.exp.get(key) or [])]


def _strong(s: np.ndarray) -> float:
    """§16 "strong onsets (>= median)", also >= 5 % of the part's p95 strength, so that a part
    with mostly near-silent junk detections keeps only its real hits."""
    return max(float(np.median(s)), 0.05 * float(np.percentile(s, 95))) if len(s) else 0.0


def _in_any(t: float, wins: list[tuple[float, float]], pad: float = 0.0) -> bool:
    return any(a - pad <= t <= b + pad for a, b in wins)


# ---- V1 landing ------------------------------------------------------------------------------
V1_WINDOW_S = 0.050
# Beat This sees [t(-8 beats) - pad, t(+8 beats) + pad] of pre + region + post. note: with a
# 3 s pad (about 14 s of audio) Beat This put the downbeat half a bar off on real joins whose
# full-track analysis agrees with the landing; from about 30 s of context it is stable
V1_BT_PAD_S = 15.0


def _v1(J: _Join, bt) -> tuple[str, dict]:
    t, s = J.ons("b")
    med = float((J.fb.get("onsets") or {}).get("median_down_strength") or 0.0)
    if len(t):
        # the strongest onset within +-50 ms (else the nearest): a clip opening on sustained
        # material just before a late kick is an onset too, and must not stand in for the kick
        near = np.where(np.abs(t - J.tl) <= V1_WINDOW_S)[0]
        k = int(near[np.argmax(s[near])]) if len(near) else int(np.argmin(np.abs(t - J.tl)))
        err, st = (t[k] - J.tl) * 1000, s[k]
        if med <= 0:                      # no Feats: compare with the part's own onset median
            med = float(np.median(s))
        strength = st / med if med > 0 else 0.0
    else:
        err, strength = 999.0, 0.0
    bt_err = None
    if bt is not None:
        y, off = J.ctx_audio()
        pad = V1_BT_PAD_S
        t0 = off + J.tl - 8 * J.beat - pad
        t1 = off + J.tl + 8 * J.beat + pad
        i0, i1 = max(0, int(t0 * J.sr)), min(len(y), int(t1 * J.sr))
        try:
            _, downs = bt(_mono(y[i0:i1]), J.sr)
            # region seconds, minus Beat This's own lag on B (lead addition B)
            downs = np.asarray(downs, float) + i0 / J.sr - off - float(J.lag.get("b", 0.0))
            near = downs[np.abs(downs - J.tl) <= 8 * J.beat]
            bt_err = float((near[np.argmin(np.abs(near - J.tl))] - J.tl) * 1000) if len(near) else 999.0
            # note: when the nearest downbeat misses, B's own downbeats decide: the median phase of
            # Beat This's downbeats over [t(0) - 1/2 beat, t(0) + 8 beats] against the landing's
            # bar grid t(0) + k bars. At a tempo step (free joins) Beat This smooths across A's
            # tempo and put B's first downbeat 110 ms early on a join whose next downbeats sit
            # on the landing grid within 2 ms
            after = downs[(downs >= J.tl - J.beat / 2) & (downs <= J.tl + 8 * J.beat)]
            if abs(bt_err) > float(V["bt_down_ms"]) and len(after):
                ph = float(np.median((after - J.tl + J.bar / 2) % J.bar - J.bar / 2) * 1000)
                if abs(ph) < abs(bt_err):
                    bt_err = ph
                    J.notes.append("V1: Beat This phase from B's downbeats after the landing")
        except Exception as exc:          # Beat This unavailable: the onset criteria still apply
            J.notes.append(f"V1: Beat This skipped ({exc})")
    # fixer (review v1 musical #2): a drop (B's contrast >= 3 dB or low jump >= 6 dB at the
    # landing) keeps the timing tests but passes from land_strength_drop x the median: the onset
    # flux after a riser is weak by construction (Dreaming's drop: 0.65 x, bass stem +49 dB)
    floor = float(V["land_strength"])
    ld, hl = J.land or {}, CFG["highlight"]
    if ld.get("drop_ok") or (ld.get("contrast_db") or 0) >= hl["drop_contrast_db"] or \
            (ld.get("low_jump_db") or 0) >= hl["drop_low_db"]:
        floor = min(floor, float(V["land_strength_drop"]))
    ok = abs(err) <= float(V["land_err_ms"]) and strength >= floor and \
        (bt_err is None or abs(bt_err) <= float(V["bt_down_ms"]))
    return ("pass" if ok else "fail"), {"land_err_ms": _r(err), "land_strength": _r(strength, 3),
                                        "bt_down_err_ms": _r(bt_err)}


# ---- V2a clock / V2b fidelity -----------------------------------------------------------------
def _v2a(J: _Join) -> tuple[str, dict]:
    errs = []
    lay = J.windows("layered")
    if lay:
        q = np.arange(np.floor(J.cm[0] * 4), np.ceil(J.cm[-1] * 4) + 1) / 4
        tq = J.t_of_m(q)
        lim = float(V["v2a_window_ms"]) / 1000
        for which in ("a", "b"):
            t, s = J.ons(which)
            if not len(t):
                continue
            strong = s >= _strong(s)
            for tt in t[strong]:
                if _in_any(tt, lay):
                    e = float(np.min(np.abs(tq - tt)))
                    if e <= lim:
                        errs.append(e * 1000)
    if not errs:
        return "pass", {"grid_med_ms": None, "grid_p90_ms": None}
    med, p90 = float(np.median(errs)), float(np.percentile(errs, 90))
    ok = med <= float(V["v2a_med_ms"]) and p90 <= float(V["v2a_p90_ms"])
    warn = med <= float(V["v2a_med_ms"]) and p90 <= float(V["v2a_warn_p90_ms"])
    return ("pass" if ok else "warn" if warn else "fail"), {"grid_med_ms": _r(med), "grid_p90_ms": _r(p90)}


V2B_MATCH_MS = 20.0          # an expected onset is matched by a detection within 20 ms
V2B_MIN_MATCHED = 0.7        # REVIEW-external-1 #2: fewer matched than this fails V2b


def _v2b(J: _Join) -> tuple[str, dict]:
    status, meds, p95s, n_all, n_miss = "pass", [], [], 0, 0
    for cp in J.prog.clips:
        lst = (J.exp.get("onsets") or {}).get(cp.id, [])
        if not lst or cp.src not in ("a", "b"):
            continue
        st = np.array([float(e[1]) for e in lst])        # the clip's strong onsets only: weak
        exp = [float(e[0]) for e in lst if float(e[1]) >= np.median(st)]   # ones do not re-detect
        t, _ = J.ons(cp.src)
        d = np.array([np.min(np.abs(t - e)) for e in exp]) * 1000 if len(t) else np.full(len(exp), np.inf)
        hit = d[d <= V2B_MATCH_MS]
        n_all += len(hit)
        n_miss += len(d) - len(hit)
        if len(exp) >= 3 and len(hit) < V2B_MIN_MATCHED * len(exp):
            status = "fail"                       # a displaced render matches nothing: not a pass
            J.notes.append(f"V2b: clip {cp.id} matched {len(hit)}/{len(exp)} expected onsets")
        d = hit
        if len(d) < 3:
            continue
        med, p95 = float(np.median(d)), float(np.percentile(d, 95))
        meds.append(med)
        if cp.source.get("kind") == "r2":
            p95s.append(p95)
            bad = med > float(V["v2b_warp_med_ms"]) or p95 > float(V["v2b_warp_p95_ms"])
        else:
            bad = med > float(V["v2b_native_med_ms"])
        if bad:
            status = "fail"
    J.notes.append(f"V2b: {n_all} expected onsets matched, {n_miss} unmatched")
    return status, {"fid_med_ms": _r(max(meds) if meds else 0.0),
                    "fid_p95_ms": _r(max(p95s) if p95s else 0.0)}


# ---- V3 flams ---------------------------------------------------------------------------------
def _v3(J: _Join) -> tuple[str, dict]:
    (ta, _), (tb, _) = J.ons("a"), J.ons("b")
    lo, hi = (float(v) / 1000 for v in V["flam_ms"])
    if not len(ta) or not len(tb):
        return "pass", {"flams": 0}
    coin = lo / 2                                   # a coincident partner means locked, not flammed
    a_locked = np.array([np.min(np.abs(tb - t)) < coin for t in ta])
    b_locked = np.array([np.min(np.abs(ta - t)) < coin for t in tb])
    pairs = [(i, j) for i, t in enumerate(ta) if not a_locked[i]
             for j in np.where((np.abs(tb - t) >= lo) & (np.abs(tb - t) <= hi))[0] if not b_locked[j]]
    if not pairs:                                   # (no HPSS needed: most slams end here)
        return "pass", {"flams": 0}
    n50 = int(float(V["rms_ms"]) / 1000 * J.sr)
    pa, pb = J.hp("a")[1], J.hp("b")[1]

    def lvl(p, t):
        i = J.i(t)
        return rms_db(p[max(0, i): max(0, i) + n50])

    floor, rel = float(V["flam_floor_dbfs"]), float(V["flam_rel_db"])
    # note: a flam needs both sources live at both hits: at each onset some clip of the other
    # part plays (its pos covers t and its gain lane is finite there, from the Program). A's
    # last hit before its cut and B's entry 80 ms later, or the two sides of a phrase_trade
    # block edge, are a sequence, not a layered flam
    clips = {s: [cp for cp in J.prog.clips if cp.src == s and cp.pos] for s in ("a", "b")}

    def playing(src: str, t: float) -> list:
        return [cp for cp in clips[src] if any(float(sg["t0"]) <= t <= float(sg["t1"]) for sg in cp.pos)
                and (not cp.gain_db or np.isfinite(S.eval_knots(cp.gain_db, np.array([t]), "db")[0]))]

    def live(src: str, t: float) -> bool:
        return bool(playing(src, t))

    # note: and each hit must come from a percussive clip of its part (the §8.9.8 classes that
    # static R4 uses): B's `top` over A is not a percussion layer, so a vocal syllable 40 ms from
    # A's hat is no flam
    def perc(src: str, t: float) -> bool:
        return any(_perc_clip(cp, t, J.fa if src == "a" else J.fb) for cp in playing(src, t))

    flams, where = 0, []
    for i, j in pairs:
        if not (live("a", tb[j]) and live("b", ta[i]) and perc("a", ta[i]) and perc("b", tb[j])):
            continue
        la, lb = lvl(pa, ta[i]), lvl(pb, tb[j])
        if la > floor and lb > floor and abs(la - lb) <= rel:
            flams += 1
            where.append(round(float(min(ta[i], tb[j])), 3))
    if where:
        J.notes.append(f"V3: flams at {where[:6]}")
    return ("pass" if flams == 0 else "fail"), {"flams": int(flams)}


def _perc_clip(cp: S.ClipProgram, t: float, F: dict | None) -> bool:
    """§8.9.8 percussive class of a clip at region time t (schema._percussive's rule): drums /
    bed, low, other on a warped track; mix unless its source bar is nobass-nodrums; high where
    the source bar has perc_db >= -6. Without Feats bars a mix / high clip counts."""
    st = cp.stems
    if isinstance(st, (list, tuple)):
        return "drums" in st or ("other" in st and cp.source.get("kind") == "r2")
    if st == "low":
        return True
    bars = (F or {}).get("bars") or {}
    if "perc_db" not in bars or "low_db" not in bars:
        return True
    s = clip_source_s(cp, t)
    if s is None:
        return True
    bt = np.asarray(bars["t"], float)
    i = int(np.clip(np.searchsorted(bt, s, side="right") - 1, 0, len(bt) - 1))
    hl = CFG["highlight"]
    p = float(bars["perc_db"][i]) >= hl["nodrums_perc_db"]
    return p if st == "high" else (p or float(bars["low_db"][i]) > hl["nobass_low_db"])


# ---- V4 double bass ---------------------------------------------------------------------------
def _v4(J: _Join) -> tuple[str, dict]:
    blk = int(float(V["rms_ms"]) / 1000 * J.sr)
    hz = float(V["dbl_bass_hz"])
    la = block_db(_filt(_mono(J.seg(J.pa, 0, J.T)), "lowpass", hz), blk)
    lb = block_db(_filt(_mono(J.seg(J.pb, 0, J.T)), "lowpass", hz), blk)
    n = min(len(la), len(lb))
    ra, rb = J.ref_of("a")["low_p90_db"], J.ref_of("b")["low_p90_db"]
    both = (la[:n] > ra + float(V["dbl_bass_db"])) & (lb[:n] > rb + float(V["dbl_bass_db"]))
    beats = float(both.sum() * blk / J.sr / J.beat)
    return ("pass" if beats <= float(V["dbl_bass_beats"]) else "fail"), {"dbl_bass_beats": _r(beats, 3)}


# ---- V5 key -----------------------------------------------------------------------------------
def _v5(J: _Join) -> tuple[str, dict]:
    wins = [(a, b) for a, b in J.windows("tonal") if b - a > float(V["key_overlap_beats"]) * J.beat]
    if not wins:
        return "pass", {"chroma_mean": None}
    import librosa
    hop = 1024
    band = [float(v) for v in V["key_band_hz"]]
    ch, lev = {}, {}
    for src in ("a", "b"):
        h = J.hp(src)[0]
        ch[src] = librosa.feature.chroma_stft(y=np.ascontiguousarray(h), sr=J.sr, n_fft=4096, hop_length=hop)
        lev[src] = _filt(h, "bandpass", band)
    grid = np.array([float(g[0]) for g in J.prog.grid])
    cos = []
    for a, b in wins:
        beats = grid[(grid >= a - 1e-6) & (grid < b - 1e-6)]
        for t0, t1 in zip(beats[:-1], beats[1:]):
            vec, ok = [], True
            for src in ("a", "b"):
                rel = rms_db(J.seg(lev[src], t0, t1)) - J.ref_of(src)["bar_db"]
                if rel < float(V["key_rel_db"]):
                    ok = False
                    break
                f0, f1 = max(0, J.i(t0) // hop), max(1, J.i(t1) // hop)
                c = ch[src][:, f0:f1].mean(axis=1) if f1 > f0 else ch[src][:, min(f0, ch[src].shape[1] - 1)]
                c = c - c.mean()
                vec.append(c / (np.linalg.norm(c) + 1e-9))
            if ok:
                cos.append(float(np.dot(vec[0], vec[1])))
    if not cos:
        return "pass", {"chroma_mean": None}
    mean = float(np.mean(cos))
    tau = float(J.fa.get("tau_key") or CFG["tau_key_default"])
    return ("pass" if mean >= tau else "warn" if mean >= 0 else "fail"), {"chroma_mean": _r(mean, 3)}


# ---- V6 clicks --------------------------------------------------------------------------------
def _v6(J: _Join) -> tuple[str, dict]:
    win, ref_ms = float(V["click_win_ms"]) / 1000, float(V["click_ref_ms"]) / 1000
    exempt = float(V["click_onset_ms"]) / 1000
    src_on = np.array([float(e[0]) for lst in (J.exp.get("onsets") or {}).values() for e in lst])
    blk = max(1, int(win * J.sr))                # the splice window is +-blk; references are
    clicks, where = 0, []                        # maxima over windows of the same 2 * blk
    gains = {cp.id: cp.gain_db for cp in J.prog.clips}
    quiet = 10 ** (float(V["silence_dbfs"]) / 20)
    for sp in J.prog.splices:
        t = float(sp.t)
        if sp.onset is not None and abs(float(sp.onset) - t) <= exempt + float(CFG["splice_pre_ms"]) / 1000:
            continue
        # note: a source onset from 5 ms before to 2 x 5 ms after the splice exempts it (its
        # attack starts a few ms before the detected onset and leaks into the +-5 ms window)
        if len(src_on) and np.any((src_on - t >= -exempt) & (src_on - t <= 2 * exempt)):
            continue
        # note: a splice of a clip that is silent on both sides (an edge of a clip already cut
        # out) cannot click
        g = gains.get(sp.clip)
        gv = None
        if g:
            gv = S.eval_knots(g, np.array([t - 0.004, t + 0.004]), "db")
            if not np.isfinite(gv).any():
                continue
        i0, i1 = J.i(t - ref_ms - 0.05), J.i(t + ref_ms + 0.05)
        x = J.out[max(0, i0): max(0, i1)]
        if len(x) < 4 * blk:
            continue
        e = np.abs(np.diff(_filt(x, "highpass", float(V["click_hp_hz"])), axis=0)).max(axis=1)
        live = np.abs(x).max(axis=1) if x.ndim == 2 else np.abs(x)
        c = J.i(t) - max(0, i0)                   # splice sample within x
        peak = float(e[max(0, c - blk): c + blk].max(initial=0.0))
        lo, hi = max(0, c - int(ref_ms * J.sr)), min(len(e), c + int(ref_ms * J.sr))
        # note: references only where the output sounds (> -50 dBFS): next to a vacuum the
        # silent side would otherwise pull the median down and turn any entry into a "click"
        # note: and only on the side where the spliced clip sounds for its edges and for cuts
        # out / in (> 12 dB gain steps): an entry is a click only against what it enters into,
        # a cut only against what it cuts (a pickup fading in after a tape stop's LF-only tail
        # scored 6x; echo_slam's dry cut into its own -28 dB echo tail 14x)
        side = {"edge_in": 1, "edge_out": -1}.get(sp.kind, 0)
        if side == 0 and gv is not None:           # a cut out (in) of the clip: its own side
            g0, g1 = (float(v) if np.isfinite(v) else -np.inf for v in gv)
            side = -1 if g0 > g1 + 12 else 1 if g1 > g0 + 12 else 0
        ref = [e[k: k + 2 * blk].max() for k in range(lo, hi - 2 * blk + 1, blk)
               if not (k + 2 * blk > c - blk and k < c + blk) and live[k: k + 2 * blk].max() > quiet
               and (side == 0 or (side > 0 and k >= c + blk) or (side < 0 and k + 2 * blk <= c - blk))]
        ref_v = max(float(np.median(ref)) if ref else 0.0, 1e-3)
        if peak > 1e-3 and peak / ref_v > float(V["click_ratio"]):
            clicks += 1
            where.append((round(t, 3), round(peak / ref_v, 1)))
    if where:
        J.notes.append(f"V6: clicks at {where[:6]}")
    return ("pass" if clicks == 0 else "fail"), {"clicks": int(clicks)}


# ---- V7 peaks ---------------------------------------------------------------------------------
def _v7(J: _Join, ceiling_db: float) -> tuple[str, dict]:
    """note: the medley output chain limits with dsp.tp_limiter (the true-peak-aware twin of
    audio.limiter, see build.render_medley), so V7 measures after that limiter."""
    from .dsp import tp_limiter
    y = tp_limiter(J.out, ceiling_db)
    tp = true_peak_db(y)
    blk = 64
    n = len(y) // blk
    a = np.abs(J.out[: n * blk]).max(axis=1).reshape(n, blk).max(axis=1)
    b = np.abs(y[: n * blk]).max(axis=1).reshape(n, blk).max(axis=1)
    gr = 20 * np.log10(np.maximum(a, 1e-9) / np.maximum(b, 1e-9))
    ms = float((gr > float(V["gr_db"])).sum() * blk / J.sr * 1000)
    ok = tp <= float(V["tp_dbtp"]) + 1e-9 and ms <= float(V["gr_ms"])
    return ("pass" if ok else "fail"), {"tp_dbtp": _r(tp), "limiter_ms_over6": _r(ms, 1)}


# ---- V8 loudness ------------------------------------------------------------------------------
def _planned_step(J: _Join, a: dict, b: dict, p: dict) -> float | None:
    if J.exp.get("step_planned_lu") is not None:
        return float(J.exp["step_planned_lu"])
    kba, kbb = J.fa.get("kblocks"), J.fb.get("kblocks")
    if not kba or not kbb:
        return None
    from ..render import track_gain
    sa, sb = _src_at(J.prog, "a", 0.0), _src_at(J.prog, "b", J.tl)
    if sa is None or sb is None:
        return None
    st = float(CFG["loudness"]["short_s"])
    la, lb = kblock_short(kba, sa - st, sa), kblock_short(kbb, sb, sb + st)
    if la is None or lb is None:
        return None
    ga, gb = (20 * np.log10(track_gain(t, p)) for t in (a, b))
    return float((lb + gb) - (la + ga))


def _v8(J: _Join, a: dict, b: dict, p: dict) -> tuple[str, dict]:
    y, off = J.ctx_audio()
    kw = (kweight(y, J.sr) ** 2).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(kw)])
    n = len(kw)

    def L(t0: float, t1: float) -> float | None:           # region seconds
        i0, i1 = max(0, int((t0 + off) * J.sr)), min(n, int((t1 + off) * J.sr))
        return _loud((c[i1] - c[i0]) / (i1 - i0)) if i1 - i0 > J.sr * 0.2 else None

    st, mo = float(CFG["loudness"]["short_s"]), float(CFG["loudness"]["momentary_s"])
    first_bar = float(J.t_of_m(J.cm[0] + J.bpb))
    la = L(-st, 0.0) if J.pre is not None and len(J.pre) >= st * J.sr * 0.9 else L(0.0, min(first_bar, J.tl))
    lb = L(J.tl, J.tl + st)
    step = (lb - la) if la is not None and lb is not None else 0.0
    planned = _planned_step(J, a, b, p)
    if planned is None:
        planned = step
        J.notes.append("V8: no planned step (no kblocks / expect); step not checked")
    lmax = max(v for v in (la, lb, DB_FLOOR) if v is not None)
    # sliding short-term over the region: time above max + 1 LU
    hop = 0.1
    centres = np.arange(max(0.0, st / 2 - off), J.T + 1e-9, hop)
    S_ = np.array([v if (v := L(cc - st / 2, cc + st / 2)) is not None else DB_FLOOR for cc in centres])
    excess = float(S_.max() - lmax) if len(S_) else 0.0
    over_s = float((S_ > lmax + float(V["region_over_lu"])).sum() * hop)
    # momentary jumps (upward), except at planned arrivals. A 400 ms window at ~120 BPM
    # alternately holds and misses a kick, so compare beat-long maxima of the momentary series
    mc = np.arange(0.0, J.T + 1e-9, hop)
    M = np.array([v if (v := L(cc - mo / 2, cc + mo / 2)) is not None else DB_FLOOR for cc in mc])
    k = max(1, int(round(J.beat / hop)))
    E = np.array([M[max(0, i - k // 2): i + k - k // 2].max() for i in range(len(M))])
    planned_t = [J.tl] + [b_ for _, b_ in J.windows("vacuums") + J.windows("silences")]
    planned_t += [_first_audible(J.prog, cp) for cp in J.prog.clips if cp.src == "b"]
    planned_t += [float(g.get("stop_t") or g["t1"]) for g in (J.exp.get("gestures") or [])]
    # note: after the landing, once A's part (with its echo tails) is silent, the output is B
    # native: a jump there is B's own music (a drop a bar after a quiet landing bar), not the join
    pa_db = block_db(J.seg(J.pa, 0.0, J.T), int(hop * J.sr))
    a_live = lambda t: t <= J.tl or pa_db[min(len(pa_db) - 1, max(0, int(t / hop)))] > float(V["silence_dbfs"])  # noqa: E731
    jumps = [round(float(mc[i]), 2) for i in range(k, len(E))
             if E[i] > -70 and E[i] - E[i - k] > float(V["momentary_jump_lu"]) and a_live(float(mc[i]))
             and not any(abs(mc[i] - pt) <= 0.5 + J.beat / 2 for pt in planned_t if pt is not None)]
    d = abs(step - planned)
    if jumps:
        J.notes.append(f"V8: unplanned momentary jumps at {jumps[:6]}")
    if over_s > J.bar:
        J.notes.append(f"V8: region {excess:.1f} LU over max(A, B) for {over_s:.1f} s")
    bad = d > float(V["step_warn_lu"]) or over_s > J.bar or bool(jumps)
    warn = d > float(V["step_lu"])
    return ("fail" if bad else "warn" if warn else "pass"), {
        "step_lu": _r(step), "step_planned_lu": _r(planned), "overlap_excess_lu": _r(excess)}


# ---- V9 gaps and gestures ---------------------------------------------------------------------
def _v9(J: _Join) -> tuple[str, dict]:
    frame, hop = int(0.010 * J.sr), int(0.005 * J.sr)
    x = _mono(J.seg(J.out, 0, J.T)).astype(np.float64)
    c = np.concatenate([[0.0], np.cumsum(x ** 2)])
    st = np.arange(0, max(0, len(x) - frame), hop)
    lv = 10 * np.log10(np.maximum((c[st + frame] - c[st]) / frame, 1e-24))
    quiet = lv < float(V["silence_dbfs"])
    # R6: the air in [-1 beat, 0) is planned; a fade to -inf reaches -50 dBFS just before 0
    allowed = J.windows("vacuums") + J.windows("silences") + [(float(J.t_of_m(-1.0)), J.tl)]
    stops = []
    for g in J.exp.get("gestures") or []:
        if g.get("stop_t") is not None:
            allowed.append((float(g["stop_t"]), J.tl))
            stops.append(g)
    rewind = any(g.get("kind") == "rewind" for g in J.exp.get("gestures") or [])
    max_len = (float(V["rewind_gap_max_beats"]) if rewind else float(V["vacuum_max_beats"])) * J.beat
    gaps = 0
    d = np.diff(np.concatenate([[0], quiet.astype(int), [0]]))
    for s0, s1 in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
        t0, t1 = st[s0] / J.sr, (st[s1 - 1] + frame) / J.sr
        if t1 - t0 < float(V["silence_ms"]) / 1000:
            continue
        inside = any(a - 0.02 <= t0 and t1 <= b + 0.02 for a, b in allowed)
        if not inside or t1 - t0 > max_len + 0.02:
            gaps += 1
            J.notes.append(f"V9: silence {t0:.3f}-{t1:.3f} s")
    ok_g = True
    for g in stops:                      # rate 0 at least 1/4 beat before the next audible beat
        if J.tl - float(g["stop_t"]) < float(V["stop_before_beats"]) * J.beat - 1e-3:
            ok_g = False
            J.notes.append(f"V9: {g.get('kind')} stops {1000 * (J.tl - g['stop_t']):.0f} ms before the landing")
    seams = [float(s) for s in J.exp.get("seams") or []]
    if seams:
        on = np.concatenate([J.ons("a")[0], J.ons("b")[0]])
        for s_ in seams:
            if not len(on) or np.min(np.abs(on - s_)) > float(V["seam_ms"]) / 1000:
                ok_g = False
                J.notes.append(f"V9: loop seam {s_:.3f} s not on an onset")
    return ("pass" if gaps == 0 and ok_g else "fail"), {"gaps_unplanned": int(gaps), "gesture_ok": bool(ok_g)}


# ---- V10 tempo --------------------------------------------------------------------------------
def _v10(J: _Join) -> tuple[str, dict]:
    t, s = J.ons("out")
    grid = [(float(g[0]), bool(g[1])) for g in J.prog.grid]
    if len(t) < 4 or len(grid) < 3:
        return "pass", {"tempo_jump_pct": 0.0}
    strong = t[s >= _strong(s)]
    skip = J.windows("ramps") + J.windows("vacuums") + J.windows("silences")
    match = []
    for tg, _ in grid:
        k = int(np.argmin(np.abs(strong - tg))) if len(strong) else -1
        match.append(strong[k] if k >= 0 and abs(strong[k] - tg) <= J.beat / 4 else None)
    bars: list[list[float]] = []
    for k in range(len(grid) - 1):
        if grid[k][1] or not bars:
            bars.append([])
        (t0, _), (t1, _) = grid[k], grid[k + 1]
        if match[k] is None or match[k + 1] is None or _in_any(t0, skip) or _in_any(t1, skip):
            continue
        bars[-1].append((match[k + 1] - match[k]) / (t1 - t0))
    r = [float(np.median(b)) if len(b) >= 3 else None for b in bars]
    jumps = [abs(y / x - 1) * 100 for x, y in zip(r[:-1], r[1:]) if x and y]
    jump = max(jumps) if jumps else 0.0
    return ("pass" if jump <= float(V["tempo_jump_pct"]) else "fail"), {"tempo_jump_pct": _r(jump)}


# ---- V11 air ----------------------------------------------------------------------------------
AIR_WINDOW_BEATS = 0.25


def _v11(J: _Join) -> tuple[str, dict]:
    t0 = float(J.t_of_m(-AIR_WINDOW_BEATS))
    air = rms_db(J.seg(J.pa, t0, J.tl)) - J.ref_of("a")["bar_db"]
    st = "pass" if air <= float(V["air_db"]) else "warn" if air <= float(V["air_warn_db"]) else "fail"
    return st, {"a_air_db": _r(air)}


# ---- V12 vocal edges (stems) ------------------------------------------------------------------
CUT_MOVES = {"cut", "roll", "loop", "tape_stop", "backspin", "rewind", "scratch", "gate", "trade", "jump"}


def a_cut_m(comp: dict) -> float | None:
    """Master beat where the composition first cuts A's line: a cut out, the end of a fade (or
    mids/highs EQ) to -inf, the first switch of a trade, the start of a gesture / loop / gate, or
    the end of an A clip before 0 (stem clips without vocals are ignored)."""
    a_ids = {c["id"] for c in comp["clips"] if c["src"] == "a" and _has_vocals(c["stem"])}
    ms = [float(c["at"]) + float(c["len"]) for c in comp["clips"]
          if c["id"] in a_ids and float(c["at"]) + float(c["len"]) < -1e-9]
    for mv in comp["moves"]:
        tg = {mv.get("clip")} | set(mv.get("clips") or []) | set(mv.get("out") or [])
        if not tg & a_ids:
            continue
        t, at = mv["type"], float(mv["at"])
        if t == "cut" and mv.get("dir") == "out":
            ms.append(at)
        elif t == "fade" and mv.get("to_db") is None:
            ms.append(at + float(mv.get("len", 0)))
        elif t == "eq" and mv.get("to_db") is None and mv.get("band") in ("mid_high", "mid", "high"):
            ms.append(at + float(mv.get("len", 0)))
        elif t == "trade":
            ms.append(at + float(mv["lens"][0]))
        elif t == "swap" and tg & set(mv.get("out") or []):
            ms.append(at)
        elif t in CUT_MOVES:
            ms.append(at)
    return min(ms) if ms else None


def _has_vocals(stem) -> bool:
    """A clip (Clip.stem or a resolved ClipProgram.stems) that carries the vocal."""
    st = stem if isinstance(stem, list) else S.clip_stems(stem)
    return st in ("mix", "high") or (isinstance(st, list) and "vocals" in st)


def _vocal_frames(x: np.ndarray, sr: int, frame_s: float) -> np.ndarray:
    n = int(frame_s * sr)
    k = len(x) // n
    if k < 1:
        return np.zeros(0)
    ms = (np.asarray(x[: k * n], np.float64).reshape(k, n) ** 2).mean(axis=1)
    return 10 * np.log10(np.maximum(ms, 1e-12))


def _v12(J: _Join, comp: dict | None) -> tuple[str, dict]:
    """Fixer (review v1 musical #4): on the source vocal stems (stems_parts["vox"], from build):
    A fails when its vocal sounds at the point where the composition cuts A's line (a_cut_m) and
    runs on for >= v12_tail_s in the source, unless A throws an echo; B warns when its clip
    opens inside a sung line (pickups excepted). Region-time vocal parts (stems_parts a/b
    "vocals") keep the original level check."""
    vox = J.stems_parts.get("vox") or {}
    if vox:
        return _v12_src(J, comp, vox)
    va = (J.stems_parts.get("a") or {}).get("vocals")
    vb = (J.stems_parts.get("b") or {}).get("vocals")
    if va is None and vb is None:
        return "pass", {"vocal_edge_db": None}
    worst = DB_FLOOR
    if va is not None and comp is not None:
        a_ids = {c["id"] for c in comp["clips"] if c["src"] == "a"}
        ms = [float(m["at"]) for m in comp["moves"]
              if m.get("clip") in a_ids and m["type"] in {"fade", "cut", "roll", "echo"} | S.GESTURE_MOVES]
        if ms:
            t1 = float(J.t_of_m(min(ms)))
            worst = max(worst, rms_db(J.seg(va, t1 - J.beat, t1)) - J.ref_of("a")["bar_db"])
    if vb is not None:
        cps = [cp for cp in J.prog.clips if cp.src == "b" and cp.pos]
        if cps:
            t0 = min(float(cp.pos[0]["t0"]) for cp in cps)
            pickup = t0 < J.tl - 0.05 and t0 >= J.tl - (CFG["pickup_max_beats"] + 0.1) * J.beat
            if not pickup:
                worst = max(worst, rms_db(J.seg(vb, t0, t0 + 0.05)) - J.ref_of("b")["bar_db"])
    return ("pass" if worst < float(V["vocal_edge_db"]) else "warn"), {"vocal_edge_db": _r(worst)}


def _v12_src(J: _Join, comp: dict | None, vox: dict) -> tuple[str, dict]:
    thr, fs = float(V["vocal_edge_db"]), float(V["v12_frame_s"])
    status, level = "pass", None
    a = vox.get("a")
    if a is not None and comp is not None and a.get("vocal", True):
        echo = any(m["type"] == "echo" for m in comp["moves"])
        m_c = a_cut_m(comp)
        s_c = _src_at(J.prog, "a", float(J.t_of_m(m_c))) if m_c is not None else None
        if s_c is not None:
            fr = _vocal_frames(a["x"], J.sr, fs) - float(a["ref_db"])
            k = int(round((s_c - float(a["s0"])) / fs))
            if 5 <= k < len(fr):
                level = float(fr[k - 5:k].max())            # the 100 ms before the cut
                on = fr[k:] >= thr
                gap = np.where(~on[:-2] & ~on[1:-1] & ~on[2:])[0]   # >= 60 ms below: a pause
                run = (gap[0] if len(gap) else len(on)) * fs
                if level >= thr and run >= float(V["v12_tail_s"]) and not echo:
                    status = "fail"
                    J.notes.append(f"V12: A's vocal cut at m {m_c:g} (source {s_c:.2f} s, {level:.1f} dB rel) "
                                   f"runs on {run:.2f} s")
    b = vox.get("b")
    if b is not None and b.get("vocal", True) and status == "pass":
        firsts = [sp[0] for cp in J.prog.clips if cp.src == "b" and _has_vocals(cp.stems)
                  and (sp := audible_span(cp, J.T, step=0.005))]
        if firsts:
            t0 = min(firsts)
            pickup = t0 < J.tl - 0.05 and t0 >= J.tl - (CFG["pickup_max_beats"] + 0.1) * J.beat
            s0 = _src_at(J.prog, "b", t0)
            if s0 is not None and not pickup:
                fr = _vocal_frames(b["x"], J.sr, fs) - float(b["ref_db"])
                k = int(round((s0 - float(b["s0"])) / fs))
                if 0 <= k < len(fr) - 3 and float(fr[k:k + 3].max()) >= thr and fr[max(0, k - 3):k].min(initial=thr) >= thr:
                    status = "warn"
                    J.notes.append(f"V12: B enters inside a sung line (source {s0:.2f} s)")
    return status, {"vocal_edge_db": _r(level) if level is not None else None}


# ---------------------------------------------------------------------------------------------
# program helpers (source positions, audibility)
# ---------------------------------------------------------------------------------------------
def clip_source_s(cp: S.ClipProgram, t: float) -> float | None:
    """Native source seconds that clip `cp` plays at region time t (None outside its pos)."""
    seg = None
    for sg in cp.pos:
        if float(sg["t0"]) - 1e-9 <= t <= float(sg["t1"]) + 1e-9:
            seg = sg
    if seg is None:
        return None
    if seg["kind"] == "copy":
        w = float(seg["w0"]) + (t - float(seg["t0"]))
    else:
        ws = np.asarray(seg["w"], float)
        w = float(np.interp(t, float(seg["t0"]) + np.arange(len(ws)) * float(CFG["compile"]["vary_step_s"]), ws))
    src = cp.source
    if src.get("kind") == "r2":
        return float(np.interp(w, src["dst_anchors"], src["src_anchors"]))
    return float(src["s0"]) + w


def _src_at(prog: S.Program, side: str, t: float) -> float | None:
    for cp in prog.clips:
        if cp.src == side:
            s = clip_source_s(cp, t)
            if s is not None:
                return s
    return None


def audible_span(cp: S.ClipProgram, T: float, step: float = 0.001) -> tuple[float, float] | None:
    """[first, last] region seconds where the clip's pos exists and its gain lane is finite."""
    if not cp.pos:
        return None
    t0 = max(float(cp.pos[0]["t0"]), -1.0)
    t1 = min(float(cp.pos[-1]["t1"]), T + 1.0)
    ts = np.arange(t0, t1 + step / 2, step)
    if not len(ts):
        return None
    g = S.eval_knots(cp.gain_db, ts, "db") if cp.gain_db else np.zeros(len(ts))
    inpos = np.zeros(len(ts), bool)
    for sg in cp.pos:
        inpos |= (ts >= float(sg["t0"]) - 1e-9) & (ts <= float(sg["t1"]) + 1e-9)
    ok = np.isfinite(g) & inpos
    if not ok.any():
        return None
    idx = np.where(ok)[0]
    lo, hi = float(ts[idx[0]]), float(ts[idx[-1]])
    # snap to the exact lane / pos edge within one grid step (a fade ends on its knot)
    edges = [float(k[0]) for k in cp.gain_db] + [float(sg[e]) for sg in cp.pos for e in ("t0", "t1")]
    lo = min([e for e in edges if lo - step - 1e-9 <= e <= lo], default=lo)
    hi = max([e for e in edges if hi <= e <= hi + step + 1e-9], default=hi)
    return lo, hi


def _first_audible(prog: S.Program, cp: S.ClipProgram) -> float | None:
    sp = audible_span(cp, float(prog.T), step=0.005)
    return sp[0] if sp else None


# ---------------------------------------------------------------------------------------------
# verify_join
# ---------------------------------------------------------------------------------------------
def verify_join(out, pa, pb, prog, fa, fb, a, b, p, *, stems_parts=None, bt_cpu: bool = True,
                bt=None, pre=None, post=None, ref=None, comp=None, hard=HARD_ALL,
                attempt: int = 1, history=None, detail: dict | None = None, lag: dict | None = None) -> dict:
    """Run §16.1 V1-V12 on one rendered join and return a `Checks` document.

    fa / fb: Feats of A / B (median downbeat strength, kblocks); a / b: order tracks (track
    gains); p: params (ceiling_db, target_lufs). bt: Beat This callable (mono, sr) ->
    (beats, downbeats); default = the CPU wrapper when bt_cpu, none otherwise. `detail` (a
    dict) receives {"results": {code: pass|warn|fail}, "warn": [...], "notes": [...]}. lag: Beat
    This's lag per side in s ({"a", "b"}, bt_lag), subtracted before V1's downbeat test."""
    from ..render import track_gain
    J = _Join(out, pa, pb, prog, fa, fb, pre, post, stems_parts, ref,
              gains={"a": track_gain(a or {}, p), "b": track_gain(b or {}, p)}, lag=lag)
    if comp is not None:
        J.land = next((ld for ld in (fb or {}).get("landings") or []
                       if int(ld["bar"]) == int(comp["b_ref"]["land_bar"])), None)
    if bt is None and bt_cpu:
        bt = bt_beats
    res, fields = {}, {}
    runs = [("V1", lambda: _v1(J, bt)), ("V2a", lambda: _v2a(J)), ("V2b", lambda: _v2b(J)),
            ("V3", lambda: _v3(J)), ("V4", lambda: _v4(J)), ("V5", lambda: _v5(J)),
            ("V6", lambda: _v6(J)), ("V7", lambda: _v7(J, float(p.get("ceiling_db", -1.0)))),
            ("V8", lambda: _v8(J, a or {}, b or {}, p)), ("V9", lambda: _v9(J)),
            ("V10", lambda: _v10(J)), ("V11", lambda: _v11(J)), ("V12", lambda: _v12(J, comp))]
    for code, fn in runs:
        res[code], f = fn()
        fields.update(f)
    hard = set(hard)
    fail = [c for c in CODES if res[c] == "fail" and c in hard]
    warn = [c for c in CODES if res[c] == "warn" or (res[c] == "fail" and c not in fail)]
    checks = {"status": "fail" if fail else "warn" if warn else "pass", "attempt": int(attempt),
              **fields, "fail": fail, "history": copy.deepcopy(history or [])}
    checks = {k: checks[k] for k in S.Checks.__annotations__ if k in checks}      # contract key order
    if detail is not None:
        detail.update(results=res, warn=warn, notes=J.notes)
    return checks


# ---------------------------------------------------------------------------------------------
# V13: the whole mix
# ---------------------------------------------------------------------------------------------
def mix_timeline(plan: dict) -> list[dict]:
    """Output seconds of every body and region in a medley render (render_medley's layout:
    body i = native [native_starts[i], a_out_start of join i or final_end], region i = T_i)."""
    trs, ns = plan["transitions"], plan["native_starts"]
    out, t = [], 0.0
    for i, o in enumerate(plan["order"]):
        end = trs[i]["a_out_start"] if i < len(trs) else float(plan.get("final_end") or o["duration"])
        row = {"track": o["id"], "body_out": t, "body_src": [float(ns[i]), float(end)]}
        t += max(0.0, end - ns[i])
        if i < len(trs):
            tr = trs[i]
            row.update(region_out=t, T=float(tr["T"]), land_out=t + float(tr["T_overlap"]),
                       chapter_next=t + float(tr.get("b_enter_s", tr["T_overlap"])))
            t += float(tr["T"])
        out.append(row)
    return out


def _decode_mono(path: str) -> np.ndarray:
    raw = subprocess.run([FFMPEG, "-v", "error", "-nostdin", "-i", path, "-map", "0:a:0", "-f", "f32le",
                          "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def verify_mix(mp3: str, plan: dict, tracks: list[dict] | dict | None = None, *, feats: dict | None = None,
               timeline: list[dict] | None = None, bt=None, y: np.ndarray | None = None) -> dict:
    """V13 (§16.1): Beat This (CPU) on the rendered mix. Planned body downbeats come from the
    Feats bars (else the tracks' analysis downbeats); landings from each join's T_overlap."""
    bt = bt or bt_beats
    mono = _mono(y) if y is not None else _decode_mono(mp3)
    beats, downs = (np.asarray(v, float) for v in bt(mono, SR))
    tl = timeline or mix_timeline(plan)
    by_id = tracks if isinstance(tracks, dict) else {t["id"]: t for t in (tracks or [])}
    # lead addition B: Beat This runs 15-30 ms late (and is 20 ms-quantised); each track's own
    # lag (its analysis beats against its refined beats) is subtracted near its audio
    lags = {row["track"]: bt_lag(by_id.get(row["track"]), (feats or {}).get(row["track"])) for row in tl}
    planned, p_lag, lands, l_lag = [], [], [], []
    for k, row in enumerate(tl):
        s0, s1 = row["body_src"]
        F = (feats or {}).get(row["track"])
        src = F["bars"]["t"] if F else (by_id.get(row["track"]) or {}).get("downbeats") or []
        mine = [row["body_out"] + (float(d) - s0) for d in src if s0 + 0.05 <= float(d) <= s1 - 0.05]
        planned += mine
        p_lag += [lags[row["track"]]] * len(mine)
        if "land_out" in row:
            lands.append(row["land_out"])
            l_lag.append(lags[tl[k + 1]["track"]] if k + 1 < len(tl) else 0.0)

    def errs(ts, ref, lag):
        ref = np.asarray(ref, float)
        return [float(np.min(np.abs(ref - lg - x))) * 1000 for x, lg in zip(ts, lag)] if len(ref) else [999.0] * len(ts)

    e_body, e_beat, e_land = errs(planned, downs, p_lag), errs(planned, beats, p_lag), errs(lands, downs, l_lag)
    body_frac = float(np.mean(np.array(e_body) <= float(V["v13_body_ms"]))) if e_body else 1.0
    land_frac = float(np.mean(np.array(e_land) <= float(V["v13_land_ms"]))) if e_land else 1.0
    return {
        "status": "pass" if body_frac >= float(V["v13_body_frac"]) and land_frac >= float(V["v13_land_frac"]) else "fail",
        "body_frac": round(body_frac, 4), "body_n": len(e_body),
        "body_med_ms": _r(np.median(e_body)) if e_body else None,
        "body_beat_frac": round(float(np.mean(np.array(e_beat) <= float(V["v13_body_ms"]))), 4) if e_beat else 1.0,
        "land_frac": round(land_frac, 4), "land_n": len(e_land),
        "land_err_ms": [_r(e) for e in e_land],
        "bt_beats": int(len(beats)), "bt_downbeats": int(len(downs)),
        "lag_ms": {k: _r(v * 1000, 1) for k, v in lags.items()},
    }


# ---------------------------------------------------------------------------------------------
# store (§16.3)
# ---------------------------------------------------------------------------------------------
class VerifyStore:
    """verify.json = {version, entries: {hash: Checks}, failed: [hash], bad_landings: [[tid, bar]]}.
    Every write is atomic (tmp file + os.replace) and increments `version`."""

    def __init__(self, path: str):
        self.path = path
        self.lock = threading.RLock()
        self.doc = {"version": 0, "entries": {}, "failed": [], "bad_landings": []}
        if os.path.exists(path):
            with open(path) as fh:
                d = json.load(fh)
            self.doc.update({k: d[k] for k in self.doc if k in d})

    @property
    def version(self) -> int:
        return int(self.doc["version"])

    @property
    def failed(self) -> list[str]:
        return list(self.doc["failed"])

    @property
    def bad_landings(self) -> list[list]:
        return [list(x) for x in self.doc["bad_landings"]]

    def get(self, h: str) -> dict | None:
        c = self.doc["entries"].get(h)
        return copy.deepcopy(c) if c is not None else None

    def is_failed(self, h: str) -> bool:
        return h in self.doc["failed"]

    def is_bad_landing(self, tid: str, bar: int) -> bool:
        return [tid, int(bar)] in self.doc["bad_landings"]

    def put(self, h: str, checks: dict) -> None:
        """Store checks under composition hash h; a failing hash joins `failed`."""
        S.ensure_valid(S.validate_checks(checks), "checks")
        with self.lock:
            self.doc["entries"][h] = copy.deepcopy(checks)
            if checks["status"] == "fail" and h not in self.doc["failed"]:
                self.doc["failed"].append(h)
            elif checks["status"] != "fail" and h in self.doc["failed"]:
                self.doc["failed"].remove(h)
            self._write()

    def mark_failed(self, h: str) -> None:
        with self.lock:
            if h not in self.doc["failed"]:
                self.doc["failed"].append(h)
                self._write()

    def mark_bad_landing(self, tid: str, bar: int) -> None:
        with self.lock:
            if [tid, int(bar)] not in self.doc["bad_landings"]:
                self.doc["bad_landings"].append([tid, int(bar)])
                self._write()

    def _write(self) -> None:
        self.doc["version"] = int(self.doc["version"]) + 1
        d = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".verify-", suffix=".json", dir=d)
        try:
            with os.fdopen(fd, "w") as fh:
                fh.write(S.to_json(self.doc))
            os.chmod(tmp, 0o644)                  # like every other data file (mkstemp makes 0600)
            os.replace(tmp, self.path)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise


# ---------------------------------------------------------------------------------------------
# blend score (medley v6): measured on the RENDERED join, does the level flow from A into B?
# ---------------------------------------------------------------------------------------------
# Listener feedback on v5: big loudness drops mid-mix, sudden rises at B and holes in the low end
# read as "too abrupt, not enough blend"; the joins that worked kept a steady level and low end
# straight through. Calibrated on the v5 mix: the flagged joins 4 (gated_weave), 7 and 14
# (roll_slam) score < 60. The metric does not see loop repetition or A's pitch glide (the
# rejected loop_rewinds / tease_drop score well on level alone): blend_penalties covers those.
BLEND = {
    "ctx_s": 8.0,              # A body before the region / B body after the landing (reference)
    "dip_free_db": 3.0, "dip_per_db": 4.0,          # p10 of the region's half-beat level vs body
    "hole_db": 9.0, "hole_w": 60.0, "low_hz": 150.0,  # <150 Hz band >9 dB under the body's low band
    "jump_free_db": 3.0, "jump_per_db": 3.0,        # adjacent beat-length level windows
    "clash_free": 0.30, "clash_w": 40.0,            # chroma clash of A and B where both sound
    "clash_high": 0.40,                             # a pitch shift is considered above this
    "overlap_rel_db": -20.0, "overlap_min_s": 2.0, "overlap_floor_db": -80.0,
    "pass": 60.0,
}


def _frames_db(x: np.ndarray, hop: int) -> np.ndarray:
    n = len(x) // hop
    if n == 0:
        return np.zeros(0)
    e = np.sqrt(np.mean(x[: n * hop].astype(np.float64).reshape(n, hop) ** 2, axis=1)) + 1e-5
    return 20 * np.log10(e)


def chroma_profile(x: np.ndarray, sr: int = SR, lo: float = 110.0, hi: float = 2000.0) -> np.ndarray | None:
    """12-bin pitch-class energy profile of a mono signal (log-compressed STFT, 110-2000 Hz)."""
    x = _mono(x)
    dec = 4 if sr >= 32000 else 1
    if dec > 1:
        x = _filt(x, "lowpass", 4000.0, sr=sr)[::dec]
    fs = sr / dec
    n = 4096
    if len(x) < n:
        return None
    hop = n // 2
    k = (len(x) - n) // hop + 1
    idx = np.arange(n)[None, :] + hop * np.arange(k)[:, None]
    S_ = np.abs(np.fft.rfft(x[idx] * np.hanning(n)[None, :], axis=1))
    f = np.fft.rfftfreq(n, 1 / fs)
    m = (f >= lo) & (f <= hi)
    pc = np.round(12 * np.log2(f[m] / 440.0)).astype(int) % 12
    mag = np.log1p(100 * S_[:, m] / (S_[:, m].max() + 1e-12)).sum(axis=0)
    prof = np.bincount(pc, weights=mag, minlength=12)
    return prof if prof.sum() > 0 else None


def chroma_clash(pa: np.ndarray, pb: np.ndarray, sr: int = SR, rel_db: float | None = None,
                 min_s: float | None = None) -> tuple[float | None, float]:
    """(clash in [0, 1] or None, overlap seconds): where A's and B's parts both sound (within
    rel_db of their own p95 level, 0.25 s frames), 1 - Pearson r of their pitch-class profiles,
    halved (same key ~0.05-0.2, a clash >= 0.4)."""
    rel_db = BLEND["overlap_rel_db"] if rel_db is None else rel_db
    min_s = BLEND["overlap_min_s"] if min_s is None else min_s
    a, b = _mono(pa), _mono(pb)
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    hop = int(0.25 * sr)
    la, lb = _frames_db(a, hop), _frames_db(b, hop)
    if not len(la):
        return None, 0.0
    both = (la > max(BLEND["overlap_floor_db"], np.percentile(la, 95) + rel_db)) & \
           (lb > max(BLEND["overlap_floor_db"], np.percentile(lb, 95) + rel_db))
    ov = float(both.sum() * hop / sr)
    if ov < min_s:
        return None, round(ov, 2)
    keep = np.repeat(both, hop)
    ka, kb = a[: len(keep)][keep], b[: len(keep)][keep]
    A, B = chroma_profile(ka, sr), chroma_profile(kb, sr)
    if A is None or B is None:
        return None, round(ov, 2)
    r = float(np.corrcoef(A, B)[0, 1])
    return round((1 - r) / 2, 3), round(ov, 2)


def blend_join(y: np.ndarray, sr: int, r0: float, land: float, beat: float,
               clash: float | None = None, ov_s: float = 0.0) -> dict:
    """Blend metrics of one join in `y` (mono or stereo seconds-indexed audio holding A's body
    before r0, the region [r0, land] up to B's landing, and B's body after): beat-length
    energy windows at half-beat steps, so the space between kicks is not a dropout;
    reference = median of the frames outside [r0, land]. -> {score, dip, holes, jump, clash, ...}."""
    B_ = BLEND
    x = _mono(y)
    hop = max(64, int(sr * max(0.1, float(beat)) / 2))
    def beat_levels(signal):
        levels = _frames_db(signal, hop)
        if len(levels) < 2:
            return np.zeros(0)
        # Average energy, not decibels: a quiet offbeat must not drag down a healthy kick.
        return 10 * np.log10(np.convolve(10 ** (levels / 10), np.ones(2) / 2, "valid"))

    L = beat_levels(x)
    Llo = beat_levels(_filt(x, "lowpass", B_["low_hz"], sr=sr))
    tt = (np.arange(len(L)) + 1) * hop / sr
    mid = (tt >= r0) & (tt <= land)
    out_ = ~mid
    if not mid.any() or not out_.any():
        return {"score": None}
    ref, refl = float(np.median(L[out_])), float(np.median(Llo[out_]))
    dip = ref - float(np.percentile(L[mid], 10))
    holes = float(np.mean(Llo[mid] < refl - B_["hole_db"]))
    # Compare neighbouring whole beats. Differencing a four-frame moving average
    # divides a real step by four and hides precisely the cliffs we want to reject.
    boundaries = tt[1:-1]
    sel = (boundaries >= r0 - hop / sr) & (boundaries <= land + hop / sr)
    steps = np.abs(L[2:] - L[:-2])
    jump = float(np.max(steps[sel])) if sel.any() else 0.0
    sub = {"dip": B_["dip_per_db"] * max(0.0, dip - B_["dip_free_db"]),
           "holes": B_["hole_w"] * holes,
           "jump": B_["jump_per_db"] * max(0.0, jump - B_["jump_free_db"]),
           "clash": B_["clash_w"] * max(0.0, (clash or 0.0) - B_["clash_free"])}
    score = max(0.0, min(100.0, 100.0 - sum(sub.values())))
    return {"score": round(score, 1), "dip": round(dip, 2), "holes": round(holes, 3), "jump": round(jump, 2),
            "clash": clash, "overlap_s": ov_s, "mix_s": round(land - r0, 2),
            "loss": {k: round(v, 1) for k, v in sub.items()}}


def blend_render(out, pa, pb, pre, post, t_land: float, beat: float, sr: int = SR, xf: int = 0) -> dict:
    """blend_join on a rendered region (render_comp's out / pa / pb cover region seconds
    [-xf, T + xf] samples), with A's native body `pre` before it and B's `post` after it."""
    o = _mono(out)
    pa_, pb_ = _mono(pa), _mono(pb)
    if xf:
        o, pa_, pb_ = o[xf:len(o) - xf], pa_[xf:len(pa_) - xf], pb_[xf:len(pb_) - xf]
    pre_ = _mono(pre) if pre is not None else np.zeros(0, np.float32)
    post_ = _mono(post) if post is not None else np.zeros(0, np.float32)
    y = np.concatenate([pre_, o, post_])
    r0 = len(pre_) / sr
    n_land = int(t_land * sr)
    clash, ov = chroma_clash(pa_[:n_land], pb_[:n_land], sr)
    return blend_join(y, sr, r0, r0 + float(t_land), beat, clash, ov)


def blend_mix(y: np.ndarray, sr: int, report: dict) -> list[dict]:
    """blend_join for every join of a rendered medley (report: the build JSON, with timeline and
    plan.transitions); no chroma (the mix has no separate parts)."""
    out = []
    ctx = BLEND["ctx_s"]
    for i, tr in enumerate(report["plan"]["transitions"]):
        tl = report["timeline"][i]
        r0, land = float(tl["region_out"]), float(tl["land_out"])
        beat = float((tr["composition"].get("b_ref") or {}).get("period_s") or 0.5)
        t0 = max(0.0, r0 - ctx)
        seg = y[int(t0 * sr): int((land + ctx) * sr)]
        out.append(blend_join(seg, sr, r0 - t0, land - t0, beat))
    return out


def comp_traits(comp: dict) -> dict:
    """What the level metric cannot hear: A's pitch shift (semitones, and whether it glides while
    B sounds), loop repeats, and the composed middle's length in bars."""
    semis = 0.0
    glide_under_b = False
    b_first = min((float(c["at"]) for c in comp.get("clips", []) if c.get("src") == "b"), default=0.0)
    for c in comp.get("clips", []):
        p = c.get("pitch")
        if p and float(p.get("semis", 0)):
            semis = max(semis, abs(float(p["semis"])), key=abs)
            if float(p.get("m1", p.get("m0", 0))) > b_first + 1e-6 and float(p.get("m1", 0)) != float(p.get("m0", 0)):
                glide_under_b = True
    loops = [int(m.get("count", 1)) for m in comp.get("moves", []) if m.get("type") == "loop"]
    bpb = float(comp.get("bpb") or 4)
    bars = max(0.0, -b_first / bpb)
    return {"pitch_semis": semis, "glide_under_b": glide_under_b, "loop_repeats": max([n - 1 for n in loops] or [0]),
            "bars": round(bars, 2)}


PENALTY = {"pitch": 12.0, "glide_under_b": 40.0, "loop_base": 10.0, "loop_per_repeat": 15.0,
           "bar_free": 4.0, "per_bar": 0.8, "prior_scale": 20.0}


def blend_penalties(comp: dict, prior: float | None = None) -> dict:
    """Selection penalties beside the measured blend: A pitch glide (any shift; worse under B), a
    loop (base + per repeat beyond the first), length beyond 4 bars, and the form's rating prior
    (prior in [-1, 1]: (Bayesian mean rating - 60) / 40)."""
    P = PENALTY
    t = comp_traits(comp)
    pen = {}
    if t["pitch_semis"]:
        pen["pitch"] = P["pitch"] + (P["glide_under_b"] if t["glide_under_b"] else 0.0)
    if t["loop_repeats"]:
        pen["loop"] = P["loop_base"] + P["loop_per_repeat"] * max(0, t["loop_repeats"] - 1)
    if t["bars"] > P["bar_free"]:
        pen["length"] = round(P["per_bar"] * (t["bars"] - P["bar_free"]), 2)
    if prior:
        pen["prior"] = round(-P["prior_scale"] * float(prior), 2)
    return {"traits": t, "penalties": pen, "total": round(sum(pen.values()), 2)}


def form_priors(ratings: dict | None, m0: float = 60.0, k: float = 2.0) -> dict[str, float]:
    """Per-form prior in [-1, 1] from medley-ratings.json: Bayesian mean (k pseudo-ratings of m0
    plus the form's ratings), (mean - m0) / 40. Forms without ratings are absent (0)."""
    acc: dict[str, list[float]] = {}
    for v in (ratings or {}).values():
        if isinstance(v, dict) and v.get("form") and isinstance(v.get("value"), (int, float)):
            acc.setdefault(str(v["form"]), []).append(float(v["value"]))
    return {f: max(-1.0, min(1.0, ((k * m0 + sum(vs)) / (k + len(vs)) - m0) / 40.0))
            for f, vs in acc.items()}


def load_form_priors(path: str) -> dict[str, float]:
    try:
        import json
        with open(path) as fh:
            return form_priors(json.load(fh))
    except (OSError, ValueError):
        return {}
