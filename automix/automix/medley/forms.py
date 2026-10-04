"""Forms (DESIGN §10), the B-in table (§7), candidate enumeration and the local static score
(§11.1-11.2).

A `JoinCtx` holds one join: A's exit X (an Exit of A's Feats), B's landing j (a Landing of B's
Feats), their relation and the facts forms test. Every `Form` has allowed(ctx), variants(ctx,
rng), build(ctx, variant) -> Composition | None and profile(comp) (its percussive / tonal overlap
windows, read at 1/4 beat from the composition's own lanes via schema.static_eval).

Implemented: drop_swap (eqpow, steps, pulse offbeat/332/stab13/pump; nobass-nodrums,
nobass-drums with B top (stems) or R4, build), phrase_trade (cuts; tops with stems),
stem_handover (stems), stutter_stitch (stems), half_time (top / high / straight), roll_slam
(roll, roll-long), echo_slam (echo, preroll), tape_stop_slam, spin_slam and cut_on_one.
cut_on_one is enumerated for every join as the universal fallback. Forms of the table that are
not implemented yet (tease_drop, vocal_reveal, double_drop; the swell and +wheel add-ons) are
skipped by the enumerator.

Fixer (review of the v1 build): slams in lock joins ramp A to B's tempo before their gesture
(slam_build: A absorbs the tempo change, R2/R5); air_cut is the gapless lock slam (A's air, then B
on the one, no vacuum); echo_slam's settings rotate with the join index; an exit through a sung
line allows only forms that throw an echo on A (§5.3); slam bin rewards an arrival, and a weak
landing onset only costs bin (drops excepted).
"""

from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass, field

import numpy as np

from . import CFG
from . import schema as S
from .compile import Clock, SrcMap

LAYERED = frozenset({"drop_swap", "stem_handover", "phrase_trade", "tease_drop", "stutter_stitch",
                     "vocal_reveal", "double_drop", "half_time"})
# §5.3 (fixer, review v1 musical #4): forms that throw an echo on A's line when their cut point
# runs through a sung line (echo_slam; drop_swap, half_time and air_cut through air()). Every other
# form is allowed only when A's vocal pauses at its cut point (Form.cut_bars before X);
# cut_on_one stays the universal fallback, with a score penalty
THROW_FORMS = frozenset({"echo_slam", "drop_swap", "half_time", "air_cut"})
AIR_THROW_FORMS = THROW_FORMS - {"echo_slam"}


def _r(x: float, n: int = 6) -> float:
    return float(round(float(x), n))


def _mmss(t: float) -> str:
    return f"{int(t // 60)}:{t % 60:05.2f}"


def stable_rng(*parts) -> random.Random:
    """Random seeded from a stable hash (Python's hash() of str is salted per process)."""
    h = hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()
    return random.Random(int(h[:12], 16))


# ---------------------------------------------------------------------------------------------
# loudness helpers
# ---------------------------------------------------------------------------------------------
def lufs_window(kb, t0: float, t1: float) -> float:
    """BS.1770 integrated loudness over [t0, t1] from Feats.kblocks (feats.lufs_window when E1's
    module is importable, else the same gated mean here)."""
    try:
        from .feats import lufs_window as lw
        return float(lw(kb, t0, t1))
    except ImportError:
        pass
    ms = np.asarray(kb["ms"] if isinstance(kb, dict) else kb, float)
    bs = float(kb.get("block_s", 0.4)) if isinstance(kb, dict) else 0.4
    hs = float(kb.get("hop_s", 0.1)) if isinstance(kb, dict) else 0.1
    i0 = max(0, int(np.ceil(t0 / hs - 1e-9)))
    i1 = min(len(ms) - 1, int(np.floor((t1 - bs) / hs + 1e-9)))
    z = ms[i0: i1 + 1] if i1 >= i0 else ms[min(max(0, int(round(t0 / hs))), len(ms) - 1):][:1]
    lk = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
    z = z[lk > -70]
    if not len(z):
        return -70.0
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z = z[-0.691 + 10 * np.log10(np.maximum(z, 1e-20)) > rel]
    return float(-0.691 + 10 * np.log10(z.mean()))


def bar_lufs(F: dict, bar: int) -> float:
    bt = F["bars"]["t"]
    t0 = float(bt[bar])
    t1 = float(bt[bar + 1]) if bar + 1 < len(bt) else float(F["duration"])
    return lufs_window(F["kblocks"], t0, t1)


def body_peak(F: dict, t0: float, t1: float) -> float | None:
    """The loud-bar true peak (dBFS): loudness.peak_pct of Feats bars.peak_db over [t0, t1) (the
    top bar alone may be a stray click); None without them."""
    pk = F["bars"].get("peak_db")
    if pk is None:
        return None
    bt = np.asarray(F["bars"]["t"], float)
    sel = (bt >= t0 - 1e-6) & (bt < t1 - 1e-6)
    v = np.asarray(pk, float)[sel] if sel.any() else np.asarray(pk, float)
    return float(np.percentile(v, CFG["loudness"]["peak_pct"])) if len(v) else None


def excerpt_gain(body_lufs: float, arc: float, target: float, c: dict = CFG, peak_db: float | None = None,
                 ceiling_db: float = -1.0) -> float:
    """§15 gain_db = clamp(target + arc - body_lufs, +-9), and (fixer, review v1 timing #1) at most
    the MP3 limiter's ceiling (ceiling - mp3_headroom_db) + max_gr_db - the body's loud-bar true
    peak (body_peak): a dynamic excerpt lifted +5 dB into the output limiter pumped 2-4 dB on its
    downbeats (the "seam dips" of the v1 audit)."""
    k = float(c["excerpt_gain_clamp_db"])
    g = float(np.clip(target + arc - body_lufs, -k, k))
    if peak_db is not None:
        lo = c["loudness"]
        g = min(g, float(ceiling_db) - float(lo["mp3_headroom_db"]) + float(lo["max_gr_db"]) - float(peak_db))
    return float(max(g, -k))


# ---------------------------------------------------------------------------------------------
# relation (§7) and the join context
# ---------------------------------------------------------------------------------------------
def _period(win: dict) -> float | None:
    f = win.get("fit")
    return float(f["period_s"]) if f and win.get("cls") != "free" else None


def _cam(ta: dict, tb: dict) -> int:
    try:
        from ..plan import camelot_distance
        return int(camelot_distance(str(ta.get("camelot") or ""), str(tb.get("camelot") or "")))
    except (ValueError, TypeError, ImportError):
        return 6


def _chroma_cos(fa: dict, X: int, fb: dict, land: dict) -> float | None:
    ca, cb = np.asarray(fa["bars"]["chroma"], float), np.asarray(fb["bars"]["chroma"], float)
    j, L = int(land["bar"]), int(land["lead"]["bars"])
    xa = ca[max(0, X - 4): X]
    xb = cb[max(0, j - L): j] if L > 0 else cb[j: j + 4]
    if not len(xa) or not len(xb):
        return None
    a, b = xa.mean(axis=0), xb.mean(axis=0)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    return None if na < 1e-9 or nb < 1e-9 else float(round(float(a @ b / (na * nb)), 4))


def relation(ta: dict, tb: dict, fa: dict, ex: dict, fb: dict, land: dict, c: dict = CFG) -> dict:
    """Rel of a join (§7) from the Feats windows the design fixes at E = 8: A's Exit.win
    [X - 16, X + 1] bars and B's Landing.win [j - 9, j + 8] bars."""
    wa, wb = ex["win"], land["win"]
    pa, pb = _period(wa), _period(wb)
    bpm_a = 60 / pa if pa else float(fa["bpm"])
    bpm_b = 60 / pb if pb else float(fb["bpm"])
    ratio = bpm_b / bpm_a
    ca, cb = wa["cls"], wb["cls"]
    four = fa["bpb"] == 4 and fb["bpb"] == 4
    kind, a_ratio = "free", 1
    if four and abs(ratio - 1) * 100 <= c["lock_max_pct"] and ca != "free" and cb != "free":
        kind = "lock"
    elif four and ca == "locked" and cb == "locked" and fa["octave_ok"] and fb["octave_ok"]:
        for ar, target in ((2, 0.5), (0.5, 2.0)):
            if abs(ratio / target - 1) * 100 <= c["double_tol_pct"]:
                kind, a_ratio = "double", ar
    stretch = (ratio * a_ratio - 1) * 100 if kind != "free" else 0.0
    return {"kind": kind, "ratio": _r(ratio, 5), "a_ratio": a_ratio, "stretch_pct": _r(stretch, 3),
            "camelot": _cam(ta, tb), "chroma": _chroma_cos(fa, int(ex["bar"]), fb, land),
            "a_class": ca, "b_class": cb}


LAND_SEARCH_MS = 25.0      # measured_landing: a strong onset this close replaces a weak one


def is_drop(land: dict, c: dict = CFG) -> bool:
    """A landing with a drop's contrast (>= drop_contrast_db) or low-band jump (>= drop_low_db)."""
    hl = c["highlight"]
    return (land.get("contrast_db") or 0) >= hl["drop_contrast_db"] or (land.get("low_jump_db") or 0) >= hl["drop_low_db"]


def drop_ok(land: dict, c: dict = CFG) -> bool:
    """A drop whose on-time downbeat onset is weak after its riser (Feats flag; Feats written
    before the flag: the same rule on the landing's fields)."""
    if "drop_ok" in land:
        return bool(land["drop_ok"])
    hl = c["highlight"]
    return bool(not land.get("onset_ok", True) and land.get("onset_err_ms") is not None
                and (land.get("onset_strength") or 0) >= hl["drop_onset_ratio"]
                and ((land.get("contrast_db") or 0) >= hl["drop_contrast_db"]
                     or (land.get("low_jump_db") or 0) >= hl["drop_low_db"]))


