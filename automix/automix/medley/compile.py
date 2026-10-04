"""Compiler (DESIGN §12): a Composition (moves on master beats) -> a Program (lanes and playhead
segments in region seconds), plus the plan-time transition fields (`transition_fields`).

`compile_join(comp, fa, fb, sr)` is pure: no audio, no I/O. It follows the lane semantics of
schema.static_eval (level-setting moves write from `at` on, window moves add dB inside their
window, hand `lanes` last) and the conventions engine.py (E3) renders:

- A lane step is two knots at one time t; the engine softens it with a raised cosine over
  [t, t + xf_ms], xf_ms from the Splice recorded at t. Fades, sweeps and the pulse / steps ramps
  are ordinary curved knots and need no splice.
- A pos segment's own start / end are faded by the engine (Splice kinds edge_in / edge_out).
- Splice placement (§12.5): an incoming step moves to onset - splice_pre_ms when a source onset
  of that clip lies within ±splice_onset_ms of the target, so its fade ends on the attack; an
  outgoing step ends by that point instead. xf is splice_xf_ms, or splice_xf_low_ms when the
  clip's low band is above -20 dB with no onset within splice_low_onset_ms.
- Positions (§8.6, §12.4): `native` clips are time based (source seconds advance 1:1 with output
  time); `r2` clips read W, the R2 --timemap of their reach whose anchors are every fitted source
  beat u -> t(at + (u - u0) / ratio) (R3: fitted grids only, never refined or raw beats).
"""

from __future__ import annotations

import math

import numpy as np

from . import CFG, COMPILER_VERSION
from . import schema as S

NEG = -math.inf
_C = CFG["compile"]
_PRE = CFG["splice_pre_ms"] / 1000.0
_OUT_GUARD = CFG["compile"]["out_guard_ms"] / 1000.0   # an outgoing fade ends this long before an onset


class CompileError(ValueError):
    """A composition that cannot be compiled. `code` is a schema.CODES key (validation) or one of
    FEATS_MISSING (a free track without Feats beats), R3_FREE_WARP (an r2 clip on a track with no
    fitted period) or PROGRAM (the Program failed schema.validate_program)."""

    def __init__(self, code: str, detail: str = ""):
        self.code, self.detail = code, detail
        super().__init__(f"{code}: {detail}" if detail else code)


def _r(x: float, n: int = 6) -> float:
    return float(round(float(x), n))


# ---------------------------------------------------------------------------------------------
# source maps and the master clock
# ---------------------------------------------------------------------------------------------
class SrcMap:
    """s(u): native seconds of source beat u, relative to the track's reference beat (§3).
    Fitted windows: ref_t + u * period_s. Free windows: the refined beats, piecewise linear
    (extrapolated with the end periods), shifted so that s(0) = ref_t exactly."""

    def __init__(self, ref_t: float, period: float | None, beats=None):
        self.ref_t = float(ref_t)
        self.period = float(period) if period else None
        if self.period is None:
            bt = np.asarray(beats if beats is not None else [], float)
            if len(bt) < 2:
                raise CompileError("FEATS_MISSING", "a free track needs Feats beats")
            k = int(np.argmin(np.abs(bt - self.ref_t)))
            self._u = np.arange(len(bt), dtype=float) - k
            self._s = bt - bt[k] + self.ref_t
            self._p = (float(bt[1] - bt[0]), float(bt[-1] - bt[-2]))

    @staticmethod
    def _lin(x, xs, ys, p0, p1):
        out = np.interp(x, xs, ys)
        out = np.where(x < xs[0], ys[0] + (x - xs[0]) * p0, out)
        return np.where(x > xs[-1], ys[-1] + (x - xs[-1]) * p1, out)

    def s(self, u):
        u = np.asarray(u, float)
        if self.period is not None:
            out = self.ref_t + u * self.period
        else:
            out = self._lin(u, self._u, self._s, *self._p)
        return float(out) if out.ndim == 0 else out

    def u(self, s):
        s = np.asarray(s, float)
        if self.period is not None:
            out = (s - self.ref_t) / self.period
        else:
            out = self._lin(s, self._s, self._u, 1 / self._p[0], 1 / self._p[1])
        return float(out) if out.ndim == 0 else out


class Clock:
    """The master clock of a composition (§8.4): t(m) with t(span.from) = 0, tabulated every
    1/64 beat (Program.clock_m / clock_t), and m(t) as its inverse. Fit and ramp segments are the
    schema's closed forms; *_refined segments use `tau` (source-beat -> seconds functions keyed by
    segment kind). Outside the span t(m) extrapolates the end segments."""

    def __init__(self, segs: list[dict], span: dict, tau: dict | None = None,
                 per_beat: int | None = None):
        self.segs = segs
        self.span = {"from": float(span["from"]), "to": float(span["to"])}
        self.tau = tau
        self.per_beat = int(per_beat or _C["clock_steps_per_beat"])
        self._tab = None
        self.T = self.t(self.span["to"])
        self.t_land = self.t(0.0)

    def _table(self):
        if self._tab is None:
            m, t = S.tabulate_clock(self.segs, self.span, self.per_beat, self.tau)
            self._tab = (np.asarray(m), np.asarray(t), self.beat_s(self.span["from"]),
                         self.beat_s(self.span["to"]))
        return self._tab

    @property
    def m_tab(self) -> np.ndarray:
        return self._table()[0]

    @property
    def t_tab(self) -> np.ndarray:
        return self._table()[1]

    def t(self, m):
        out = S.clock_seconds(self.segs, m, self.tau)
        return float(out[0]) if np.ndim(m) == 0 else out

    def m(self, t):
        mt, tt, k0, k1 = self._table()
        x = np.asarray(t, float)
        out = np.interp(x, tt, mt)
        out = np.where(x < tt[0], mt[0] + (x - tt[0]) / k0, out)
        out = np.where(x > tt[-1], mt[-1] + (x - tt[-1]) / k1, out)
        return float(out) if out.ndim == 0 else out

    def beat_s(self, m: float, h: float = 1e-3) -> float:
        """Seconds per master beat at m (a central difference; t(m) extrapolates past the span)."""
        return (self.t(m + h) - self.t(m - h)) / (2 * h)


def track_maps(comp: dict, fa: dict | None, fb: dict | None) -> dict[str, SrcMap]:
    out = {}
    for src, ref, F in (("a", comp["a_ref"], fa), ("b", comp["b_ref"], fb)):
        per = ref.get("period_s")
        beats = None if per is not None or F is None else F.get("beats", {}).get("t")
        if per is None and beats is None:
            raise CompileError("FEATS_MISSING", f"{src.upper()} is free (period_s null) and has no Feats")
        out[src] = SrcMap(ref["exit_t"] if src == "a" else ref["land_t"], per, beats)
    return out


def make_clock(comp: dict, maps: dict[str, SrcMap] | None = None, fa: dict | None = None,
               fb: dict | None = None) -> Clock:
    tau = None
    if any(s["kind"].endswith("_refined") for s in comp["clock"]):
        maps = maps or track_maps(comp, fa, fb)
        tau = {"a_refined": maps["a"].s, "b_refined": maps["b"].s}
    return Clock(comp["clock"], comp["span"], tau)


# ---------------------------------------------------------------------------------------------
# playhead: pos pieces over master beats
# ---------------------------------------------------------------------------------------------
def _rate_law(typ: str, mv: dict, at: float) -> tuple[float, callable, float | None]:
    """(length in beats, rate(x) for x = m - at in beats, stop x or None) of a gesture (§9)."""
    if typ == "backspin":
        push, peak, tau = float(mv["push"]), float(mv["peak_rate"]), float(mv["tau"])
        L = float(mv["end_by"]) - at
        X = max(L - push, 1e-6)
        e = math.exp(-X / tau)

        def rate(x):
            y = np.clip(x - push, 0, X)
            tail = peak * (np.exp(-y / tau) - e) / (1 - e)
            head = 1 + (peak - 1) * (1 - np.cos(np.pi * np.clip(x / push, 0, 1))) / 2
            return np.where(x < push, head, tail)
        return L, rate, L
    if typ == "tape_stop":
        L, k = float(mv["len"]), float(mv["k"])
        return L, (lambda x: np.clip(1 - x / L, 0, 1) ** k), L
    if typ == "rewind":
        L, peak = float(mv["len"]), float(mv["peak_rate"])
        rise = min(0.125, L / 4)
        X = max(L - rise, 1e-6)
        tau = X / 4
        e = math.exp(-X / tau)

        def rate(x):
            y = np.clip(x - rise, 0, X)
            head = 1 + (peak - 1) * (1 - np.cos(np.pi * np.clip(x / rise, 0, 1))) / 2
            return np.where(x < rise, head, peak * (np.exp(-y / tau) - e) / (1 - e))
        return L, rate, None
    raise ValueError(typ)


