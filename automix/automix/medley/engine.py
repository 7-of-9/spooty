"""Medley renderer (DESIGN §13): a compiled Program -> the region audio for [-XF, T + XF].

`render_program` is pure DSP on arrays. `render_join` is the drop-in `region_fn` for
render.render_clip / render_full: it compiles tr["composition"] (medley.compile) and renders it.

Region contract (R11). Output sample i is region time t = (i - xf) / sr, so out[:xf] overlaps the
native pre-roll and out[-xf:] the native post-roll exactly as render_region does. A native `copy`
segment that touches the region start is anchored at t = 0, one that touches the region end at
t = T (to tr["a_out_start"] / tr["b_in_end"] when render_join passes them), so those samples are
y[round(s * sr) + k] * track gain: bit for bit what render.crop gives.

Transitions (§13 step 3). Every lane step (two knots at one time) and every jump between adjacent
pos segments is a raised-cosine crossfade over [t, t + xf_ms], xf_ms from the matching Splice
(else CFG splice_xf_ms); the outgoing side keeps reading through the fade, and a same-source jump
first searches ±search_ms for the incoming offset that best continues the waveform. A clip's own
edges fade inside its pos segments: in over [t0, t0 + xf], out over [t1 - xf, t1]; never at the
region edges.

Per clip (§13 steps 1-4, 6): source W (native crop, or one Rubber Band R2 --timemap of the window,
stems as one 8-channel file) -> pseudo-stem split on W (low/high) -> playhead -> 3-band EQ ->
HP -> LP -> gain lane x trim x track gain. Echo buses capture a clip's post-fader signal (§13
step 5). pa / pb are the A / B sums; a loudness guard (step 7) then trims both where the overlap
runs hot. Parts are returned unlimited.
"""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import numpy as np

from ..audio import SR, split_bands, timemap_stretch
from . import CFG, dsp
from .schema import STEM_NAMES, Program, from_json

R2_OPTS = "rubberband-4.0.0|R2|timemap"      # every WarpCache key; the engine never uses R3
_R2_SEM = threading.BoundedSemaphore(int(CFG["r2_procs"]))
_MARGIN_S = 0.1                                # native window margin: splice search, filter settling
_EDGE_TOL_S = 0.005                            # render_join anchors must agree with the program
_CO = CFG["compile"]


# ---------------------------------------------------------------------------------------------
# warp cache and R2
# ---------------------------------------------------------------------------------------------
class WarpCache:
    """LRU of warped source windows bounded by bytes (§13 step 1). Thread-safe and single-flight:
    concurrent requests for one key run Rubber Band once. Cached arrays are read-only."""

    def __init__(self, max_bytes: int = int(CFG["warp_cache_mb"]) << 20):
        self.max_bytes = int(max_bytes)
        self.items: OrderedDict[str, np.ndarray] = OrderedDict()
        self.nbytes = 0
        self.hits = self.misses = 0
        self._lock = threading.Lock()
        self._inflight: dict[str, threading.Event] = {}

    def __len__(self) -> int:
        return len(self.items)

    def __contains__(self, key: str) -> bool:
        with self._lock:
            return key in self.items

    def get(self, key: str) -> np.ndarray | None:
        with self._lock:
            arr = self.items.get(key)
            if arr is not None:
                self.items.move_to_end(key)
                self.hits += 1
            return arr

    def put(self, key: str, arr: np.ndarray) -> np.ndarray:
        arr = np.ascontiguousarray(arr)
        arr.setflags(write=False)
        with self._lock:
            old = self.items.pop(key, None)
            if old is not None:
                self.nbytes -= old.nbytes
            if arr.nbytes <= self.max_bytes:
                self.items[key] = arr
                self.nbytes += arr.nbytes
                while self.nbytes > self.max_bytes:
                    _, v = self.items.popitem(last=False)
                    self.nbytes -= v.nbytes
        return arr

    def get_or_compute(self, key: str, fn) -> np.ndarray:
        while True:
            with self._lock:
                arr = self.items.get(key)
                if arr is not None:
                    self.items.move_to_end(key)
                    self.hits += 1
                    return arr
                ev = self._inflight.get(key)
                owner = ev is None
                if owner:
                    ev = self._inflight[key] = threading.Event()
                    self.misses += 1
            if not owner:
                ev.wait()                  # then re-check: the owner may have failed
                continue
            try:
                return self.put(key, fn())
            finally:
                with self._lock:
                    self._inflight.pop(key, None)
                ev.set()