def measured_landing(land: dict, c: dict = CFG, F: dict | None = None) -> dict:
    """The Landing with `t` moved onto B's measured landing onset (REVIEW-external-1
    improvement 1). B is native, so this only decides where B's attack sits on the master clock
    (t(0)) and where its clip starts (3 ms before that attack); the fitted time is kept as
    `t_fit`. Idempotent.
      - onset_ok: the fitted bar time plus onset_err_ms (the strongest onset within +-15 ms);
      - otherwise, with Feats: the strongest onset within +-LAND_SEARCH_MS reaching
        land_onset_ratio x the median downbeat strength (a verify window on a free track put
        the fitted downbeat 18-22 ms off the hit, with only a weak onset or none within 15 ms);
      - otherwise any onset within +-15 ms (onset_err_ms), else the fitted time.
    Fixer (review v1 musical #2): `v1_ok` predicts V1's onset test (the same detector and
    strengths): an onset_ok landing, a drop whose on-time onset reaches drop_onset_ratio (V1's
    drop floor), or a landing moved onto a strong enough onset within 25 ms (a drop's search
    starts from the drop floor)."""
    if "v1_ok" in land:
        return land
    t = float(land["t"])
    hl = c["highlight"]
    err = land.get("onset_err_ms")
    ok = err is not None and abs(float(err)) <= float(hl["land_onset_ms"])
    new = t + float(err) / 1000 if ok else None
    v1 = bool(land.get("onset_ok", True)) or drop_ok(land, c)
    if not v1 and F is not None:
        ot = np.asarray(F["onsets"]["t"], float)
        st = np.asarray(F["onsets"]["strength"], float)
        med = float(F["onsets"].get("median_down_strength") or 0.0)
        # a drop: its strongest onset within +-25 ms from the drop floor
        ratio = hl["drop_onset_ratio"] if is_drop(land, c) else hl["land_onset_ratio"]
        k = np.where((np.abs(ot - t) <= LAND_SEARCH_MS / 1000) & (st >= float(ratio) * med))[0]
        if med > 0 and len(k):
            new, v1 = float(ot[k[np.argmax(st[k])]]), True
    if new is None:
        return dict(land, v1_ok=v1)
    return dict(land, t=_r(new, 6), t_fit=t, v1_ok=v1)


@dataclass
class JoinCtx:
    """One join: A's exit `ex` (Feats Exit at bar X), B's landing `land` (Feats Landing j)."""
    ta: dict
    tb: dict
    fa: dict
    fb: dict
    ex: dict
    land: dict
    idx: int = 0
    stems_a: bool = False
    stems_b: bool = False
    block_a: str = "house"
    block_b: str = "house"
    dL: float = 0.0                    # gained B landing bar - gained A exit bar (dB, §11.2 Loud)
    ratings: dict | None = None
    c: dict = field(default_factory=lambda: CFG)
    rel: dict = field(default=None)
    hashed: bool = True                # False while enumerating: kept candidates are hashed later

    def __post_init__(self):
        self.land = measured_landing(self.land, self.c, self.fb)
        if self.rel is None:
            self.rel = relation(self.ta, self.tb, self.fa, self.ex, self.fb, self.land, self.c)
        self.pa, self.pb = _period(self.ex["win"]), _period(self.land["win"])
        self.src_a = SrcMap(self.ex["t"], self.pa, self.fa["beats"]["t"])
        self.src_b = SrcMap(self.land["t"], self.pb, self.fb["beats"]["t"])

    # identity
    @property
    def a(self) -> str:
        return self.ta.get("id") or self.fa["track"]

    @property
    def b(self) -> str:
        return self.tb.get("id") or self.fb["track"]

    @property
    def cid(self) -> str:
        return f"j{self.idx + 1:02d}"

    @property
    def X(self) -> int:
        return int(self.ex["bar"])

    @property
    def j(self) -> int:
        return int(self.land["bar"])

    @property
    def lead(self) -> dict:
        return self.land["lead"]

    @property
    def bpb_b(self) -> int:
        return int(self.fb["bpb"])

    @property
    def bpb_a(self) -> int:
        return int(self.fa["bpb"])

    @property
    def beat_b_s(self) -> float:
        return self.pb or 60 / float(self.fb["bpm"])

    @property
    def r4(self) -> bool:
        """R4 statically: lock/double, both windows locked, |stretch| <= 3 %."""
        r = self.rel
        return (r["kind"] in ("lock", "double") and r["a_class"] == "locked" and r["b_class"] == "locked"
                and abs(r["stretch_pct"]) <= self.c["layer_perc_max_pct"] + 1e-9)

    @property
    def tau_key(self) -> float:
        return float(self.c.get("tau_key", self.c["tau_key_default"]))

    @property
    def key_ok(self) -> bool:
        ch = self.rel["chroma"]
        return self.rel["camelot"] <= self.c["key"]["cam_ok"] or (ch is not None and ch >= self.tau_key)

    @property
    def clash(self) -> float:
        if self.key_ok:
            return 0.0
        return float(self.c["key"]["clash"].get(str(min(3, self.rel["camelot"])), 1.0))

    @property
    def reset(self) -> bool:
        return self.block_a != self.block_b

    @property
    def vocal_edge(self) -> bool:
        """A's exit cuts through a sung line (§5.3; stems: no vocal gap at X)."""
        return bool(self.ex.get("vocal_at_edge"))

    def vocal_edge_at(self, bar: int) -> bool:
        """A sung line runs through A's bar `bar` (X itself: the Exit flag; earlier bars: the
        Feats vocal gap, stems only)."""
        if bar == self.X:
            return self.vocal_edge
        F = self.fa
        vr = F["bars"].get("vox_run_s")
        if not F.get("stems") or vr is None or not 0 <= bar < len(vr) or not F.get("vocal_track", True):
            return False
        return bool(vr[bar] >= self.c["highlight"]["vocal_gap_s"])

    @property
    def onset_weak(self) -> bool:
        """B's landing has no strong on-time onset and is not a drop (contrast >= 3 dB or low
        jump >= 6 dB; fixer, review v1 musical #2: a soft penalty, V1 decides)."""
        return not self.land.get("onset_ok", True) and not is_drop(self.land, self.c)

    @property
    def arrival(self) -> bool:
        """B's landing is an arrival a slam can hit (Feats flag; older Feats: a lead, contrast or
        low jump)."""
        if "arrival" in self.land:
            return bool(self.land["arrival"])
        hl = self.c["highlight"]
        return self.lead["type"] != "none" or (self.land.get("contrast_db") or 0) >= hl["arrival_contrast_db"] or \
            (self.land.get("low_jump_db") or 0) >= hl["drop_low_db"]

    def echo_set(self) -> dict:
        """echo_slam / echo throw settings, rotating with the join index (musical #1)."""
        sets = self.c["forms"]["echo_sets"]
        return sets[self.idx % len(sets)]

    @property
    def slam_ramps(self) -> bool:
        """A slam in this join ramps A to B's tempo (timing #2): lock with |stretch| above
        slam_ramp_min_pct."""
        return self.rel["kind"] == "lock" and abs(self.rel["stretch_pct"]) > self.c["forms"]["slam_ramp_min_pct"]

    def title(self, side: str) -> str:
        t = self.ta if side == "a" else self.tb
        return str(t.get("title") or (self.fa if side == "a" else self.fb)["file"].rsplit(".", 1)[0])

    def bar_perc(self, side: str, bar: int) -> bool:
        """§8.9.8 mix rule for a source bar: percussive unless perc_db < -6 and low_db <= -15."""
        F = self.fa if side == "a" else self.fb
        b = F["bars"]
        if not 0 <= bar < len(b["t"]):
            return True
        return b["perc_db"][bar] >= self.c["highlight"]["nodrums_perc_db"] or \
            b["low_db"][bar] > self.c["highlight"]["nobass_low_db"]

    def beatless_lead_s(self) -> float | None:
        """Seconds of B's lead when it is beatless (nobass-nodrums, perc_db < -6 throughout)."""
        ld = self.lead
        if ld["type"] != "nobass-nodrums" or ld["bars"] < 1:
            return None
        perc = np.asarray(self.fb["bars"]["perc_db"][max(0, self.j - ld["bars"]): self.j], float)
        if not len(perc) or perc.max() >= self.c["highlight"]["nodrums_perc_db"]:
            return None
        return float(self.src_b.s(0) - self.src_b.s(-ld["bars"] * self.bpb_b))


def cell(ctx: JoinCtx) -> list[str]:
    """The B-in table (§7): forms enumerated for (relation, B's lead), in preference order, plus
    cut_on_one, the universal fallback."""
    k, lt = ctx.rel["kind"], ctx.lead["type"]
    if k == "lock":
        forms = {"nobass-nodrums": ["tease_drop", "drop_swap", "stem_handover", "vocal_reveal"],
                 "nobass-drums": ["drop_swap", "phrase_trade", "stutter_stitch"],
                 "build": ["phrase_trade", "drop_swap", "stutter_stitch", "roll_slam"],
                 "break": ["stutter_stitch", "double_drop", "roll_slam", "echo_slam", "air_cut"],
                 "none": ["phrase_trade", "stutter_stitch", "double_drop", "echo_slam", "air_cut", "cut_on_one"]}[lt]
    elif k == "double":
        forms = ["half_time", "echo_slam"]
    else:
        s = ctx.beatless_lead_s()
        if s is not None and s <= ctx.c["forms"]["preroll_max_s"] + 1e-9:
            forms = ["echo_slam", "cut_on_one"]
        else:
            forms = ["roll_slam", "tape_stop_slam", "spin_slam", "echo_slam", "cut_on_one"]
    return forms if "cut_on_one" in forms else forms + ["cut_on_one"]


# ---------------------------------------------------------------------------------------------
# composition assembly
# ---------------------------------------------------------------------------------------------
def _seg(m0, m1, kind, b0, b1=None) -> dict:
    return {"m0": _r(m0, 9), "m1": _r(m1, 9), "kind": kind, "bpm0": float(b0),
            "bpm1": float(b0 if b1 is None else b1)}


def _clip(cid, src, stem, at, ln, u0, ratio=1, warp="native") -> dict:
    return {"id": cid, "src": src, "stem": stem, "at": _r(at, 9), "len": _r(ln, 9), "u0": _r(u0, 9),
            "ratio": ratio, "warp": warp, "gain_db": 0}