class Playhead:
    """The playhead of one clip over its life [at, at + len) as pieces [kind, m0, m1, d, seam]:
    "run" (d = source beat u at m0; the clip then runs at its natural rate: r2 in beats,
    native in time) or "vary" (d = f(m) -> u, vectorised). seam marks a pos splice at m0.
    Moves rewrite it in list order like schema.static_eval: loops, rolls, gestures, reverse and
    scratch inside their window; after a jump or a non-slip loop the playhead runs locked again;
    backspin / tape_stop end the clip where the rate reaches 0 and rewind leaves its gap empty."""

    def __init__(self, clip: dict, clock: Clock, src: SrcMap | None):
        self.c, self.clock, self.src = clip, clock, src
        self.native = clip["warp"] == "native"
        self.ratio = float(clip["ratio"])
        a = float(clip["at"])
        self.end = a + float(clip["len"])
        self.p: list[list] = [["run", a, self.end, float(clip["u0"]), False]]
        self.gestures: list[tuple[str, float, float, float | None]] = []

    def _u(self, pc: list, m):
        kind, m0, _, d, _ = pc
        if kind == "vary":
            return d(np.asarray(m, float))
        if self.native and self.src is not None:
            s = self.src.s(d) + (self.clock.t(m) - self.clock.t(m0))
            return self.src.u(s)
        return d + (np.asarray(m, float) - m0) * self.ratio

    def piece(self, m: float) -> list | None:
        for pc in self.p:
            if pc[1] <= m < pc[2]:
                return pc
        return None

    def u(self, m: float) -> float:
        pc = self.piece(m) or (self.p[-1] if self.p and m >= self.p[-1][2] else self.p[0] if self.p else None)
        if pc is None:
            return float(self.c["u0"])
        return float(self._u(pc, m))

    def s(self, m: float) -> float:
        """Native track seconds the clip reads at master beat m."""
        pc = self.piece(m) or (self.p[-1] if m >= self.p[-1][2] else self.p[0])
        if pc[0] == "run" and self.native:
            return float(self.src.s(pc[3]) + (self.clock.t(m) - self.clock.t(pc[1])))
        return float(self.src.s(self._u(pc, m)))

    def put(self, m0: float, m1: float, pieces: list[list]) -> None:
        """Replace [m0, m1) by `pieces` (which may leave holes: silence)."""
        out = []
        for pc in self.p:
            k, a, b, d, seam = pc
            if b <= m0 or a >= m1:
                out.append(pc)
                continue
            if a < m0:
                out.append([k, a, m0, d, seam])
            if b > m1:
                out.append([k, m1, b, float(self._u(pc, m1)) if k == "run" else d, False])
        out.extend(pieces)
        out.sort(key=lambda q: q[1])
        self.p = [q for q in out if q[2] - q[1] > 1e-9]

    def apply(self, mv: dict) -> None:
        typ, at = mv["type"], float(mv["at"])
        end = self.end
        if typ == "jump":
            self.put(at, end, [["run", at, end, float(mv["to_u"]), True]])
        elif typ in ("loop", "roll"):
            stages = ([(float(mv["size"]), float(mv["size"]) * int(mv["count"]))] if typ == "loop"
                      else [(float(s), float(c)) for s, c in mv["sizes"]])
            slip = bool(mv.get("slip", False))
            u0 = self.u(at)
            pieces, x, u_s, size = [], at, u0, stages[-1][0]
            for size, cov in stages:
                u_s = self.u(x) if slip else u0
                y = x
                while y < x + cov - 1e-9:
                    y1 = min(y + size, x + cov)
                    pieces.append(["run", y, y1, u_s, y > at + 1e-9 or abs(u_s - self.u(at)) > 1e-6])
                    y = y1
                x += cov
            if slip:
                self.put(at, x, pieces)
            else:                                   # resume from the end of the last loop
                self.put(at, end, pieces + [["run", x, end, u_s + size * self.ratio, True]])
        elif typ in ("backspin", "tape_stop", "rewind"):
            L, rate, stop = _rate_law(typ, mv, at)
            xs = np.linspace(0, L, max(64, int(L * 512)) + 1)
            r = rate(xs)
            ur = np.concatenate([[0.0], np.cumsum((r[1:] + r[:-1]) / 2 * np.diff(xs))]) * self.ratio
            ua = self.u(at)
            fn = (lambda m, ua=ua, xs=xs, ur=ur, at=at: ua + np.interp(np.asarray(m, float) - at, xs, ur))
            if typ == "rewind":
                gap = float(mv["gap"])
                self.put(at, end, [["vary", at, at + L, fn, False],
                                   ["run", at + L + gap, end, float(mv["then_u"]), True]])
            else:                                   # silent from the stop on: no audio after it
                self.put(at, end, [["vary", at, at + L, fn, False]])
            self.gestures.append((typ, at, at + L, at + stop if stop is not None else None))
        elif typ == "reverse":
            L, su = float(mv["len"]), float(mv["src_u"])
            # the slice [src_u, src_u + len] played backwards, so the peak at src_u lands on at + len
            fn = (lambda m, su=su, L=L, at=at: su + (at + L - np.asarray(m, float)) * self.ratio)
            self.put(at, at + L, [["vary", at, at + L, fn, False]])
            self.gestures.append((typ, at, at + L, None))
        elif typ == "scratch":
            L, depth, per = float(mv["len"]), float(mv["depth"]), float(mv["period"])
            ua = self.u(at)
            fn = (lambda m, ua=ua, at=at: ua + depth * (1 - np.cos(2 * np.pi * (np.asarray(m, float) - at) / per)) / 2)
            self.put(at, at + L, [["vary", at, at + L, fn, False]])
            self.gestures.append((typ, at, at + L, None))

    def hand(self, knots: list, clock_m: callable = None) -> None:
        """A hand-written pos lane (source beats against master beats) replaces its range."""
        k0, k1 = min(float(k[0]) for k in knots), max(float(k[0]) for k in knots)
        fn = (lambda m, kn=knots: S.eval_knots(kn, m, "pos"))
        if k1 > k0:
            self.put(k0, k1, [["vary", k0, k1, fn, True]])


# ---------------------------------------------------------------------------------------------
# lanes in region seconds
# ---------------------------------------------------------------------------------------------
def _dbv(v) -> float:
    return NEG if v is None else float(v)


def _same(a, b) -> bool:
    if a is None or b is None:
        return a is b
    if math.isinf(a) or math.isinf(b):
        return a == b
    return abs(a - b) <= 1e-6