def warp_key(seg: np.ndarray, src: list[float], dst: list[float]) -> str:
    """sha1 over the R2 options, the anchors (rounded to anchor_round_ms) and the window's samples
    (so track, file version, stems version and stem set are all covered)."""
    q = 1000.0 / float(CFG["render"]["anchor_round_ms"])
    h = hashlib.sha1(f"{R2_OPTS}|{seg.shape}|{seg.dtype}|".encode())
    h.update(np.round(np.asarray(src, dtype=float) * q).astype(np.int64).tobytes())
    h.update(np.round(np.asarray(dst, dtype=float) * q).astype(np.int64).tobytes())
    h.update(np.ascontiguousarray(seg).data)
    return h.hexdigest()


def warp(seg: np.ndarray, src: list[float], dst: list[float], sr: int = SR,
         wc: WarpCache | None = None) -> np.ndarray:
    """Rubber Band R2 --timemap of seg (any channel count) so that src[k] (s from seg[0]) lands
    on dst[k] (s from W[0]); at most r2_procs processes at once."""
    def run() -> np.ndarray:
        with _R2_SEM:
            return timemap_stretch(seg, list(src), list(dst), sr)
    return run() if wc is None else wc.get_or_compute(warp_key(seg, src, dst), run)


# ---------------------------------------------------------------------------------------------
# sources
# ---------------------------------------------------------------------------------------------
def _crop(y: np.ndarray, i0: int, i1: int) -> np.ndarray:
    out = np.zeros((max(0, i1 - i0), y.shape[1] if y.ndim == 2 else 1), np.float32)
    a, b = max(i0, 0), min(i1, len(y))
    if b > a:
        out[a - i0: b - i0] = y[a:b].reshape(b - a, -1)
    return out


def _stems8(stems, mix: np.ndarray, i0: int, i1: int) -> np.ndarray:
    """(n, 8) float32 in STEM_NAMES order over mix frames [i0, i1); other = mix - (d + b + v).
    `stems` is a TrackStems-like object (.frames(i0, i1, names)) or {name: full (n, 2) array}."""
    names = ("drums", "bass", "vocals")
    if isinstance(stems, dict):
        got = {n: _crop(stems[n], i0, i1) for n in names}
    else:
        got = stems.frames(i0, i1, names)
    got["other"] = _crop(mix, i0, i1) - (got["drums"] + got["bass"] + got["vocals"])
    return np.concatenate([got[n] for n in STEM_NAMES], axis=1)


def _pick(raw: np.ndarray, sel, sr: int) -> np.ndarray:
    """The clip's signal from its raw source window: the mix, a 150 Hz pseudo-stem, or a stem sum."""
    if isinstance(sel, list):
        out = np.zeros((len(raw), 2), np.float32)
        for name in sel:
            k = STEM_NAMES.index(name)
            out += raw[:, 2 * k: 2 * k + 2]
        return out
    if sel in ("low", "high"):
        lo, hi = split_bands(raw, CFG["crossover_low_hz"], sr)
        return lo if sel == "low" else hi
    return raw


@dataclass
class _Src:
    W: np.ndarray            # (n, 2) float32
    native: bool
    s0: float
    origin: int              # native: absolute track frame of W[0]; r2: 0
    src: dict = field(default_factory=dict)

    def index(self, w, sr: int):
        """Fractional W index of W-second(s) w."""
        return (self.s0 + np.asarray(w)) * sr - self.origin if self.native else np.asarray(w) * sr

    def iindex(self, w: float, sr: int) -> int:
        """Integer W index of W second w, on the track's own frame grid for native sources."""
        return int(round((self.s0 + w) * sr)) - self.origin if self.native else int(round(w * sr))

    def track_s(self, w: float) -> float:
        """Track seconds of W second w."""
        if self.native:
            return self.s0 + w
        return float(np.interp(w, self.src["dst_anchors"], self.src["src_anchors"]))