class Build:
    """Accumulates one composition (§8.4)."""

    def __init__(self, ctx: JoinCtx, form: str, variant: str, b_in: str, rel: dict | None = None):
        self.ctx, self.form, self.variant, self.b_in = ctx, form, variant, b_in
        self.rel = dict(rel or ctx.rel)
        self.clock: list[dict] = []
        self.span = (0.0, 0.0)
        self.clips: list[dict] = []
        self.moves: list[dict] = []
        self.events: list[list] = []
        self.lanes: dict = {}
        self.fallback: list[str] = []
        self._clk: Clock | None = None

    def mv(self, typ: str, at: float, **kw) -> None:
        self.moves.append({"type": typ, "at": _r(at, 9), **kw})

    def ev(self, m0: float, m1: float, label: str) -> None:
        self.events.append([_r(m0, 9), _r(m1, 9), label])

    def clk(self) -> Clock:
        if self._clk is None:
            tau = {"a_refined": self.ctx.src_a.s, "b_refined": self.ctx.src_b.s}
            # 4 points a beat: m(t) is exact on fit segments and on refined ones (linear per beat)
            self._clk = Clock(self.clock, {"from": self.span[0], "to": self.span[1]}, tau, per_beat=4)
        return self._clk

    def land_event(self) -> None:
        ld = self.ctx.land
        self.ev(0, 0, f"land: {self.ctx.title('b')} {ld['label']} {_mmss(ld['t'])}")

    def done(self, hashed: bool = True) -> dict:
        ctx = self.ctx
        comp = {
            "id": ctx.cid, "a": ctx.a, "b": ctx.b, "form": self.form, "variant": self.variant,
            "tier": S.tier_of(self.form, self.variant), "loud": S.is_loud(self.form, self.variant),
            "b_in": self.b_in, "rel": self.rel, "bpb": ctx.bpb_b,
            "a_ref": {"exit_bar": ctx.X, "exit_t": float(ctx.ex["t"]), "period_s": ctx.pa},
            "b_ref": {"land_bar": ctx.j, "land_t": float(ctx.land["t"]), "period_s": ctx.pb},
            "clock": self.clock, "span": {"from": _r(self.span[0], 9), "to": _r(self.span[1], 9)},
            "clips": self.clips, "moves": self.moves,
            "events": self.events,
            "fallback": [f for f in (self.fallback or ["echo_slam", "roll_slam", "cut_on_one"]) if f != self.form],
            "hash": "",
        }
        if self.lanes:
            comp["lanes"] = self.lanes
        comp["hash"] = S.canonical_hash(comp) if hashed and ctx.hashed else ""
        return comp


def lock_frame(ctx: JoinCtx, bd: Build, E: int) -> tuple[float, float]:
    """§10 common lock/double structure: a_fit, ramp over R bars (B silent), b_fit from -E bars;
    clip A warped (r2) over [from, 0). Returns (from, to)."""
    Bb, ar = ctx.bpb_b, bd.rel["a_ratio"]
    R = int(min(ctx.c["ramp_bars"][1], max(ctx.c["ramp_bars"][0],
                                             math.ceil(abs(bd.rel["stretch_pct"]) / ctx.c["forms"]["ramp_bars_per_pct"] - 1e-9))))
    f, to = -(E + R + 1) * Bb, Bb
    bpm_a, bpm_b = 60 / ctx.pa / ar, 60 / ctx.pb
    bd.span = (f, to)
    bd.clock = [_seg(f, -(E + R) * Bb, "a_fit", bpm_a), _seg(-(E + R) * Bb, -E * Bb, "ramp", bpm_a, bpm_b),
                _seg(-E * Bb, to, "b_fit", bpm_b)]
    return f, to


def slam_frame(ctx: JoinCtx, bd: Build, g_beats: float) -> tuple[float, float]:
    """§10 common any-tempo structure: A's own clock up to its exit X = m 0, B's from 0 (the step);
    span.from = -(g + 1) bars with g = the gesture's bars rounded up. Returns (from, to).
    A ramped slam (bd.ramped, lock joins, timing #2) instead runs a_fit, a ramp of R bars (A
    alone, R5) and b_fit from -g bars, so A's gesture plays at B's tempo and nothing steps at 0."""
    Bb, ar = ctx.bpb_b, bd.rel["a_ratio"]
    g = int(math.ceil(g_beats / Bb - 1e-9))
    if getattr(bd, "ramped", False):
        R = int(min(ctx.c["ramp_bars"][1], max(ctx.c["ramp_bars"][0], math.ceil(
            abs(bd.rel["stretch_pct"]) / ctx.c["forms"]["ramp_bars_per_pct"] - 1e-9))))
        f, to = -(g + R + 1) * Bb, Bb
        bpm_a, bpm_b = 60 / ctx.pa / ar, 60 / ctx.pb
        bd.span = (f, to)
        bd.clock = [_seg(f, -(g + R) * Bb, "a_fit", bpm_a), _seg(-(g + R) * Bb, -g * Bb, "ramp", bpm_a, bpm_b),
                    _seg(-g * Bb, to, "b_fit", bpm_b)]
        return f, to
    f, to = -(g + 1) * Bb, Bb
    if ctx.pa:
        a = _seg(f, 0, "a_fit", 60 / ctx.pa / ar)
    else:                         # refined: its mean tempo keeps t(0) and T exact without tau
        a = _seg(f, 0, "a_refined", 60 * (-f) / float(ctx.src_a.s(0) - ctx.src_a.s(f * ar)))
    if ctx.pb:
        b = _seg(0, to, "b_fit", 60 / ctx.pb)
    else:
        b = _seg(0, to, "b_refined", 60 * to / float(ctx.src_b.s(to) - ctx.src_b.s(0)))
    bd.span, bd.clock = (f, to), [a, b]
    return f, to


def slam_clips(ctx: JoinCtx, bd: Build) -> float:
    """A native over [from, 0); B native from its pickup (R7: B starts at -pickup, placed by B's own
    time before t(0), §8.6). Returns B's first master beat m_p (0 without a pickup)."""
    f, to = bd.span
    ar = bd.rel["a_ratio"]
    bd.clips.append(_clip("A", "a", "mix", f, -f, f * ar, ar, "r2" if getattr(bd, "ramped", False) else "native"))
    p = int(ctx.lead.get("pickup_beats", 0) or 0)
    m_p = 0.0
    if p:
        clk = bd.clk()
        m_p = float(clk.m(clk.t_land - float(ctx.src_b.s(0) - ctx.src_b.s(-p))))
        if m_p < f + ctx.bpb_b:              # keep the span start A's alone
            p, m_p = 0, 0.0
    bd.clips.append(_clip("B", "b", "mix", m_p, to - m_p, -p))
    if p:
        bd.ev(m_p, 0, f"B pickup {p} beat{'s' if p > 1 else ''}")
    return m_p


def echo_throw(ctx: JoinCtx, bd: Build, a_id: str, duck_key: str, throw: float = -1.0) -> None:
    """An echo throw on A (§5.3: A's exit runs through a sung line): capture [throw - 1, throw),
    dry cut at the throw, the join's rotating echo settings, ducked by B."""
    c = ctx.c
    es = ctx.echo_set()
    fb = tail_fb(bd, throw, es["delay"], es["send_db"], c)
    duck = {"key": duck_key, "depth_db": c["compile"]["echo_duck_db"],
            "release_beats": c["compile"]["echo_duck_release_beats"]}
    bd.mv("echo", throw - 1, clip=a_id, capture=1, delay=es["delay"], fb=fb, tail=c["forms"]["echo_tail_beats"],
          hp_hz=list(es["hp_hz"]), send_db=es["send_db"], duck=duck)
    bd.mv("cut", throw, clip=a_id, dir="out", ms=c["compile"]["cut_ms"])
    bd.ev(throw - 1, throw, "echo throw on A's line")


def air(ctx: JoinCtx, bd: Build, a_id: str = "A", duck_key: str | None = None) -> None:
    """R6 air (amended) and R7 (LOCK): A's low out at -air_beats (-1), A's top fades cos to -inf
    over [-1, -1/4]; with a B pickup of p beats A's mids/highs are killed over [-p - 1, -p] so A
    has no top under the pickup. When A's exit runs through a sung line (§5.3, fixer) and B has
    no pickup, A throws an echo at -1 instead (duck_key: B's clip at the landing)."""
    p = int(ctx.lead.get("pickup_beats", 0) or 0)
    if ctx.vocal_edge and not p and duck_key:
        echo_throw(ctx, bd, a_id, duck_key)
        return
    if p:
        bd.mv("eq", -p - 1, clip=a_id, band="mid_high", len=1, to_db=None, curve="cos")
    bd.mv("eq", -ctx.c["air_beats"], clip=a_id, band="low", len=0, to_db=None, curve="hold")
    bd.mv("fade", -1, clip=a_id, len=1 - ctx.c["air_top_end_beats"], from_db=0, to_db=None, shape="cos")
    bd.ev(-ctx.c["air_beats"], 0, "air: A bass out")