class Lane:
    """A lane as contiguous pieces [x0, x1, v0, v1, curve] over [lo, hi] (region seconds), with the
    §8.6 curve semantics (schema.ramp_db / eval_knots). db lanes hold -inf for null, hz lanes hold
    None (bypass). A piece that starts at another value than its predecessor ended is a step,
    emitted as two knots at one time (a splice)."""

    def __init__(self, v, lo: float, hi: float, kind: str = "db"):
        self.kind, self.lo, self.hi = kind, lo, hi
        self.p = [[lo, hi, v, v, "hold"]]

    # -- evaluation
    def _pv(self, pc: list, x: float):
        x0, x1, v0, v1, c = pc
        if c == "hold" or x1 - x0 <= 0 or _same(v0, v1):
            return v0
        f = min(1.0, max(0.0, (x - x0) / (x1 - x0)))
        if self.kind == "db":
            return float(S.ramp_db(None if v0 == NEG else v0, None if v1 == NEG else v1, np.array([f]), c)[0])
        if v0 is None or v1 is None:
            return v0
        w = f if c in ("lin", "exp") else (1 - math.cos(math.pi * f)) / 2
        return v0 + (v1 - v0) * w if c == "lin" else math.exp(math.log(v0) + (math.log(v1) - math.log(v0)) * w)

    def value(self, x: float, left: bool = False):
        if x <= self.lo:
            return self.p[0][2]
        for pc in self.p:
            if (pc[0] < x <= pc[1]) if left else (pc[0] <= x < pc[1]):
                return self._pv(pc, x)
        return self.p[-1][3]

    # -- editing
    def _part(self, pc: list, a: float, b: float) -> list[list]:
        x0, x1, v0, v1, c = pc
        if a <= x0 + 1e-12 and b >= x1 - 1e-12:
            return [list(pc)]
        if c == "hold" or _same(v0, v1):
            return [[a, b, v0, v0, "hold"]]
        va, vb = self._pv(pc, a), self._pv(pc, b)
        if c in ("lin", "exp"):                  # partial segments of these laws are exact
            return [[a, b, va, vb, c]]
        n = int(min(16, max(1, math.ceil(64 * (b - a) / (x1 - x0)))))   # eqpow is quadratic near 0
        xs = np.linspace(a, b, n + 1)
        vs = [self._pv(pc, x) for x in xs]
        sub = "lin" if self.kind == "db" else "exp"
        return [[xs[i], xs[i + 1], vs[i], vs[i + 1], sub] for i in range(n)]

    def slice(self, a: float, b: float) -> list[list]:
        out = []
        for pc in self.p:
            x0, x1 = max(pc[0], a), min(pc[1], b)
            if x1 - x0 > 1e-12:
                out.extend(self._part(pc, x0, x1))
        return out

    def replace(self, a: float, b: float, pieces: list[list]) -> None:
        a, b = max(a, self.lo), min(b, self.hi)
        if b <= a:
            return
        head = self.slice(self.lo, a) if a > self.lo else []
        tail = self.slice(b, self.hi) if b < self.hi else []
        mid = [[max(p[0], a), min(p[1], b), p[2], p[3], p[4]] for p in pieces if min(p[1], b) - max(p[0], a) > 1e-12]
        self.p = head + mid + tail

    def write_from(self, a: float, pieces: list[list]) -> None:
        """Level-setting write: `pieces` from a, then hold their last value to the end."""
        pieces = [p for p in pieces if p[1] - p[0] > 1e-12]
        v_end = pieces[-1][3] if pieces else None
        x_end = pieces[-1][1] if pieces else a
        if not pieces:
            return
        self.replace(a, self.hi, pieces + [[x_end, self.hi, v_end, v_end, "hold"]])

    def step_from(self, a: float, v) -> None:
        self.write_from(a, [[a, self.hi, v, v, "hold"]])

    def add(self, a: float, b: float, off: list[list]) -> None:
        """Window write: add dB offsets (pieces covering [a, b]) inside [a, b) only."""
        a, b = max(a, self.lo), min(b, self.hi)
        if b <= a:
            return
        base = self.slice(a, b)
        off = [[max(p[0], a), min(p[1], b), p[2], p[3], p[4]] for p in off if min(p[1], b) - max(p[0], a) > 1e-12]
        xs = sorted({x for p in base + off for x in (p[0], p[1])} | {a, b})
        out = []
        for x0, x1 in zip(xs, xs[1:]):
            if x1 - x0 <= 1e-12:
                continue
            xm = (x0 + x1) / 2
            pa = next((p for p in base if p[0] <= xm < p[1]), None)
            pb = next((p for p in off if p[0] <= xm < p[1]), None)
            if pa is None:
                continue
            if pb is None:
                out.extend(self._part(pa, x0, x1))
                continue
            A, B = self._part(pa, x0, x1), self._part(pb, x0, x1)
            if len(A) == 1 and len(B) == 1 and (B[0][4] == "hold" or _same(B[0][2], B[0][3])):
                k = B[0][2]
                out.append([x0, x1, A[0][2] + k, A[0][3] + k, A[0][4]])
            elif len(A) == 1 and len(B) == 1 and (A[0][4] == "hold" or _same(A[0][2], A[0][3])):
                k = A[0][2]
                out.append([x0, x1, B[0][2] + k, B[0][3] + k, B[0][4]])
            else:                                  # both vary: sample the sum (amplitude-linear)
                n = int(min(8, max(1, math.ceil((x1 - x0) / 0.01))))
                ys = np.linspace(x0, x1, n + 1)
                vs = [self._pv(pa, y) + self._pv(pb, y) for y in ys]
                out.extend([ys[i], ys[i + 1], vs[i], vs[i + 1], "lin"] for i in range(n))
        self.p = (self.slice(self.lo, a) if a > self.lo else []) + out + (self.slice(b, self.hi) if b < self.hi else [])

    # -- output
    def knots(self) -> list[list]:
        ps: list[list] = []
        for p in self.p:                          # merge equal constant neighbours
            const = p[4] == "hold" or _same(p[2], p[3])
            if ps and const and (ps[-1][4] == "hold" or _same(ps[-1][2], ps[-1][3])) and _same(ps[-1][3], p[2]):
                ps[-1][1] = p[1]
                continue
            ps.append([p[0], p[1], p[2], p[2] if const else p[3], "hold" if const else p[4]])

        def J(v):
            if v is None or v == NEG:
                return None
            return _r(v, 4) if self.kind == "db" else _r(v, 2)

        out = []
        for i, (x0, x1, v0, v1, c) in enumerate(ps):
            out.append([_r(x0), J(v0), c])
            nxt = ps[i + 1] if i + 1 < len(ps) else None
            if (nxt is None and c != "hold") or (nxt is not None and not _same(nxt[2], v1)):
                out.append([_r(x1), J(v1), "hold"])
        return out

    def steps(self) -> list[tuple[float, object, object]]:
        """(x, before, after) of every step (value discontinuity)."""
        out = []
        for p, q in zip(self.p, self.p[1:]):
            if not _same(p[3], q[2]):
                out.append((p[1], p[3], q[2]))
        return out

    def sample(self, xs: np.ndarray) -> np.ndarray:
        kn = self.knots()
        return S.eval_knots(kn, xs, "db" if self.kind == "db" else "hz")


# ---------------------------------------------------------------------------------------------
# the compiler
# ---------------------------------------------------------------------------------------------
_BANDS = {"low": ("low",), "mid": ("mid",), "high": ("high",), "mid_high": ("mid", "high"),
          "all": ("low", "mid", "high")}


class _Clip:
    """Per-clip compile state."""

    def __init__(self, c: dict, clock: Clock, src: SrcMap | None, lo: float, hi: float):
        self.c = c
        self.id = c["id"]
        self.head = Playhead(c, clock, src)
        self.src = src
        self.lanes = {"gain": Lane(0.0, lo, hi), "low": Lane(0.0, lo, hi), "mid": Lane(0.0, lo, hi),
                      "high": Lane(0.0, lo, hi), "hp": Lane(None, lo, hi, "hz"), "lp": Lane(None, lo, hi, "hz")}
        self.segs: list[dict] = []
        self.onsets = (np.zeros(0), np.zeros(0))     # region t, strength of mapped source onsets
        self.W = None                                  # r2: (src_anchors, dst_anchors)
        self.extent: list[tuple[float, float]] = []   # pos runs (region s)


def _edge_onsets(cl, seg: dict, F: dict | None) -> np.ndarray:
    """Region times of the Feats onsets of clip `cl` mapped through its first `copy` segment,
    unbounded by the segment edges (the clip-start pre-roll looks just before the segment)."""
    if F is None or seg.get("kind") != "copy":
        return cl.onsets[0]
    ot = np.asarray(F["onsets"]["t"], float)
    if cl.c["warp"] == "native":
        tt = seg["t0"] + (ot - (cl.source["s0"] + seg["w0"]))
    else:
        tt = seg["t0"] + (np.interp(ot, *cl.W) - seg["w0"])
    return np.concatenate([cl.onsets[0], tt])


def _near(ts: np.ndarray, x: float, tol: float) -> float | None:
    if not len(ts):
        return None
    i = int(np.argmin(np.abs(ts - x)))
    return float(ts[i]) if abs(ts[i] - x) <= tol else None


