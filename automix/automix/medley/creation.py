"""Creation forms (medley v5): a composed middle where A and B play together and are re-arranged.

The v4 joins were nearly all "gesture on A, then cut to B": rule R4 (two drum sources overlap only
when both grids are locked, <= 3 % stretch) made the planner pick slams. Creation forms use the
stems so that ONLY ONE DRUM KIT and ONE BASSLINE sound at any instant: layering is beat-safe by
construction, so A and B can coexist for 4-32 bars.

Common frame (forms.lock_frame): A at its own tempo, a ramp of R bars where A plays alone (A
absorbs the tempo change and, when the keys clash, glides its harmonic stems by +-1-2 semitones,
like a turntable pitch move), then B's clock for the E-bar middle and the landing. A is split into
its four stems (A_drums, A_bass, A_vox, A_oth); B is native, as stem clips taken from any bar of B
(its pre-landing bars, its landing hook or a later chorus) and the landing set from m 0.

Forms (each with seeded, per-join parameters; variant "r<k>" is the seed):
  mashup        B's vocal over A's instrumental, then B's band drops under its own vocal
  drum_swap     A's music over B's drums + bass, A's top filtered / faded out into B
  loop_rewind   a 1-2 bar hook of B played twice (one repeat) over A's bed, rewound / re-triggered to B's build
  call_response A and B trade phrases (e.g. 4-4-2-2-1-1-1/2-1/2 bars), full mixes or tops
  gated_weave   a 16th-note gate weaves A's top and B's top over one kit (patterns rotate)
  double_drop   both drops together: B's drums only, the basslines alternate per bar / half bar
  tease_drop    1-2 bar fragments of B's hook punched into A, then a short handover

Static invariant (schema KIT_OVERLAP / BASS_OVERLAP) and the measured one (`stem_overlaps`:
drum-only and bass-only re-renders of the compiled Program, from the stems) both hold.
"""

from __future__ import annotations

import copy
import math
import random

import numpy as np

from . import CFG
from . import schema as S
from .forms import FORMS, Build, Form, JoinCtx, _clip, _r, echo_throw, lock_frame, stable_rng

CREATION = S.CREATION_FORMS
STEMS4 = ("drums", "bass", "vocals", "other")
A_IDS = {"drums": "A_drums", "bass": "A_bass", "vocals": "A_vox", "other": "A_oth"}
SLAMS = ["echo_slam", "roll_slam", "air_cut"]
SMOOTH = ("drum_swap", "mashup", "call_response")    # level-matched stem handovers (v6: favoured)


# ---------------------------------------------------------------------------------------------
# relation, key, source windows
# ---------------------------------------------------------------------------------------------
def creation_rel(ctx: JoinCtx, c: dict = CFG) -> dict | None:
    """The join's relation for a creation form: A warped within creation.max_stretch_pct
    (straight, else the half / double relation), both bars of 4 and neither window free.
    None: no creation (the old slam forms stay the fallback)."""
    r = ctx.rel
    lim = float(c["creation"]["max_stretch_pct"])
    if ctx.bpb_a != 4 or ctx.bpb_b != 4 or r["a_class"] == "free" or r["b_class"] == "free":
        return None
    if not ctx.pa or not ctx.pb:
        return None
    if r["kind"] in ("lock", "double") and abs(float(r["stretch_pct"])) <= lim:
        return dict(r)
    ratio = float(r["ratio"])
    octave = bool(ctx.fa.get("octave_ok", True)) and bool(ctx.fb.get("octave_ok", True))
    best = None
    for ar in (1, 2, 0.5):
        if ar != 1 and not octave:
            continue
        st = (ratio * ar - 1) * 100
        if abs(st) <= lim and (best is None or abs(st) < abs(best[1])):
            best = (ar, st)
    if best is None:
        return None
    ar, st = best
    return dict(r, kind="lock" if ar == 1 else "double", a_ratio=ar, stretch_pct=_r(st, 3))


LENGTH_CAPS = {"s": 4, "c": 8, "r": 16}       # medley v6: SHORT / MEDIUM / LONG creation middles


def length_cap(variant: str) -> int:
    return LENGTH_CAPS.get(str(variant)[:1], 16)


def pitched(variant: str) -> bool:
    """A creation variant that may move A's key (suffix "p", e.g. "c0p")."""
    return str(variant).split(".")[0].endswith("p")


def length_class(bars: float) -> str:
    return "S" if bars <= 4 + 1e-6 else "M" if bars <= 8 + 1e-6 else "L"


def shift_camelot(key: str, semis: int) -> str:
    n, letter = int(key[:-1]), key[-1]
    return f"{(n - 1 + 7 * semis) % 12 + 1}{letter}"


def pitch_semis(ctx: JoinCtx, c: dict = CFG) -> int:
    """Semitones for A's harmonic stems so its key agrees with B's (Camelot distance > 1 only;
    |shift| <= creation.pitch_max_semis, the smallest shift reaching the best distance). B never."""
    from ..plan import camelot_distance
    ka, kb = str(ctx.ta.get("camelot") or ""), str(ctx.tb.get("camelot") or "")
    try:
        d0 = camelot_distance(ka, kb)
        if d0 <= 1 or d0 >= 6 and ("?" in ka + kb or not ka or not kb):
            return 0
        mx = int(c["creation"]["pitch_max_semis"])
        opts = [(camelot_distance(shift_camelot(ka, s), kb), abs(s), s) for s in range(-mx, mx + 1) if s]
    except (ValueError, IndexError):
        return 0
    d, _, s = min(opts)
    return s if d < d0 and d <= 1 else 0


def stem_db(F: dict, stem: str, b0: int, n: int) -> float | None:
    """Mean bar RMS (dB rel. the mix p90) of a stem over bars [b0, b0 + n); `top` = vocals and other
    (power sum); `mix` = rel_db. None outside the track."""
    bars = F["bars"]
    N = len(bars["t"])
    if b0 < 0 or b0 + n > N - 1 or n <= 0:
        return None
    if stem == "mix":
        return float(np.mean(bars["rel_db"][b0:b0 + n]))
    sr = bars.get("stem_rms")
    if not sr:
        return None
    names = ["vocals", "other"] if stem == "top" else ["drums", "bass"] if stem == "bed" else [stem]
    p = sum(10 ** (np.asarray(sr[k][b0:b0 + n], float) / 10) for k in names)
    return float(np.mean(10 * np.log10(np.maximum(p, 1e-12))))


def b_window(ctx: JoinCtx, rng: random.Random, stem: str, n: int, cands: list[int],
             min_db: float | None = None) -> tuple[int, float] | None:
    """A B source window of n bars for `stem`: one of the candidate starts (bars relative to the
    landing), loud enough, picked at random among the best two. -> (start bar rel j, dB)."""
    lim = float(CFG["creation"]["stem_min_db"]) if min_db is None else min_db
    ok = []
    for b in dict.fromkeys(cands):
        v = stem_db(ctx.fb, stem, ctx.j + b, n)
        if v is not None and v >= lim:
            ok.append((v, b))
    if not ok:
        return None
    ok.sort(reverse=True)
    v, b = ok[rng.randrange(min(2, len(ok)))]
    return b, v