def _sources(prog: Program, tracks: dict, stems: dict, wc: WarpCache | None) -> dict[str, _Src]:
    """Stage 1: every clip's source window. R2 windows are deduplicated by key and run in parallel."""
    sr = prog.sr
    M = int(round(_MARGIN_S * sr))
    raws, jobs, out = {}, {}, {}
    for c in prog.clips:
        if c.src not in tracks:
            raise ValueError(f"clip {c.id}: no audio for source {c.src!r}")
        src, y = c.source, tracks[c.src]
        use_stems = isinstance(c.stems, list)
        if use_stems and stems.get(c.src) is None:
            raise ValueError(f"clip {c.id} needs stems of track {c.src!r}, none supplied")
        lo, hi = int(round(src["s0"] * sr)), int(round(src["s1"] * sr))
        if src["kind"] == "native":
            i0, i1 = lo - M, hi + M
            raw = _stems8(stems[c.src], y, i0, i1) if use_stems else _crop(y, i0, i1)
            raws[c.id] = (raw, True, i0)
        elif src["kind"] == "r2":
            if c.src == "b":
                raise ValueError(f"clip {c.id}: B is never warped (R2)")
            seg = _stems8(stems[c.src], y, lo, hi) if use_stems else _crop(y, lo, hi)
            s_rel = [a - src["s0"] for a in src["src_anchors"]]
            key = warp_key(seg, s_rel, src["dst_anchors"])
            jobs.setdefault(key, (seg, s_rel, list(src["dst_anchors"])))
            raws[c.id] = (key, False, 0)
        else:
            raise ValueError(f"clip {c.id}: source kind {src['kind']!r}")
    done = {}
    if jobs:
        def job(key):
            seg, s_rel, dst = jobs[key]
            return warp(seg, s_rel, dst, sr, wc)
        keys = list(jobs)
        if len(keys) == 1:
            done[keys[0]] = job(keys[0])
        else:
            with ThreadPoolExecutor(max_workers=min(len(keys), int(CFG["r2_procs"]))) as ex:
                done = dict(zip(keys, ex.map(job, keys)))
    for c in prog.clips:
        raw, native, origin = raws[c.id]
        if not native:
            raw = done[raw]
        W = _pick(raw, c.stems, sr)
        if c.source.get("pitch"):
            W = pitch_glide(W, c.source["pitch"], sr, wc)
        out[c.id] = _Src(W, native, float(c.source["s0"]), origin, c.source)
    return out


def pitch_glide(W: np.ndarray, knots: list, sr: int = SR, wc: WarpCache | None = None) -> np.ndarray:
    """Creation key fix: Rubber Band (R2, --pitchmap) on a clip's picked W signal, 0 semitones
    before knots[0][0] (W s), a linear glide to knots[-1][1] semitones at knots[-1][0], then
    held. Length and timing are kept (W stays on its timemap); cached like the R2 warps."""
    from ..audio import pitch_map_shift
    h = hashlib.sha1(f"pitch|{W.shape}|{json_knots(knots)}".encode())
    h.update(np.ascontiguousarray(W).data)

    def run() -> np.ndarray:
        with _R2_SEM:
            return pitch_map_shift(W, knots, sr)
    return run() if wc is None else wc.get_or_compute(h.hexdigest(), run)


def json_knots(knots: list) -> str:
    return ";".join(f"{float(w):.4f}:{float(v):.3f}" for w, v in knots)