def compile_join(comp: dict, fa: dict | None = None, fb: dict | None = None, sr: int = 44100,
                 check_hash: bool = True) -> S.Program:
    """Moves -> lanes -> Program (§12). Validates the composition first (§8.9, with the Feats for
    rule 8) and the Program last; raises CompileError on failure."""
    iss = S.validate_composition(comp, fa, fb, check_hash=check_hash)
    if iss:
        raise CompileError(iss[0].code, "; ".join(str(i) for i in iss[:4]))
    maps = track_maps(comp, fa, fb)
    clock = make_clock(comp, maps)
    feats = {"a": fa, "b": fb}
    bpb = int(comp["bpb"])
    xf = int(_C["xf_ms"] * sr / 1000)                   # == render.XF (int(0.015 * SR))
    xf_s = xf / sr
    f, to = clock.span["from"], clock.span["to"]
    T, t_land = clock.T, clock.t_land
    lo, hi = -xf_s, T + xf_s
    tm = clock.t
    splices: dict[tuple[str, float], dict] = {}

    def splice(cid: str, t: float, kind: str, xf_ms: float, onset: float | None = None,
               search_ms: float = 0.0) -> None:
        key = (cid, _r(t))
        if key not in splices or kind in ("edge_in", "edge_out", "pos"):
            splices[key] = {"t": _r(t), "clip": cid, "kind": kind, "onset": None if onset is None else _r(onset),
                            "xf_ms": float(xf_ms), "search_ms": float(search_ms)}

    clips = {c["id"]: _Clip(c, clock, maps.get(c["src"]), lo, hi) for c in comp["clips"]}

    # ---- 1. playheads (pos moves, then hand pos lanes)
    for mv in comp["moves"]:
        if mv["type"] in S.POS_MOVES and mv.get("clip") in clips:
            clips[mv["clip"]].head.apply(mv)
    for cid, lanes in (comp.get("lanes") or {}).items():
        if lanes.get("pos") and cid in clips:
            clips[cid].head.hand(lanes["pos"])

    # ---- 2. sources, W and pos segments (§12.4)
    pad = float(_C["reach_pad_s"])
    dt_v = float(_C["vary_step_s"])
    for cid, cl in clips.items():
        c, src, head = cl.c, cl.src, cl.head
        if src is None:
            raise CompileError("CLIP_REF", f"clip {cid}: src {c['src']} has no track")
        if c["warp"] == "r2" and src.period is None:
            raise CompileError("R3_FREE_WARP", f"clip {cid}: r2 on a track with no fitted period")
        pieces = [list(p) for p in head.p]
        if not pieces:
            continue
        # region times of every piece, with the edge rules (A at span.from: -xf; clip starts
        # pre-rolled 3 ms; the span end +xf)
        rows = []
        for k, (kind, m0, m1, d, seam) in enumerate(pieces):
            t0, t1 = tm(m0), tm(m1)
            if k == 0 and abs(m0 - f) < 1e-9:
                t0 = -xf_s
            elif k == 0 or (not seam and abs(pieces[k - 1][2] - m0) > 1e-9):
                t0 = t0 - _PRE
            if abs(m1 - to) < 1e-9:
                t1 = hi
            rows.append([kind, m0, m1, d, seam, t0, t1])
        # vary samples, and the u / s reach
        us, ss = [], []
        for row in rows:
            kind, m0, m1, d, seam, t0, t1 = row
            if kind == "vary":
                n = max(2, int(math.ceil((t1 - t0) / dt_v)) + 1)
                tt = t0 + np.arange(n) * dt_v
                uu = np.asarray(d(clock.m(tt)), float)
                row.append(uu)
                us.extend([uu.min(), uu.max()])
                ss.extend([float(np.min(src.s(uu))), float(np.max(src.s(uu)))])
            else:
                u_a = float(d)
                s_a = src.s(u_a) - (tm(m0) - t0)                         # the pre-rolled read start
                s_b = s_a + (t1 - t0)
                if head.native:
                    us.extend([src.u(s_a), src.u(s_b)])
                else:                                                    # W runs 1:1 with output
                    us.extend([u_a - 0.25, u_a + (m1 - m0) * head.ratio + 0.25])
                ss.extend([s_a, s_b])
                row.append(u_a)
        if c["warp"] == "native":
            s0, s1 = min(ss) - pad, max(ss) + pad
            c_source = {"kind": "native", "s0": _r(s0), "s1": _r(s1)}

            def W(u, s0=s0, src=src):
                return np.asarray(src.s(u), float) - s0
        else:
            u_lo = math.floor(min(us)) - int(_C["reach_pad_beats"])
            u_hi = math.ceil(max(us)) + int(_C["reach_pad_beats"])
            ub = np.arange(u_lo, u_hi + 1, dtype=float)
            sb = np.asarray(src.s(ub), float)
            db = np.asarray(tm(c["at"] + (ub - c["u0"]) / c["ratio"]), float)
            db = db - db[0]
            k0 = (db[1] - db[0]) / (sb[1] - sb[0])
            k1 = (db[-1] - db[-2]) / (sb[-1] - sb[-2])
            sa = np.concatenate([[sb[0] - pad], sb, [sb[-1] + pad]])
            da = np.concatenate([[0.0], pad * k0 + db, [pad * k0 + db[-1] + pad * k1]])
            sa, da = np.round(sa, 6), np.round(da, 6)
            cl.W = (sa, da)
            c_source = {"kind": "r2", "s0": float(sa[0]), "s1": float(sa[-1]),
                        "src_anchors": sa.tolist(), "dst_anchors": da.tolist(), "w_len": float(da[-1])}

            def W(u, sa=sa, da=da, src=src):
                return np.interp(np.asarray(src.s(u), float), sa, da)
            pt = c.get("pitch")
            if pt and float(pt["semis"]):                # creation key fix: A's harmonic stems
                um = [c["u0"] + (float(pt[k]) - c["at"]) * c["ratio"] for k in ("m0", "m1")]
                w0, w1 = (float(W(x)) for x in um)
                c_source["pitch"] = [[_r(w0), 0.0], [_r(max(w1, w0 + 1e-3)), float(pt["semis"])]]
        cl.source, cl.Wf = c_source, W
        segs = []
        for row in rows:
            kind, m0, m1, d, seam, t0, t1 = row[:7]
            if kind == "vary":
                segs.append({"t0": _r(t0), "t1": _r(t1), "kind": "vary",
                             "w": [_r(x) for x in np.asarray(W(row[7]), float)]})
            else:
                w_at_m0 = float(W(row[7]))
                segs.append({"t0": _r(t0), "t1": _r(t1), "kind": "copy", "w0": _r(w_at_m0 - (tm(m0) - t0)),
                             "_seam": seam, "_m0": m0, "_u": row[7]})
        cl.segs = segs

    # ---- 3. source onsets in region time (copy segments only), loop seams snapped to onsets
    seams: list[float] = []
    for cid, cl in clips.items():
        F = feats.get(cl.c["src"])
        if F is None or not cl.segs:
            continue
        ot = np.asarray(F["onsets"]["t"], float)
        os_ = np.asarray(F["onsets"]["strength"], float)
        for k, seg in enumerate(cl.segs):
            if seg["kind"] != "copy" or not seg.get("_seam"):
                continue
            t_k = tm(seg["_m0"])
            s_k = float(cl.src.s(seg["_u"])) if not cl.head.native else float(cl.src.s(seg["_u"]))
            # REVIEW-external-1 #4: snap only to an onset within +-splice_onset_ms (15 ms, the
            # §12.5 splice rule; the content moves at most that against the piece time); with no
            # onset that close the seam stays on the grid (content exact) with the waveform-
            # searched splice, and V9 has nothing to check there. (Snapping to an onset up to 1/4
            # beat away displaced whole rolls; at 10 ms a loop start 12 ms into a hit's attack on
            # a real track restarted mid-attack and clicked on every repeat.)
            tol = max(CFG["limits"]["loop_onset_ms"], _C["splice_onset_ms"]) / 1000
            o = _near(ot, s_k, tol)
            # a piece that starts where a vacuum silences this clip (the playhead after a roll)
            # is never heard: pre-rolling it onto its onset would sound 3 ms of that attack
            # just before the vacuum cut (a click)
            if any(mv["type"] == "vacuum" and cid not in (mv.get("keep") or [])
                   and -1 / 64 <= float(mv["at"]) - seg["_m0"] <= 1 / 16 for mv in comp["moves"]):
                # ... and the playhead switch waits until the vacuum's fade is over (the
                # previous piece plays on while it fades)
                late = 2 * CFG["splice_xf_ms"] / 1000
                seg["t0"], seg["w0"] = _r(seg["t0"] + late), _r(seg["w0"] + late)
                if k:
                    cl.segs[k - 1]["t1"] = seg["t0"]
                splice(cid, seg["t0"], "pos", CFG["splice_xf_ms"])
                continue
            if o is not None:
                seams.append(_r(t_k))
                new_t0 = t_k - _PRE
                seg["w0"] = _r(float(cl.Wf(cl.src.u(o))) - _PRE)
                seg["t0"] = _r(new_t0)
                if k and cl.segs[k - 1]["t1"] > new_t0:
                    cl.segs[k - 1]["t1"] = _r(new_t0)
                splice(cid, new_t0, "pos", CFG["splice_xf_ms"], onset=t_k, search_ms=CFG["splice_search_ms"])
            else:
                splice(cid, seg["t0"], "pos", CFG["splice_xf_ms"], search_ms=CFG["splice_search_ms"])
        tts, sts = [], []
        for seg in cl.segs:
            if seg["kind"] != "copy":
                continue
            if cl.c["warp"] == "native":
                s_lo = cl.source["s0"] + seg["w0"]
                sel = (ot >= s_lo) & (ot < s_lo + seg["t1"] - seg["t0"])
                tt = seg["t0"] + (ot[sel] - s_lo)
            else:
                w = np.interp(ot, *cl.W, left=-1e9, right=1e9)
                sel = (w >= seg["w0"]) & (w < seg["w0"] + seg["t1"] - seg["t0"])
                tt = seg["t0"] + (w[sel] - seg["w0"])
            tts.append(tt)
            sts.append(os_[sel])
        if tts:
            order = np.argsort(np.concatenate(tts), kind="stable")
            cl.onsets = (np.concatenate(tts)[order], np.concatenate(sts)[order])

    # clip start pre-roll on the attack (B "starts 3 ms before its onset with a 2 ms fade-in")
    for cid, cl in clips.items():
        if not cl.segs:
            continue
        first = cl.segs[0]
        m_at = float(cl.c["at"])
        if abs(m_at - f) > 1e-9:
            # the source onsets around the start, not only those inside the (pre-rolled) first
            # segment: an attack up to 15 ms before the planned start is the one to keep whole
            o = _near(_edge_onsets(cl, first, feats.get(cl.c["src"])), tm(m_at), _C["splice_onset_ms"] / 1000)
            if o is not None and first["kind"] == "copy":
                shift = (o - _PRE) - first["t0"]
                first["t0"], first["w0"] = _r(first["t0"] + shift), _r(first["w0"] + shift)
            splice(cid, first["t0"], "edge_in", _C["cut_in_fade_ms"], onset=o)
        # extent (contiguous runs) and edge_out splices
        runs = []
        for seg in cl.segs:
            if runs and abs(runs[-1][1] - seg["t0"]) < 1e-6:
                runs[-1][1] = seg["t1"]
            else:
                runs.append([seg["t0"], seg["t1"]])
        cl.extent = [tuple(r) for r in runs]
        for a, b in runs:
            if b < hi - 1e-6:
                splice(cid, b, "edge_out", CFG["splice_xf_ms"])
            if a > lo + 1e-6 and (cid, _r(a)) not in splices:
                splice(cid, a, "edge_in", _C["cut_in_fade_ms"])

    # ---- 4. lanes: moves in list order
    def onset_of(cl: _Clip, t: float, ms: float) -> float | None:
        return _near(cl.onsets[0], t, ms / 1000)

    def low_hot(cl: _Clip, t: float) -> bool:
        return cl.lanes["gain"].value(t) + cl.lanes["low"].value(t) + float(cl.c.get("gain_db", 0)) > -20

    def step(cl: _Clip, lane: str, target: float, v, kind: str, xf_ms: float | None = None,
             incoming: bool | None = None) -> float:
        """A level-setting step on `lane` at `target` (region s), placed by the splice rules."""
        ln = cl.lanes[lane]
        before = ln.value(target, left=True)
        if incoming is None:
            incoming = (v != NEG) and (before == NEG or (v is not None and before is not None and v > before))
        low = lane == "low" or (lane == "gain" and low_hot(cl, target))
        o = onset_of(cl, target, _C["splice_onset_ms"])
        x = xf_ms if xf_ms is not None else CFG["splice_xf_ms"]
        if xf_ms is None and low and o is None and onset_of(cl, target, _C["splice_low_onset_ms"]) is None:
            x = CFG["splice_xf_low_ms"]
        if o is not None:
            # an outgoing fade ends _OUT_GUARD before the onset: the detected onset is the attack's
            # steepest point and real attacks start up to ~10 ms earlier (a fade ending 3 ms before
            # it chopped the attack of the hit on echo_slam's throw beat: a V6 click)
            t = (o - _PRE) if incoming else (min(target, o - _OUT_GUARD) - x / 1000)
        else:
            t = target if incoming else target - x / 1000
        t = max(lo, t)
        ln.step_from(t, v)
        splice(cl.id, t, kind, x, onset=o)
        return t

    bands_of = _BANDS
    echoes: list[S.EchoProgram] = []
    vacuums, gestures = [], []
    for mv in comp["moves"]:
        typ, at = mv["type"], float(mv["at"])
        cl = clips.get(mv.get("clip", ""))
        ta = tm(at)
        if typ == "fade" and cl:
            ln = float(mv["len"])
            tb = tm(at + ln)
            v0, v1 = _dbv(mv["from_db"]), _dbv(mv["to_db"])
            g = cl.lanes["gain"]
            shape = mv["shape"]
            if ln <= 0:
                step(cl, "gain", ta, v1, "gain")
            elif shape == "steps":
                n = max(1, int(round(ln / (float(mv.get("step_bars", 1)) * bpb))))
                a_ = CFG["analysis"]["db_floor"] if v0 == NEG else v0
                b_ = CFG["analysis"]["db_floor"] if v1 == NEG else v1
                lv = [a_ + (b_ - a_) * k / n for k in range(n)] + [v1]
                if v0 == NEG:
                    lv[0] = NEG
                r = _C["steps_ramp_ms"] / 2000
                xs = [tm(at + ln * k / n) for k in range(n + 1)]
                pcs = []
                for k in range(n + 1):
                    x0 = xs[k] + (r if k else 0.0)
                    x1 = xs[k + 1] - r if k < n else hi
                    if k:
                        pcs.append([xs[k] - r, xs[k] + r, lv[k - 1], lv[k], "cos"])
                    pcs.append([x0, max(x1, x0), lv[k], lv[k], "hold"])
                g.write_from(ta, pcs)
            else:
                g.write_from(ta, [[ta, tb, v0, v1, "eqpow" if shape == "pulse" else shape]])
                if shape == "pulse":
                    g.add(ta, tb, _pulse(clock, at, ln, mv, bpb))
        elif typ == "cut" and cl:
            ms = float(mv.get("ms", _C["cut_ms"]))
            if mv["dir"] == "out":
                step(cl, "gain", ta, NEG, "gain", xf_ms=ms, incoming=False)
            else:
                o = onset_of(cl, ta, _C["splice_onset_ms"])
                t = (o if o is not None else ta) - _PRE
                cl.lanes["gain"].replace(lo, t, [[lo, t, NEG, NEG, "hold"]])
                splice(cl.id, t, "gain", _C["cut_in_fade_ms"], onset=o)
        elif typ == "eq" and cl:
            ln = float(mv["len"])
            tb = tm(at + ln)
            v1 = _dbv(mv["to_db"])
            for b in bands_of[mv["band"]]:
                lane = cl.lanes[b]
                if ln <= 0:
                    step(cl, b, ta, v1, "eq")
                else:
                    v0 = lane.value(ta, left=True)
                    lane.write_from(ta, [[ta, tb, v0, v1, mv["curve"]]])
                    if mv["curve"] == "hold" and not _same(v0, v1):
                        splice(cl.id, tb, "eq", CFG["splice_xf_ms"])
        elif typ == "filter" and cl:
            ln = float(mv["len"])
            h0, h1 = float(mv["hz"][0]), float(mv["hz"][1])
            cl.lanes[mv["kind"]].write_from(ta, [[ta, tm(at + ln), h0, h1, mv.get("curve", "exp")]])
        elif typ == "swap":
            ms = float(mv.get("ms", _C["swap_ms"]))
            ins = [clips[c] for c in mv["in"] if c in clips]
            o = next((x for x in (onset_of(c, ta, _C["splice_onset_ms"]) for c in ins) if x is not None), None)
            t = (o - _PRE) if o is not None else ta - ms / 1000
            for cid, v in [(c, NEG) for c in mv["out"]] + [(c, 0.0) for c in mv["in"]]:
                c2 = clips.get(cid)
                if c2 is None:
                    continue
                for b in (("gain",) if mv["band"] == "all" else (mv["band"],)):
                    before = c2.lanes[b].value(t, left=True)
                    c2.lanes[b].step_from(t, v)
                    if not _same(before, v):
                        splice(cid, t, "swap", ms, onset=o if v != NEG else None)
        elif typ == "vacuum":
            tb = tm(at + float(mv["len"]))
            keep = set(mv.get("keep", []))
            vacuums.append((_r(ta), _r(tb)))
            # silent ON [at, at + len): the outgoing fade ends splice_pre_ms before `at` (the
            # engine crossfades a step over [t, t + xf]; pieces pre-roll 3 ms onto their onsets),
            # else the attack of the source hit that follows a roll's last repeat sounds for the
            # length of the fade: a click
            t_out = max(lo, ta - (CFG["splice_xf_ms"] + CFG["splice_pre_ms"]) / 1000)
            for cid, c2 in clips.items():
                if cid in keep:
                    continue
                c2.lanes["gain"].add(t_out, tb, [[t_out, tb, NEG, NEG, "hold"]])
                splice(cid, t_out, "gain", CFG["splice_xf_ms"])
                splice(cid, tb, "gain", CFG["splice_xf_ms"])
        elif typ == "trade":
            c0, c1 = mv["clips"]
            xfm = float(mv.get("xf_ms", _C["trade_xf_ms"]))
            x, edges = at, []
            for ln in mv["lens"]:
                edges.append((x, x + float(ln)))
                x += float(ln)
            # block edges (region s); an edge moves to the incoming clip's attack when one is near
            ts = []
            for i, (m0, _) in enumerate(edges):
                t = tm(m0)
                inc = clips.get(c0 if i % 2 == 0 else c1)
                o = onset_of(inc, t, _C["splice_onset_ms"]) if (inc and i) else None
                ts.append((o - _PRE) if o is not None else t)
            ts.append(tm(edges[-1][1]))
            for i in range(len(edges)):
                off = clips.get(c1 if i % 2 == 0 else c0)
                if off is None:
                    continue
                off.lanes["gain"].add(ts[i], ts[i + 1], [[ts[i], ts[i + 1], NEG, NEG, "hold"]])
                for tt in (ts[i], ts[i + 1]):
                    splice(off.id, tt, "gain", xfm)
            for cid in (c0, c1):
                if cid in clips:
                    for tt in ts[1:-1]:
                        splice(cid, tt, "gain", xfm)
        elif typ == "gate":
            ca, cb = mv["clips"]
            q = 0.25
            att, rel = float(mv.get("attack_ms", CFG["gate_attack_ms"])), float(mv.get("release_ms", CFG["gate_release_ms"]))
            steps_ = "".join(mv["steps"])
            for cid, ch in ((ca, "A"), (cb, "B")):
                c2 = clips.get(cid)
                if c2 is None:
                    continue
                k = 0
                while k < len(steps_):
                    if steps_[k] == ch:
                        k += 1
                        continue
                    j = k
                    while j < len(steps_) and steps_[j] != ch:
                        j += 1
                    t0, t1 = tm(at + k * q), tm(at + j * q)
                    c2.lanes["gain"].add(t0, t1, [[t0, t1, NEG, NEG, "hold"]])
                    splice(cid, t0, "gain", rel)
                    if j < len(steps_):
                        splice(cid, t1, "gain", att)
                    k = j
        elif typ == "roll" and cl:
            x = at
            for size, cov in mv["sizes"]:
                if float(size) < 0.5:
                    t0, t1 = tm(x), tm(x + float(cov))
                    k = float(mv.get("taper_db", -3.0))
                    cl.lanes["gain"].add(t0, t1, [[t0, t1, k, k, "hold"]])
                    splice(cl.id, t0, "gain", CFG["splice_xf_ms"])
                    splice(cl.id, t1, "gain", CFG["splice_xf_ms"])
                x += float(cov)
        elif typ == "echo" and cl:
            throw = at + float(mv["capture"])
            t_th = tm(throw)
            delay_s = float(mv["delay"]) * clock.beat_s(throw - 1e-3)
            tail_s = tm(throw + float(mv["tail"])) - t_th
            h0, h1 = (float(x) for x in mv["hp_hz"])
            # the loop HP sweeps over the tail; the engine keeps it >= echo_tail_hp_hz after t(0)
            hp = [[_r(t_th), h0, "exp"], [_r(t_th + max(tail_s, 1e-3)), h1, "hold"]]
            duck = mv.get("duck")
            dk = None
            if duck:
                rel_s = float(duck["release_beats"]) * clock.beat_s(min(to, 0.5))
                dk = {"key": duck["key"], "depth_db": float(duck["depth_db"]), "release_s": _r(rel_s)}
            echoes.append(S.EchoProgram(clip=cl.id, capture=(_r(ta), _r(t_th)), delay_s=_r(delay_s),
                                        fb=float(mv["fb"]), tail_s=_r(tail_s), hp_hz=hp,
                                        lp_hz=float(mv.get("lp_hz", 20000.0)), send_db=float(mv["send_db"]),
                                        duck=dk, part="a" if cl.c["src"] != "b" else "b"))
        elif typ in ("backspin", "tape_stop", "rewind") and cl:
            L, rate, stop = _rate_law(typ, mv, at)
            n = max(8, int(L * 32))
            xs = np.linspace(0, L, n + 1)
            r = np.abs(rate(xs))
            law = [10 * math.log10(v) if v > 0 else NEG for v in np.minimum(1, r / CFG["limits"]["backspin_gain_rate"])]
            tt = [tm(at + x) for x in xs]
            cl.lanes["gain"].add(tt[0], tt[-1], [[tt[i], tt[i + 1], law[i], law[i + 1], "lin"] for i in range(n)])
            lp0, lp1 = CFG["limits"]["gesture_lp_hz"]
            hz = [lp1 * (lp0 / lp1) ** float(min(1.0, v)) for v in r]
            cl.lanes["lp"].replace(tt[0], tt[-1], [[tt[i], tt[i + 1], hz[i], hz[i + 1], "exp"] for i in range(n)])
            cl.lanes["lp"].replace(tt[-1], hi, [[tt[-1], hi, None, None, "hold"]])
            if typ == "rewind":
                g1 = tm(at + L + float(mv["gap"]))
                cl.lanes["gain"].add(tt[-1], g1, [[tt[-1], g1, NEG, NEG, "hold"]])
                stop_t = None
            else:
                cl.lanes["gain"].step_from(tt[-1], NEG)
                stop_t = _r(tt[-1])
            gestures.append({"kind": typ, "clip": cl.id, "t0": _r(tt[0]), "t1": _r(tt[-1]), "stop_t": stop_t})
        elif typ == "reverse" and cl:
            tb = tm(at + float(mv["len"]))
            if "gain_db" in mv:
                k = float(mv["gain_db"])
                cl.lanes["gain"].add(ta, tb, [[ta, tb, k, k, "hold"]])
            if "hp_hz" in mv:
                cl.lanes["hp"].replace(ta, tb, [[ta, tb, float(mv["hp_hz"]), float(mv["hp_hz"]), "hold"]])
            gestures.append({"kind": "reverse", "clip": cl.id, "t0": _r(ta), "t1": _r(tb), "stop_t": None})
        elif typ == "scratch" and cl:
            gestures.append({"kind": "scratch", "clip": cl.id, "t0": _r(ta), "t1": _r(tm(at + float(mv["len"]))),
                             "stop_t": None})
        elif typ == "duck" and cl:
            key = clips.get(mv["key"])
            if key is None:
                continue
            t_end = tm(at + float(mv["len"])) if "len" in mv else hi
            rel_s = float(mv["release_beats"]) * clock.beat_s(at)
            depth = float(mv["depth_db"])
            ons = key.onsets[0][(key.onsets[0] >= ta) & (key.onsets[0] < t_end)]
            pcs, x = [], ta
            for o in ons:
                o = max(o, x)                              # a dip inside a release re-triggers
                a0 = max(x, o - 0.001)
                if a0 > x:
                    pcs.append([x, a0, 0.0, 0.0, "hold"])
                if o > a0:
                    pcs.append([a0, o, 0.0, -depth, "exp"])
                e = min(o + rel_s, t_end)
                if e > o:
                    pcs.append([o, e, -depth, -depth * (1 - (e - o) / rel_s), "exp"])
                x = max(e, o)
            if x < t_end:
                pcs.append([x, t_end, 0.0, 0.0, "hold"])
            if pcs:
                cl.lanes["gain"].add(ta, t_end, pcs)

    # hand lanes last: they replace the lane between their first and last knot
    for cid, lanes in (comp.get("lanes") or {}).items():
        cl = clips.get(cid)
        if cl is None:
            continue
        for param, knots in lanes.items():
            if param in ("pos", "send") or not knots:
                continue
            name = param[3:] if param.startswith("eq_") else param
            ln = cl.lanes[name]
            ks = sorted(knots, key=lambda k: float(k[0]))
            conv = (lambda v: _dbv(v)) if ln.kind == "db" else (lambda v: None if v is None else float(v))
            pcs = [[tm(float(a[0])), tm(float(b[0])), conv(a[1]), conv(b[1]), a[2]] for a, b in zip(ks, ks[1:])]
            t0, t1 = tm(float(ks[0][0])), tm(float(ks[-1][0]))
            if t1 > t0:
                ln.replace(t0, t1, pcs)
            for x, _, _ in ln.steps():
                if t0 - 1e-9 <= x <= t1 + 1e-9:
                    splice(cid, x, "gain" if name == "gain" else "eq", CFG["splice_xf_ms"])

    # every remaining lane step gets a splice (the engine softens steps by the splice at their time)
    for cl in clips.values():
        for name in ("gain", "low", "mid", "high"):
            for x, _, _ in cl.lanes[name].steps():
                if (cl.id, _r(x)) not in splices:
                    splice(cl.id, x, "gain" if name == "gain" else "eq", CFG["splice_xf_ms"])

    # before a clip exists its lanes hold their value at its start (no step at the pre-roll)
    for cl in clips.values():
        if not cl.extent:
            continue
        t_in = max(lo, tm(float(cl.c["at"])))
        for ln in cl.lanes.values():
            if t_in > lo:
                v = ln.value(t_in)
                ln.replace(lo, t_in, [[lo, t_in, v, v, "hold"]])

    # ---- 5. Program clips
    progs = []
    for cid, cl in clips.items():
        c = cl.c
        segs = [{k: v for k, v in s.items() if not k.startswith("_")} for s in cl.segs]
        hp, lp = cl.lanes["hp"], cl.lanes["lp"]
        progs.append(S.ClipProgram(
            id=cid, src=c["src"], stems=S.clip_stems(c["stem"]), source=cl.source, pos=segs,
            gain_db=cl.lanes["gain"].knots(),
            hp_hz=None if all(p[2] is None and p[3] is None for p in hp.p) else hp.knots(),
            lp_hz=None if all(p[2] is None and p[3] is None for p in lp.p) else lp.knots(),
            eq_db={b: ([] if all(p[2] == 0 and p[3] == 0 for p in cl.lanes[b].p) else cl.lanes[b].knots())
                   for b in ("low", "mid", "high")},
            trim_db=float(c.get("gain_db", 0.0)), track_gain_from="b" if c["src"] == "b" else "a"))

    # ---- 6. levels on a 5 ms grid: owners, layered / tonal overlaps, silences, audible onsets
    ts = np.arange(lo, hi, 0.005)
    lev, ton = {}, {}
    for cid, cl in clips.items():
        inside = np.zeros(len(ts), bool)
        for a, b in cl.extent:
            inside |= (ts >= a) & (ts < b)
        g = cl.lanes["gain"].sample(ts) + float(cl.c.get("gain_db", 0.0))
        eqs = {b: cl.lanes[b].sample(ts) for b in ("low", "mid", "high")}
        band = np.isfinite(eqs["low"]) | np.isfinite(eqs["mid"]) | np.isfinite(eqs["high"])
        lev[cid] = np.where(inside & band, g, NEG)
        tonal = S.clip_stems(cl.c["stem"])
        tonal = tonal in ("mix", "high") or (isinstance(tonal, list) and bool({"other", "vocals"} & set(tonal)))
        ton[cid] = np.where(inside & tonal, g + np.maximum(eqs["mid"], eqs["high"]), NEG)

    def src_max(d: dict, src: str) -> np.ndarray:
        rows = [v for cid, v in d.items() if clips[cid].c["src"] == src]
        return np.max(rows, axis=0) if rows else np.full(len(ts), NEG)

    la, lb = src_max(lev, "a"), src_max(lev, "b")

    def runs(mask: np.ndarray, gap: float = 0.0, min_len: float = 0.0) -> list[list[float]]:
        out = []
        for a, b in S._runs(mask, ts, 0.005):
            if out and a - out[-1][1] <= gap + 1e-9:
                out[-1][1] = b
            else:
                out.append([a, b])
        return [[_r(max(a, lo)), _r(min(b, hi))] for a, b in out if b - a >= min_len - 1e-9]

    beat_s = clock.beat_s(0.0)
    layered = runs((la > -40) & (lb > -40), gap=0.03)
    tonal = runs((src_max(ton, "a") >= CFG["key"]["tonal_db"]) & (src_max(ton, "b") >= CFG["key"]["tonal_db"]),
                 gap=beat_s)
    silences = runs((la <= -60) & (lb <= -60) & (ts > 0) & (ts < T), min_len=0.03)
    onsets = {}
    for cid, cl in clips.items():
        t_on, s_on = cl.onsets
        if not len(t_on):
            onsets[cid] = []
            continue
        idx = np.clip(np.searchsorted(ts, t_on), 0, len(ts) - 1)
        ok = lev[cid][idx] >= CFG["limits"]["perc_db"]
        onsets[cid] = [[_r(t), float(round(float(s), 6))] for t, s in zip(t_on[ok], s_on[ok])]

    grid = []
    for m in range(int(math.ceil(f - 1e-9)), int(math.floor(to + 1e-9)) + 1):
        t = tm(m)
        i = min(len(ts) - 1, int(np.searchsorted(ts, t + 0.002)))
        a_on, b_on = la[i] > -60, lb[i] > -60
        own = "both" if a_on and b_on else "a" if a_on else "b" if b_on else ("a" if m < 0 else "b")
        grid.append([_r(t), m % bpb == 0, own])
    events = [[_r(tm(e[0])), _r(tm(e[1])), e[2]] for e in comp["events"]]
    expect = {
        "land_t": _r(t_land), "vacuums": [list(v) for v in vacuums], "layered": layered, "tonal": tonal,
        "ramps": [[_r(tm(s["m0"])), _r(tm(s["m1"]))] for s in comp["clock"] if s["kind"] == "ramp"],
        "step_planned_lu": None, "silences": silences, "gestures": gestures, "seams": sorted(set(seams)),
        "onsets": onsets,
    }
    def live(v: dict) -> bool:                          # only splices where the clip plays
        if v["kind"] in ("edge_in", "edge_out"):
            return True
        return any(a - 1e-3 <= v["t"] <= b + 1e-3 for a, b in clips[v["clip"]].extent)

    sp = [S.Splice(**v) for _, v in sorted(splices.items(), key=lambda kv: (kv[1]["t"], kv[1]["clip"]))
          if lo - 1e-9 <= v["t"] <= hi + 1e-9 and live(v)]
    prog = S.Program(version=COMPILER_VERSION, sr=int(sr), xf=xf, T=_r(T), t_land=_r(t_land),
                     clock_m=[_r(x) for x in clock.m_tab], clock_t=[_r(x) for x in clock.t_tab],
                     clips=progs, echoes=echoes, splices=sp, grid=grid, events=events, expect=expect)
    iss = S.validate_program(prog)
    if iss:
        raise CompileError("PROGRAM", "; ".join(str(i) for i in iss[:4]))
    return prog