def lead_fade(ctx: JoinCtx, bd: Build, clip: str, L: int, shape: str, to_db: float = 0.0) -> str:
    """B's lead fade from lead_from_db over [-L bars, -1] (steps: over the whole lead so every
    step lands on a downbeat, step_bars = L/2). Returns a short description for the events."""
    Bb = ctx.bpb_b
    a = -L * Bb
    f0 = ctx.c["lead_from_db"]
    if shape == "steps":
        bd.mv("fade", a, clip=clip, len=L * Bb, from_db=f0, to_db=to_db, shape="steps", step_bars=max(1, L // 2))
        return f"stepped up every {max(1, L // 2)} bar{'s' if L > 2 else ''}"
    if shape.startswith("pulse-"):
        pat = shape.split("-", 1)[1]
        bd.mv("fade", a, clip=clip, len=L * Bb - 1, from_db=f0, to_db=to_db, shape="pulse", pattern=pat,
              floor_db=ctx.c["pulse_floor_db"])
        return f"pulsed {pat}"
    bd.mv("fade", a, clip=clip, len=L * Bb - 1, from_db=f0, to_db=to_db, shape=shape)
    return f"{shape} fade"


# ---------------------------------------------------------------------------------------------
# forms
# ---------------------------------------------------------------------------------------------
class Form:
    name = ""
    needs_stems = False
    b_in = "slam"
    cut_bars = 0            # bars before X where the form first cuts A's line (§5.3 check)

    @property
    def tier(self) -> str:
        return S.FORM_TIER[self.name]

    @property
    def loud(self) -> bool:
        return self.name in S.LOUD_FORMS

    @property
    def base(self) -> float:
        return float(CFG["base_f"][self.name])

    def allowed(self, ctx: JoinCtx) -> bool:
        if self.name not in THROW_FORMS and self.name != "cut_on_one" and ctx.vocal_edge_at(ctx.X - self.cut_bars):
            return False                 # §5.3: throw an echo on A's line, or take another exit
        if self.name in AIR_THROW_FORMS and ctx.vocal_edge and int(ctx.lead.get("pickup_beats") or 0):
            return False                 # air() cannot throw under B's pickup (A's top leaves before it)
        return self.name in cell(ctx) and (not self.needs_stems or (ctx.stems_a and ctx.stems_b))

    def variant_set(self, ctx: JoinCtx) -> list[str]:
        return [self.name]

    def variants(self, ctx: JoinCtx, rng: random.Random) -> list[str]:
        vs = self.variant_set(ctx)
        k = min(int(ctx.c["score"]["variants_per_form"]), len(vs))
        pick = rng.sample(vs, k)
        return sorted(pick, key=vs.index)

    def build(self, ctx: JoinCtx, variant: str) -> dict | None:
        raise NotImplementedError

    def profile(self, comp: dict, fa: dict | None = None, fb: dict | None = None) -> dict:
        return profile_of(comp, fa, fb)

    @staticmethod
    def family(variant: str) -> str:
        """Shape / variant family for the beam's same-shape penalty."""
        v = variant.split(".", 1)[1] if variant.startswith("L") and "." in variant else variant
        return v.split("-", 1)[0]

    def swap_b_in(self, ctx: JoinCtx) -> str:
        return "swap" if ctx.lead["type"] in ("nobass-nodrums", "nobass-drums", "build") else "slam"


def _perc_at(ctx: JoinCtx, side: str, s: np.ndarray) -> np.ndarray:
    """§8.9.8 mix rule on the source bars under native seconds s (as validate_composition maps)."""
    F = ctx.fa if side == "a" else ctx.fb
    bt = np.asarray(F["bars"]["t"], float)
    i = np.clip(np.searchsorted(bt, s, side="right") - 1, 0, len(bt) - 1)
    hl = ctx.c["highlight"]
    return (np.asarray(F["bars"]["perc_db"], float)[i] >= hl["nodrums_perc_db"]) | \
        (np.asarray(F["bars"]["low_db"], float)[i] > hl["nobass_low_db"])


def first_overlap(ctx: JoinCtx, m0: float, a_ratio: float) -> float | None:
    """First master beat in [m0, 0) where B's native mix (on its fitted clock) and A's warped mix
    (u = m * a_ratio) both sit on percussive source bars: where a lock layer needs R4."""
    step = CFG["limits"]["static_step_beats"]
    ms = np.arange(m0, 0, step) + step / 2
    sb = ctx.land["t"] + ms * ctx.beat_b_s
    sa = ctx.ex["t"] + ms * a_ratio * (ctx.pa or 60 / float(ctx.fa["bpm"]))
    hit = _perc_at(ctx, "b", sb) & _perc_at(ctx, "a", sa)
    return float(ms[hit][0] - step / 2) if hit.any() else None


def _lead_Ls(ctx: JoinCtx, cap: int) -> list[int]:
    return [L for L in (8, 4, 2) if L <= min(cap, ctx.lead["bars"])][:2]


class DropSwap(Form):
    name, b_in = "drop_swap", "swap"
    SHAPES = ("eqpow", "steps", "pulse-offbeat", "pulse-332", "pulse-stab13", "pulse-pump")

    def allowed(self, ctx):
        lt = ctx.lead["type"]
        if not super().allowed(ctx) or lt not in ("nobass-nodrums", "nobass-drums", "build"):
            return False
        if lt == "nobass-drums" and not (ctx.stems_b or ctx.r4):
            return False                     # phrase_trade cuts takes over (§10.1)
        return bool(self.variant_set(ctx))

    def variant_set(self, ctx):
        lt = ctx.lead["type"]
        cap = ctx.c["lead_max_bars"]
        if lt == "build" or not ctx.key_ok:
            cap = ctx.c["key"]["cap_lead_bars"]
        shapes = list(self.SHAPES)
        if lt == "build" or ctx.bpb_b != 4:
            shapes = ["eqpow", "steps"]      # pulse: non-percussive pulsed clip or R4, 4/4 only
        return [f"L{L}.{s}" for L in _lead_Ls(ctx, cap) for s in shapes]

    def build(self, ctx, variant):
        L = int(variant.split(".")[0][1:])
        shape = variant.split(".", 1)[1]
        lt, Bb = ctx.lead["type"], ctx.bpb_b
        bd = Build(ctx, self.name, variant, "swap")
        f, to = lock_frame(ctx, bd, L)
        bd.clips.append(_clip("A", "a", "mix", f, -f, f * bd.rel["a_ratio"], bd.rel["a_ratio"], "r2"))
        a = -L * Bb
        a_out = None                              # m where A is cut (no air then)
        if lt == "nobass-drums" and ctx.stems_b:
            bd.clips += [_clip("B_top", "b", "top", a, to - a, a), _clip("B_bed", "b", "bed", 0, to, 0)]
            lead_clip, what = "B_top", "B's top"
        else:
            bd.clips.append(_clip("B", "b", "mix", a, to - a, a))
            lead_clip, what = "B", "B"
            if lt != "build":
                bd.mv("eq", a, clip="B", band="low", len=0, to_db=None, curve="hold")
        desc = lead_fade(ctx, bd, lead_clip, L, shape)
        bd.ev(a, 0, f"{ctx.title('b')} lead in ({lt}, {what}), {desc}")
        if lt == "build":
            bd.mv("eq", a, clip="A", band="low", len=0, to_db=None, curve="hold")
            if ctx.r4:
                bd.mv("eq", a, clip="A", band="mid_high", len=L * Bb, to_db=None, curve="lin")
                bd.ev(a, 0, "basses swap; A's top fades out over B's build")
            else:
                bd.mv("cut", a, clip="A", dir="out")
                a_out = a
                bd.ev(a, a, "A out: B's build carries the beat")
        else:
            if lead_clip == "B" and not ctx.r4:   # R4: a percussive B fill must not meet A's beat
                m1 = first_overlap(ctx, a, bd.rel["a_ratio"])
                if m1 is not None:
                    if m1 < -ctx.c["highlight"]["fill_bars_max"] * Bb - 1e-9:
                        return None
                    a_out = math.floor(m1 * 2 + 1e-9) / 2          # on the beat or half beat before
                    bd.mv("cut", a_out, clip="A", dir="out")
                    bd.ev(a_out, 0, "A out for B's fill")
            k = min(ctx.c["key"]["cap_lead_bars"], L)
            db = ctx.c["key"]["mid_high_db"] if ctx.key_ok else ctx.c["key"]["mid_high_clash_db"]
            if a_out is None or a_out > -k * Bb:
                bd.mv("eq", -k * Bb, clip="A", band="mid_high", len=k * Bb - 1, to_db=db, curve="lin")
                bd.ev(-k * Bb, -1, f"A mids/highs {db:g} dB")
        if a_out is None:
            air(ctx, bd, duck_key="B_bed" if lead_clip == "B_top" else "B")
        if lt == "nobass-drums" and ctx.stems_b:
            bd.mv("swap", 0, out=["A"], **{"in": ["B_bed"]}, band="all", ms=ctx.c["compile"]["swap_ms"])
        elif lt != "build":
            bd.mv("swap", 0, out=["A"], **{"in": ["B"]}, band="low", ms=ctx.c["compile"]["swap_ms"])
        bd.land_event()
        bd.fallback = ["phrase_trade", "echo_slam", "roll_slam", "cut_on_one"]
        return bd.done()


class PhraseTrade(Form):
    name = "phrase_trade"
    cut_bars = 6                         # the first trade switch: -32 + 8 beats

    def allowed(self, ctx):
        return super().allowed(ctx) and ctx.lead["type"] in ("nobass-drums", "build", "none")

    def variant_set(self, ctx):
        vs = ["cuts"]
        if ctx.stems_a and ctx.stems_b and ctx.rel["a_class"] == "locked" and ctx.rel["b_class"] == "locked":
            vs.append("tops")                    # cuts is the only variant for verify windows
        return vs

    def build(self, ctx, variant):
        Bb = ctx.bpb_b
        bd = Build(ctx, self.name, variant, self.swap_b_in(ctx))
        f, to = lock_frame(ctx, bd, 8)
        ar = bd.rel["a_ratio"]
        a = -8 * Bb
        lens = [x * Bb / 4 for x in ctx.c["forms"]["trade_lens"]]
        end = a + sum(lens)
        xf = ctx.c["compile"]["trade_xf_ms"]
        if variant == "tops":
            bd.clips += [_clip("A_top", "a", "top", f, -f, f * ar, ar, "r2"),
                         _clip("A_bed", "a", "bed", f, -f, f * ar, ar, "r2"),
                         _clip("B_top", "b", "top", a, to - a, a), _clip("B_bed", "b", "bed", 0, to, 0)]
            pair = ["A_top", "B_top"]
            bd.mv("trade", a, clips=pair, lens=lens, slip=True, xf_ms=xf)
            bd.mv("cut", end, clip="A_top", dir="out")
            bd.mv("cut", -ctx.c["air_beats"], clip="A_bed", dir="out")
            bd.mv("swap", 0, out=["A_bed"], **{"in": ["B_bed"]}, band="all", ms=ctx.c["compile"]["swap_ms"])
            bd.ev(a, end, "tops trade 8/8/4/4/2/2/1/1 over A's bed")
            bd.ev(-ctx.c["air_beats"], 0, "air: A's bed out")
        else:
            bd.clips += [_clip("A", "a", "mix", f, -f, f * ar, ar, "r2"), _clip("B", "b", "mix", a, to - a, a)]
            bd.mv("trade", a, clips=["A", "B"], lens=lens, slip=True, xf_ms=xf)
            bd.mv("cut", end, clip="A", dir="out")
            bd.ev(a, end, "full mixes trade 8/8/4/4/2/2/1/1, one source at a time")
        bd.ev(end, 0, f"{ctx.title('b')} holds")
        bd.land_event()
        bd.fallback = ["drop_swap", "echo_slam", "roll_slam", "cut_on_one"]
        return bd.done()


class StemHandover(Form):
    name, needs_stems = "stem_handover", True
    cut_bars = 8                         # A's vocal stem fades out at -8 bars

    def allowed(self, ctx):
        return super().allowed(ctx) and ctx.lead["bars"] >= 1

    def variant_set(self, ctx):
        return ["handover" if ctx.r4 else "handover.other-out"]

    def build(self, ctx, variant):
        Bb = ctx.bpb_b
        bd = Build(ctx, self.name, variant, "swap")
        f, to = lock_frame(ctx, bd, 8)
        ar = bd.rel["a_ratio"]
        for st in ("vocals", "drums", "bass", "other"):
            bd.clips.append(_clip(f"A_{st}", "a", st, f, -f, f * ar, ar, "r2"))
        bd.clips += [_clip("B_top", "b", "top", -8 * Bb, to + 8 * Bb, -8 * Bb),
                     _clip("B_drums", "b", "drums", -4 * Bb, to + 4 * Bb, -4 * Bb),
                     _clip("B_bass", "b", "bass", 0, to, 0)]
        ms = ctx.c["compile"]["swap_ms"]
        bd.mv("fade", -8 * Bb, clip="B_top", len=4 * Bb, from_db=ctx.c["lead_from_db"], to_db=0, shape="eqpow")
        bd.mv("fade", -8 * Bb, clip="A_vocals", len=Bb, from_db=0, to_db=None, shape="cos")
        bd.mv("swap", -4 * Bb, out=["A_drums"], **{"in": ["B_drums"]}, band="all", ms=ms)
        if ctx.r4:
            bd.mv("fade", -1, clip="A_other", len=1 - ctx.c["air_top_end_beats"], from_db=0, to_db=None, shape="cos")
        else:                                  # A's other carries drum residue: out with its drums
            bd.mv("cut", -4 * Bb, clip="A_other", dir="out")
        bd.mv("cut", -ctx.c["air_beats"], clip="A_bass", dir="out")
        bd.mv("swap", 0, out=["A_bass"], **{"in": ["B_bass"]}, band="all", ms=ms)
        bd.ev(-8 * Bb, -4 * Bb, "B's top in, A's vocal out")
        bd.ev(-4 * Bb, -4 * Bb, "drum swap")
        bd.ev(-ctx.c["air_beats"], 0, "air: A's bass and other out")
        bd.land_event()
        bd.fallback = ["drop_swap", "echo_slam", "cut_on_one"]
        return bd.done()


class HalfTime(Form):
    name, b_in = "half_time", "double"

    def allowed(self, ctx):
        if ctx.vocal_edge and int(ctx.lead.get("pickup_beats") or 0):
            return False                 # air() cannot throw under B's pickup (§5.3)
        return ctx.rel["kind"] == "double"

    def variant_set(self, ctx):
        vs = []
        if ctx.lead["bars"] >= 1 and ctx.lead["type"] != "none":
            if ctx.stems_b:
                vs.append("top")
            elif ctx.r4 or ctx.lead["type"] == "nobass-nodrums":
                vs.append("high")
        return vs + ["straight"]

    def build(self, ctx, variant):
        Bb = ctx.bpb_b
        p = int(ctx.lead.get("pickup_beats", 0) or 0)
        E = min(ctx.c["forms"]["half_time_lead_bars"], ctx.lead["bars"]) if variant != "straight" else (1 if p else 0)
        bd = Build(ctx, self.name, variant, "double")
        f, to = lock_frame(ctx, bd, E)
        ar = bd.rel["a_ratio"]
        bd.clips.append(_clip("A", "a", "mix", f, -f, f * ar, ar, "r2"))
        a = -E * Bb
        top = ctx.c["forms"]["half_time_to_db"]
        if variant == "top":
            bd.clips += [_clip("B_top", "b", "top", a, to - a, a), _clip("B_bed", "b", "bed", 0, to, 0)]
            lead_fade(ctx, bd, "B_top", E, "eqpow", top)
            bd.mv("fade", 0, clip="B_top", len=0, from_db=top, to_db=0, shape="lin")
            bd.mv("swap", 0, out=["A"], **{"in": ["B_bed"]}, band="all", ms=ctx.c["compile"]["swap_ms"])
            bd.ev(a, 0, f"{ctx.title('b')}'s top over A at {ar:g}:1")
        elif variant == "high":
            bd.clips.append(_clip("B", "b", "mix", a, to - a, a))
            bd.mv("eq", a, clip="B", band="low", len=0, to_db=None, curve="hold")
            lead_fade(ctx, bd, "B", E, "eqpow", top)
            bd.mv("swap", 0, out=["A"], **{"in": ["B"]}, band="all", ms=ctx.c["compile"]["swap_ms"])
            bd.mv("eq", 0, clip="B", band="low", len=0, to_db=0, curve="hold")
            bd.ev(a, 0, f"{ctx.title('b')} lead over A at {ar:g}:1")
        else:
            m_b = -p if p else 0
            bd.clips.append(_clip("B", "b", "mix", m_b, to - m_b, m_b))
            bd.mv("swap", 0, out=["A"], **{"in": ["B"]}, band="all", ms=ctx.c["compile"]["swap_ms"])
            bd.ev(f, 0, f"A at {ar:g}:1 on the shared grid")
        air(ctx, bd, duck_key="B_bed" if variant == "top" else "B")
        bd.land_event()
        bd.fallback = ["echo_slam", "cut_on_one"]
        return bd.done()


def _slam_rel(ctx: JoinCtx) -> dict:
    return dict(ctx.rel, stretch_pct=0.0)      # A plays native: no warp


def slam_build(ctx: JoinCtx, form: str, variant: str, b_in: str = "slam", ramp: bool | None = None) -> Build:
    """A Build for a slam form: ramped (A warped onto B's tempo before the gesture, keeping the
    relation's stretch) in lock joins with |stretch| > slam_ramp_min_pct (timing #2), else A
    native with stretch 0."""
    ramp = ctx.slam_ramps if ramp is None else ramp
    bd = Build(ctx, form, variant, b_in, dict(ctx.rel) if ramp else _slam_rel(ctx))
    bd.ramped = bool(ramp)
    return bd


def _min_size(ctx: JoinCtx, bd: Build) -> float:
    """Smallest roll size (beats): >= 1/4 beat and >= roll_min_ms at A's tempo."""
    beat = bd.clk().beat_s(-1)
    return max(0.25, ctx.c["roll_min_ms"] / 1000 / beat)


class RollSlam(Form):
    name = "roll_slam"
    cut_bars = 2                         # the roll starts at -8 beats

    def variant_set(self, ctx):
        return ["roll", "roll-long"]

    def build(self, ctx, variant):
        bd = slam_build(ctx, self.name, variant)
        long_ = variant == "roll-long"
        f, to = slam_frame(ctx, bd, 8 + (16 if long_ else 0))
        m_p = slam_clips(ctx, bd)
        sizes = [[s, c] for s, c in ctx.c["roll_sizes"] if s >= _min_size(ctx, bd) - 1e-9]
        if not sizes:
            return None
        start = -ctx.c["vacuum_beats"] - sum(c for _, c in sizes)
        h0, h1 = ctx.c["roll_hp_hz"]
        if long_:
            l0, l1 = ctx.c["forms"]["roll_long_hp_hz"]
            bd.mv("filter", start - 16, clip="A", kind="hp", len=16, hz=[l0, l1], curve="exp")
            h0 = l1                                # continuous with the long sweep
            bd.ev(start - 16, start, "long HP rise")
        bd.mv("filter", start, clip="A", kind="hp", len=-ctx.c["vacuum_beats"] - start, hz=[h0, h1], curve="exp")
        bd.mv("roll", start, clip="A", sizes=sizes, slip=False, taper_db=-3)
        v = min(-ctx.c["vacuum_beats"], m_p) if m_p < 0 else -ctx.c["vacuum_beats"]
        bd.mv("vacuum", v, len=-v, **({"keep": ["B"]} if m_p < 0 else {}))
        bd.ev(start, -ctx.c["vacuum_beats"], "roll " + " / ".join(f"{s:g}" for s, _ in sizes) + " with the HP rising")
        bd.ev(v, 0, "vacuum")
        bd.land_event()
        bd.fallback = ["echo_slam", "cut_on_one"]
        return bd.done()


def tail_fb(bd: Build, throw: float, delay_beats: float, send_db: float, c: dict) -> float:
    """§9 tail rule: fb <= 10^((-20 - send_db) * delay / (20 * D)), D = throw -> B's second beat,
    evaluated exactly as schema.validate_composition does (the clock's closed forms)."""
    t_th, t_b2 = S.clock_seconds(bd.clock, [throw, 1.0])
    seg = next((s for s in bd.clock if s["m0"] <= throw < s["m1"]), bd.clock[-1])
    delay_s = delay_beats * 60.0 / float(seg["bpm0"])
    D = float(t_b2 - t_th)
    bound = 10 ** ((c["tail_floor_db"] - send_db) * delay_s / (20 * D)) if D > 0 else c["echo_fb_max"]
    return math.floor(min(c["echo_fb_max"], bound) * 1e4) / 1e4


class EchoSlam(Form):
    name = "echo_slam"

    def variant_set(self, ctx):
        s = ctx.beatless_lead_s()
        if ctx.rel["kind"] == "free" and s is not None and s <= ctx.c["forms"]["preroll_max_s"] + 1e-9:
            return ["preroll"]
        return ["echo"]

    def build(self, ctx, variant):
        c = ctx.c
        rel = _slam_rel(ctx)
        es = ctx.echo_set()                       # musical #1: rotating settings
        send, dly, hp = es["send_db"], es["delay"], list(es["hp_hz"])
        duck = {"key": "B", "depth_db": c["compile"]["echo_duck_db"],
                "release_beats": c["compile"]["echo_duck_release_beats"]}
        if variant == "preroll":
            bd = Build(ctx, self.name, variant, "preroll", rel)
            L = ctx.lead["bars"]
            lead_s = float(ctx.src_b.s(0) - ctx.src_b.s(-L * ctx.bpb_b))
            beat_a = ctx.pa or 60 / float(ctx.fa["bpm"])
            g = lead_s / (beat_a * rel["a_ratio"]) + 2
            f, to = slam_frame(ctx, bd, g)
            clk = bd.clk()
            m_b = float(clk.m(clk.t_land - lead_s))
            throw = math.floor(m_b + 1e-9)
            if throw - 1 < f + ctx.bpb_b:
                return None
            ar = rel["a_ratio"]
            bd.clips += [_clip("A", "a", "mix", f, -f, f * ar, ar, "native"),
                         _clip("B", "b", "mix", m_b, to - m_b, -L * ctx.bpb_b)]
            fb = tail_fb(bd, throw, dly, send, c)
            bd.mv("echo", throw - 1, clip="A", capture=1, delay=dly, fb=fb, tail=c["forms"]["echo_tail_beats"],
                  hp_hz=hp, send_db=send, duck=duck)
            bd.mv("cut", throw, clip="A", dir="out")
            l0, l1 = c["forms"]["echo_preroll_lp_hz"]
            # hand lane: the LP opens over the lead and is bypassed from the landing (a filter
            # move would stay engaged at the span end)
            bd.lanes = {"B": {"lp": [[_r(m_b, 9), l0, "exp"], [-0.0625, l1, "hold"], [0, None, "hold"]]}}
            bd.ev(throw - 1, throw, "echo throw")
            bd.ev(m_b, 0, f"{ctx.title('b')} beatless lead under the tail, LP opening")
        else:
            bd = slam_build(ctx, self.name, variant)
            f, to = slam_frame(ctx, bd, 2)
            m_p = slam_clips(ctx, bd)
            throw = min(-1.0, math.floor(m_p)) if m_p < 0 else -1.0
            if throw - 1 < f + ctx.bpb_b:
                return None
            fb = tail_fb(bd, throw, dly, send, c)
            bd.mv("echo", throw - 1, clip="A", capture=1, delay=dly, fb=fb, tail=c["forms"]["echo_tail_beats"],
                  hp_hz=hp, send_db=send, duck=duck)
            bd.mv("cut", throw, clip="A", dir="out", ms=c["compile"]["cut_ms"])
            v = min(-0.25, m_p) if m_p < 0 else -0.25
            bd.mv("vacuum", v, len=-v, **({"keep": ["B"]} if m_p < 0 else {}))
            bd.ev(throw - 1, throw, "echo throw, dry cut")
            bd.ev(v, 0, "vacuum")
        bd.land_event()
        bd.fallback = ["roll_slam", "cut_on_one"]
        return bd.done()


class StutterStitch(Form):
    """§10.5 with stems: B's top enters at -6 bars (-12 -> -3 dB), then a 2-bar gate trades the
    two tops on 16ths over A's bed (the only kick) until -1/2; B lands at 0. The no-stem `high`
    variant is not built: A's pseudo-stem split would break the span-start rule (one mix clip)."""
    name = "stutter_stitch"
    cut_bars = 2                         # the gate starts at -2 bars

    def allowed(self, ctx):
        return super().allowed(ctx) and ctx.stems_a and ctx.stems_b and ctx.bpb_b == 4 and ctx.bpb_a == 4

    def variant_set(self, ctx):
        return ["stitch" if ctx.key_ok else "stitch.gate-only"]   # no top layering on a key clash

    def build(self, ctx, variant):
        Bb = ctx.bpb_b
        bd = Build(ctx, self.name, variant, self.swap_b_in(ctx))
        f, to = lock_frame(ctx, bd, 6)
        ar = bd.rel["a_ratio"]
        c = ctx.c
        b0 = -6 * Bb if variant == "stitch" else -2 * Bb
        bd.clips += [_clip("A_top", "a", "top", f, -f, f * ar, ar, "r2"),
                     _clip("A_bed", "a", "bed", f, -f, f * ar, ar, "r2"),
                     _clip("B_top", "b", "top", b0, to - b0, b0), _clip("B_bed", "b", "bed", 0, to, 0)]
        top = c["forms"]["stutter_top_db"]
        if variant == "stitch":
            bd.mv("fade", b0, clip="B_top", len=4 * Bb, from_db=c["forms"]["stutter_entry_db"], to_db=top,
                  shape="eqpow")
            bd.ev(b0, -2 * Bb, f"{ctx.title('b')}'s top enters under A")
        else:
            bd.mv("fade", b0, clip="B_top", len=0, from_db=top, to_db=top, shape="lin")
        bd.mv("gate", -2 * Bb, clips=["A_top", "B_top"], len=2 * Bb, steps=list(c["forms"]["stutter_steps"]),
              attack_ms=c["gate_attack_ms"], release_ms=c["gate_release_ms"])
        bd.mv("cut", -c["air_beats"], clip="A_bed", dir="out")
        bd.mv("fade", 0, clip="B_top", len=0, from_db=top, to_db=0, shape="lin")
        bd.mv("swap", 0, out=["A_top", "A_bed"], **{"in": ["B_bed"]}, band="all", ms=c["compile"]["swap_ms"])
        bd.ev(-2 * Bb, 0, "stutter gate: the tops trade on 16ths over A's bed")
        bd.ev(-c["air_beats"], 0, "air: A's bed out")
        bd.land_event()
        bd.fallback = ["phrase_trade", "echo_slam", "cut_on_one"]
        return bd.done()


def _pickup_a_beats(ctx: JoinCtx) -> float:
    """B's pickup length in master beats of A's clock (an estimate for sizing the frame)."""
    p = int(ctx.lead.get("pickup_beats", 0) or 0)
    if not p:
        return 0.0
    beat_a = (ctx.pa or 60 / float(ctx.fa["bpm"])) * ctx.rel["a_ratio"]
    return float(ctx.src_b.s(0) - ctx.src_b.s(-p)) / beat_a


def _gesture_end(m_p: float, default: float) -> float:
    """A gesture must be over before B's pickup starts (the pickup plays in the vacuum)."""
    return min(default, m_p) if m_p < 0 else default


class TapeStopSlam(Form):
    """§10.11: tape_stop at -2.5, len 2, k 1.5 (rate 0 at -1/2), vacuum [-1/2, 0), slam."""
    name = "tape_stop_slam"

    def variant_set(self, ctx):
        return ["stop"]

    def build(self, ctx, variant):
        c = ctx.c
        ts = c["tape_stop"]
        bd = slam_build(ctx, self.name, variant)
        f, to = slam_frame(ctx, bd, ts["len"] + max(c["vacuum_beats"], _pickup_a_beats(ctx)))
        m_p = slam_clips(ctx, bd)
        end = _gesture_end(m_p, -c["vacuum_beats"])
        at = end - ts["len"]
        if at < f + ctx.bpb_b:
            return None
        bd.mv("tape_stop", at, clip="A", len=ts["len"], k=ts["k"])
        bd.mv("vacuum", end, len=-end, **({"keep": ["B"]} if m_p < 0 else {}))
        bd.ev(at, end, "tape stop")
        bd.ev(end, 0, "vacuum")
        bd.land_event()
        bd.fallback = ["roll_slam", "echo_slam", "cut_on_one"]
        return bd.done()


class SpinSlam(Form):
    """§10.12: backspin at -1 (push 1/8, peak -3.5, tau 0.35), rate 0 by -1/4, then a slam."""
    name = "spin_slam"

    def variant_set(self, ctx):
        return ["spin"]

    def build(self, ctx, variant):
        c = ctx.c
        bs = c["backspin"]
        bd = slam_build(ctx, self.name, variant)
        f, to = slam_frame(ctx, bd, 1 + max(0.0, _pickup_a_beats(ctx) + bs["end_by"]))
        m_p = slam_clips(ctx, bd)
        end = _gesture_end(m_p, bs["end_by"])
        at = -1.0 + (end - bs["end_by"])              # beat 4 of A's last bar (earlier before a pickup)
        if at < f + ctx.bpb_b:
            return None
        bd.mv("backspin", at, clip="A", push=bs["push"], peak_rate=bs["peak_rate"], tau=bs["tau"], end_by=end)
        bd.mv("vacuum", end, len=-end, **({"keep": ["B"]} if m_p < 0 else {}))
        bd.ev(at, end, "backspin")
        bd.ev(end, 0, "vacuum")
        bd.land_event()
        bd.fallback = ["echo_slam", "cut_on_one"]
        return bd.done()


class CutOnOne(Form):
    name = "cut_on_one"

    def allowed(self, ctx):
        return True                             # the universal fallback

    def variant_set(self, ctx):
        # v = 1/4 beat always: rule 7 needs A silent from t(0) - 1/4 beat at the tempo step, so
        # the design's v = 0 for a quiet last bar becomes a short fade instead (see report)
        loud = ctx.fa["bars"]["rel_db"][max(0, ctx.X - 1)] >= ctx.c["forms"]["cut_v_loud_db"]
        return ["cut" if loud else "fade"]

    def build(self, ctx, variant):
        bd = slam_build(ctx, self.name, variant)
        f, to = slam_frame(ctx, bd, 1)
        m_p = slam_clips(ctx, bd)
        v = min(-0.25, m_p) if m_p < 0 else -0.25
        if variant == "fade":
            bd.mv("fade", v - 0.75, clip="A", len=0.75, from_db=0, to_db=None, shape="cos")
        else:
            bd.mv("cut", v, clip="A", dir="out", ms=ctx.c["compile"]["cut_ms"])
        bd.mv("vacuum", v, len=-v, **({"keep": ["B"]} if m_p < 0 else {}))
        bd.ev(v, 0, "A cut" if variant == "cut" else "A fades")
        bd.land_event()
        bd.fallback = []
        return bd.done()


class AirCut(Form):
    """Fixer (review v1, musical #1): the gapless lock slam. A is ramped onto B's tempo (lock
    frame, R2) and keeps playing into the landing: R6's low kill at -1 beat, A's top eased (cos)
    to air_cut_hold_db over [-1, -1/4] and held there into the one, where B slams (V11 measures A
    >= 6 dB under its body there). With a B pickup, or a sung exit (echo throw), the R6 air of
    air() applies: the pickup or the echo fills the last beat. No vacuum, no gesture, and no
    digital silence (v2's cos-to-silence air left 1/4 beat of it, like the slams it replaced)."""
    name = "air_cut"

    def allowed(self, ctx):
        return super().allowed(ctx) and ctx.rel["kind"] == "lock" and ctx.pa is not None and ctx.pb is not None

    def variant_set(self, ctx):
        return ["air"]

    def build(self, ctx, variant):
        c = ctx.c
        p = int(ctx.lead.get("pickup_beats", 0) or 0)
        bd = slam_build(ctx, self.name, variant, ramp=True)
        f, to = slam_frame(ctx, bd, 1 + p)
        slam_clips(ctx, bd)
        if p or ctx.vocal_edge:
            air(ctx, bd, duck_key="B")
        else:
            hold = float(c["forms"]["air_cut_hold_db"])
            bd.mv("eq", -c["air_beats"], clip="A", band="low", len=0, to_db=None, curve="hold")
            bd.mv("fade", -1, clip="A", len=1 - c["air_top_end_beats"], from_db=0, to_db=hold, shape="cos")
            bd.ev(-c["air_beats"], 0, f"air: A bass out, A's top {hold:g} dB into the one")
        bd.land_event()
        bd.fallback = ["echo_slam", "cut_on_one"]
        return bd.done()


FORMS: dict[str, Form] = {f.name: f for f in (DropSwap(), StemHandover(), PhraseTrade(), StutterStitch(),
                                               HalfTime(), RollSlam(), EchoSlam(), TapeStopSlam(), SpinSlam(),
                                               CutOnOne(), AirCut())}


# ---------------------------------------------------------------------------------------------
# profile and local score (§11.2)
# ---------------------------------------------------------------------------------------------
def profile_of(comp: dict, fa: dict | None = None, fb: dict | None = None, step: float = 0.25) -> dict:
    """Overlap windows at 1/4 beat from the composition's lanes: beats where both sources are
    percussive above -20 dB (perc), where both have a tonal clip above -12 dB (tonal, Ht) and
    where both are audible above -40 dB (layered)."""
    st = S.static_eval(comp, step=step)
    warped = {s: any(c["src"] == s and c["warp"] == "r2" for c in comp["clips"]) for s in ("a", "b")}
    feats = {"a": fa, "b": fb}
    n = len(st.m)
    perc = {s: np.zeros(n, bool) for s in ("a", "b")}
    ton = {s: np.zeros(n, bool) for s in ("a", "b")}
    aud = {s: np.zeros(n, bool) for s in ("a", "b")}
    for ct in st.clips.values():
        s = ct.clip["src"]
        if s not in perc:
            continue
        lev = ct.level
        perc[s] |= ct.audible & (lev >= CFG["limits"]["perc_db"]) & \
            S._percussive(comp, ct, st, feats.get(s), warped.get(s, False))
        names = S.clip_stems(ct.clip["stem"])
        tonal = names in ("mix", "high") or (isinstance(names, list) and bool({"other", "vocals"} & set(names)))
        if tonal:
            with np.errstate(invalid="ignore"):
                tl = lev + np.maximum(ct.eq["mid"], ct.eq["high"])
            ton[s] |= ct.audible & (tl >= CFG["key"]["tonal_db"])
        aud[s] |= ct.audible & (lev > -40)
    both = {k: d["a"] & d["b"] for k, d in (("perc", perc), ("tonal", ton), ("layered", aud))}
    return {k: float(v.sum() * step) for k, v in both.items()} | {
        "perc_windows": S._runs(both["perc"], st.m, step)}


def _fit_echo(ctx: JoinCtx) -> float:
    """1 when A's last beat carries a vocal (vocal_at_edge) or a strong percussive onset."""
    if ctx.ex.get("vocal_at_edge"):
        return 1.0
    ot = np.asarray(ctx.fa["onsets"]["t"], float)
    os_ = np.asarray(ctx.fa["onsets"]["strength"], float)
    beat = ctx.pa or 60 / float(ctx.fa["bpm"])
    sel = (ot >= ctx.ex["t"] - beat) & (ot < ctx.ex["t"])
    med = float(ctx.fa["onsets"].get("median_down_strength") or 0)
    return 1.0 if sel.any() and med > 0 and os_[sel].max() >= med else ctx.c["score"]["fit_default"]


def _fit_roll(ctx: JoinCtx) -> float:
    """0 on ambient or free material (a roll needs a beat to repeat)."""
    if ctx.rel["a_class"] == "free":
        return 0.0
    X = ctx.X
    perc = np.asarray(ctx.fa["bars"]["perc_db"][max(0, X - 4): X], float)
    if len(perc) and perc.mean() < ctx.c["highlight"]["nodrums_perc_db"]:
        return 0.0
    return ctx.c["score"]["fit_default"]


def _fit_stutter(ctx: JoinCtx) -> float:
    """1 on vocal-heavy tops: A's last 4 body bars carry the vocal proxy near its p90."""
    vox = np.asarray(ctx.fa["bars"]["vox_db"][max(0, ctx.X - 4): ctx.X], float)
    return 1.0 if len(vox) and vox.mean() >= -3 else ctx.c["score"]["fit_default"]


FIT = {"roll_slam": _fit_roll, "echo_slam": _fit_echo, "stutter_stitch": _fit_stutter,
       "tape_stop_slam": lambda ctx: 1.0 if (ctx.reset or ctx.dL >= 3) else ctx.c["score"]["fit_default"]}


def _rating(ctx: JoinCtx) -> float | None:
    if not ctx.ratings:
        return None
    v = ctx.ratings.get(f"{ctx.a}>{ctx.b}")
    if isinstance(v, dict):
        v = v.get("value", v.get("rating"))
    return float(v) if isinstance(v, (int, float)) else None


GROOVE_SNAP_S = 0.040          # an onset belongs to the nearest beat when within 40 ms of it


def _pos_offsets(F: dict, ref_t: float, period: float, t0: float, t1: float, bpb: int) -> dict[int, list[float]]:
    """{beat-in-bar k: [offset s]} of the strong onsets (>= 1/2 the median downbeat strength)
    in source [t0, t1] against the grid ref_t + u * period (k from the grid's own bar phase)."""
    ot = np.asarray(F["onsets"]["t"], float)
    st = np.asarray(F["onsets"]["strength"], float)
    med = float(F["onsets"].get("median_down_strength") or 0.0)
    sel = (ot >= t0) & (ot <= t1) & (st >= 0.5 * med)
    u = (ot[sel] - ref_t) / period
    k = np.round(u)
    off = (u - k) * period
    out: dict[int, list[float]] = {}
    for kk, o in zip(k.astype(int), off):
        if abs(o) <= GROOVE_SNAP_S:
            out.setdefault(int(kk % bpb), []).append(float(o))
    return out


def groove_ok(ctx: JoinCtx, comp: dict, prof: dict) -> bool:
    """Lead engineer's addition A: before two percussive sources layer (R4), each side's
    kick/snare onset offsets per beat-in-bar (A against its fitted grid, which the warp puts on
    the master grid; B against its own) must agree within groove_tol_ms, where both sides have
    >= 3 hits at that position. A per-position disagreement (a 20 ms clap groove against a
    straight one) flams under the lock even with both grids exact: layering is then refused
    (the enumerator drops the candidate; its non-layered forms remain)."""
    wins = prof.get("perc_windows") or []
    if not wins or not ctx.pa or not ctx.pb:
        return True
    tol = float(ctx.c["forms"].get("groove_tol_ms", 10)) / 1000
    ar = comp["rel"]["a_ratio"]
    m0, m1 = min(a for a, _ in wins), max(b for _, b in wins)
    bpb = int(comp["bpb"])
    pad = 2 * bpb                                   # a bar either side for enough hits
    ea, lb = float(comp["a_ref"]["exit_t"]), float(comp["b_ref"]["land_t"])
    offa = _pos_offsets(ctx.fa, ea, ctx.pa, ea + (m0 - pad) * ar * ctx.pa, ea + (m1 + pad) * ar * ctx.pa, bpb)
    offb = _pos_offsets(ctx.fb, lb, ctx.pb, lb + (m0 - pad) * ctx.pb, lb + (m1 + pad) * ctx.pb, bpb)
    scale = ctx.pb / (ctx.pa * ar)                  # A's source seconds -> master seconds
    for k in set(offa) & set(offb):
        if len(offa[k]) >= 3 and len(offb[k]) >= 3:
            if abs(float(np.median(offa[k])) * scale - float(np.median(offb[k]))) > tol:
                return False
    return True


def local_score(ctx: JoinCtx, comp: dict, prof: dict | None = None) -> tuple[float, dict] | None:
    """S = base_f + 2.0 Bin + 1.0 Beat + 0.6 Key + 0.5 Loud + 0.4 Fit + 0.5 S_out(X) + Rt (§11.2).
    None when the candidate breaks R4 statically (two percussive sources without R4)."""
    c = ctx.c
    sc = c["score"]
    form = comp["form"]
    prof = prof or profile_of(comp, ctx.fa, ctx.fb)
    lt = ctx.lead["type"]
    if form in LAYERED:
        b = sc["bin_lead"][lt]
        if lt == "nobass-drums" and not (ctx.stems_b or ctx.r4):
            b = sc["bin_nobass_drums_weak"]
    else:
        # fixer (review v1 musical #3): a slam rewards the landing's arrival (contrast, low jump or
        # a vocal entry at a section start), not its onset strength; a non-arrival costs bin
        bs = sc["bin_slam"]
        pick = int(ctx.lead.get("pickup_beats") or 0) > 0 or "swell" in comp["variant"]
        b = bs["base"] + bs["onset"] * ctx.arrival + bs["pickup"] * pick + (0.0 if ctx.arrival else bs["no_arrival"])
    if ctx.dL < -sc["quiet_landing_db"] and not ctx.reset:
        b += sc["bin_quiet_landing"]
    if ctx.onset_weak:     # fixer (musical #2): a soft penalty instead of dropping the landing
        b += c["highlight"]["no_onset_bin"]
    rel = comp["rel"]
    if prof["perc"] > 0:
        r4 = (rel["kind"] in ("lock", "double") and rel["a_class"] == "locked" and rel["b_class"] == "locked"
              and abs(rel["stretch_pct"]) <= c["layer_perc_max_pct"] + 1e-9)
        if not r4 or not groove_ok(ctx, comp, prof):
            return None
        beat = 1.0
    else:
        both_locked = rel["a_class"] == "locked" and rel["b_class"] == "locked"
        beat = 1.0 if both_locked and abs(rel["stretch_pct"]) <= c["layer_perc_max_pct"] else sc["beat_verify"]
    key = 1 - min(1.0, prof["tonal"] / c["key"]["ht_beats"]) * ctx.clash
    loud = 1.0 if ctx.reset else max(-1.0, 1 - max(0.0, abs(ctx.dL) - sc["loud_free_db"]) / sc["loud_span_db"])
    fit = FIT.get(form, lambda _: sc["fit_default"])(ctx)
    s_out = float(ctx.ex["s_out"]) + (c["highlight"]["s_out"]["tail48"] * bool(ctx.ex.get("tail48"))
                                      if ctx.rel["kind"] == "lock" else 0.0)
    rt = 0.0
    rv = _rating(ctx)
    if rv is not None and form in LAYERED:
        if ctx.rel["kind"] == "lock" and rv >= sc["rt"]["hi"]:
            rt = sc["rt"]["hi_bonus"]
        elif rv <= sc["rt"]["lo"]:
            rt = sc["rt"]["lo_pen"]
    if form == "cut_on_one" and ctx.vocal_edge:
        rt += sc["vocal_edge_noecho"]           # the fallback cut through a sung line (musical #4)
    w = c["weights"]
    terms = {"base": float(c["base_f"][form]), "bin": _r(b, 4), "beat": _r(beat, 4), "key": _r(key, 4),
             "loud": _r(loud, 4), "fit": _r(fit, 4), "exit": _r(s_out, 4), "rt": _r(rt, 4)}
    S_ = (terms["base"] + w["bin"] * b + w["beat"] * beat + w["key"] * key + w["loud"] * loud
          + w["fit"] * fit + w["exit"] * s_out + rt)
    return _r(S_, 6), terms


# ---------------------------------------------------------------------------------------------
# candidates (§11.1)
# ---------------------------------------------------------------------------------------------
@dataclass
class Cand:
    """One candidate composition for a join. `fields` holds what the beam needs (a_out_start,
    b_in_start, b_in_end: native seconds); `valid` is None until schema validation ran."""
    X: int
    j: int
    form: str
    variant: str
    tier: str
    loud: bool
    family: str
    S: float
    terms: dict
    comp: dict
    fields: dict = field(default_factory=dict)
    lead_bars: int = 0
    id: int = 0
    valid: bool | None = None
    vacuum: bool = False            # the dry audio stops before the landing (musical #1)

    @property
    def key(self) -> tuple:
        return (-self.S, self.form, self.variant, self.X, self.j)

    def check(self, fa: dict | None, fb: dict | None) -> bool:
        """Full §8.9 validation (memoised on the candidate)."""
        if self.valid is None:
            self.valid = not S.validate_composition(self.comp, fa, fb)
        return self.valid


@dataclass
class PairCtx:
    """Everything for enumerating one (A, B) pair: all of A's exits x all of B's landings."""
    ta: dict
    tb: dict
    fa: dict
    fb: dict
    stems_a: bool = False
    stems_b: bool = False
    block_a: str = "house"
    block_b: str = "house"
    target_lufs: float = -11.0
    ceiling_db: float = -1.0
    seed: int = 0
    ratings: dict | None = None
    bad_landings: frozenset = frozenset()     # {(track id, bar)}
    c: dict = field(default_factory=lambda: CFG)
    lands: frozenset | None = None            # B landing bars the planner allows (None = all)

    @property
    def a(self) -> str:
        return self.ta.get("id") or self.fa["track"]

    @property
    def b(self) -> str:
        return self.tb.get("id") or self.fb["track"]


def exits_by_bar(F: dict) -> dict[int, tuple[dict, dict]]:
    """X -> (Exit, Landing) over a track's top landings: the best-h landing that exits at X."""
    out: dict[int, tuple[dict, dict]] = {}
    for ld in F["landings"]:
        for e in ld["exits"]:
            if e["bar"] not in out or e["h"] > out[e["bar"]][0]["h"]:
                out[e["bar"]] = (e, ld)
    return out


def _dL(pc: PairCtx, ex: dict, ld_a: dict, land: dict) -> float:
    """Gained B landing bar minus gained A exit bar (dB), with the excerpt gains of A's best
    excerpt ending at X and B's best excerpt from j (§11.2 Loud, §15)."""
    c = pc.c
    arc = c["arc_off_lu"]
    body_a = lufs_window(pc.fa["kblocks"], ld_a["lead"]["t"], ex["t"])
    e_b = land["exits"][0] if land["exits"] else None
    body_b = lufs_window(pc.fb["kblocks"], land["lead"]["t"], e_b["t"] if e_b else land["t"] + 30)
    t1b = e_b["t"] if e_b else land["t"] + 30
    ga = excerpt_gain(body_a, arc.get(pc.block_a, 0), pc.target_lufs, c,
                      body_peak(pc.fa, ld_a["lead"]["t"], ex["t"]), pc.ceiling_db)
    gb = excerpt_gain(body_b, arc.get(pc.block_b, 0), pc.target_lufs, c,
                      body_peak(pc.fb, land["lead"]["t"], t1b), pc.ceiling_db)
    return (bar_lufs(pc.fb, int(land["bar"])) + gb) - (bar_lufs(pc.fa, max(0, int(ex["bar"]) - 1)) + ga)


def join_contexts(pc: PairCtx, idx: int = 0, hashed: bool = True) -> list[JoinCtx]:
    """A JoinCtx per (A exit X, B landing j), bad landings excluded."""
    out = []
    xs = exits_by_bar(pc.fa)
    for X in sorted(xs):
        ex, ld_a = xs[X]
        for land in pc.fb["landings"]:
            if (pc.b, int(land["bar"])) in pc.bad_landings or (pc.lands is not None and int(land["bar"]) not in pc.lands):
                continue
            out.append(JoinCtx(pc.ta, pc.tb, pc.fa, pc.fb, ex, land, idx=idx, stems_a=pc.stems_a,
                               stems_b=pc.stems_b, block_a=pc.block_a, block_b=pc.block_b,
                               dL=_dL(pc, ex, ld_a, land), ratings=pc.ratings, c=pc.c, hashed=hashed))
    return out


def is_vacuum(comp: dict) -> bool:
    """A vacuum join: the composition silences the dry audio before the landing (every slam but
    air_cut; echo tails do not count as groove)."""
    return any(m["type"] == "vacuum" for m in comp["moves"])


def beam_fields(ctx: JoinCtx, comp: dict) -> dict | None:
    """The native seconds the beam needs (§11.3): a_out_start (A at span.from), b_in_start (B's
    first audible clip start) and b_in_end (B at span.to), or None when A's region or B's lead
    falls outside its file (a static precondition: the lead of track k starts >= 0 s).
    compile.transition_fields gives the same numbers for these forms (B's playhead is never
    rewritten); the plan uses transition_fields for the chosen candidates."""
    st = None
    a0 = min((c for c in comp["clips"] if c["src"] == "a"), key=lambda c: c["at"])
    b_clips = [c for c in comp["clips"] if c["src"] == "b"]
    b0 = min(b_clips, key=lambda c: c["at"])
    if any(mv["type"] == "trade" for mv in comp["moves"]):
        st = S.static_eval(comp, step=0.25)            # B's first block may be A's: first audible
        aud = [c for c in b_clips if st.clips[c["id"]].audible.any()]
        b0 = min(aud or b_clips, key=lambda c: c["at"])
    a_out = float(ctx.src_a.s(a0["u0"]))
    b_in = float(ctx.src_b.s(b0["u0"]))
    to = comp["span"]["to"]
    be = max(b_clips, key=lambda c: c["at"] + c["len"])
    tau = {"a_refined": ctx.src_a.s, "b_refined": ctx.src_b.s}
    t_at, t_to = S.clock_seconds(comp["clock"], [be["at"], to], tau)
    b_end = float(ctx.src_b.s(be["u0"])) + float(t_to - t_at)
    if a_out < 0 or b_in < 0 or b_end > float(ctx.fb["duration"]):
        return None
    return {"a_out_start": _r(a_out), "b_in_start": _r(b_in), "b_in_end": _r(b_end)}


def enumerate_candidates(pc: PairCtx, idx: int = 0, validate: bool = False) -> list[Cand]:
    """§11.1: every (X_A, j_B, allowed form, 2 variants) that builds, lies inside its files and
    scores (static R4 at 1/4 beat); pruned to cands_per_join keeping the best per_form_keep per
    form, cut_on_one for every (X_A, j_B) (the universal fallback keeps the beam feasible) and at
    least one per j_B and per X_A. Sorted by score, ties by (form, variant, X, j); `id` = rank.
    With validate=True only candidates passing schema.validate_composition are kept; otherwise
    validation is lazy (Cand.check), done by the planner on the beam's picks."""
    c = pc.c
    pool: list[Cand] = []
    ctxs = {}
    for ctx in join_contexts(pc, idx, hashed=False):
        for name in cell(ctx):
            form = FORMS.get(name)
            if form is None or not form.allowed(ctx):
                continue
            rng = stable_rng(pc.seed, pc.a, pc.b, name, ctx.X, ctx.j)
            for v in form.variants(ctx, rng):
                comp = form.build(ctx, v)
                if comp is None:
                    continue
                fields = beam_fields(ctx, comp)
                if fields is None:
                    continue
                prof = form.profile(comp, ctx.fa, ctx.fb)
                sc = local_score(ctx, comp, prof)
                if sc is None:
                    continue
                comp["score"] = {"local": sc[0], "terms": sc[1]}
                bars = int(round(-min(cl["at"] for cl in comp["clips"] if cl["src"] == "b") / ctx.bpb_b))
                q = Cand(ctx.X, ctx.j, name, v, comp["tier"], comp["loud"], form.family(v),
                         sc[0], sc[1], comp, fields=fields, lead_bars=max(0, bars),
                         vacuum=is_vacuum(comp))
                pool.append(q)
                ctxs[id(q)] = ctx
    pool.sort(key=lambda q: q.key)

    def ok(q: Cand) -> bool:
        if not q.comp["hash"]:
            q.comp["hash"] = S.canonical_hash(q.comp)
        return not validate or q.check(pc.fa, pc.fb)

    keep: list[Cand] = []
    taken: set[int] = set()
    n_max, n_form = int(c["cands_per_join"]), int(c["score"]["per_form_keep"])

    def take(q: Cand) -> bool:
        if id(q) in taken or len(keep) >= n_max or not ok(q):
            return False
        keep.append(q)
        taken.add(id(q))
        return True

    per_form: dict[str, int] = {}
    for q in pool:                                      # the best per form
        if per_form.get(q.form, 0) < n_form and take(q):
            per_form[q.form] = per_form.get(q.form, 0) + 1
    # note: the beam's feasibility fixes X_A per join (the previous landing's exits), so every
    # (X_A, j_B) keeps its best per_xj_keep forms besides cut_on_one; with only "the best 3 per
    # form" the pool was all one or two (X, j) and the beam fell back to cut_on_one in a third
    # of the joins of the real set
    n_xj = int(c["score"].get("per_xj_keep", 2))
    xj: dict[tuple, set] = {}
    for q in keep:
        xj.setdefault((q.X, q.j), set()).add(q.form)
    for q in pool:
        got = xj.setdefault((q.X, q.j), set())
        if q.form != "cut_on_one" and q.form not in got and len(got - {"cut_on_one"}) < n_xj and take(q):
            got.add(q.form)
    covers = (lambda q: ("cut", q.X, q.j) if q.form == "cut_on_one" else None, lambda q: q.j, lambda q: q.X)
    for cover in covers:
        have = {cover(q) for q in keep}
        for q in pool:
            k = cover(q)
            if k is not None and k not in have and take(q):
                have.add(k)
    if c.get("creation", {}).get("enabled", False):
        keep += _creation_pool(pc, idx, {(q.X, q.j) for q in keep}, ctxs, validate)
    keep.sort(key=lambda q: q.key)
    for i, q in enumerate(keep):
        q.id = i
    return keep


def _creation_pool(pc: PairCtx, idx: int, xjs: set, ctxs: dict, validate: bool) -> list[Cand]:
    """Creation candidates (medley v5) for the (X_A, j_B) pairs the pool kept: the first parameter
    seed of every allowed creation form, scored by creation.creation_score (its bonus puts a
    creation ahead of every slam the beam could pick for the same excerpts)."""
    from .creation import creation_cands, creation_score
    out: list[Cand] = []
    for ctx in join_contexts(pc, idx, hashed=False):
        if (ctx.X, ctx.j) not in xjs:
            continue
        for name, v, comp, fields in creation_cands(ctx):
            comp["hash"] = S.canonical_hash(comp)
            if validate and S.validate_composition(comp, pc.fa, pc.fb):
                continue
            sc = creation_score(ctx, comp)
            comp["score"] = {"local": sc[0], "terms": sc[1]}
            bars = int(round(-min(cl["at"] for cl in comp["clips"] if cl["src"] == "b") / ctx.bpb_b))
            out.append(Cand(ctx.X, ctx.j, name, v, comp["tier"], comp["loud"], name, sc[0], sc[1], comp,
                            fields=fields, lead_bars=max(0, bars), vacuum=False))
    return out


from . import creation as _creation  # noqa: E402,F401  (registers the creation forms in FORMS)

__all__ = ["FORMS", "FIT", "Form", "JoinCtx", "PairCtx", "Cand", "Build", "relation", "cell", "is_vacuum",
           "profile_of", "local_score", "enumerate_candidates", "join_contexts", "exits_by_bar",
           "lufs_window", "bar_lufs", "excerpt_gain", "stable_rng", "lock_frame", "slam_frame", "beam_fields"]