# ---------------------------------------------------------------------------------------------
# playhead (stage 2) and splices (stage 3)
# ---------------------------------------------------------------------------------------------
class _Seg:
    """One pos segment of a clip, readable over any output range (extrapolating its law)."""

    def __init__(self, seg: dict, S: _Src, i0: int, i1: int, xf: int, sr: int,
                 iref: int | None = None, base: int | None = None):
        self.seg, self.S, self.i0, self.i1, self.xf, self.sr = seg, S, i0, i1, xf, sr
        self.copy = seg["kind"] == "copy"
        self.edge = iref is not None          # anchored on a region edge: never shifted
        self.shift: float = 0
        if self.copy:
            self.iref = iref if iref is not None else xf + int(round(seg["t0"] * sr))
            self.base = base if base is not None else S.iindex(seg["w0"], sr)
            self.key = ("copy", self.base + (i0 - self.iref))
        else:
            self.key = ("vary", round(seg["w"][0] * sr), len(seg["w"]))

    def _t(self, a: int, b: int) -> np.ndarray:
        return (np.arange(a, b) - self.xf) / self.sr

    def pos_at(self, i: int) -> float:
        """W index this segment reads at output sample i (without shift)."""
        if self.copy:
            return float(self.base + (i - self.iref))
        w, _ = dsp.upsample_positions(self.seg["w"], _CO["vary_step_s"], self.seg["t0"], self._t(i, i + 1))
        return float(self.S.index(w[0], self.sr))

    def read(self, a: int, b: int, shift: float = 0) -> np.ndarray:
        if b <= a:
            return np.zeros((0, 2), np.float32)
        if self.copy:
            k = self.base + (a - self.iref) + int(shift)
            return _crop(self.S.W, k, k + (b - a))
        w, rate = dsp.upsample_positions(self.seg["w"], _CO["vary_step_s"], self.seg["t0"], self._t(a, b))
        pos = self.S.index(w, self.sr) + shift
        return dsp.read_varispeed(self.S.W, pos / self.sr, self.sr, rate)


class _Splices:
    """Program splices by clip, matched to a time within 1 ms."""

    def __init__(self, splices):
        self.by = {}
        for s in splices:
            self.by.setdefault(s.clip, []).append(s)

    def find(self, clip: str, t: float, tol: float = 1e-3):
        best = None
        for s in self.by.get(clip, []):
            if abs(s.t - t) <= tol and (best is None or abs(s.t - t) < abs(best.t - t)):
                best = s
        return best

    def xf(self, clip: str, t: float, sr: int) -> int:
        s = self.find(clip, t)
        return max(1, int(round((s.xf_ms if s else CFG["splice_xf_ms"]) * sr / 1000)))

    def search(self, clip: str, t: float, sr: int) -> int:
        s = self.find(clip, t)
        return int(round((s.search_ms if s else CFG["splice_search_ms"]) * sr / 1000))