def _pulse(clock: Clock, at: float, ln: float, mv: dict, bpb: int) -> list[list]:
    """The pulse pattern P(phi) (§9) as dB offset pieces over [t(at), t(at + ln)]: 1/16 steps of a
    4/4 bar counted from the master downbeats, 2 ms ramps; `pump` recovers within each beat."""
    floor = float(mv.get("floor_db", CFG["pulse_floor_db"]))
    r = CFG["pulse_ramp_ms"] / 2000
    m0, m1 = at, at + ln
    t0, t1 = clock.t(m0), clock.t(m1)
    pat = mv.get("pattern", "offbeat")
    out: list[list] = []
    if pat == "pump":
        d0, d1 = CFG["forms"]["pump_db"]
        tau = CFG["forms"]["pump_tau"]
        for k in range(int(math.floor(m0)), int(math.ceil(m1))):
            xs = np.linspace(max(k, m0), min(k + 1, m1), 9)
            if xs[-1] - xs[0] <= 1e-9:
                continue
            d = d0 + (d1 - d0) * np.clip((xs - m0) / ln, 0, 1)
            P = 20 * np.log10(np.maximum(1e-6, 1 - (1 - 10 ** (d / 20)) * np.exp(-(xs - k) / tau)))
            tt = [clock.t(x) for x in xs]
            if out:                                      # the dip returns on each beat: 2 ms ramp
                out.append([tt[0], tt[0] + 2 * r, out[-1][3], float(P[0]), "cos"])
                tt[0] = tt[0] + 2 * r
            out.extend([tt[i], tt[i + 1], float(P[i]), float(P[i + 1]), "exp"] for i in range(8) if tt[i + 1] > tt[i])
        return out or [[t0, t1, 0.0, 0.0, "hold"]]
    steps = CFG["forms"]["pulse_patterns"][pat]
    q = bpb / 16.0
    vals, cuts = [], []
    k = int(math.floor(m0 / q + 1e-9))
    while k * q < m1 - 1e-9:
        phi = int(round(((k * q) % bpb) / q)) % 16
        vals.append(0.0 if steps[phi] == "x" else floor)
        cuts.append(max(k * q, m0))
        k += 1
    cuts.append(m1)
    tt = [clock.t(x) for x in cuts]
    # the offset is 0 outside its window: ramp in / out at the edges too (no hard step there)
    cur = [tt[0], None, vals[0]]
    if vals[0] != 0.0:
        out.append([tt[0], tt[0] + 2 * r, 0.0, vals[0], "cos"])
        cur[0] = tt[0] + 2 * r
    for i in range(1, len(vals)):
        if vals[i] == vals[i - 1]:
            continue
        out.append([cur[0], tt[i] - r, cur[2], cur[2], "hold"])
        out.append([tt[i] - r, tt[i] + r, vals[i - 1], vals[i], "cos"])
        cur = [tt[i] + r, None, vals[i]]
    if cur[2] != 0.0:
        out.append([cur[0], tt[-1] - 2 * r, cur[2], cur[2], "hold"])
        out.append([tt[-1] - 2 * r, tt[-1], cur[2], 0.0, "cos"])
    else:
        out.append([cur[0], tt[-1], cur[2], cur[2], "hold"])
    return [p for p in out if p[1] > p[0]]