def a_bar(ctx: JoinCtx, rel: dict, m: float) -> int:
    return ctx.X + int(math.floor(m * float(rel["a_ratio"]) / ctx.bpb_a + 1e-9))


def a_sings(ctx: JoinCtx, rel: dict, m: float) -> bool:
    """A's vocal sounds at master beat m (a sung line runs through its bar, or the vocal stem is
    up in that bar)."""
    b = a_bar(ctx, rel, m)
    if ctx.vocal_edge_at(b):
        return True
    v = stem_db(ctx.fa, "vocals", b, 1)
    return v is not None and v >= -12 and bool(ctx.fa.get("vocal_track", True))


def _max_E(ctx: JoinCtx, rel: dict, R: int) -> int:
    c = ctx.c
    bar_s = ctx.bpb_b * ctx.pb
    by_T = int(float(c["creation"]["max_T_s"]) / bar_s) - R - 3
    by_span = int(c["limits"]["max_span_beats"] // ctx.bpb_b) - R - 3
    by_a = int(ctx.X * ctx.bpb_a / (ctx.bpb_b * float(rel["a_ratio"]))) - R - 3   # A's start >= 0 s
    return max(0, min(by_T, by_span, by_a))


def ramp_bars(ctx: JoinCtx, rel: dict) -> int:
    c = ctx.c
    return int(min(c["ramp_bars"][1], max(c["ramp_bars"][0], math.ceil(
        abs(rel["stretch_pct"]) / c["forms"]["ramp_bars_per_pct"] - 1e-9))))


# ---------------------------------------------------------------------------------------------
# the creation build
# ---------------------------------------------------------------------------------------------
class CBuild(Build):
    """A Build with the creation frame: A as four stem clips (harmonic ones pitched), B clips
    added by the form, the landing set and A's air."""

    def __init__(self, ctx: JoinCtx, form: str, variant: str, rel: dict, E: int):
        super().__init__(ctx, form, variant, "swap", rel=rel)
        self.E = E
        self.Bb = ctx.bpb_b
        self.R = ramp_bars(ctx, rel)
        f, to = lock_frame(ctx, self, E + 1)        # + 1 settle bar of A alone on B's clock
        self.f, self.to = f, to
        # medley v6: no pitch move unless the variant asks for one ("...p"; the ladder renders it
        # only when the unshifted overlap clashes and the shifted render measures >= +10 better)
        self.semis = pitch_semis(ctx) if pitched(variant) else 0
        ar = rel["a_ratio"]
        m0, m1 = -(E + 1 + self.R) * self.Bb, -(E + 1) * self.Bb
        for st in STEMS4:
            cl = _clip(A_IDS[st], "a", st, f, -f, f * ar, ar, "r2")
            if self.semis and st != "drums":
                cl["pitch"] = {"semis": float(self.semis), "m0": _r(m0, 9), "m1": _r(m1, 9)}
            self.clips.append(cl)
        self.a_live = set(A_IDS.values())
        self.cont: set[str] = set()          # B stems whose middle clip runs on into the landing
        self.desc: list[str] = []
        self.n_b = 0
        if self.semis:
            self.ev(m0, m1, f"A's vocals/music/bass glide {self.semis:+d} semitone{'s' if abs(self.semis) > 1 else ''} "
                            f"(key {ctx.ta.get('camelot')} -> {shift_camelot(str(ctx.ta.get('camelot')), self.semis)}) "
                            f"while A ramps to B's tempo")
        else:
            self.ev(m0, m1, "A ramps to B's tempo alone")

    # B clips ---------------------------------------------------------------------------------
    def b(self, name: str, stem, at: float, ln: float, u0: float, gain_db: float = 0.0) -> str:
        cid = f"B_{name}"
        cl = _clip(cid, "b", stem, at, ln, u0)
        cl["gain_db"] = _r(gain_db, 3)
        self.clips.append(cl)
        names = S.clip_stems(stem)
        if at < 0 and isinstance(names, list) and not {"bass", "drums"} & set(names):
            # a layered top keeps out of the low band (one low end at a time, V4); back at the one
            self.mv("eq", at, clip=cid, band="low", len=0, to_db=None, curve="hold")
            if at + ln > 0:
                self.mv("eq", 0, clip=cid, band="low", len=0, to_db=0, curve="hold")
        return cid

    def b_cont(self, name: str, stems: list[str], at: float, gain_db: float = 0.0) -> str:
        """A B clip of `stems` from `at`, running continuously into the landing and on to `to`."""
        self.cont |= set(stems)
        return self.b(name, _stem_arg(stems), at, self.to - at, at, gain_db)

    # A moves ---------------------------------------------------------------------------------
    def a_out(self, cid: str, m: float, how: str = "cut", ln: float = 1.0, duck: str | None = None) -> str:
        """A clip leaves at m: cut, a fade over [m - ln, m], or (A_vox through a sung line) an
        echo throw at m (§5.3). Returns what happened."""
        if cid not in self.a_live:
            return ""
        self.a_live.discard(cid)
        ctx = self.ctx
        if cid == "A_vox" and duck and (a_sings(ctx, self.rel, m - 0.5) or a_sings(ctx, self.rel, m + 0.5)):
            echo_throw(ctx, self, cid, duck, throw=m)
            return "echo"
        if how == "fade":
            self.mv("fade", m - ln, clip=cid, len=ln, from_db=0, to_db=None, shape="cos")
            return "fade"
        if how in ("hp", "lp"):
            hz = [20.0, 1800.0] if how == "hp" else [20000.0, 350.0]
            self.mv("filter", m - ln, clip=cid, kind=how, len=ln, hz=hz, curve="exp")
            self.mv("cut", m, clip=cid, dir="out", ms=self.ctx.c["compile"]["cut_ms"])
            return how
        self.mv("cut", m, clip=cid, dir="out", ms=self.ctx.c["compile"]["cut_ms"])
        return "cut"

    def a_swap_bed(self, m: float, ins: list[str], what=("A_drums", "A_bass")) -> None:
        """A's kit (and bass) out, B's in, on one instant (one kit at a time)."""
        outs = [x for x in what if x in self.a_live]
        self.a_live -= set(outs)
        for x in ("A_oth", "A_vox"):                # A's top over B's bed: B owns the low band
            if x in self.a_live:
                self.mv("eq", m, clip=x, band="low", len=0, to_db=None, curve="hold")
        if "A_oth" in self.a_live:                  # A's music carries drum bleed: under B's kit, -5 dB
            self.mv("eq", m, clip="A_oth", band="mid_high", len=self.Bb, to_db=-5, curve="lin")
        self.mv("swap", m, out=outs, **{"in": ins}, band="all", ms=self.ctx.c["compile"]["swap_ms"])

    def air(self, duck: str, style: str = "beat") -> None:
        """A leaves for the landing: its kit and bass at -air (style "beat": -1 beat, "half": -1/2,
        "bar": -2 beats: B's vocal / build alone), its top faded over [-1, -1/4] (A_vox: echo
        throw through a sung line)."""
        c = self.ctx.c
        ab = {"beat": float(c["air_beats"]), "half": 0.5, "two": 2.0}[style]
        for cid in ("A_drums", "A_bass"):
            if cid in self.a_live:
                self.a_out(cid, -ab)
        top_end = float(c["air_top_end_beats"])
        for cid in ("A_oth", "A_vox"):
            if cid not in self.a_live:
                continue
            if cid == "A_vox" and a_sings(self.ctx, self.rel, -1.5):
                self.a_out(cid, -1, duck=duck)
                continue
            self.a_live.discard(cid)
            t0 = min(-1.0, -ab)
            self.mv("fade", t0, clip=cid, len=-t0 - top_end, from_db=0, to_db=None, shape="cos")
        self.ev(-ab, 0, f"air: A leaves {ab:g} beat{'s' if ab != 1 else ''} before B's one")

    def land(self) -> str:
        """B's landing set from m 0 (u 0): the stems no middle clip carries on; a vocal pickup of p
        beats starts B's vocal at -p. Returns the clip id that sounds at 0 (echo ducking key)."""
        Bb, to = self.Bb, self.to
        rest = [s for s in STEMS4 if s not in self.cont]
        p = int(self.ctx.lead.get("pickup_beats", 0) or 0)
        key = None
        if p and "vocals" in rest:
            key = self.b("pick", "vocals", -p, to + p, -p)
            rest.remove("vocals")
            self.ev(-p, 0, f"B's vocal pickup ({p} beat{'s' if p > 1 else ''})")
        if rest:
            key = self.b("land", _stem_arg(rest), 0, to, 0)
        return key or next(c["id"] for c in self.clips if c["src"] == "b" and c["at"] + c["len"] >= to - 1e-6)

    def finish(self, duck: str | None = None, air: str = "beat") -> dict:
        key = self.land()
        self.air(duck or key, air)
        self.land_event()
        others = [f for f in CREATION if f != self.form]
        self.fallback = others + SLAMS
        return self.done()


def _stem_arg(stems: list[str]):
    st = [s for s in STEMS4 if s in stems]
    if len(st) == 4:
        return "mix"
    if st == ["vocals", "other"]:
        return "top"
    if st == ["drums", "bass"]:
        return "bed"
    return st[0] if len(st) == 1 else st


def _bars(x: float) -> str:
    return f"{x:g} bar{'s' if x != 1 else ''}"


# ---------------------------------------------------------------------------------------------
# forms
# ---------------------------------------------------------------------------------------------
class CreationForm(Form):
    needs_stems = True
    b_in = "swap"

    def allowed(self, ctx: JoinCtx) -> bool:
        return bool(ctx.stems_a and ctx.stems_b and ctx.fa.get("stems") and ctx.fb.get("stems")
                    and creation_rel(ctx, ctx.c) is not None)

    def variant_set(self, ctx):
        # medley v6 lengths: s0 SHORT (<= 4 bars), c0 MEDIUM (<= 8), r<k> LONG seeds (<= 16);
        # a "p" suffix (built on demand by the ladder) allows A's 1-semitone key move
        return ["s0", "c0"] + [f"r{k}" for k in range(int(ctx.c["creation"]["variants"]))]

    def variants(self, ctx, rng):
        return self.variant_set(ctx)

    def rng(self, ctx: JoinCtx, variant: str) -> random.Random:
        return stable_rng("creation", ctx.a, ctx.b, ctx.X, ctx.j, self.name, variant)

    def frame(self, ctx: JoinCtx, variant: str, E: int) -> CBuild | None:
        rel = creation_rel(ctx, ctx.c)
        if rel is None:
            return None
        mx = _max_E(ctx, rel, ramp_bars(ctx, rel))
        if E > mx:
            return None
        return CBuild(ctx, self.name, variant, rel, E)

    def build(self, ctx, variant):
        rng = self.rng(ctx, variant)
        rel = creation_rel(ctx, ctx.c)
        if rel is None:
            return None
        mx = min(_max_E(ctx, rel, ramp_bars(ctx, rel)), length_cap(variant))
        try:
            return self.make(ctx, variant, rng, mx)
        except _Skip:
            return None

    def make(self, ctx, variant, rng, mx) -> dict | None:
        raise NotImplementedError


class _Skip(Exception):
    pass


def _need(x):
    if x is None:
        raise _Skip
    return x


class Mashup(CreationForm):
    """a. B's vocal over A's instrumental for 4-8 bars, then B's band drops under its own vocal."""
    name = "mashup"

    def make(self, ctx, variant, rng, mx):
        n = rng.choice([8, 12, 16])
        pre = rng.choice([0, 2])
        while n + pre > mx and n > 4:
            n -= 2
        if n + pre > mx:
            pre = 0
        bd = _need(self.frame(ctx, variant, n + pre))
        Bb = bd.Bb
        a = -n * Bb
        # B's vocal: its own lead-in (continuous into the landing) or its landing hook / a later chorus
        opts = []
        cont = b_window(ctx, rng, "vocals", n, [-n])
        hook = b_window(ctx, rng, "vocals", n, [0, 8, 16, 4])
        if cont:
            opts.append(("pre", cont))
        if hook:
            opts.append(("hook", hook))
        kind, (b0, _) = _need(rng.choice(opts) if opts else None)
        entry = rng.choice(["punch", "swell"])
        under = rng.choice(["none", "dip", "lp"])
        air = rng.choice(["beat", "two"]) if kind == "pre" else "beat"
        if kind == "pre":
            vid = bd.b_cont("vox", ["vocals"], a, gain_db=0.0)
            src = "its own lead-in vocal (running on into the drop)"
        else:
            vid = bd.b("vox", "vocals", a, n * Bb, b0 * Bb, gain_db=0.0)
            src = ("drop/chorus" if b0 == 0 else f"bar +{b0} chorus") + " vocal"
        if entry == "swell":
            bd.mv("fade", a, clip=vid, len=Bb, from_db=-15, to_db=0, shape="eqpow")
        how = bd.a_out("A_vox", a, "fade", 1.0, duck=vid)
        if under == "dip":
            bd.mv("eq", a, clip="A_oth", band="mid", len=Bb, to_db=-5, curve="lin")
        elif under == "lp":
            bd.mv("filter", a, clip="A_oth", kind="lp", len=2 * Bb, hz=[20000.0, 2500.0], curve="exp")
        bd.ev(a, 0, f"MASHUP: B's {src} over A's instrumental (drums+bass+music) for {_bars(n)}"
                    f"{' (vocal swells in)' if entry == 'swell' else ''}; A's vocal {how or 'out'}"
                    f"{', A music dipped -5 dB in the mids' if under == 'dip' else ', A music low-passed' if under == 'lp' else ''}")
        bd.desc.append(f"B's vocal ({'lead-in' if kind == 'pre' else 'hook'}) over A's beat {_bars(n)}, "
                       f"then B's band drops" + (" after 2 beats of B's vocal alone" if air == "two" else ""))
        return bd.finish(vid, air)


class DrumSwap(CreationForm):
    """b. A's music (vocals + other) over B's drums + bass for 4-8 bars, A's top out into B."""
    name = "drum_swap"

    def make(self, ctx, variant, rng, mx):
        D = rng.choice([8, 12, 16])
        pre = rng.choice([0, 2])
        while D + pre > mx and D > 4:
            D -= 2
        if D + pre > mx:
            pre = 0
        bd = _need(self.frame(ctx, variant, D + pre))
        Bb = bd.Bb
        a = -D * Bb
        cont = b_window(ctx, rng, "drums", D, [-D], min_db=-10)
        if cont:
            bed = bd.b_cont("bed", ["drums", "bass"], a)
            bsrc = "B's own drums+bass leading into its drop"
        else:
            b0, _ = _need(b_window(ctx, rng, "drums", D, [0, 8, 16], min_db=-10))
            bed = bd.b("bed", "bed", a, D * Bb, b0 * Bb)
            bsrc = f"B's {'drop' if b0 == 0 else f'bar +{b0}'} drums+bass (looped back to the drop at the landing)"
        brk = rng.choice(["hard", "break"])
        if brk == "break":                      # A's kit stops a beat early: A's top alone, then B's kit
            bd.a_out("A_drums", a - 1)
            bd.a_out("A_bass", a - 1)
            for x in ("A_oth", "A_vox"):
                bd.mv("eq", a - 1, clip=x, band="low", len=0, to_db=None, curve="hold")
            bd.mv("eq", a - 1, clip="A_oth", band="mid_high", len=Bb, to_db=-5, curve="lin")
            bd.mv("cut", a, clip=bed, dir="in", ms=ctx.c["compile"]["cut_in_fade_ms"])
        else:
            bd.a_swap_bed(a, [bed])
            bd.mv("cut", a, clip=bed, dir="in", ms=ctx.c["compile"]["cut_in_fade_ms"])
        exit_ = rng.choice(["hp", "lp", "fade"])
        F = min(D, rng.choice([2, 4]))
        b_top = rng.choice([0, 2]) if cont else 0
        if b_top:
            tid = bd.b_cont("top", ["vocals", "other"], -b_top * Bb)
            bd.mv("fade", -b_top * Bb, clip=tid, len=b_top * Bb, from_db=-14, to_db=0, shape="eqpow")
        for cid in ("A_oth", "A_vox"):
            bd.a_out(cid, -1.0, exit_, ln=F * Bb - 1, duck=bed)
        bd.ev(a, 0, f"DRUM SWAP: A's vocals+music ride {bsrc} for {_bars(D)}"
                    f"{' (A drops its kit a beat early)' if brk == 'break' else ''}; A's top "
                    f"{ {'hp': 'high-pass swept out', 'lp': 'low-pass swept out', 'fade': 'faded'}[exit_]} "
                    f"over the last {_bars(F)}" + (f"; B's top fades in from -{b_top} bars" if b_top else ""))
        bd.desc.append(f"A's song over B's beat for {_bars(D)}, A's top {exit_}-swept out")
        return bd.finish(bed, "beat")


class LoopRewind(CreationForm):
    """c. A 1-2 bar hook of B played twice (one repeat) over A's bed, rewound (or re-triggered) to B's build,
    the build replays over A's beat, then the full drop."""
    name = "loop_rewind"

    def make(self, ctx, variant, rng, mx):
        size = rng.choice([1, 2])
        count = 2                                # medley v6: one repeat at most (2-3x was rejected)
        k = rng.choice([2, 4])
        intro = rng.choice([0, 2, 4])
        for _ in range(8):                       # shrink to fit: intro, loops, loop size, build
            if size * count + k + intro <= mx:
                break
            if intro:
                intro = 0
            elif count > 2:
                count -= 1
            elif size > 1:
                size = 1
            elif k > 2:
                k = 2
        if size * count + k + intro > mx:
            raise _Skip
        E = intro + size * count + k
        bd = _need(self.frame(ctx, variant, E))
        Bb = bd.Bb
        stem = rng.choice(["vocals", "other", "top"])
        hb = b_window(ctx, rng, stem, size, [0, 4, 8, 16, 2, 6]) or b_window(ctx, rng, "top", size, [0, 4, 8, 16])
        h, _ = _need(hb)
        if hb and stem != "top" and stem_db(ctx.fb, stem, ctx.j + h, size) is None:
            stem = "top"
        # B's build (the replay) must sound too
        stems = ["vocals", "other"] if stem == "top" else [stem]
        if (stem_db(ctx.fb, stem, ctx.j - k, k) or -99) < -24:
            stems, stem = ["vocals", "other"], "top"
        m_l = -(k + size * count) * Bb
        cid = bd.b("hook", _stem_arg(stems), m_l, bd.to - m_l, h * Bb)
        bd.cont |= set(stems)
        bd.mv("loop", m_l, clip=cid, size=size * Bb, count=count, slip=False)
        gest = rng.choice(["rewind", "retrigger"])
        m_k = -k * Bb
        if gest == "rewind":
            ln = rng.choice([1.0, 1.5])          # a quick rewind
            gap = 0.5
            peak = rng.choice([-6.0, -8.0, -10.0])
            bd.mv("rewind", m_k - ln - gap, clip=cid, len=ln, peak_rate=peak, then_u=m_k, gap=gap)
            g = f"rewinds ({ln:g} beats at {peak:g}x) to"
        else:
            bd.mv("jump", m_k, clip=cid, to_u=m_k)
            g = "re-triggers to"
        bd.a_out("A_vox", m_l, "fade", 1.0, duck=cid)
        a_music = rng.choice(["keep", "lp"])
        if a_music == "lp":
            bd.mv("filter", m_k, clip="A_oth", kind="lp", len=k * Bb - 1, hz=[20000.0, 500.0], curve="exp")
        what = {"vocals": "vocal", "other": "riff", "top": "hook (vocal+music)"}[stem]
        bd.ev(m_l, m_k, f"LOOP: B's {_bars(size)} {what} from bar +{h} looped {count}x over A's beat")
        bd.ev(m_k - (0 if gest == "retrigger" else 3), m_k, f"B {g} its {_bars(k)} build")
        bd.ev(m_k, 0, f"B's build replays over A's beat" + (" (A's music low-passed away)" if a_music == "lp" else ""))
        bd.desc.append(f"B's {_bars(size)} {what} looped {count}x over A's beat, {gest} to B's build, replay, drop")
        return bd.finish(cid, rng.choice(["beat", "two"]))


TRADES = [[4, 4, 2, 2, 1, 1, 0.5, 0.5], [4, 4, 2, 2, 1, 1], [2, 2, 2, 2, 2, 2, 1, 1, 0.5, 0.5],
          [4, 4, 4, 2, 1, 1], [4, 2, 2, 2, 2, 1, 1, 0.5, 0.5, 0.5, 0.5], [2, 2, 2, 2, 1, 1, 1, 1, 0.5, 0.5]]


class CallResponse(CreationForm):
    """d. A and B trade phrases, shrinking (4-4-2-2-1-1-1/2-1/2 bars ...), ending on B: full
    mixes alternating, or the two tops over one bed."""
    name = "call_response"

    def make(self, ctx, variant, rng, mx):
        lens = list(rng.choice(TRADES))
        tail = rng.choice([0, 1, 2])
        tot = sum(lens)
        while tot + tail > mx and len(lens) > 4:
            lens = lens[2:]
            tot = sum(lens)
        if tot + tail > mx:
            tail = 0
        if tot + tail > mx or abs(tot - round(tot)) > 1e-9:
            raise _Skip
        E = int(round(tot)) + tail
        bd = _need(self.frame(ctx, variant, E))
        Bb = bd.Bb
        m_t = -E * Bb
        m_e = m_t + tot * Bb
        mode = rng.choice(["full", "tops_a_bed", "tops_b_bed"])
        need = "mix" if mode == "full" else "top"
        cont = b_window(ctx, rng, need, E, [-E], min_db=-12 if need == "mix" else -16)
        if cont:
            src_u, cont_ok = m_t, True
        else:
            b0, _ = _need(b_window(ctx, rng, need, E, [0, 8, 16], min_db=-12 if need == "mix" else -16))
            src_u, cont_ok = b0 * Bb, False
        xf = ctx.c["compile"]["trade_xf_ms"]
        L = [x * Bb for x in lens]
        if mode == "full":
            bid = (bd.b_cont("call", list(STEMS4), m_t) if cont_ok else bd.b("call", "mix", m_t, -m_t, src_u))
            a_side = [x for x in ("A_drums", "A_bass", "A_oth", "A_vox") if x in bd.a_live]
            pairs = [(x, bid) for x in a_side]
        else:
            bid = (bd.b_cont("call", ["vocals", "other"], m_t) if cont_ok else
                   bd.b("call", "top", m_t, -m_t, src_u))
            pairs = [(x, bid) for x in ("A_oth", "A_vox")]
            if mode == "tops_b_bed":
                bed_c = b_window(ctx, rng, "drums", E, [-E], min_db=-10)
                if bed_c and cont_ok:
                    bed = bd.b_cont("bed", ["drums", "bass"], m_t)
                else:
                    b0, _ = _need(b_window(ctx, rng, "drums", E, [0, 8, 16], min_db=-10))
                    bed = bd.b("bed", "bed", m_t, -m_t, b0 * Bb)
                bd.a_swap_bed(m_t, [bed])
                bd.mv("cut", m_t, clip=bed, dir="in", ms=ctx.c["compile"]["cut_in_fade_ms"])
        for x, y in pairs:
            bd.mv("trade", m_t, clips=[x, y], lens=L, slip=True, xf_ms=xf)
        # A's last call echoes out (its line is cut by the trade, §5.3)
        last_a = m_t + sum(L[:len(L) - 1])
        if "A_vox" in bd.a_live and any(a_sings(ctx, bd.rel, m_t + sum(L[:k])) for k in range(0, len(L), 2)):
            es = ctx.echo_set()
            from .forms import tail_fb
            fb = tail_fb(bd, last_a, es["delay"], es["send_db"], ctx.c)
            bd.mv("echo", last_a - 1, clip="A_vox", capture=1, delay=es["delay"], fb=fb,
                  tail=ctx.c["forms"]["echo_tail_beats"], hp_hz=list(es["hp_hz"]), send_db=es["send_db"])
        for x, _ in pairs:
            if x in bd.a_live:
                bd.a_live.discard(x)
                bd.mv("cut", m_e, clip=x, dir="out", ms=ctx.c["compile"]["cut_ms"])
        if not cont_ok:
            bd.cont = set()
        if mode == "tops_b_bed" and not cont_ok:
            pass
        pat = "-".join(f"{x:g}" for x in lens)
        what = {"full": "full mixes", "tops_a_bed": "the tops (vocals+music) over A's beat",
                "tops_b_bed": "the tops (vocals+music) over B's beat"}[mode]
        bd.ev(m_t, m_e, f"CALL & RESPONSE: A and B trade {what}, blocks of {pat} bars, ending on B"
                        + ("" if cont_ok else " (B's material from its hook, re-launched at the drop)"))
        if tail:
            bd.ev(m_e, 0, f"B holds {_bars(tail)}")
        bd.desc.append(f"A/B trade {what} in {pat}-bar blocks, B answers last")
        return bd.finish(bid, "beat")


GATES = [
    ["AAAABBBBAAAABBBB", "AABBAABBAABBAABB", "ABABABABABABABAB", "ABBBABBBABBBABBB"],
    ["AAABBBAAAAABBBAA", "AABAABAABAABAABB", "ABBABBABBABBABBB", "BBBBBBBBABBBBBBB"],
    ["AAAAAAAABBBBBBBB", "AAAABBBBAAAABBBB", "AABBAABBAABBAABB", "ABABABABABABBBBB"],
    ["AABBBBAAAABBBBAA", "ABBAABBAABBAABBA", "ABABBABAABABBABA", "ABBBBBBBABBBBBBB"],
]


class GatedWeave(CreationForm):
    """e. A 16th-note gate weaving A's top and B's top over one kit (A's or B's), the patterns
    rotating towards B."""
    name = "gated_weave"

    def make(self, ctx, variant, rng, mx):
        G = rng.choice([4, 6, 8])
        P = rng.choice([2, 4, 8])
        while G + P > mx and P > 0:
            P -= 2
        while G + P > mx and G > 2:
            G -= 2
        if G + P > mx:
            raise _Skip
        bd = _need(self.frame(ctx, variant, G + P))
        Bb = bd.Bb
        m_p, m_g = -(G + P) * Bb, -G * Bb
        cont = b_window(ctx, rng, "top", G + P, [-(G + P)], min_db=-16)
        if cont:
            tid = bd.b_cont("top", ["vocals", "other"], m_p)
        else:
            b0, _ = _need(b_window(ctx, rng, "top", G + P, [0, 8, 16], min_db=-16))
            tid = bd.b("top", "top", m_p, -m_p, b0 * Bb)
        if P:
            bd.mv("fade", m_p, clip=tid, len=P * Bb, from_db=-15, to_db=-3, shape="eqpow")
        bank = rng.choice(GATES)
        steps = [bank[min(len(bank) - 1, int(k * len(bank) / G))] for k in range(G)]
        bed_side = rng.choice(["A", "B"])
        if bed_side == "B":
            bc = b_window(ctx, rng, "drums", G, [-G], min_db=-10) if cont else None
            if bc:
                bed = bd.b_cont("bed", ["drums", "bass"], m_g)
            else:
                b0b = b_window(ctx, rng, "drums", G, [0, 8, 16], min_db=-10)
                if b0b is None:
                    bed_side = "A"
                else:
                    bed = bd.b("bed", "bed", m_g, -m_g, b0b[0] * Bb)
            if bed_side == "B":
                bd.a_swap_bed(m_g, [bed])
                bd.mv("cut", m_g, clip=bed, dir="in", ms=ctx.c["compile"]["cut_in_fade_ms"])
        c = ctx.c
        for x in ("A_oth", "A_vox"):
            bd.mv("gate", m_g, clips=[x, tid], len=G * Bb, steps=steps,
                  attack_ms=c["gate_attack_ms"], release_ms=c["gate_release_ms"])
        # after the weave A's top is gone; B's top at full level for the landing
        if "A_vox" in bd.a_live and a_sings(ctx, bd.rel, m_g):
            es = ctx.echo_set()
            from .forms import tail_fb
            fb = tail_fb(bd, -1.0, es["delay"], es["send_db"], c)
            bd.mv("echo", m_g - 1, clip="A_vox", capture=1, delay=es["delay"], fb=fb,
                  tail=c["forms"]["echo_tail_beats"], hp_hz=list(es["hp_hz"]), send_db=es["send_db"])
        for x in ("A_oth", "A_vox"):
            if x in bd.a_live:
                bd.a_live.discard(x)
                bd.mv("cut", -0.25, clip=x, dir="out", ms=c["compile"]["cut_ms"])
        bd.mv("fade", m_g, clip=tid, len=0, from_db=0, to_db=0, shape="lin")
        if P:
            bd.ev(m_p, m_g, f"B's top (vocals+music) slides in under A at -3 dB for {_bars(P)}")
        bd.ev(m_g, 0, f"GATED WEAVE: 16th-note gate trades A's top and B's top over "
                      f"{'A' if bed_side == 'A' else 'B'}'s beat for {_bars(G)}, patterns "
                      + " > ".join(dict.fromkeys(steps)))
        bd.desc.append(f"16th gate weaving A's and B's tops over {bed_side}'s kit, {_bars(G)}")
        return bd.finish(tid, "beat")


class DoubleDrop(CreationForm):
    """f. Both drops together: B's drums only, A's and B's music on top, the basslines trading
    per bar (or half bar); B re-drops at the landing."""
    name = "double_drop"

    def allowed(self, ctx):
        if not super().allowed(ctx):
            return False
        a = stem_db(ctx.fa, "mix", ctx.X - 8, 8)
        return a is not None and a >= -5

    def make(self, ctx, variant, rng, mx):
        n = rng.choice([8, 12, 16])
        pre = rng.choice([0, 2])
        while n + pre > mx and n > 4:
            n -= 4
        if n + pre > mx:
            pre = 0
        if n + pre > mx:
            raise _Skip
        bd = _need(self.frame(ctx, variant, n + pre))
        Bb = bd.Bb
        a = -n * Bb
        b0, _ = _need(b_window(ctx, rng, "drums", n, [0, 8, 4, 16], min_db=-10))
        drop = "drop" if b0 == 0 else f"drop (bar +{b0})"
        unit = rng.choice([Bb, Bb, Bb / 2])
        first = rng.choice(["A", "B"])
        bvox = rng.choice([True, False])
        bdr = bd.b("dd_drums", "drums", a, n * Bb, b0 * Bb)
        bbs = bd.b("dd_bass", "bass", a, n * Bb, b0 * Bb)
        btop = bd.b("dd_top", ["vocals", "other"] if bvox else "other", a, n * Bb, b0 * Bb, gain_db=-1.0)
        bd.mv("swap", a, out=["A_drums"], **{"in": [bdr]}, band="all", ms=ctx.c["compile"]["swap_ms"])
        bd.a_live.discard("A_drums")
        for x in (bdr, bbs, btop):
            bd.mv("cut", a, clip=x, dir="in", ms=ctx.c["compile"]["cut_in_fade_ms"])
        if bvox:
            bd.a_out("A_vox", a, "fade", 1.0, duck=bdr)
        # A's music sits under B's drop: -7 dB, no low end (its transients must not flam B's kit)
        bd.mv("eq", a, clip="A_oth", band="mid_high", len=Bb, to_db=-7, curve="lin")
        k = int(round(n * Bb / unit))
        pair = ["A_bass", bbs] if first == "A" else [bbs, "A_bass"]
        bd.mv("trade", a, clips=pair, lens=[unit] * k, slip=True, xf_ms=ctx.c["compile"]["trade_xf_ms"])
        for x in ("A_oth", "A_vox"):
            bd.mv("eq", a, clip=x, band="low", len=0, to_db=None, curve="hold")
        end = rng.choice(["air", "backspin"])
        if end == "backspin":
            ids = [x for x in ("A_oth", "A_vox") if x in bd.a_live]
            for x in ids:
                bs = ctx.c["backspin"]
                bd.mv("backspin", -2.0, clip=x, push=bs["push"], peak_rate=bs["peak_rate"], tau=bs["tau"],
                      end_by=-0.5)
                bd.a_live.discard(x)
        u = "bar" if unit == Bb else "half bar"
        bd.ev(a, 0, f"DOUBLE DROP: B's {drop} under A's {'music' if bvox else 'music+vocal'} for {_bars(n)}, "
                    f"only B's drums; the basslines alternate every {u} ({first} first)"
                    + ("; A's top backspins out" if end == "backspin" else ""))
        bd.desc.append(f"both drops together {_bars(n)}, B's kit, basses trade per {u}, B re-drops")
        return bd.finish(bdr, "beat")


class TeaseDrop(CreationForm):
    """g. 1-2 bar fragments of B's hook punched into A 8-16 bars before the real entry, then a
    short handover (B's build over A's beat, or a drum swap)."""
    name = "tease_drop"

    def make(self, ctx, variant, rng, mx):
        E = rng.choice([12, 16])
        while E > mx and E > 8:
            E -= 4
        if E > mx:
            raise _Skip
        bd = _need(self.frame(ctx, variant, E))
        Bb = bd.Bb
        tl = rng.choice([1, 2])
        stem = rng.choice(["vocals", "top", "other"])
        hb = b_window(ctx, rng, stem, tl, [0, 4, 8, 16, 2]) or b_window(ctx, rng, "top", tl, [0, 4, 8, 16])
        h, _ = _need(hb)
        if stem_db(ctx.fb, stem, ctx.j + h, tl) is None or stem_db(ctx.fb, stem, ctx.j + h, tl) < -16:
            stem = "top"
        H = rng.choice([2, 4])
        n_t = rng.choice([3, 4])
        gap = (E - H) // n_t
        if gap < tl + 1:
            tl = 1
        while gap < tl + 1 and n_t > 2:
            n_t -= 1
            gap = (E - H) // n_t
        adv = rng.choice(["same", "advance"])
        style = rng.choice(["punch", "filtered"])
        at_bars = [-E + k * gap for k in range(n_t)]
        ids = []
        for k, ab in enumerate(at_bars):
            u = (h + (k * tl if adv == "advance" else 0)) * Bb
            cid = bd.b(f"tease{k + 1}", _stem_arg(["vocals", "other"]) if stem == "top" else stem,
                       ab * Bb, tl * Bb, u, gain_db=-2.0)
            ids.append(cid)
            if style == "filtered":
                bd.mv("filter", ab * Bb, clip=cid, kind="hp", len=0, hz=[300.0, 300.0], curve="exp")
            bd.mv("eq", ab * Bb, clip="A_vox", band="mid_high", len=0, to_db=-9, curve="hold")
            bd.mv("eq", (ab + tl) * Bb, clip="A_vox", band="mid_high", len=0, to_db=0, curve="hold")
        hand = rng.choice(["build", "swap"])
        m_h = -H * Bb
        duck = ids[-1]
        if hand == "swap":
            bc = b_window(ctx, rng, "drums", H, [-H], min_db=-10)
            if bc is not None:
                bed = bd.b_cont("bed", ["drums", "bass"], m_h)
                bd.a_swap_bed(m_h, [bed])
                bd.mv("cut", m_h, clip=bed, dir="in", ms=ctx.c["compile"]["cut_in_fade_ms"])
                duck = bed
            else:
                hand = "build"
        topc = bd.b_cont("build", ["vocals", "other"], m_h)
        bd.mv("fade", m_h, clip=topc, len=H * Bb, from_db=-12, to_db=0, shape="eqpow")
        bd.a_out("A_vox", m_h, "fade", 1.0, duck=topc)
        what = {"vocals": "vocal", "other": "riff", "top": "hook"}[stem]
        bd.ev(at_bars[0] * Bb, m_h, f"TEASE: {n_t} punches of B's {_bars(tl)} {what} (bar +{h}"
                                     f"{', advancing' if adv == 'advance' else ''}) into A, every {_bars(gap)}"
                                     f"{', high-passed' if style == 'filtered' else ''}; A's vocal ducks under each")
        bd.ev(m_h, 0, f"handover: B's build fades in over {_bars(H)}" +
              (" on B's own beat (drum swap)" if hand == "swap" else " over A's beat"))
        bd.desc.append(f"{n_t} teases of B's {what} into A, {hand} handover {_bars(H)}")
        return bd.finish(topc if hand == "build" else duck, "beat")


CREATION_CLASSES = (Mashup, DrumSwap, LoopRewind, CallResponse, GatedWeave, DoubleDrop, TeaseDrop)
for _cls in CREATION_CLASSES:
    FORMS[_cls.name] = _cls()


# ---------------------------------------------------------------------------------------------
# choosing creation forms along the set (planner)
# ---------------------------------------------------------------------------------------------
def creation_options(ctx: JoinCtx, fa=None, fb=None, lo: float = -math.inf, hi: float = math.inf) -> dict[str, list[dict]]:
    """{form: [valid compositions, one per parameter seed]} for this join (schema-valid, inside
    the files and between the neighbours' native solos lo / hi)."""
    from .forms import beam_fields
    out: dict[str, list[dict]] = {}
    for name in CREATION:
        form = FORMS[name]
        if not form.allowed(ctx):
            continue
        for v in form.variant_set(ctx):
            comp = form.build(ctx, v)
            if comp is None:
                continue
            f = beam_fields(ctx, comp)
            if f is None or f["a_out_start"] < lo - 1e-6 or f["b_in_end"] > hi + 1e-6:
                continue
            comp["hash"] = S.canonical_hash(comp)
            if S.validate_composition(comp, fa or ctx.fa, fb or ctx.fb):
                continue
            out.setdefault(name, []).append(comp)
    return out


def choose_form(options: dict[str, list[dict]], recent: list[str], counts: dict[str, int], rng: random.Random,
                window: int | None = None) -> str | None:
    """The variety rule: never a form used in the previous window-1 joins; among the rest the least
    used so far (spread over the set), ties at random."""
    w = int(CFG["creation"]["variety_window"]) if window is None else window
    banned = set(recent[-(w - 1):]) if w > 1 else set()
    ok = [f for f in options if options[f] and f not in banned]
    if not ok:
        return None
    lo = min(counts.get(f, 0) for f in ok)
    pool = sorted(f for f in ok if counts.get(f, 0) == lo)
    return rng.choice(pool)


def assign_creations(ctxs: list[JoinCtx | None], seed: int = 0, bounds=None, log=None) -> list[dict | None]:
    """Per join: a creation composition (variety rule, parameters seeded per join) or None (no
    stems / tempo out of reach: the slam forms stay). bounds(i, comp) -> bool may veto a comp
    (neighbour solos, computed sequentially by the caller)."""
    recent: list[str] = []
    counts: dict[str, int] = {}
    out: list[dict | None] = []
    for i, ctx in enumerate(ctxs):
        if ctx is None:
            out.append(None)
            recent.append("-")
            continue
        opts = creation_options(ctx)
        if bounds is not None:
            opts = {f: [c for c in cs if bounds(i, c)] for f, cs in opts.items()}
        rng = stable_rng("creation-pick", seed, i, ctx.a, ctx.b)
        name = choose_form(opts, recent, counts, rng)
        if name is None:
            out.append(None)
            recent.append("-")
            continue
        comp = copy.deepcopy(rng.choice(opts[name]))
        w = int(CFG["creation"]["variety_window"])
        others = [f for f in CREATION if f != name and opts.get(f) and f not in recent[-(w - 1):]]
        comp["fallback"] = others + [f for f in CREATION if f != name and f not in others] + SLAMS
        out.append(comp)
        recent.append(name)
        counts[name] = counts.get(name, 0) + 1
    return out


def effective_clash(ctx: JoinCtx, semis: int) -> float:
    """JoinCtx.clash with A's harmonic stems shifted by `semis` (0: the join's own clash)."""
    if not semis:
        return ctx.clash
    from ..plan import camelot_distance
    try:
        d = camelot_distance(shift_camelot(str(ctx.ta.get("camelot")), semis), str(ctx.tb.get("camelot")))
    except (ValueError, IndexError):
        return ctx.clash
    if d <= ctx.c["key"]["cam_ok"]:
        return 0.0
    return float(ctx.c["key"]["clash"].get(str(min(3, d)), 1.0))


def creation_bars(comp: dict) -> float:
    """Bars where B sounds before the landing (the length of the composed middle)."""
    b0 = min((c["at"] for c in comp["clips"] if c["src"] == "b"), default=0.0)
    return max(0.0, -float(b0) / float(comp["bpb"]))


def creation_score(ctx: JoinCtx, comp: dict) -> tuple[float, dict]:
    """The beam's local score of a creation candidate: forms.local_score's terms without its R4
    gate (one kit at a time is the invariant here), the key term after A's pitch fix, plus
    creation.bonus so a creation wins over every slam whenever the geometry allows one."""
    c = ctx.c
    sc, w = c["score"], c["weights"]
    lt = ctx.lead["type"]
    b = float(sc["bin_lead"][lt])
    if ctx.onset_weak:
        b += c["highlight"]["no_onset_bin"]
    semis = next((float(cl["pitch"]["semis"]) for cl in comp["clips"] if cl.get("pitch")), 0.0)
    key = 1.0 - effective_clash(ctx, int(semis))
    loud = 1.0 if ctx.reset else max(-1.0, 1 - max(0.0, abs(ctx.dL) - sc["loud_free_db"]) / sc["loud_span_db"])
    s_out = float(ctx.ex["s_out"])
    cc = c["creation"]
    prior = float((cc.get("form_prior") or {}).get(comp["form"], 0.0))
    loop = -float(cc.get("loop_penalty", 0.0)) if any(m.get("type") == "loop" for m in comp["moves"]) else 0.0
    terms = {"base": float(c["base_f"][comp["form"]]), "bin": _r(b, 4), "beat": 1.0, "key": _r(key, 4),
             "loud": _r(loud, 4), "fit": 1.0, "exit": _r(s_out, 4), "rt": 0.0,
             "creation": float(cc["bonus"]) + float(cc["bar_bonus"]) * creation_bars(comp),
             "prior": _r(float(cc.get("prior_w", 0.0)) * prior, 4), "loop": loop,
             "smooth": float(cc.get("smooth_bonus", 0.0)) if comp["form"] in SMOOTH else 0.0}
    S_ = (terms["base"] + w["bin"] * b + w["beat"] + w["key"] * key + w["loud"] * loud + w["fit"]
          + w["exit"] * s_out + terms["creation"] + terms["prior"] + terms["loop"] + terms["smooth"])
    return _r(S_, 6), terms


def creation_cands(ctx: JoinCtx, variants: tuple[str, ...] = ("s0", "c0", "r0")) -> list[tuple[str, str, dict, dict]]:
    """(form, variant, comp, beam fields) of the creation forms for one (X, j) (enumeration: the
    first parameter seed only; the ladder builds the others)."""
    from .forms import beam_fields
    out = []
    if not ctx.c["creation"].get("enabled", True):
        return out
    for name in CREATION:
        form = FORMS[name]
        if not form.allowed(ctx):
            continue
        for v in variants:
            comp = form.build(ctx, v)
            if comp is None:
                continue
            f = beam_fields(ctx, comp)
            if f is not None:
                out.append((name, v, comp, f))
    return out


def variety_ok(forms: list[str], window: int | None = None) -> bool:
    w = int(CFG["creation"]["variety_window"]) if window is None else window
    for i, f in enumerate(forms):
        if f in CREATION and f in forms[max(0, i - w + 1):i]:
            return False
    return True


# ---------------------------------------------------------------------------------------------
# measured invariant: one kit, one bassline (rendered from the stems)
# ---------------------------------------------------------------------------------------------
def only_stem(prog: S.Program, what: str) -> S.Program:
    """A copy of the Program whose clips play only their `what` stem (mix / bed / low / high ->
    [what]; clips without it play silence). Echo buses keep capturing the reduced clips."""
    p = copy.deepcopy(prog)
    for cp in p.clips:
        st = cp.stems
        if isinstance(st, str):
            keep = S.carries(st, what)
        else:
            keep = what in st
        cp.stems = [what] if keep else []
    return p


def _levels(x: np.ndarray, sr: int, blk: int) -> np.ndarray:
    m = np.asarray(x, np.float64)
    m = m.mean(axis=1) if m.ndim == 2 else m
    n = len(m) // blk
    if n == 0:
        return np.zeros(0)
    e = (m[: n * blk] ** 2).reshape(n, blk).mean(axis=1)
    return 10 * np.log10(np.maximum(e, 1e-12))


def stem_overlaps(prog: S.Program, ya, yb, ga: float, gb: float, stems_a, stems_b, wc=None,
                  c: dict = CFG) -> dict:
    """Render the Program twice more from the stems, drums only and bass only, and measure where
    A's and B's both sound (each within kit_rel_db of its own p90 level over the region and above
    kit_floor_dbfs, 10 ms blocks). -> {kit_overlap_beats, bass_overlap_beats, kit_runs: [[t0, t1]],
    bass_runs}."""
    from .engine import render_program
    cc = c["creation"]
    sr = int(prog.sr)
    blk = int(0.010 * sr)
    ms = np.asarray(prog.clock_m, float)
    ts = np.asarray(prog.clock_t, float)
    beat = float(np.interp(min(1.0, ms[-1]), ms, ts) - np.interp(min(1.0, ms[-1]) - 1, ms, ts))
    res = {}
    for what in ("drums", "bass"):
        p = only_stem(prog, what)
        _, pa, pb = render_program(p, ya, yb, ga, gb, stems_a, stems_b, wc, loud_guard=False)
        la, lb = _levels(pa, sr, blk), _levels(pb, sr, blk)
        n = min(len(la), len(lb))
        la, lb = la[:n], lb[:n]

        def on(lv):
            act = lv[lv > float(cc["kit_floor_dbfs"])]
            if not len(act):
                return np.zeros(len(lv), bool)
            ref = float(np.percentile(act, 90))
            return lv > max(ref - float(cc["kit_rel_db"]), float(cc["kit_floor_dbfs"]))
        both = on(la) & on(lb)
        # a sustained overlap, not a single crossfaded block: count runs of >= 2 blocks (20 ms)
        d = np.diff(np.concatenate([[0], both.astype(int), [0]]))
        runs = [(a, b) for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]) if b - a >= 2]
        tot = sum(b - a for a, b in runs) * blk / sr
        key = "kit" if what == "drums" else "bass"
        xf = int(prog.xf)
        res[f"{key}_overlap_beats"] = round(tot / beat, 3)
        res[f"{key}_runs"] = [[round((a * blk - xf) / sr, 3), round((b * blk - xf) / sr, 3)] for a, b in runs[:8]]
    tol = float(cc["kit_tol_beats"])
    res["kit_ok"] = res["kit_overlap_beats"] <= tol
    res["bass_ok"] = res["bass_overlap_beats"] <= tol
    return res


def describe(comp: dict) -> list[str]:
    """Plain-words events of a composition (labels in time order)."""
    return [ev[2] for ev in sorted(comp["events"], key=lambda e: (e[0], e[1]))]


__all__ = ["creation_score", "creation_cands", "CREATION", "CREATION_CLASSES", "creation_rel", "pitch_semis", "shift_camelot", "assign_creations",
           "choose_form", "variety_ok", "creation_options", "stem_overlaps", "only_stem", "describe"]