def _playhead(c, S: _Src, prog: Program, N: int, nT: int, sp: _Splices, edge_abs: dict,
              memo: dict) -> tuple[np.ndarray, np.ndarray]:
    """Stage 2 + pos splices: the clip's raw signal (N, 2) and its existence envelope (N,)."""
    sr, xf = prog.sr, prog.xf
    x = np.zeros((N, 2), np.float32)
    env = np.zeros(N, np.float32)
    segs: list[_Seg] = []
    lo_edge, hi_edge = -xf / sr + 0.5 / sr, prog.T + xf / sr - 0.5 / sr
    raw = sorted(c.pos, key=lambda s: s["t0"])
    for k, seg in enumerate(raw):
        i0 = max(0, xf + int(round(seg["t0"] * sr)))
        i1 = min(N, xf + int(round(seg["t1"] * sr)))
        if i1 <= i0:
            continue
        iref = base = None
        if S.native and seg["kind"] == "copy":
            at_start, at_end = seg["t0"] <= lo_edge, seg["t1"] >= hi_edge
            if at_end and (c.src == "b" or not at_start):
                iref = xf + nT
                s_T = S.s0 + seg["w0"] + (prog.T - seg["t0"])
                base = int(round(edge_abs.get(("end", c.src), s_T) * sr)) - S.origin
            elif at_start:
                iref = xf
                s_0 = S.s0 + seg["w0"] - seg["t0"]
                base = int(round(edge_abs.get(("start", c.src), s_0) * sr)) - S.origin
        segs.append(_Seg(seg, S, i0, i1, xf, sr, iref, base))
    prev: _Seg | None = None
    for cur in segs:
        t_b = (cur.i0 - xf) / sr
        adjacent = prev is not None and prev.i1 == cur.i0
        if adjacent:
            p_prev = prev.pos_at(cur.i0) + prev.shift
            p_cur = cur.pos_at(cur.i0)
            gap = p_prev - p_cur
            seamless = abs(gap) < 0.5 or (abs(gap) <= 1.5 and not cur.edge)
            if seamless:
                cur.shift = 0 if abs(gap) < 0.5 else (int(round(gap)) if cur.copy else gap)
                x[cur.i0:cur.i1] = cur.read(cur.i0, cur.i1, cur.shift)
            else:
                nx = sp.xf(c.id, t_b, sr)
                S_ = 0 if cur.edge else sp.search(c.id, t_b, sr)
                a_ext = prev.read(cur.i0, cur.i0 + nx, prev.shift)
                if S_ > 0:
                    mk = (c.id, prev.key, cur.key, nx, S_)
                    if mk not in memo:
                        memo[mk] = dsp.splice_offset(a_ext, cur.read(cur.i0 - S_, cur.i0 + nx + S_), nx, S_)
                    cur.shift = memo[mk]
                body = cur.read(cur.i0, cur.i1, cur.shift)
                n = min(nx, len(body))
                w = dsp.raised_cos(n).astype(np.float32)[:, None]
                body[:n] = a_ext[:n] * (1 - w) + body[:n] * w
                x[cur.i0:cur.i1] = body
        else:
            if prev is not None and prev.i1 < N:           # the previous run ends: fade out inside it
                n = min(sp.xf(c.id, (prev.i1 - xf) / sr, sr), prev.i1 - prev.i0)
                env[prev.i1 - n: prev.i1] *= dsp.raised_cos(n)[::-1].astype(np.float32)
            x[cur.i0:cur.i1] = cur.read(cur.i0, cur.i1)
        env[cur.i0:cur.i1] = 1.0
        if not adjacent and cur.i0 > 0:                    # a new run starts: fade in inside it
            n = min(sp.xf(c.id, t_b, sr), cur.i1 - cur.i0)
            env[cur.i0: cur.i0 + n] = dsp.raised_cos(n).astype(np.float32)
        prev = cur
    if prev is not None and prev.i1 < N:
        n = min(sp.xf(c.id, (prev.i1 - xf) / sr, sr), prev.i1 - prev.i0)
        env[prev.i1 - n: prev.i1] *= dsp.raised_cos(n)[::-1].astype(np.float32)
    return x, env


def _lane_amp(knots: list, clip: str, N: int, prog: Program, sp: _Splices) -> np.ndarray:
    """A dB lane as linear amplitude per output sample, each step softened per its splice."""
    sr, xf = prog.sr, prog.xf
    amp = dsp.db_to_amp(dsp.lane_eval(knots, N, sr, -xf / sr, "db"))
    if knots:
        t = dsp.sample_times(N, sr, -xf / sr)
        for ts in dsp.lane_steps(knots):
            dsp.soften_step(amp, int(np.searchsorted(t, ts, side="left")), sp.xf(clip, ts, sr))
    return amp


# ---------------------------------------------------------------------------------------------
# echoes, loudness guard
# ---------------------------------------------------------------------------------------------
def _beat_after(prog: Program, t: float, k: int = 1) -> float | None:
    """The k-th grid beat after the one at t (e.g. B's second beat after the landing)."""
    ts = sorted(float(g[0]) for g in prog.grid)
    after = [x for x in ts if x >= t - 1e-3]
    if len(after) > k:
        return after[k]
    if len(ts) >= 2:
        return t + k * (ts[-1] - ts[-2])
    return None