# ---------------------------------------------------------------------------------------------
# plan-time fields (no Program): what Transition needs from a composition
# ---------------------------------------------------------------------------------------------
def transition_fields(comp: dict, fa: dict | None = None, fb: dict | None = None) -> dict:
    """The Transition compatibility fields of a composition (§8.3): a_out_start / a_out_end /
    b_in_start / b_in_end (native seconds), T, T_overlap, bars, b_enter_s, grid, events_s,
    land_s, exit_s. Uses schema.static_eval for audibility, so it agrees with the validator."""
    maps = track_maps(comp, fa, fb)
    clock = make_clock(comp, maps)
    tm = clock.t
    f, to = clock.span["from"], clock.span["to"]
    bpb = int(comp["bpb"])
    st = S.static_eval(comp)
    h = st.h
    heads = {}
    for c in comp["clips"]:
        ph = Playhead(c, clock, maps.get(c["src"]))
        for mv in comp["moves"]:
            if mv["type"] in S.POS_MOVES and mv.get("clip") == c["id"]:
                ph.apply(mv)
        heads[c["id"]] = ph

    def aud(src: str) -> np.ndarray:
        rows = [ct.audible for ct in st.clips.values() if ct.clip["src"] == src]
        return np.any(rows, axis=0) if rows else np.zeros(len(st.m), bool)

    a_on, b_on = aud("a"), aud("b")
    a_clips = [c for c in comp["clips"] if c["src"] == "a"]
    b_clips = [c for c in comp["clips"] if c["src"] == "b"]
    a0 = min(a_clips, key=lambda c: c["at"])
    a_out_start = maps["a"].s(a0["u0"]) if a0["warp"] == "r2" else heads[a0["id"]].s(f)
    if a_on.any():
        i = int(np.where(a_on)[0][-1])
        m_last = min(float(st.m[i] + h / 2), 0.0)
        ca = next((c for c in a_clips if st.clips[c["id"]].audible[i]), a0)
        a_out_end = min(heads[ca["id"]].s(m_last - 1e-6), comp["a_ref"]["exit_t"])
    else:
        a_out_end = a_out_start
    b_aud = [c for c in b_clips if st.clips[c["id"]].audible.any()] or b_clips
    b_first = min(b_aud, key=lambda c: c["at"])
    b_in_start = heads[b_first["id"]].s(float(b_first["at"]))
    b_end = next((c for c in b_clips if c["at"] + c["len"] >= to - 1e-9 and st.clips[c["id"]].audible[-1]),
                 max(b_clips, key=lambda c: c["at"] + c["len"]))
    b_in_end = heads[b_end["id"]].s(to)
    if b_on.any():
        m_b = float(st.m[int(np.where(b_on)[0][0])] - h / 2)
    else:
        m_b = 0.0
    grid = []
    n = len(st.m)
    ms = np.arange(int(math.ceil(f - 1e-9)), int(math.floor(to + 1e-9)) + 1)
    for m, t in zip(ms.tolist(), np.atleast_1d(tm(ms.astype(float))).tolist()):
        i = min(n - 1, max(0, int(round((m - f) / h))))
        own = "both" if a_on[i] and b_on[i] else "a" if a_on[i] else "b" if b_on[i] else ("a" if m < 0 else "b")
        grid.append([_r(t), m % bpb == 0, own])
    ev = comp["events"]
    te = np.atleast_1d(tm(np.array([x for e in ev for x in (e[0], e[1])] or [0.0], float))).tolist()
    return {
        "a_out_start": _r(a_out_start), "a_out_end": _r(a_out_end), "b_in_start": _r(b_in_start),
        "b_in_end": _r(b_in_end), "T": _r(clock.T), "T_overlap": _r(clock.t_land),
        "bars": float((to - f) / bpb), "b_enter_s": _r(tm(m_b)), "grid": grid,
        "events_s": [[_r(te[2 * k]), _r(te[2 * k + 1]), e[2]] for k, e in enumerate(ev)],
        "land_s": float(comp["b_ref"]["land_t"]), "exit_s": float(comp["a_ref"]["exit_t"]),
        "m_b_first": _r(m_b, 9),
    }


__all__ = ["CompileError", "Clock", "SrcMap", "Lane", "Playhead", "track_maps", "make_clock",
           "compile_join", "transition_fields"]