def _render_echo(e, prog: Program, clip_out: dict, N: int, nT: int) -> np.ndarray:
    """§13 step 5 with the §9 tail rule: capture the clip's post-fader signal, clamp fb, keep the
    loop HP >= 1 kHz after the landing (A tails), duck from the key clip's onsets, and fade the
    tail out by T so the region end stays B's native crop."""
    sr, xf = prog.sr, prog.xf
    y = clip_out[e.clip]
    c0 = max(0, xf + int(round(e.capture[0] * sr)))
    c1 = min(N, xf + int(round(e.capture[1] * sr)))
    wet = np.zeros((N, 2), np.float32)
    if c1 <= c0:
        return wet
    cap = y[c0:c1].copy()
    ne = min(int(0.002 * sr), (c1 - c0) // 2)
    if ne > 0:
        r = dsp.raised_cos(ne).astype(np.float32)[:, None]
        cap[:ne] *= r
        cap[-ne:] *= r[::-1]
    cap *= np.float32(10 ** (e.send_db / 20))
    fb = min(float(e.fb), float(CFG["echo_fb_max"]))
    floor = None
    if e.part == "a":                          # A's tail under B obeys the tail rule
        b2 = _beat_after(prog, prog.t_land)
        if b2 is not None:
            fb = min(fb, dsp.tail_rule_fb(e.delay_s, e.send_db, b2 - e.capture[1]))
        floor = (prog.t_land, float(_CO["echo_tail_hp_hz"]))
    t_c0 = (c0 - xf) / sr
    w = dsp.echo_bus(cap, e.delay_s, fb, e.tail_s, e.hp_hz, e.lp_hz, sr, t0=t_c0, hp_floor=floor)
    end = min(c0 + len(w), xf + nT, N)
    w = w[: end - c0]
    nf = min(int(0.02 * sr), len(w))
    if nf > 0:
        w[-nf:] *= dsp.raised_cos(nf)[::-1].astype(np.float32)[:, None]
    wet[c0:end] = w
    duck = e.duck
    if duck is None and e.part == "a" and end > xf + int(round(prog.t_land * sr)):
        key = next((c.id for c in prog.clips if c.src == "b" and any(
            s["t0"] <= prog.t_land < s["t1"] for s in c.pos)), None)
        b1 = _beat_after(prog, prog.t_land, 1)
        if key is not None:
            duck = {"key": key, "depth_db": _CO["echo_duck_db"],
                    "release_s": _CO["echo_duck_release_beats"] * ((b1 - prog.t_land) if b1 else 0.5)}
    if duck and duck.get("key") in clip_out:
        wet *= _duck_lane(duck, prog, clip_out[duck["key"]], N)[:, None]
    return wet


def _duck_lane(duck: dict, prog: Program, key_sig: np.ndarray, N: int) -> np.ndarray:
    """Gain (N,) dipping depth_db at each key onset (1 ms attack), releasing linearly in dB."""
    sr, xf = prog.sr, prog.xf
    ons = prog.expect.get("onsets", {}).get(duck["key"]) if isinstance(prog.expect, dict) else None
    if ons:
        s = np.array([o[1] for o in ons], dtype=float)
        times = np.array([o[0] for o in ons], dtype=float)[s >= np.median(s)]
    else:
        times = dsp.rise_onsets(key_sig, sr) - xf / sr
    depth, rel = float(duck["depth_db"]), max(1e-3, float(duck.get("release_s", 0.1)))
    t = dsp.sample_times(N, sr, -xf / sr)
    db = np.zeros(N)
    att = 0.001
    for to in times:
        a, b = np.searchsorted(t, to - att), np.searchsorted(t, to + rel)
        x = t[a:b] - to
        d = np.where(x < 0, -depth * (x + att) / att, -depth * (1 - x / rel))
        db[a:b] = np.minimum(db[a:b], d)
    return (10 ** (db / 20)).astype(np.float32)


def _source_time(c, S: _Src, t: float) -> float | None:
    """Track seconds the clip plays at region time t (None when it has no segment there)."""
    for seg in c.pos:
        if seg["t0"] <= t < seg["t1"]:
            if seg["kind"] == "copy":
                return S.track_s(seg["w0"] + (t - seg["t0"]))
            w, _ = dsp.upsample_positions(seg["w"], _CO["vary_step_s"], seg["t0"], np.array([t]))
            return S.track_s(float(w[0]))
    return None


def _loudness_guard(prog: Program, pa: np.ndarray, pb: np.ndarray, tracks: dict, gains: dict,
                    srcs: dict, N: int, nT: int) -> np.ndarray | None:
    """§13 step 7: where the 3 s short-term loudness of pa + pb exceeds max(L_A, L_B) + 1 LU for
    more than a bar, a correction of at most loud_correct_max_db with bar-long ramps (0 dB in the
    first and last bar, so the region edges are untouched). L_A = 3 s of gained A before the
    region, L_B = 3 s of gained B from the landing."""
    sr, xf = prog.sr, prog.xf
    lo = CFG["loudness"]
    win = float(lo["short_s"])
    nw = int(round(win * sr))
    refs: dict[str, float] = {}
    for c in prog.clips:
        if c.src not in ("a", "b") or c.src in refs:
            continue
        s = _source_time(c, srcs[c.id], 0.0 if c.src == "a" else prog.t_land + 1e-4)
        if s is not None:
            i = int(round(s * sr))
            i0, i1 = (i - nw, i) if c.src == "a" else (i, i + nw)
            refs[c.src] = dsp.lufs(_crop(tracks[c.src], i0, i1) * gains[c.src], sr)
    vals = [L for L in refs.values() if np.isfinite(L)]
    if not vals:
        return None
    ref = max(vals) + float(lo["correct_over_lu"])
    ctr, L = dsp.short_term_lufs(pa + pb, sr, win)
    if not len(L):
        return None
    downs = [float(g[0]) for g in prog.grid if g[1]]
    bar = float(np.median(np.diff(downs))) if len(downs) > 1 else 2.0
    over = L - ref
    hot = over > 0
    corr = np.zeros(len(L))
    k = 0
    hop_s = (ctr[1] - ctr[0]) / sr if len(ctr) > 1 else 0.1
    while k < len(L):
        if not hot[k]:
            k += 1
            continue
        j = k
        while j < len(L) and hot[j]:
            j += 1
        if (j - k) * hop_s > bar * float(lo["correct_min_bars"]):
            corr[k:j] = -np.minimum(float(CFG["loud_correct_max_db"]), over[k:j])
        k = j
    if not corr.any():
        return None
    db = np.interp(np.arange(N), ctr, corr, left=0.0, right=0.0)
    nb = max(1, int(round(bar * sr)))
    # widen by half a bar each side (running minimum), then bar-long ramps (moving average)
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    db = uniform_filter1d(minimum_filter1d(db, size=nb), size=nb)
    taper = np.clip((np.minimum(np.arange(N) - xf, xf + nT - np.arange(N)) - nb) / nb, 0.0, 1.0)
    db = np.where(taper > 0, db * taper, 0.0)
    return dsp.db_to_amp(db).astype(np.float32)


# ---------------------------------------------------------------------------------------------
# render
# ---------------------------------------------------------------------------------------------
def _as_program(prog) -> Program:
    return prog if isinstance(prog, Program) else from_json(prog, Program)


def render_program(prog, ya: np.ndarray, yb: np.ndarray, ga: float, gb: float,
                   stems_a=None, stems_b=None, wc: WarpCache | None = None, *,
                   anchor: dict | None = None, loud_guard: bool = True,
                   clip_sink: dict | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Render a Program (dataclass or its JSON dict) to (out, pa, pb), each (round(T*sr) + 2*xf, 2)
    float32, out = pa + pb, unlimited. ga/gb are the track gains (render.track_gain); stems_a/b are
    None, a stems.TrackStems or {name: full array}. `anchor` {"a": a_out_start, "b": b_in_end,
    "T": T} pins the native edges to the transition's own seconds (render_join passes it);
    `clip_sink` receives each clip's final signal by id."""
    prog = _as_program(prog)
    sr, xf = prog.sr, prog.xf
    anchor = anchor or {}
    T_a = anchor.get("T")
    nT = int(round((T_a if T_a is not None and abs(T_a - prog.T) < 1e-3 else prog.T) * sr))
    N = nT + 2 * xf
    tracks = {"a": ya, "b": yb}
    gains = {"a": float(ga), "b": float(gb)}
    srcs = _sources(prog, tracks, {"a": stems_a, "b": stems_b}, wc)
    sp = _Splices(prog.splices)

    # native edge anchors from the transition, when they agree with the program's own
    edge_abs = {}
    for c in prog.clips:
        S = srcs[c.id]
        if not S.native:
            continue
        for side, key, t in (("start", "a", 0.0), ("end", "b", prog.T)):
            v = anchor.get(key)
            if v is None or c.src != key:
                continue
            own = _source_time(c, S, min(max(t, 0.0), prog.T - 1e-9))
            if own is not None and abs(own - v) < _EDGE_TOL_S:
                edge_abs[(side, c.src)] = float(v)

    pa = np.zeros((N, 2), np.float32)
    pb = np.zeros((N, 2), np.float32)
    clip_out: dict[str, np.ndarray] = {}
    memo: dict = {}
    t0 = -xf / sr
    for c in prog.clips:
        S = srcs[c.id]
        x, env = _playhead(c, S, prog, N, nT, sp, edge_abs, memo)
        # tone: EQ (only when a band leaves 0 dB), then HP, then LP; neutral = exact pass-through
        gains3 = {b: _lane_amp(c.eq_db.get(b) or [], c.id, N, prog, sp) for b in ("low", "mid", "high")}
        if any(not np.all(g == 1.0) for g in gains3.values()):
            lo, mid, hi = dsp.bands3(x, sr)
            x = (x + lo * (gains3["low"] - 1).astype(np.float32)[:, None]
                 + mid * (gains3["mid"] - 1).astype(np.float32)[:, None]
                 + hi * (gains3["high"] - 1).astype(np.float32)[:, None])
        if c.hp_hz:
            x = dsp.sweep(x, "hp", c.hp_hz, sr, t0)
        if c.lp_hz:
            x = dsp.sweep(x, "lp", c.lp_hz, sr, t0)
        g_track = gains[c.track_gain_from]
        fac = (_lane_amp(c.gain_db, c.id, N, prog, sp) * env * (10 ** (float(c.trim_db) / 20)) * g_track)
        y = x * fac.astype(np.float32)[:, None]
        clip_out[c.id] = y
        part = pb if c.src == "b" else pa          # motif clips join A's part
        part += y
    for e in prog.echoes:
        part = pb if e.part == "b" else pa
        part += _render_echo(e, prog, clip_out, N, nT)
    if loud_guard:
        g = _loudness_guard(prog, pa, pb, tracks, gains, srcs, N, nT)
        if g is not None:
            pa *= g[:, None]
            pb *= g[:, None]
    if clip_sink is not None:
        clip_sink.update(clip_out)
    return pa + pb, pa, pb


def _compile(comp: dict, fa, fb, sr: int) -> Program:
    from .compile import compile_join            # E2's compiler; imported late on purpose
    return compile_join(comp, fa, fb, sr)


def _bind(stems, t: dict, y: np.ndarray):
    if stems is None or not stems.has(t["id"], t.get("path")):
        raise ValueError(f"composition needs stems of {t.get('id')}, which has none")
    return stems.bind(t["id"], t.get("path"), y)


def render_join(ya: np.ndarray, yb: np.ndarray, a: dict, b: dict, tr: dict, p: dict,
                parts: bool = False, *, stems=None, feats=None, warp_cache: WarpCache | None = None,
                sink: dict | None = None):
    """Drop-in `region_fn` (§13): compile tr["composition"] and render it for [-XF, T + XF].
    Returns out, or (out, pa, pb) with parts=True. With a `sink` dict it also stores prog, out,
    pa, pb and clips (each clip's final signal) for verification."""
    from ..render import track_gain
    comp = tr["composition"]
    fa = feats.get(a) if feats is not None else None
    fb = feats.get(b) if feats is not None else None
    prog = _compile(comp, fa, fb, SR)
    need = {c.src for c in prog.clips if isinstance(c.stems, list)}
    sa = _bind(stems, a, ya) if "a" in need else None
    sb = _bind(stems, b, yb) if "b" in need else None
    clips: dict = {}
    out, pa, pb = render_program(prog, ya, yb, track_gain(a, p), track_gain(b, p), sa, sb, warp_cache,
                                 anchor={"a": tr.get("a_out_start"), "b": tr.get("b_in_end"),
                                         "T": tr.get("T")},
                                 clip_sink=clips if sink is not None else None)
    if sink is not None:
        sink.update(prog=prog, out=out, pa=pa, pb=pb, clips=clips)
    return (out, pa, pb) if parts else out
