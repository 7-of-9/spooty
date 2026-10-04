"""Frozen Phase-0 contracts for Claude_Best · Medley (DESIGN.md §8, §12, §16.3; AMENDMENTS applied).

What lives here, and who produces / consumes it:

- `Feats` (E1 -> E2/E4): per-track features, cached by `feats.FeatStore` (§4, §5).
- `Composition` (E2 -> E3/E4/page), `Transition`, `Excerpt`, `SessionPlanMedley` (§8.1-8.7).
- `Program` dataclasses (E2 -> E3/E4): the compiled, JSON-native render program (§12).
- `Checks` (E4 -> page) and the verify store document (§8.8, §16.3).
- `validate_composition` / `validate_plan` / `validate_feats` / `validate_program` /
  `validate_checks`: return a list of `Issue`s with stable codes (see `CODES`); empty = valid.
  `ensure_valid(issues)` raises `SchemaError`.
- `canonical_json` / `canonical_hash` / `to_json` / `from_json`.
- Reference semantics the other modules must match: `clock_seconds` (§8.4 clock),
  `eval_knots` (§8.6 lane curves) and `static_eval` (how moves write lanes, see below).

Units: m = master beats (0 = B's landing), u = source beats relative to a_ref/b_ref, s = track
seconds, t = region seconds (0 = t(span.from)). Everything persisted is JSON-native: dicts with
str keys, lists, str, int, finite float, bool, None. Absent optional fields are omitted.

Lane semantics (refines §12 step 3; the §8.10 example needs a swap to lift a held kill):
  Lanes start at their defaults (gain 0 dB, eq 0 dB, hp/lp bypass, pos default for the warp).
  Moves apply in list order and are causal (they change nothing before their `at`), except
  `cut dir:"in"` which silences the clip before `at`.
  * Level-setting moves write the lane from `at` onwards, replacing what was there:
      fade  gain: from_db at `at` -> to_db at at+len (shape), then holds to_db (None = -inf);
      eq    band(s): the lane's value at `at` -> to_db at at+len (curve), then holds;
      filter hp/lp: hz[0] -> hz[1] over len (exp), then holds hz[1];
      cut   out: gain -inf from `at`;  in: gain -inf before `at`;
      swap  out clips: gain (band "all") or that band -> -inf from `at`; in clips: -> 0 dB from `at`.
  * Window moves add dB (-inf dominates) only inside their own window, then stop:
      vacuum, trade, gate, roll taper, reverse gain_db, duck, the pulse pattern P(phi).
  * Gestures: backspin/tape_stop silence the clip from the moment the rate reaches 0
    (end_by / at+len); rewind silences its gap. Loops, rolls, gestures, reverse and scratch
    rewrite pos inside their window ("moved"); after a jump or a loop the playhead runs at
    rate `ratio` again ("locked").
  * Hand-written `lanes` are applied last and replace the lane between their first and last knot.
"""

import dataclasses
import hashlib
import json
import math
import types
import typing
from dataclasses import dataclass, field
from typing import Any, Literal, NotRequired, TypedDict, Union, get_args, get_origin

import numpy as np

from . import CFG, COMPILER_VERSION, FEATS_VERSION, MEDLEY_VERSION  # noqa: F401 (re-exported)

SCHEMA_ID = "claude-best-medley/1"

# ---------------------------------------------------------------------------------------------
# vocabularies (§3, §7, §8)
# ---------------------------------------------------------------------------------------------
GridClass = Literal["locked", "verify", "free"]
RelKind = Literal["lock", "double", "free"]
LeadType = Literal["nobass-nodrums", "nobass-drums", "build", "break", "none"]
BlockName = Literal["house", "dnb", "swing", "rock", "close"]   # fixer: + rock (close split by bucket)
ExitKind = Literal["natural", "dip", "tail", "end"]
Tier = Literal["smooth", "noticeable", "signature"]
BIn = Literal["swap", "slam", "preroll", "tease", "double"]
FormName = Literal["drop_swap", "stem_handover", "phrase_trade", "tease_drop", "stutter_stitch",
                   "vocal_reveal", "double_drop", "half_time", "roll_slam", "echo_slam",
                   "tape_stop_slam", "spin_slam", "cut_on_one", "air_cut",   # fixer: + air_cut
                   # creation forms (medley v5): A and B coexist in a composed middle, one kit
                   "mashup", "drum_swap", "loop_rewind", "call_response", "gated_weave"]
StemName = Literal["drums", "bass", "other", "vocals"]
PseudoStem = Literal["mix", "low", "high", "top", "bed"]
ClipSrc = Literal["a", "b", "motif"]
Warp = Literal["native", "r2"]
LaneParam = Literal["pos", "gain", "hp", "lp", "eq_low", "eq_mid", "eq_high", "send"]
Curve = Literal["hold", "lin", "exp", "cos", "eqpow"]
ClockKind = Literal["a_fit", "a_refined", "ramp", "b_fit", "b_refined"]
Owner = Literal["a", "b", "both"]
Status = Literal["pass", "warn", "fail"]
FadeShape = Literal["eqpow", "lin", "cos", "exp", "steps", "pulse"]
PulsePattern = Literal["offbeat", "332", "stab13", "pump"]
EqBand = Literal["low", "mid", "high", "mid_high"]
SwapBand = Literal["all", "low", "mid", "high"]
ExcludeReason = Literal["needs_prep", "too_short", "low_h", "no_landing", "no_excerpt", "other"]

GRID_CLASSES = get_args(GridClass)
REL_KINDS = get_args(RelKind)
LEAD_TYPES = get_args(LeadType)
BLOCKS = get_args(BlockName)
TIERS = get_args(Tier)
B_INS = get_args(BIn)
FORM_NAMES = get_args(FormName)
STEM_NAMES = ("drums", "bass", "vocals", "other")     # the 8-channel R2 order (§13)
CLOCK_KINDS = get_args(ClockKind)
CURVES = get_args(Curve)
LANE_PARAMS = get_args(LaneParam)

# §10 tiers and loudness; "+wheel" in the variant makes any composition signature and loud
FORM_TIER: dict[str, str] = {
    "drop_swap": "smooth", "stem_handover": "smooth", "half_time": "smooth",
    "phrase_trade": "noticeable", "tease_drop": "noticeable", "roll_slam": "noticeable",
    "echo_slam": "noticeable", "cut_on_one": "noticeable", "air_cut": "noticeable",
    "stutter_stitch": "signature", "vocal_reveal": "signature", "double_drop": "signature",
    "tape_stop_slam": "signature", "spin_slam": "signature",
    "mashup": "signature", "drum_swap": "noticeable", "loop_rewind": "signature",
    "call_response": "signature", "gated_weave": "signature",
}
# creation forms (medley v5): a composed middle where A and B play together. Layering is made
# beat-safe by stems: one drum kit and one bassline at any instant (KIT_OVERLAP / BASS_OVERLAP
# replace R4 for these forms)
CREATION_FORMS = ("mashup", "drum_swap", "loop_rewind", "call_response", "gated_weave", "double_drop",
                  "tease_drop")
LOUD_FORMS = frozenset({"roll_slam", "tape_stop_slam", "spin_slam"})
STEM_FORMS = frozenset({"tease_drop", "stem_handover", "vocal_reveal"})        # † in §7
ANY_TEMPO_FORMS = frozenset({"roll_slam", "echo_slam", "tape_stop_slam", "spin_slam", "cut_on_one", "air_cut"})
WHEEL_TAG = "+wheel"
STEM_SETS = {"top": ["other", "vocals"], "bed": ["drums", "bass"]}             # §8.5 pseudo-stems
PSEUDO_NO_STEMS = ("mix", "low", "high")                                        # mix-phase sources


def tier_of(form: str, variant: str = "") -> str:
    return "signature" if WHEEL_TAG in (variant or "") else FORM_TIER[form]


def is_loud(form: str, variant: str = "") -> bool:
    return form in LOUD_FORMS or WHEEL_TAG in (variant or "")


def clip_stems(stem: Any) -> str | list[str]:
    """Resolve a Clip.stem to what the engine reads: "mix" | "low" | "high" | [stem names]
    (in STEM_NAMES order)."""
    if isinstance(stem, str) and stem in PSEUDO_NO_STEMS:
        return stem
    names = STEM_SETS.get(stem, [stem]) if isinstance(stem, str) else list(stem)
    return [s for s in STEM_NAMES if s in names]


def uses_stems(stem: Any) -> bool:
    return not (isinstance(stem, str) and stem in PSEUDO_NO_STEMS)


def rating_key(key: str, form: str, comp_hash: str) -> str:
    """medley-ratings.json key: "a>b|form|hash8" (§17.2)."""
    return f"{key}|{form}|{comp_hash[:8]}"


# ---------------------------------------------------------------------------------------------
# Feats (E1 -> everyone). Arrays may be lists (JSON / fixtures) or numpy arrays (FeatStore .npz);
# consumers wrap them with np.asarray. Times are native track seconds.
# ---------------------------------------------------------------------------------------------
class Fit(TypedDict):
    """grid.fit_grid result. Fitted time of beat index k (index into Feats.beats.t) is
    phase_s + k * period_s; k0..k1 is the beat-index range the fit used."""
    period_s: float
    phase_s: float
    rms_ms: float
    max_ms: float
    keep: float           # fraction of beats kept after outlier removal
    n: int                # beats kept
    k0: int
    k1: int


class WinFit(TypedDict):
    """A fit on a window [t0, t1] (s) and its class (§4.2)."""
    t0: float
    t1: float
    fit: Fit | None
    cls: GridClass


class FeatBeats(TypedDict):
    t: list[float]                      # consensus beats, refined to 1 ms where possible (§4.1)
    refined: list[int]                  # 1 = onset-refined, 0 = detected beat kept
    pos: list[int]                      # 0-based position in the bar; 0 = downbeat
    vox_db: list[float]                 # per beat, harmonic 300-3400 Hz level rel. p90 of bars.vox_db
    vox_stem_db: NotRequired[list[float]]   # per beat vocal-stem RMS rel. the mix p90 (stems only)


class StemRms(TypedDict):
    drums: list[float]
    bass: list[float]
    vocals: list[float]
    other: list[float]


class FeatBars(TypedDict):
    """Consensus bars (§4.3). bars.t[i] == beats.t[bars.beat[i]]; bar i spans [t[i], t[i+1])
    and the last bar ends at the file end. All *_db floored at CFG analysis.db_floor."""
    t: list[float]
    beat: list[int]
    rel_db: list[float]                 # RMS dB minus the track's p90 bar RMS
    low_db: list[float]                 # < 120 Hz level minus its p90
    perc_db: list[float]                # HPSS percussive / harmonic energy ratio, dB
    vox_db: list[float]                 # harmonic 300-3400 Hz level minus its p90 (vocal proxy)
    chroma: list[list[float]]           # 12-d, mean-centred over bars > 20th pct, unit norm
    label: list[str]                    # section label containing the bar ("unlabelled" if none)
    stem_rms: NotRequired[StemRms]      # dB rel. the mix p90 bar RMS, only when Feats.stems
    peak_db: NotRequired[list[float]]   # fixer: bar true peak (4x), dBFS (excerpt gain headroom)
    vox_run_s: NotRequired[list[float]]  # fixer: the sung line's run-on past t - 1/4 beat, s (stems)


class Section(TypedDict):
    start: float
    end: float
    label: str                          # all-in-one label, or "unlabelled" (novelty boundaries)
    bar: int                            # consensus bar nearest `start`


class Phrase(TypedDict):
    P: int                              # bars: smallest power of two with P * bar_s >= 12 s
    phase: int                          # phrase grid = bars with (bar - phase) % P == 0
    conf: float


class Onsets(TypedDict):
    t: list[float]                      # percussive onsets, 1 ms resolution, ascending
    strength: list[float]               # flux peak height (track-relative units)
    median_down_strength: float         # median onset strength at body downbeats


class KBlocks(TypedDict):
    """K-weighted mean square (sum over L/R, G = 1) of block i = [i*hop_s, i*hop_s + block_s).
    Block loudness = -0.691 + 10 log10(ms). BS.1770 gating is done by feats.lufs_window."""
    block_s: float
    hop_s: float
    ms: list[float]


class Lead(TypedDict):
    type: LeadType
    bars: int                           # lead length in bars (0 for "none")
    t: float                            # native s of the lead start (bar j - bars)
    pickup_beats: Literal[0, 1, 2]      # vocal/fill pickup before the landing (R7)
    fill_bars: int                      # 0-2 fill bars skipped by the nobass rule


class Exit(TypedDict):
    n: int                              # body bars, from CFG body_bars_allowed
    bar: int                            # X = j + n
    t: float                            # native s of X (fitted when the window is locked/verify)
    kind: ExitKind
    s_out: float                        # S_out(X) with next_lock = False; add 0.3 * tail48 for lock
    tail48: bool
    natural: bool
    dip: bool
    in_fade_or_lull: bool
    vocal_at_edge: bool
    verse_bars: NotRequired[int]        # fixer: verse / outro / break bars in the body
    section_end: NotRequired[bool]      # fixer: X closes the landing's highlight section
    level_db: float                     # body level: mean rel_db over j..X-1
    dur_s: float                        # (lead bars + n) * bar_s
    h: float                            # H(j, n) (§5.4)
    win: WinFit                         # A-side window [X - 16 bars, X + 1 bar] (E = 8, R = 6)


class Landing(TypedDict):
    bar: int                            # j (consensus bar index)
    t: float                            # native s (fitted when the window is locked/verify)
    label: str
    why: str                            # e.g. "chorus", "arrival+4dB", "chorus+drop"
    rel_db: float
    prior: float
    contrast_db: float
    low_jump_db: float
    onset_ok: bool                      # §5.1(6)
    onset_err_ms: float | None
    onset_strength: float | None        # ratio to median_down_strength
    drop_ok: NotRequired[bool]          # fixer: a drop whose on-time onset is weak after its riser
    h_base: NotRequired[float]          # fixer: best exit h without the vocal-edge term (eligibility)
    arrival: NotRequired[bool]          # fixer: contrast, low jump or a vocal entry at a section start
    lead: Lead
    exits: list[Exit]                   # every valid n, best h first
    h: float                            # max over exits
    win: WinFit                         # B-side window [j - 9 bars, j + 8 bars] (E = 8)


class Feats(TypedDict):
    version: int                        # FEATS_VERSION
    track: str                          # "spotify:<id>" / "file:<hash>"
    file: str                           # mp3 basename; the cache stem is its stem
    sig: str                            # "<size>:<mtime>:<analysis version>" (cache key part)
    duration: float
    bpb: int
    bpm: float                          # 60 / fit.period_s, else the analysis bpm
    bpm_bt: float
    bpm_a1: float | None
    meter_ok: bool
    octave_ok: bool
    grid_src: Literal["a1", "bt"]
    grid_class: GridClass               # track level, over `active`
    fit: Fit | None                     # over `active`
    active: tuple[float, float]         # first..last bar with rel_db > -6 (s)
    beats: FeatBeats
    bars: FeatBars
    sections: list[Section]
    phrase: Phrase
    last_loud_bar: int
    onsets: Onsets
    kblocks: KBlocks
    stems: bool                         # stem_rms/vox_stem_db present (all 4 stem files existed)
    landings: list[Landing]             # top 3 by h (§5.1 step 7), best first
    vocal_track: NotRequired[bool]      # fixer: sung (vocal stem p75 >= vocal_track_db; stems only)


class Rel(TypedDict):
    """Composition.rel (§8.4)."""
    kind: RelKind
    ratio: float                        # bpm_b / bpm_a
    a_ratio: Literal[1, 2, 0.5]
    stretch_pct: float                  # max |A warp| in %, signed like the example (-0.81)
    camelot: int
    chroma: float | None
    a_class: GridClass
    b_class: GridClass


class Relation(Rel):
    """order.relation() result: Rel plus the window fits it was decided on."""
    a_win: WinFit
    b_win: WinFit


# ---------------------------------------------------------------------------------------------
# Composition (§8.4-8.7)
# ---------------------------------------------------------------------------------------------
Knot = tuple[float, float | None, Curve]          # [m or t, value | None, curve of the next segment]
Span = TypedDict("Span", {"from": float, "to": float})
Event = tuple[float, float, str]


class ClockSeg(TypedDict):
    m0: float
    m1: float
    kind: ClockKind
    bpm0: float
    bpm1: float


class ARef(TypedDict):
    exit_bar: int
    exit_t: float
    period_s: float | None              # None for free (refined-beat) tracks


class BRef(TypedDict):
    land_bar: int
    land_t: float
    period_s: float | None


class ClipPitch(TypedDict):
    """A pitch shift of a warped A clip (creation forms, key fix): 0 st before m0, a linear glide
    to `semis` over [m0, m1] (master beats), then held. Never on B."""
    semis: float
    m0: float
    m1: float


class Clip(TypedDict):
    id: str
    src: ClipSrc
    stem: PseudoStem | StemName | list[StemName]
    at: float
    len: float
    u0: float
    ratio: Literal[1, 2, 0.5]
    warp: Warp
    gain_db: float                      # static trim
    pitch: NotRequired[ClipPitch]


class Lanes(TypedDict, total=False):
    pos: list[Knot]
    gain: list[Knot]
    hp: list[Knot]
    lp: list[Knot]
    eq_low: list[Knot]
    eq_mid: list[Knot]
    eq_high: list[Knot]
    send: list[Knot]


class Score(TypedDict):
    local: float
    terms: dict[str, float]


class HistoryItem(TypedDict):
    form: FormName
    variant: str
    hash: str
    fail: list[str]
    blend: NotRequired[float | None]     # medley v6: the render's measured blend score


class Checks(TypedDict):
    status: Status
    attempt: int
    land_err_ms: float
    land_strength: float
    bt_down_err_ms: float | None
    grid_med_ms: float | None
    grid_p90_ms: float | None
    fid_med_ms: float
    fid_p95_ms: float
    flams: int
    dbl_bass_beats: float
    chroma_mean: float | None
    clicks: int
    tp_dbtp: float
    limiter_ms_over6: float
    step_lu: float
    step_planned_lu: float
    overlap_excess_lu: float
    gaps_unplanned: int
    gesture_ok: bool
    tempo_jump_pct: float
    a_air_db: float
    vocal_edge_db: float | None
    fail: list[str]
    history: list[HistoryItem]
    blend: NotRequired[dict[str, Any]]   # medley v6: verify.blend_render + selection penalties


class ChecksSummary(TypedDict):
    status: Status
    attempt: int
    land_err_ms: float
    flams: int
    dbl_bass_beats: float
    clicks: int
    step_lu: float
    chroma_mean: float | None
    fail: list[str]


CHECKS_SUMMARY_KEYS = tuple(ChecksSummary.__annotations__)


def checks_summary(checks: "Checks | None") -> "ChecksSummary | None":
    return None if checks is None else {k: checks[k] for k in CHECKS_SUMMARY_KEYS}


# --- moves (§8.7). Every move has type and at; params per type. ---
DuckSpec = TypedDict("DuckSpec", {"key": str, "depth_db": float, "release_beats": float})

CutMove = TypedDict("CutMove", {"type": Literal["cut"], "at": float, "clip": str,
                                "dir": Literal["out", "in"], "ms": NotRequired[float]})
FadeMove = TypedDict("FadeMove", {
    "type": Literal["fade"], "at": float, "clip": str, "len": float,
    "from_db": float | None, "to_db": float | None, "shape": FadeShape,
    "step_bars": NotRequired[float], "pattern": NotRequired[PulsePattern], "floor_db": NotRequired[float]})
EqMove = TypedDict("EqMove", {"type": Literal["eq"], "at": float, "clip": str, "band": EqBand,
                              "len": float, "to_db": float | None, "curve": Curve})
FilterMove = TypedDict("FilterMove", {"type": Literal["filter"], "at": float, "clip": str,
                                      "kind": Literal["hp", "lp"], "len": float,
                                      "hz": tuple[float, float], "curve": NotRequired[Curve]})
SwapMove = TypedDict("SwapMove", {"type": Literal["swap"], "at": float, "out": list[str],
                                  "in": list[str], "band": SwapBand, "ms": NotRequired[float]})
TradeMove = TypedDict("TradeMove", {"type": Literal["trade"], "at": float, "clips": tuple[str, str],
                                    "lens": list[float], "slip": NotRequired[bool],
                                    "xf_ms": NotRequired[float]})
GateMove = TypedDict("GateMove", {"type": Literal["gate"], "at": float, "clips": tuple[str, str],
                                  "len": float, "steps": list[str], "attack_ms": NotRequired[float],
                                  "release_ms": NotRequired[float]})
RollMove = TypedDict("RollMove", {"type": Literal["roll"], "at": float, "clip": str,
                                  "sizes": list[tuple[float, float]], "slip": NotRequired[bool],
                                  "taper_db": NotRequired[float]})
LoopMove = TypedDict("LoopMove", {"type": Literal["loop"], "at": float, "clip": str, "size": float,
                                  "count": int, "slip": bool})
JumpMove = TypedDict("JumpMove", {"type": Literal["jump"], "at": float, "clip": str, "to_u": float})
EchoMove = TypedDict("EchoMove", {
    "type": Literal["echo"], "at": float, "clip": str, "capture": float, "delay": float, "fb": float,
    "tail": float, "hp_hz": tuple[float, float], "lp_hz": NotRequired[float], "send_db": float,
    "duck": NotRequired[DuckSpec]})
BackspinMove = TypedDict("BackspinMove", {"type": Literal["backspin"], "at": float, "clip": str,
                                          "push": float, "peak_rate": float, "tau": float,
                                          "end_by": float})
TapeStopMove = TypedDict("TapeStopMove", {"type": Literal["tape_stop"], "at": float, "clip": str,
                                          "len": float, "k": float})
RewindMove = TypedDict("RewindMove", {"type": Literal["rewind"], "at": float, "clip": str,
                                      "len": float, "peak_rate": float, "then_u": float, "gap": float})
ReverseMove = TypedDict("ReverseMove", {"type": Literal["reverse"], "at": float, "clip": str,
                                        "len": float, "src_u": float, "hp_hz": NotRequired[float],
                                        "gain_db": NotRequired[float]})
VacuumMove = TypedDict("VacuumMove", {"type": Literal["vacuum"], "at": float, "len": float,
                                      "keep": NotRequired[list[str]]})
DuckMove = TypedDict("DuckMove", {"type": Literal["duck"], "at": float, "clip": str, "key": str,
                                  "depth_db": float, "release_beats": float, "len": NotRequired[float]})
ScratchMove = TypedDict("ScratchMove", {"type": Literal["scratch"], "at": float, "clip": str,
                                        "len": float, "kind": Literal["baby", "chirp"],
                                        "depth": float, "period": float})

MOVE_TYPES: dict[str, type] = {
    "cut": CutMove, "fade": FadeMove, "eq": EqMove, "filter": FilterMove, "swap": SwapMove,
    "trade": TradeMove, "gate": GateMove, "roll": RollMove, "loop": LoopMove, "jump": JumpMove,
    "echo": EchoMove, "backspin": BackspinMove, "tape_stop": TapeStopMove, "rewind": RewindMove,
    "reverse": ReverseMove, "vacuum": VacuumMove, "duck": DuckMove, "scratch": ScratchMove,
}
Move = Union[CutMove, FadeMove, EqMove, FilterMove, SwapMove, TradeMove, GateMove, RollMove,
             LoopMove, JumpMove, EchoMove, BackspinMove, TapeStopMove, RewindMove, ReverseMove,
             VacuumMove, DuckMove, ScratchMove]
GESTURE_MOVES = frozenset({"backspin", "tape_stop", "rewind", "reverse", "scratch"})   # rate != 1
POS_MOVES = GESTURE_MOVES | {"roll", "loop", "jump"}


class Composition(TypedDict):
    id: str                             # "j03"
    a: str
    b: str
    form: FormName
    variant: str                        # dot-joined, e.g. "L4.pulse-offbeat", "+wheel8"
    tier: Tier
    loud: bool
    b_in: BIn
    rel: Rel
    bpb: int                            # master bpb = B's
    a_ref: ARef
    b_ref: BRef
    clock: list[ClockSeg]
    span: Span
    clips: list[Clip]
    moves: list[Move]
    lanes: NotRequired[dict[str, Lanes]]
    events: list[Event]                 # master beats [m0, m1, label]
    fallback: list[FormName]
    score: NotRequired[Score]
    checks: NotRequired[Checks]
    hash: str                           # canonical_hash(self)


# ---------------------------------------------------------------------------------------------
# Plan (§8.1-8.3)
# ---------------------------------------------------------------------------------------------
class ExcerptLead(TypedDict):
    type: LeadType
    bars: int
    t: float
    pickup_beats: Literal[0, 1, 2]


class ExcerptLand(TypedDict):
    bar: int
    t: float
    label: str
    why: str
    rel_db: float


class ExcerptExit(TypedDict):
    bar: int
    t: float
    kind: ExitKind
    s_out: float
    vocal_clear: bool | None


class Excerpt(TypedDict):
    track: str
    block: BlockName
    bpb: int
    grid_class: GridClass
    bpm: float
    lead: ExcerptLead
    land: ExcerptLand
    exit: ExcerptExit
    body_bars: int
    body_lufs: float
    arc_off_lu: float
    gain_db: float
    h: float
    labels: list[str]


class ExcerptBrief(TypedDict):
    lead_t: float
    land_t: float
    exit_t: float
    lead_type: LeadType
    labels: list[str]


class OrderSummary(TypedDict):
    """build_plan's existing summary row (open: extra existing keys are allowed) + excerpt."""
    id: str
    artist: str
    title: str
    file: str
    bpm: float
    duration: float
    start: float
    excerpt: ExcerptBrief


class Transition(TypedDict):
    index: int
    key: str                            # "a>b"
    a: str
    b: str
    style: Literal["medley"]
    beatmatch: bool
    a_out_start: float
    a_out_end: float
    b_in_start: float
    b_in_end: float
    T: float
    T_overlap: float
    bars: float
    reason: str
    key_distance: int
    stretch_pct: float | None
    k: float
    requested: str
    override: dict[str, Any]            # always {}
    form: FormName
    variant: str
    tier: Tier
    b_in: BIn
    land_s: float
    exit_s: float
    b_enter_s: float
    grid: list[tuple[float, bool, Owner]]
    events_s: list[Event]
    checks_summary: ChecksSummary | None
    composition: NotRequired[Composition]   # stripped from /api/state, served by /composition


class TierCounts(TypedDict):
    smooth: int
    noticeable: int
    signature: int


class MedleyStats(TypedDict):
    songs: int
    total_s: float
    tiers: TierCounts
    verified: int
    warned: int
    failed: int
    unverified: int


class Excluded(TypedDict):
    """AMENDMENTS 1: every excluded track is reported with its reason."""
    track: str
    reason: ExcludeReason
    detail: str


class MedleyMeta(TypedDict):
    schema: Literal["claude-best-medley/1"]
    medley_version: str
    compiler: str
    seed: int
    target_s: float                     # informational only (AMENDMENTS 1: not a cap)
    excerpts: list[Excerpt]
    motif: dict[str, Any] | None        # Phase 5
    needs_prep: list[str]
    excluded: list[Excluded]
    stats: MedleyStats


class SessionPlanMedley(TypedDict):
    kind: Literal["medley"]
    order: list[OrderSummary]
    transitions: list[Transition]
    total_seconds: float
    native_starts: list[float]
    first_fade_s: float
    final_end: float
    final_fade_s: float
    medley: MedleyMeta


class MedleyDoc(TypedDict):
    """doc["medley"] on a medley set (§17.2)."""
    version: int
    seed: int
    target_s: float
    blocks: list[BlockName]
    pins: dict[str, Any]


class MedleyRating(TypedDict):
    """POST /api/state body {"medley_rating": ...}; stored under rating_key()."""
    key: str
    form: FormName
    hash: str
    value: int | None


class VerifyDoc(TypedDict):
    """<session>/<set>/verify.json (§16.3), written atomically, version += 1 per write."""
    version: int
    entries: dict[str, Checks]          # composition hash -> Checks
    failed: list[str]
    bad_landings: list[tuple[str, int]]


_OPEN_DICTS = {OrderSummary}           # extra keys allowed


# ---------------------------------------------------------------------------------------------
# Program (§12): the only interface between compiler and engine. Times are region seconds.
# ---------------------------------------------------------------------------------------------
@dataclass
class Splice:
    t: float                            # region s (already moved to onset - splice_pre_ms)
    clip: str
    kind: str                           # "edge_in" | "edge_out" | "gain" | "eq" | "pos" | "swap"
    onset: float | None                 # region s of the source onset it snapped to, or None
    xf_ms: float
    search_ms: float                    # 0 = no offset search (different-source splices)


@dataclass
class ClipProgram:
    id: str
    src: str                            # "a" | "b" | "motif"
    stems: list[str] | str              # "mix" | "low" | "high" | [stem names, STEM_NAMES order]
    # {"kind":"native","s0":s,"s1":s}: W = the native crop [s0, s1] of the track (or its stems)
    # {"kind":"r2","s0","s1","src_anchors":[s],"dst_anchors":[s],"w_len":s}: W = R2 --timemap of
    #   [s0, s1]; src_anchors absolute track s (first = s0, last = s1), dst_anchors W s
    #   (first = 0, last = w_len), strictly increasing, fitted-grid beats only (R3).
    source: dict
    # [{"t0","t1","kind":"copy","w0"}]: out[t] = W[w0 + (t - t0)]  (w in W seconds)
    # [{"t0","t1","kind":"vary","w":[W s every CFG compile.vary_step_s from t0]}]
    pos: list[dict]
    gain_db: list[list]                 # knots [t, dB | None, curve]
    hp_hz: list[list] | None            # knots [t, Hz | None (bypass), curve] or None
    lp_hz: list[list] | None
    eq_db: dict[str, list[list]]        # "low" / "mid" / "high" knots, dB | None (kill)
    trim_db: float
    track_gain_from: str                # "a" | "b": multiply by track_gain(order track)


@dataclass
class EchoProgram:
    clip: str
    capture: tuple[float, float]        # region s [t0, t1) fed into the bus
    delay_s: float
    fb: float
    tail_s: float
    hp_hz: list[list]                   # knots inside the loop
    lp_hz: float
    send_db: float
    duck: dict | None                   # {"key": clip id, "depth_db", "release_s"}
    part: str                           # "a" | "b"


@dataclass
class Program:
    version: str                        # COMPILER_VERSION
    sr: int
    xf: int                             # samples (render.XF)
    T: float
    t_land: float
    clock_m: list[float]                # every 1/64 beat over [span.from, span.to]
    clock_t: list[float]
    clips: list[ClipProgram]
    echoes: list[EchoProgram]
    splices: list[Splice]
    grid: list[list]                    # [t, isDownbeat, owner]
    events: list[list]                  # [t0, t1, label]
    expect: dict                        # see Expect


class GestureExpect(TypedDict):
    kind: str
    clip: str
    t0: float
    t1: float
    stop_t: float | None                # where the rate reaches 0 (backspin, tape_stop)


class Expect(TypedDict):
    """Program.expect: what verify_join (§16) checks against."""
    land_t: float
    vacuums: list[tuple[float, float]]
    layered: list[tuple[float, float]]  # both parts audible (V2a, V3)
    tonal: list[tuple[float, float]]    # tonal overlap windows (V5)
    ramps: list[tuple[float, float]]    # planned tempo ramps (V10 exemption)
    step_planned_lu: float | None       # None: verify derives it from the plan excerpts
    silences: list[tuple[float, float]]  # allowed silences (V9)
    gestures: list[GestureExpect]
    seams: list[float]                  # loop seam times (V9)
    onsets: dict[str, list[tuple[float, float]]]   # clip id -> [(t, strength)] audible >= -20 dB


# ---------------------------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------------------------
def to_jsonable(obj: Any) -> Any:
    """Plain JSON-native copy: dataclasses -> dicts, tuples/ndarrays -> lists, numpy scalars ->
    Python scalars. Raises ValueError on NaN/inf and on non-str dict keys."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: to_jsonable(getattr(obj, f.name)) for f in dataclasses.fields(obj)}
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if not isinstance(k, str):
                raise ValueError(f"non-str key {k!r}")
            out[k] = to_jsonable(v)
        return out
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [to_jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        x = float(obj)
        if not math.isfinite(x):
            raise ValueError("NaN/inf is not JSON; use None")
        return x
    if obj is None or isinstance(obj, str):
        return obj
    raise ValueError(f"not JSON-native: {type(obj).__name__}")


def to_json(obj: Any, indent: int | None = None) -> str:
    return json.dumps(to_jsonable(obj), indent=indent, ensure_ascii=False, allow_nan=False)


def from_json(src: str | bytes | dict | list, cls: type | None = None) -> Any:
    """Parse JSON text (or take an already-parsed object). With a dataclass `cls` (Program,
    ClipProgram, EchoProgram, Splice) rebuild it, including nested dataclasses and tuples."""
    obj = json.loads(src) if isinstance(src, (str, bytes)) else src
    return obj if cls is None else _build(cls, obj)


def _build(tp: Any, v: Any) -> Any:
    if v is None:
        return None
    if dataclasses.is_dataclass(tp):
        hints = typing.get_type_hints(tp)
        return tp(**{f.name: _build(hints[f.name], v[f.name]) for f in dataclasses.fields(tp)
                     if f.name in v})
    origin, args = get_origin(tp), get_args(tp)
    if origin in (Union, types.UnionType):
        for a in args:
            if a is not type(None) and (dataclasses.is_dataclass(a) or get_origin(a) is tuple):
                return _build(a, v)
        return v
    if origin is list and args and dataclasses.is_dataclass(args[0]):
        return [_build(args[0], x) for x in v]
    if origin is tuple:
        return tuple(v)
    return v


def _canon(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: _canon(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_canon(x) for x in v]
    if isinstance(v, float):
        v = round(v, 9)
        if v == int(v) and abs(v) < 2 ** 53:
            return int(v)                   # 28.0 and 28 hash alike; -0.0 -> 0
        return v
    return v


def canonical_json(obj: Any) -> str:
    """Key-sorted, compact, integral floats as ints, other floats rounded to 1e-9."""
    return json.dumps(_canon(to_jsonable(obj)), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False)


HASH_EXCLUDE = ("hash", "score", "checks")


def canonical_hash(obj: Any, exclude: tuple[str, ...] = HASH_EXCLUDE) -> str:
    """sha1(canonical JSON of obj minus its top-level hash/score/checks)[:16]."""
    if isinstance(obj, dict):
        obj = {k: v for k, v in obj.items() if k not in exclude}
    return hashlib.sha1(canonical_json(obj).encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------------------------
# reference semantics: clock and lane curves
# ---------------------------------------------------------------------------------------------
def _seg_dt(seg: dict, m: np.ndarray) -> np.ndarray:
    """Seconds from seg.m0 to m under the segment's tempo law (extrapolated outside it)."""
    x = m - seg["m0"]
    b0, b1 = float(seg["bpm0"]), float(seg["bpm1"])
    if seg["kind"] == "ramp" and abs(b1 - b0) > 1e-12:
        k = (b1 - b0) / (seg["m1"] - seg["m0"])
        return 60.0 / k * np.log((b0 + k * x) / b0)
    return x * 60.0 / b0


def clock_seconds(clock: list[dict], m: Any, tau: dict | None = None) -> np.ndarray:
    """t(m) with t(clock[0].m0) = 0 (§8.4). Fit and ramp segments are exact closed forms; a
    `*_refined` segment uses tau[seg kind](u) -> s (u = source beat, relative to the track's ref
    beat, which is m on that track's own clock) when given, else its bpm0 (an approximation)."""
    m = np.atleast_1d(np.asarray(m, dtype=float))
    starts = np.array([s["m0"] for s in clock], dtype=float)
    t0 = [0.0]
    for s in clock[:-1]:
        t0.append(t0[-1] + float(_seg_dt_any(s, np.array([s["m1"]]), tau)[0]))
    idx = np.clip(np.searchsorted(starts, m, side="right") - 1, 0, len(clock) - 1)
    out = np.empty_like(m)
    for i, s in enumerate(clock):
        sel = idx == i
        if sel.any():
            out[sel] = t0[i] + _seg_dt_any(s, m[sel], tau)
    return out


def _seg_dt_any(seg: dict, m: np.ndarray, tau: dict | None) -> np.ndarray:
    if seg["kind"].endswith("_refined") and tau and seg["kind"] in tau:
        f = tau[seg["kind"]]
        return np.asarray(f(m), float) - float(f(np.array([seg["m0"]]))[0])
    return _seg_dt(seg, m)


def tabulate_clock(clock: list[dict], span: dict, per_beat: int = 64,
                   tau: dict | None = None) -> tuple[list[float], list[float]]:
    """(clock_m, clock_t) every 1/per_beat beat over [span.from, span.to] (Program.clock_*)."""
    n = int(round((span["to"] - span["from"]) * per_beat))
    m = span["from"] + np.arange(n + 1) / per_beat
    return m.tolist(), clock_seconds(clock, m, tau).tolist()


DB_FLOOR = float(CFG["analysis"]["db_floor"])


def _amp(v: np.ndarray) -> np.ndarray:
    return np.where(np.isfinite(v), 10.0 ** (np.where(np.isfinite(v), v, 0.0) / 20.0), 0.0)


def _db(a: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore"):
        return np.where(a > 0, 20.0 * np.log10(np.maximum(a, 1e-300)), -np.inf)


def ramp_db(v0: float | None, v1: float | None, x: np.ndarray, curve: str) -> np.ndarray:
    """dB-lane interpolation for x in [0, 1] (None = -inf). lin/cos interpolate linear amplitude
    (cos with the raised-cosine weight); eqpow is linear in power,
    a = sqrt((a0 cos(pi x/2))^2 + (a1 sin(pi x/2))^2), i.e. the sin/cos law when one end is -inf;
    exp is linear in dB with None treated as CFG db_floor and exactly -inf at that end; hold keeps v0."""
    x = np.asarray(x, dtype=float)
    a = -np.inf if v0 is None else float(v0)
    b = -np.inf if v1 is None else float(v1)
    if curve == "hold":
        return np.full_like(x, a)
    if curve == "exp":
        fa, fb = max(a, DB_FLOOR), max(b, DB_FLOOR)
        out = fa + (fb - fa) * x
        if v1 is None:
            out = np.where(x >= 1, -np.inf, out)
        if v0 is None:
            out = np.where(x <= 0, -np.inf, out)
        return out
    A0, A1 = _amp(np.array(a)), _amp(np.array(b))
    if curve == "eqpow":        # linear in power: a0 cos, a1 sin at the ends, never overshoots
        amp = np.sqrt((A0 * np.cos(np.pi * x / 2)) ** 2 + (A1 * np.sin(np.pi * x / 2)) ** 2)
    else:
        w = x if curve == "lin" else (1 - np.cos(np.pi * x)) / 2
        amp = A0 + (A1 - A0) * w
    return _db(amp)


def eval_knots(knots: list, x: Any, kind: str = "db") -> np.ndarray:
    """Evaluate a knot lane at x (beats or seconds). kind "db" (gain/eq/send; None = -inf),
    "hz" (hp/lp; None = bypass, returned as NaN; exp = log-linear) or "pos" (source beats; any
    curve but hold is linear). Before the first knot the lane holds the first value, after the
    last it holds the last; two knots at the same x are a splice (the later one wins at x)."""
    x = np.atleast_1d(np.asarray(x, dtype=float))
    ks = sorted(((float(k[0]), i, k) for i, k in enumerate(knots)), key=lambda q: (q[0], q[1]))
    xs = np.array([q[0] for q in ks])
    vals = [q[2][1] for q in ks]
    curves = [q[2][2] for q in ks]

    def num(v, null):
        return null if v is None else float(v)

    null = -np.inf if kind == "db" else np.nan
    out = np.full_like(x, num(vals[0], null))
    idx = np.searchsorted(xs, x, side="right") - 1
    out[idx >= len(ks) - 1] = num(vals[-1], null)
    for k in range(len(ks) - 1):
        sel = idx == k
        if not sel.any():
            continue
        span = xs[k + 1] - xs[k]
        f = np.clip((x[sel] - xs[k]) / span, 0, 1) if span > 0 else np.ones(sel.sum())
        v0, v1, c = vals[k], vals[k + 1], curves[k]
        if kind == "db":
            out[sel] = ramp_db(v0, v1, f, c)
        elif kind == "hz":
            if v0 is None or c == "hold" or v1 is None:
                out[sel] = num(v0, np.nan)
            else:
                w = f if c in ("lin", "exp") else (1 - np.cos(np.pi * f)) / 2
                out[sel] = (v0 + (v1 - v0) * w if c == "lin"
                            else np.exp(np.log(v0) + (np.log(v1) - np.log(v0)) * w))
        else:
            out[sel] = float(v0) if c == "hold" else float(v0) + (float(v1) - float(v0)) * f
    return out


# ---------------------------------------------------------------------------------------------
# validation plumbing
# ---------------------------------------------------------------------------------------------
CODES: dict[str, str] = {
    # structure (any document)
    "FIELD_MISSING": "a required field is absent",
    "FIELD_TYPE": "a field has the wrong JSON type",
    "FIELD_VALUE": "a field value is outside its enum or range",
    "FIELD_UNKNOWN": "a field that the contract does not define",
    "NOT_JSON": "a value is not JSON-native (numpy type, NaN/inf, non-str key)",
    # composition identity and references
    "ID_DUP": "two clips share an id",
    "CLIP_REF": "a move, lane or duck key names an unknown clip",
    "HASH_FORMAT": "hash is not 16 lowercase hex characters",
    "HASH_MISMATCH": "hash != canonical_hash(composition)",
    "TIER_MISMATCH": "tier does not match the form (and +wheel)",
    "LOUD_MISMATCH": "loud does not match the form (and +wheel)",
    "REL_RATIO": "rel.a_ratio does not match rel.kind (2 or 0.5 only for double)",
    "CLIP_RATIO": "clip ratio 2/0.5 on a non-A clip or outside a double join",
    "CLIP_RANGE": "clip lies outside the span",
    "MOVE_RANGE": "move lies outside the span",
    "MOVE_SRC": "move not allowed on this clip's source (backspin/tape_stop are A only)",
    "MOVE_PARAM": "move parameters are inconsistent (gate steps, trade lens, fade shape params)",
    "EVENT_RANGE": "event outside the span or m0 > m1",
    "SPAN_ORDER": "span.from > 0, span.to < 0 or from >= to",
    # §8.9.1 clock
    "CLOCK_EMPTY": "no clock segments",
    "CLOCK_ORDER": "a clock segment has m1 <= m0",
    "CLOCK_GAP": "clock segments are not contiguous",
    "CLOCK_COVER": "clock does not cover [span.from, span.to]",
    "CLOCK_BPM": "bpm0 != bpm1 on a non-ramp segment, or bpm <= 0",
    "CLOCK_KIND": "clock segment kind on the wrong side of the landing",
    "CLOCK_FIT_BPM": "a_fit/b_fit bpm0 disagrees with 60 / ref period_s",
    "CLOCK_JUMP": "bpm discontinuity other than the allowed step at m = 0",
    "RAMP_SLOPE": "ramp slope above ramp_pct_per_bar",
    "RAMP_LEN": "ramp length outside ramp_bars (R5)",
    "RAMP_B_AUDIBLE": "a B clip is audible during a ramp",
    # §8.9.2-10
    "B_WARP": "a B clip is not warp native at ratio 1",
    "SPAN_START": "span start is not exactly A's full mix at 0 dB, locked, ratio 1, no EQ/filter",
    "SPAN_END": "span end is not exactly B's full mix at 0 dB, locked, native, no EQ/filter",
    "KNOT_FORMAT": "a lane knot is not [m, value|null, curve] (or null on a pos lane)",
    "KNOT_ORDER": "lane knots are not sorted by m",
    "KNOT_RANGE": "a lane knot lies outside [span.from - 1/8, span.to + 1/8]",
    "GESTURE_LEN": "a rate != 1 window is too long (8; rewind 4; tape_stop bpb; scratch 2)",
    "GESTURE_CLOCK": "a loop/roll/echo/gesture reach crosses a tempo change or another track's clock",
    "STEP_A_AUDIBLE": "at a tempo step a locked A clip is audible after t(0) - max(1/4 beat, pickup)",
    "STEP_A_AFTER": "at a tempo step an A clip is audible after the landing",
    "ECHO_FB": "echo feedback above min(echo_fb_max, tail-rule bound)",
    "R4_OVERLAP": "two percussive sources above -20 dB without lock/double, both locked, <= 3 %",
    "KIT_OVERLAP": "creation form: two drum kits (drums / bed / mix / low / high) sound at once",
    "BASS_OVERLAP": "creation form: two basslines (bass / bed / mix / low) sound at once",
    "PITCH_B": "a pitch shift on a B clip, or on a non-warped clip",
    "R10_MIXED": "a warped track mixes stem clips with mix-phase clips",
    "SIZE_SPAN": "span longer than max_span_beats",
    "SIZE_T": "T longer than max_T_s",
    # plan
    "PLAN_KIND": "plan kind/schema is not medley",
    "PLAN_LEN": "order/transitions/native_starts/excerpts lengths disagree",
    "PLAN_ALIGN": "transition or excerpt does not match its neighbours in order",
    "PLAN_NATIVE": "native_starts[i+1] != transitions[i].b_in_end",
    "PLAN_SOLO": "native solo shorter than max(8 bars, 12 s) (R9)",
    "PLAN_COMPAT": "transition compatibility fields disagree with its composition",
    "PLAN_STATS": "medley.stats disagree with the plan",
    # feats
    "FEATS_VERSION": "feats version != FEATS_VERSION",
    "FEATS_LEN": "feats arrays have inconsistent lengths",
    "FEATS_ORDER": "feats times not ascending or indices out of range",
    "FEATS_VALUE": "feats value out of range",
    # program
    "PROG_CLOCK": "program clock tables empty, unequal or not increasing",
    "PROG_SOURCE": "program clip source window/anchors malformed",
    "PROG_POS": "program pos segments malformed or outside [-xf, T + xf]",
    "PROG_KNOTS": "program knots unsorted or malformed",
    "PROG_REF": "program splice/echo references an unknown clip",
    # checks
    "CHECKS_STATUS": "checks status disagrees with its fail list",
}


@dataclass(frozen=True)
class Issue:
    code: str
    path: str
    detail: str = ""

    def __str__(self) -> str:
        return f"{self.code} at {self.path or '<root>'}: {self.detail}"


class SchemaError(ValueError):
    def __init__(self, issues: list[Issue], what: str = "document"):
        self.issues = issues
        self.code = issues[0].code if issues else ""
        more = f" (+{len(issues) - 1} more)" if len(issues) > 1 else ""
        super().__init__(f"invalid {what}: {issues[0]}{more}" if issues else f"invalid {what}")


def ensure_valid(issues: list[Issue], what: str = "document") -> None:
    if issues:
        raise SchemaError(issues, what)


def codes(issues: list[Issue]) -> set[str]:
    return {i.code for i in issues}


class _Out(list):
    """Issue collector with a cap, so one broken array cannot produce thousands of issues."""
    CAP = 200

    def add(self, code: str, path: str, detail: str = "") -> None:
        assert code in CODES, code
        if len(self) < self.CAP:
            self.append(Issue(code, path, detail))


def _is_num(v: Any) -> bool:
    return type(v) in (int, float) and math.isfinite(v)


def _check(v: Any, tp: Any, path: str, out: _Out, arrays: bool = False) -> None:
    """Check v against a typing annotation: TypedDict, Literal, Union, list, tuple, dict, scalars."""
    if tp is Any:
        _check_json(v, path, out)
        return
    if tp == Move:                                      # dispatch on the move's "type"
        if not isinstance(v, dict):
            out.add("FIELD_TYPE", path, f"expected move object, got {type(v).__name__}")
        elif v.get("type") not in MOVE_TYPES:
            out.add("FIELD_VALUE", f"{path}.type", f"{v.get('type')!r} not in {list(MOVE_TYPES)}")
        else:
            _check_td(v, MOVE_TYPES[v["type"]], path, out, arrays)
        return
    origin, args = get_origin(tp), get_args(tp)
    if origin in (Union, types.UnionType):
        trials = []
        for a in args:
            o = _Out()
            _check(v, a, path, o, arrays)
            if not o:
                return
            trials.append(o)
        best = min(trials, key=len)
        out.extend(best[: _Out.CAP - len(out)])
        return
    if origin is Literal:
        ok = any((type(v) is type(a) or (_is_num(v) and _is_num(a) and not isinstance(a, bool)))
                 and v == a and not isinstance(v, bool) for a in args)
        if not ok:
            out.add("FIELD_VALUE", path, f"{v!r} not in {list(args)}")
        return
    if tp is type(None):
        if v is not None:
            out.add("FIELD_TYPE", path, f"expected null, got {type(v).__name__}")
        return
    if tp in (int, float, bool, str):
        _check_scalar(v, tp, path, out)
        return
    if typing.is_typeddict(tp):
        _check_td(v, tp, path, out, arrays)
        return
    if origin in (list, tuple):
        if arrays and isinstance(v, np.ndarray):
            if v.dtype.kind not in "biuf" or (v.dtype.kind == "f" and not np.isfinite(v).all()):
                out.add("NOT_JSON", path, "array must be finite numeric")
            return
        if not isinstance(v, (list, tuple)):
            out.add("FIELD_TYPE" if not isinstance(v, np.ndarray) else "NOT_JSON", path,
                    f"expected list, got {type(v).__name__}")
            return
        if origin is tuple and args and args[-1] is not Ellipsis:
            if len(v) != len(args):
                out.add("FIELD_TYPE", path, f"expected {len(args)} items, got {len(v)}")
                return
            for i, (x, a) in enumerate(zip(v, args)):
                _check(x, a, f"{path}[{i}]", out, arrays)
            return
        item = args[0] if args else Any
        for i, x in enumerate(v):
            _check(x, item, f"{path}[{i}]", out, arrays)
            if len(out) >= _Out.CAP:
                return
        return
    if origin is dict:
        if not isinstance(v, dict):
            out.add("FIELD_TYPE", path, f"expected object, got {type(v).__name__}")
            return
        for k, x in v.items():
            if not isinstance(k, str):
                out.add("NOT_JSON", path, f"non-str key {k!r}")
                continue
            _check(x, args[1] if args else Any, f"{path}.{k}", out, arrays)
        return
    raise TypeError(f"unsupported annotation {tp!r}")


def _check_scalar(v: Any, tp: type, path: str, out: _Out) -> None:
    if isinstance(v, (np.generic, np.ndarray)):
        out.add("NOT_JSON", path, f"numpy {type(v).__name__}")
    elif tp is float:
        if type(v) not in (int, float):
            out.add("FIELD_TYPE", path, f"expected number, got {type(v).__name__}")
        elif not math.isfinite(v):
            out.add("NOT_JSON", path, "NaN/inf (use null)")
    elif type(v) is not tp:
        out.add("FIELD_TYPE", path, f"expected {tp.__name__}, got {type(v).__name__}")


def _check_json(v: Any, path: str, out: _Out) -> None:
    try:
        to_jsonable(v)
        if isinstance(v, (np.generic, np.ndarray)):
            raise ValueError("numpy")
    except ValueError as exc:
        out.add("NOT_JSON", path, str(exc))


def _check_td(v: Any, td: type, path: str, out: _Out, arrays: bool) -> None:
    if not isinstance(v, dict):
        out.add("FIELD_TYPE", path, f"expected object {td.__name__}, got {type(v).__name__}")
        return
    hints = typing.get_type_hints(td)
    for k in td.__required_keys__:
        if k not in v:
            out.add("FIELD_MISSING", f"{path}.{k}" if path else k, td.__name__)
    for k, x in v.items():
        p = f"{path}.{k}" if path else str(k)
        if k not in hints:
            if td not in _OPEN_DICTS:
                out.add("FIELD_UNKNOWN", p, td.__name__)
            else:
                _check_json(x, p, out)
            continue
        _check(x, hints[k], p, out, arrays)


def check_type(v: Any, tp: Any, path: str = "", arrays: bool = False) -> list[Issue]:
    """Structural check of any value against one of this module's annotations."""
    out = _Out()
    _check(v, tp, path, out, arrays)
    return list(out)


# ---------------------------------------------------------------------------------------------
# static evaluation of a composition (used by validate_composition and by form scoring)
# ---------------------------------------------------------------------------------------------
@dataclass
class ClipTrack:
    """One clip sampled at Static.m. gain excludes the clip trim; -inf = silent."""
    clip: dict
    inside: np.ndarray
    gain: np.ndarray
    eq: dict[str, np.ndarray]
    hp: np.ndarray                      # a high-pass is engaged
    lp: np.ndarray
    moved: np.ndarray                   # pos rewritten here (loop/roll/gesture/reverse/scratch)
    rate: np.ndarray                    # rate != 1 here (gestures)

    @property
    def level(self) -> np.ndarray:
        return self.gain + float(self.clip.get("gain_db", 0.0))

    @property
    def audible(self) -> np.ndarray:
        bands = np.isfinite(self.eq["low"]) | np.isfinite(self.eq["mid"]) | np.isfinite(self.eq["high"])
        return self.inside & np.isfinite(self.gain) & bands

    @property
    def locked(self) -> np.ndarray:
        return ~(self.moved | self.rate)


@dataclass
class Static:
    m: np.ndarray                       # sample midpoints (beats)
    h: float
    t: np.ndarray                       # clock seconds at m
    clips: dict[str, ClipTrack]
    reaches: list[tuple[str, str, float, float]] = field(default_factory=list)   # (type, clip, m0, m1)
    gestures: list[tuple[str, str, float, float]] = field(default_factory=list)  # rate != 1 windows

    def window(self, m0: float, m1: float) -> np.ndarray:
        return (self.m >= m0) & (self.m < m1)


_BANDS = {"low": ("low",), "mid": ("mid",), "high": ("high",), "mid_high": ("mid", "high"),
          "all": ("low", "mid", "high")}


def _fade_curve(mv: dict, x: np.ndarray, bpb: int) -> np.ndarray:
    shape = mv["shape"]
    v0, v1 = mv["from_db"], mv["to_db"]
    if shape == "steps":
        n = max(1, int(round(mv["len"] / (float(mv.get("step_bars", 1)) * bpb))))
        a = DB_FLOOR if v0 is None else float(v0)
        b = DB_FLOOR if v1 is None else float(v1)
        out = a + (b - a) * np.floor(x * n) / n
        return np.where((v0 is None) & (x < 1.0 / n), -np.inf, out)
    curve = {"pulse": "eqpow"}.get(shape, shape)      # static level = the pulse's peak G(m)
    return ramp_db(v0, v1, x, curve)


def static_eval(comp: dict, step: float | None = None) -> Static:
    """Sample every clip's lanes on a 1/64-beat grid from its moves (module docstring)."""
    step = step or float(CFG["limits"]["static_step_beats"])
    f, to = float(comp["span"]["from"]), float(comp["span"]["to"])
    n = max(1, int(round((to - f) / step)))
    m = f + (np.arange(n) + 0.5) * step
    bpb = int(comp.get("bpb", 4))
    tracks: dict[str, ClipTrack] = {}
    for c in comp["clips"]:
        inside = (m >= c["at"]) & (m < c["at"] + c["len"])
        z = np.zeros(n)
        tracks[c["id"]] = ClipTrack(c, inside, z.copy(), {b: z.copy() for b in ("low", "mid", "high")},
                                    np.zeros(n, bool), np.zeros(n, bool), np.zeros(n, bool),
                                    np.zeros(n, bool))
    win = {cid: np.zeros(n) for cid in tracks}          # window-move dB offsets
    st = Static(m, step, clock_seconds(comp["clock"], m), tracks)

    def after(at):
        return m >= at

    def within(at, ln):
        return (m >= at) & (m < at + ln)

    for mv in comp["moves"]:
        typ, at = mv["type"], float(mv["at"])
        ct = tracks.get(mv.get("clip", ""))
        if typ == "fade" and ct:
            ln = float(mv["len"])
            sel = within(at, ln)
            if ln > 0:
                ct.gain[sel] = _fade_curve(mv, (m[sel] - at) / ln, bpb)
            end = after(at + ln)
            ct.gain[end] = -np.inf if mv["to_db"] is None else float(mv["to_db"])
        elif typ == "cut" and ct:
            if mv["dir"] == "out":
                ct.gain[after(at)] = -np.inf
            else:
                ct.gain[~after(at)] = -np.inf
        elif typ == "eq" and ct:
            ln = float(mv["len"])
            for b in _BANDS[mv["band"]]:
                lane = ct.eq[b]
                before = lane[m < at]
                v0 = float(before[-1]) if len(before) else 0.0
                sel = within(at, ln)
                if ln > 0:
                    lane[sel] = ramp_db(None if not np.isfinite(v0) else v0, mv["to_db"],
                                        (m[sel] - at) / ln, mv["curve"])
                lane[after(at + ln)] = -np.inf if mv["to_db"] is None else float(mv["to_db"])
        elif typ == "filter" and ct:
            (ct.hp if mv["kind"] == "hp" else ct.lp)[after(at)] = True
        elif typ == "swap":
            sel = after(at)
            for cid, val in [(c, -np.inf) for c in mv["out"]] + [(c, 0.0) for c in mv["in"]]:
                if cid not in tracks:
                    continue
                if mv["band"] == "all":
                    tracks[cid].gain[sel] = val
                else:
                    tracks[cid].eq[mv["band"]][sel] = val
        elif typ == "vacuum":
            keep = set(mv.get("keep", []))
            sel = within(at, float(mv["len"]))
            for cid in tracks:
                if cid not in keep:
                    win[cid][sel] = -np.inf
        elif typ == "trade":
            c0, c1 = mv["clips"]
            x = at
            for i, ln in enumerate(mv["lens"]):
                off = c1 if i % 2 == 0 else c0
                if off in win:
                    win[off][within(x, float(ln))] = -np.inf
                x += float(ln)
        elif typ == "gate":
            c0, c1 = mv["clips"]
            q = 1.0 / 4                                  # 16 steps per 4/4 bar = 1/4 beat each
            for bar, pat in enumerate(mv["steps"]):
                for k, ch in enumerate(pat):
                    s0 = at + bar * bpb + k * q
                    sel = within(s0, q)
                    for cid, on in ((c0, ch == "A"), (c1, ch == "B")):
                        if cid in win and not on:
                            win[cid][sel] = -np.inf
        elif typ in ("roll", "loop") and ct:
            ln = (sum(float(c) for _, c in mv["sizes"]) if typ == "roll"
                  else float(mv["size"]) * int(mv["count"]))
            ct.moved[within(at, ln)] = True
            st.reaches.append((typ, ct.clip["id"], at, at + ln))
            if typ == "roll":
                x = at
                for size, cov in mv["sizes"]:
                    if float(size) < 0.5:
                        win[ct.clip["id"]][within(x, float(cov))] += float(mv.get("taper_db", -3.0))
                    x += float(cov)
        elif typ == "echo" and ct:
            st.reaches.append((typ, ct.clip["id"], at, at + float(mv["capture"])))
        elif typ == "jump" and ct:
            st.reaches.append((typ, ct.clip["id"], at, at + 1e-6))
        elif typ in GESTURE_MOVES and ct:
            if typ == "backspin":
                end = float(mv["end_by"])
                ct.gain[after(end)] = -np.inf
            elif typ == "rewind":
                end = at + float(mv["len"])
                win[ct.clip["id"]][within(end, float(mv["gap"]))] = -np.inf
            else:
                end = at + float(mv["len"])
                if typ == "tape_stop":
                    ct.gain[after(end)] = -np.inf
                if typ == "reverse" and "gain_db" in mv:
                    win[ct.clip["id"]][within(at, end - at)] += float(mv["gain_db"])
                if typ == "reverse" and "hp_hz" in mv:
                    ct.hp[within(at, end - at)] = True
            sel = within(at, end - at)
            ct.moved[sel] = True
            ct.rate[sel] = True
            st.reaches.append((typ, ct.clip["id"], at, end))
            st.gestures.append((typ, ct.clip["id"], at, end))
    for cid, ct in tracks.items():
        ct.gain = ct.gain + win[cid]
    # hand lanes last: they replace the lane between their first and last knot
    for cid, lanes in (comp.get("lanes") or {}).items():
        ct = tracks.get(cid)
        if not ct:
            continue
        for param, knots in lanes.items():
            if not knots:
                continue
            k0, k1 = min(float(k[0]) for k in knots), max(float(k[0]) for k in knots)
            sel = (m >= k0) & (m <= k1)
            if param == "gain":
                ct.gain[sel] = eval_knots(knots, m[sel], "db")
            elif param.startswith("eq_"):
                ct.eq[param[3:]][sel] = eval_knots(knots, m[sel], "db")
            elif param in ("hp", "lp"):
                (ct.hp if param == "hp" else ct.lp)[sel] = ~np.isnan(eval_knots(knots, m[sel], "hz"))
            elif param == "pos":
                ct.moved[sel] = True
    return st


# ---------------------------------------------------------------------------------------------
# composition validation (§8.9)
# ---------------------------------------------------------------------------------------------
def _src_seconds(comp: dict, clip: dict, m: np.ndarray, t: np.ndarray, F: dict | None) -> np.ndarray | None:
    """Default-pos source seconds of `clip` at master beats m (clock seconds t)."""
    ref = comp["a_ref"] if clip["src"] == "a" else comp["b_ref"] if clip["src"] == "b" else None
    if ref is None:
        return None
    ref_t = ref["exit_t"] if clip["src"] == "a" else ref["land_t"]
    period = ref.get("period_s")
    if period is None:
        if F is None:
            return None
        period = 60.0 / float(F["bpm"])
    if clip["warp"] == "native":
        t_at = float(clock_seconds(comp["clock"], [clip["at"]])[0])
        return ref_t + clip["u0"] * period + (t - t_at)
    return ref_t + (clip["u0"] + (m - clip["at"]) * clip["ratio"]) * period


def _percussive(comp: dict, ct: ClipTrack, st: Static, F: dict | None, warped: bool) -> np.ndarray:
    """§8.9.8 percussive clip classes. mix counts unless Feats show the covered source bars are
    nobass-nodrums (perc_db < -6 and low_db <= -15: the lead that §7 layers without R4); high
    counts where perc_db >= -6 (always without Feats); other/top count on a warped track."""
    stem = ct.clip["stem"]
    n = len(st.m)
    names = clip_stems(stem)
    if isinstance(names, list):
        return np.full(n, "drums" in names or ("other" in names and warped))
    if stem == "low":
        return np.ones(n, bool)
    s = _src_seconds(comp, ct.clip, st.m, st.t, F) if F is not None else None
    if s is None:
        return np.ones(n, bool)
    bt = np.asarray(F["bars"]["t"], float)
    i = np.clip(np.searchsorted(bt, s, side="right") - 1, 0, len(bt) - 1)
    perc = np.asarray(F["bars"]["perc_db"], float)[i] >= CFG["highlight"]["nodrums_perc_db"]
    if stem == "high":
        return perc
    low = np.asarray(F["bars"]["low_db"], float)[i] > CFG["highlight"]["nobass_low_db"]
    return perc | low


def _runs(mask: np.ndarray, m: np.ndarray, h: float) -> list[tuple[float, float]]:
    """[m0, m1) runs where mask is true."""
    if not mask.any():
        return []
    d = np.diff(np.concatenate([[0], mask.astype(int), [0]]))
    return [(float(m[a] - h / 2), float(m[b - 1] + h / 2)) for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0])]


def _fmt_runs(r: list[tuple[float, float]]) -> str:
    return ", ".join(f"[{a:g}, {b:g})" for a, b in r[:3]) + (" ..." if len(r) > 3 else "")


def validate_composition(comp: Any, fa: dict | None = None, fb: dict | None = None,
                         check_hash: bool = True) -> list[Issue]:
    """All §8.9 rules plus structure. fa/fb (Feats of A and B) refine the percussive classes of
    rule 8; without them mix/high clips count as percussive. Returns [] when valid."""
    out = _Out()
    _check(comp, Composition, "", out)
    if not isinstance(comp, dict) or any(
            i.code in ("FIELD_MISSING", "FIELD_TYPE", "FIELD_VALUE", "NOT_JSON") and
            i.path.split(".")[0].split("[")[0] in ("span", "clock", "clips", "moves", "rel", "bpb",
                                                   "lanes", "events", "a_ref", "b_ref", "form")
            for i in out):
        return list(out)                                # too broken to evaluate the rules
    L = CFG["limits"]
    slack = float(L["knot_slack_beats"])
    f, to = float(comp["span"]["from"]), float(comp["span"]["to"])
    bpb = int(comp["bpb"])
    rel = comp["rel"]
    clips = {c["id"]: c for c in comp["clips"]}

    # identity
    if check_hash:
        h = comp.get("hash", "")
        if not (isinstance(h, str) and len(h) == 16 and all(ch in "0123456789abcdef" for ch in h)):
            out.add("HASH_FORMAT", "hash", repr(h))
        elif h != canonical_hash(comp):
            out.add("HASH_MISMATCH", "hash", f"{h} != {canonical_hash(comp)}")
    if comp["form"] in FORM_TIER:
        if comp["tier"] != tier_of(comp["form"], comp["variant"]):
            out.add("TIER_MISMATCH", "tier", f"{comp['tier']} for {comp['form']} {comp['variant']}")
        if comp["loud"] != is_loud(comp["form"], comp["variant"]):
            out.add("LOUD_MISMATCH", "loud", f"{comp['loud']} for {comp['form']} {comp['variant']}")
    if (rel["kind"] == "double") != (rel["a_ratio"] in (2, 0.5)):
        out.add("REL_RATIO", "rel.a_ratio", f"{rel['a_ratio']} with kind {rel['kind']}")
    if not (f <= 0 <= to and f < to):
        out.add("SPAN_ORDER", "span", f"[{f}, {to}]")
        return list(out)

    # clips
    if len(clips) != len(comp["clips"]):
        out.add("ID_DUP", "clips", "duplicate clip id")
    for i, c in enumerate(comp["clips"]):
        p = f"clips[{i}]"
        if c["src"] == "b" and (c["warp"] != "native" or c["ratio"] != 1):
            out.add("B_WARP", p, f"B clip {c['id']} warp {c['warp']} ratio {c['ratio']}")
        if c["ratio"] != 1 and not (c["src"] == "a" and rel["kind"] == "double"):
            out.add("CLIP_RATIO", p, f"ratio {c['ratio']} on {c['src']} in a {rel['kind']} join")
        if c["len"] <= 0 or c["at"] < f - slack or c["at"] + c["len"] > to + slack:
            out.add("CLIP_RANGE", p, f"[{c['at']}, {c['at'] + c['len']}) vs span [{f}, {to}]")
        if isinstance(c["stem"], list) and (not c["stem"] or len(set(c["stem"])) != len(c["stem"])):
            out.add("FIELD_VALUE", f"{p}.stem", "stem list empty or repeated")

    # moves: references, ranges, per-type parameter rules
    for i, mv in enumerate(comp["moves"]):
        p = f"moves[{i}]"
        refs = [mv.get("clip")] + list(mv.get("clips", [])) + list(mv.get("out", [])) \
            + list(mv.get("in", [])) + list(mv.get("keep", []))
        if mv.get("type") == "duck":
            refs.append(mv.get("key"))
        if isinstance(mv.get("duck"), dict):
            refs.append(mv["duck"].get("key"))
        for r in refs:
            if r is not None and r not in clips:
                out.add("CLIP_REF", p, f"unknown clip {r!r}")
        at = mv.get("at")
        if _is_num(at) and not (f - slack <= at <= to + slack):
            out.add("MOVE_RANGE", p, f"at {at} outside [{f}, {to}]")
        typ = mv.get("type")
        if typ in ("backspin", "tape_stop") and clips.get(mv.get("clip"), {}).get("src") != "a":
            out.add("MOVE_SRC", p, f"{typ} on a non-A clip")
        if typ == "fade" and mv.get("shape") == "steps" and "step_bars" not in mv:
            out.add("MOVE_PARAM", p, "steps fade needs step_bars")
        if typ == "fade" and mv.get("shape") == "pulse" and "pattern" not in mv:
            out.add("MOVE_PARAM", p, "pulse fade needs pattern")
        if typ == "gate":
            if mv["len"] != len(mv["steps"]) * bpb or any(len(s) != 4 * bpb or set(s) - set("AB.")
                                                           for s in mv["steps"]):
                out.add("MOVE_PARAM", p, f"gate needs len/bpb strings of {4 * bpb} steps from 'AB.'")
        if typ == "trade" and any(ln <= 0 for ln in mv["lens"]):
            out.add("MOVE_PARAM", p, "trade lens must be > 0")
        if typ == "backspin" and mv["end_by"] > float(L["backspin_end_by_max"]) + 1e-9:
            out.add("MOVE_PARAM", p, f"end_by {mv['end_by']} > {L['backspin_end_by_max']}")
    if any(i.code == "CLIP_REF" for i in out):
        return list(out)

    # events
    for i, ev in enumerate(comp["events"]):
        if not (f - slack <= ev[0] <= ev[1] <= to + slack):
            out.add("EVENT_RANGE", f"events[{i}]", f"{ev[0]}..{ev[1]}")

    # 5. lanes: knots sorted and in range
    for cid, lanes in (comp.get("lanes") or {}).items():
        if cid not in clips:
            out.add("CLIP_REF", f"lanes.{cid}", "unknown clip")
            continue
        for param, knots in lanes.items():
            p = f"lanes.{cid}.{param}"
            xs = [k[0] for k in knots]
            if param == "pos" and any(k[1] is None for k in knots):
                out.add("KNOT_FORMAT", p, "pos knots are never null")
            if any(b < a for a, b in zip(xs, xs[1:])):
                out.add("KNOT_ORDER", p, "knots not sorted by m")
            if any(x < f - slack or x > to + slack for x in xs):
                out.add("KNOT_RANGE", p, f"knot outside [{f - slack}, {to + slack}]")

    # 1. clock
    _check_clock(comp, out)
    if any(i.code in ("CLOCK_EMPTY", "CLOCK_ORDER", "CLOCK_GAP", "CLOCK_COVER") for i in out):
        return list(out)
    st = static_eval(comp)
    ramps = [s for s in comp["clock"] if s["kind"] == "ramp"]
    for s in ramps:
        sel = st.window(s["m0"], s["m1"])
        for cid, ct in st.clips.items():
            if ct.clip["src"] == "b" and (ct.audible & sel).any():
                out.add("RAMP_B_AUDIBLE", f"clips.{cid}",
                        f"audible in ramp [{s['m0']}, {s['m1']}): {_fmt_runs(_runs(ct.audible & sel, st.m, st.h))}")

    # 3./4. span edges (a full mix: one mix clip, or stem clips partitioning all four stems)
    _check_edge(comp, st, "a", st.window(f, f + bpb), "SPAN_START", out)
    _check_edge(comp, st, "b", st.window(to - 1, to), "SPAN_END", out)

    # 6. gestures and reaches
    for typ, cid, m0, m1 in st.gestures:
        cap = {"rewind": L["rewind_max_beats"], "scratch": L["scratch_max_beats"], "tape_stop": bpb,
               "reverse": L["reverse_max_beats"]}.get(typ, L["gesture_max_beats"])
        if m1 - m0 > min(float(cap), float(L["gesture_max_beats"])) + 1e-9:
            out.add("GESTURE_LEN", f"clips.{cid}", f"{typ} lasts {m1 - m0:g} beats > {cap}")
    for typ, cid, m0, m1 in st.reaches:
        c = clips[cid]
        own = {"a": ("a_fit", "a_refined"), "b": ("b_fit", "b_refined"), "motif": CLOCK_KINDS}[c["src"]]
        if c["src"] == "a" and c["warp"] == "r2":
            own = own + ("b_fit",)
        segs = [s for s in comp["clock"] if s["m0"] < m1 - 1e-9 and s["m1"] > m0 + 1e-9]
        bpms = {round(float(s["bpm0"]), 6) for s in segs} | {round(float(s["bpm1"]), 6) for s in segs}
        if any(s["kind"] not in own for s in segs) or len(bpms) > 1:
            out.add("GESTURE_CLOCK", f"clips.{cid}",
                    f"{typ} [{m0:g}, {m1:g}) over {[s['kind'] for s in segs]}")

    # 7. tempo step at m = 0, and the echo tail rule
    step = _step_at_zero(comp)
    if step:
        _check_step(comp, st, step, out)
    _check_echoes(comp, st, out)

    # 8. static R4
    warped = {src: any(c["src"] == src and c["warp"] == "r2" for c in comp["clips"]) for src in ("a", "b")}
    feats = {"a": fa, "b": fb}
    perc = {}
    for cid, ct in st.clips.items():
        src = ct.clip["src"]
        hot = ct.audible & (ct.level >= float(L["perc_db"]))
        perc[cid] = hot & _percussive(comp, ct, st, feats.get(src), warped.get(src, False))
    srcs = sorted({ct.clip["src"] for ct in st.clips.values()})
    by_src = {s: np.any([perc[c] for c, ct in st.clips.items() if ct.clip["src"] == s], axis=0)
              for s in srcs}
    both = np.sum([by_src[s] for s in srcs], axis=0) >= 2 if len(srcs) > 1 else np.zeros(len(st.m), bool)
    if comp["form"] in CREATION_FORMS:
        _check_one_kit(comp, st, out)
        both = np.zeros(len(st.m), bool)
    for i, c in enumerate(comp["clips"]):
        if "pitch" in c and (c["src"] != "a" or c["warp"] != "r2"):
            out.add("PITCH_B", f"clips[{i}]", f"pitch on {c['src']} clip {c['id']} ({c['warp']})")
    if both.any():
        r4 = (rel["kind"] in ("lock", "double") and rel["a_class"] == "locked"
              and rel["b_class"] == "locked"
              and abs(float(rel["stretch_pct"])) <= float(CFG["layer_perc_max_pct"]) + 1e-9)
        if not r4:
            out.add("R4_OVERLAP", "clips",
                    f"percussive overlap {_fmt_runs(_runs(both, st.m, st.h))} with rel {rel['kind']} "
                    f"{rel['a_class']}/{rel['b_class']} {rel['stretch_pct']} %")

    # 9. R10
    for src in ("a", "b"):
        mine = [c for c in comp["clips"] if c["src"] == src]
        if warped[src] and any(uses_stems(c["stem"]) for c in mine) and \
                not all(uses_stems(c["stem"]) for c in mine):
            out.add("R10_MIXED", "clips", f"warped {src} mixes stems with {[c['stem'] for c in mine]}")

    # 10. size
    if to - f > float(L["max_span_beats"]) + 1e-9:
        out.add("SIZE_SPAN", "span", f"{to - f:g} beats > {L['max_span_beats']}")
    T = float(clock_seconds(comp["clock"], [to])[0])
    if T > float(L["max_T_s"]) + 1e-9:
        out.add("SIZE_T", "clock", f"T = {T:.3f} s > {L['max_T_s']}")
    return list(out)


KIT_STEMS = ("drums",)
KIT_PSEUDO = ("mix", "bed", "low", "high")
BASS_PSEUDO = ("mix", "bed", "low")


def carries(stem: Any, what: str) -> bool:
    """Does a clip stem carry `what` ("drums" | "bass")? mix / bed / low (and high for drums: hats)
    count; stem lists by name."""
    if isinstance(stem, str) and stem in PSEUDO_NO_STEMS + ("top", "bed"):
        return stem in (KIT_PSEUDO if what == "drums" else BASS_PSEUDO)
    return what in clip_stems(stem)


def source_masks(comp: dict, st: "Static", what: str, db: float | None = None) -> dict[str, np.ndarray]:
    """{src: steps where a clip of src carrying `what` is audible above db (default limits.perc_db)}."""
    thr = float(CFG["limits"]["perc_db"]) if db is None else db
    out: dict[str, np.ndarray] = {}
    for cid, ct in st.clips.items():
        if not carries(ct.clip["stem"], what):
            continue
        hot = ct.audible & (ct.level >= thr)
        src = ct.clip["src"]
        out[src] = out.get(src, np.zeros(len(st.m), bool)) | hot
    return out


def _check_one_kit(comp: dict, st: "Static", out: _Out) -> None:
    """Creation forms: one drum kit and one bassline at any instant (statically, at the static
    step; a swap or trade switch is instantaneous here). Tolerance: creation.static_overlap_beats."""
    tol = float(CFG["creation"]["static_overlap_beats"])
    for what, code in (("drums", "KIT_OVERLAP"), ("bass", "BASS_OVERLAP")):
        m = source_masks(comp, st, what)
        if len(m) < 2:
            continue
        both = m.get("a", False) & m.get("b", False)
        if both.sum() * st.h > tol + 1e-9:
            out.add(code, "clips", f"{what} of A and B together {_fmt_runs(_runs(both, st.m, st.h))}")


def _check_clock(comp: dict, out: _Out) -> None:
    L = CFG["limits"]
    segs = comp["clock"]
    f, to = float(comp["span"]["from"]), float(comp["span"]["to"])
    if not segs:
        out.add("CLOCK_EMPTY", "clock")
        return
    for i, s in enumerate(segs):
        p = f"clock[{i}]"
        if s["m1"] <= s["m0"]:
            out.add("CLOCK_ORDER", p, f"m1 {s['m1']} <= m0 {s['m0']}")
        if s["bpm0"] <= 0 or s["bpm1"] <= 0 or (s["kind"] != "ramp" and s["bpm0"] != s["bpm1"]):
            out.add("CLOCK_BPM", p, f"{s['kind']} {s['bpm0']} -> {s['bpm1']}")
        if i and abs(s["m0"] - segs[i - 1]["m1"]) > 1e-9:
            out.add("CLOCK_GAP", p, f"m0 {s['m0']} != previous m1 {segs[i - 1]['m1']}")
    if abs(segs[0]["m0"] - f) > 1e-9 or abs(segs[-1]["m1"] - to) > 1e-9:
        out.add("CLOCK_COVER", "clock", f"[{segs[0]['m0']}, {segs[-1]['m1']}] vs span [{f}, {to}]")
    ramp_pct, (rb0, rb1) = float(CFG["ramp_pct_per_bar"]), CFG["ramp_bars"]
    bpb = int(comp["bpb"])
    for i, s in enumerate(segs):
        p = f"clock[{i}]"
        k = s["kind"]
        if (k.startswith("a_") or k == "ramp") and s["m1"] > 1e-9:
            out.add("CLOCK_KIND", p, f"{k} after the landing (A's clock and ramps end by m = 0)")
        if k in ("a_fit", "b_fit"):
            ref = comp["a_ref"] if k == "a_fit" else comp["b_ref"]
            per = ref.get("period_s")
            # master beats are B's: in a double join A's fit runs a_ratio source beats per master beat
            want = None if per is None else 60.0 / per / (comp["rel"]["a_ratio"] if k == "a_fit" else 1)
            if want is None:
                out.add("CLOCK_FIT_BPM", p, f"{k} needs {k[0]}_ref.period_s")
            elif abs(want - s["bpm0"]) > float(L["fit_bpm_tol"]):
                out.add("CLOCK_FIT_BPM", p, f"bpm0 {s['bpm0']} vs 60/period {want:.4f}")
        if k == "ramp":
            bars = (s["m1"] - s["m0"]) / bpb
            pct = abs(s["bpm1"] / s["bpm0"] - 1) * 100
            if pct / bars > ramp_pct + 1e-9:
                out.add("RAMP_SLOPE", p, f"{pct / bars:.3f} %/bar > {ramp_pct}")
            if not (rb0 - 1e-9 <= bars <= rb1 + 1e-9):
                out.add("RAMP_LEN", p, f"{bars:g} bars outside {rb0}..{rb1}")
    step_ok = _step_allowed(comp)
    for i in range(1, len(segs)):
        a, b = segs[i - 1], segs[i]
        if abs(a["bpm1"] - b["bpm0"]) > float(L["bpm_cont_tol"]):
            if not (abs(b["m0"]) < 1e-9 and step_ok):
                out.add("CLOCK_JUMP", f"clock[{i}]", f"{a['bpm1']} -> {b['bpm0']} at m = {b['m0']}")


def _step_allowed(comp: dict) -> bool:
    """A tempo step at m = 0 is allowed in free joins, double-fallback joins (double relation but
    not half_time) and any-tempo (slam) forms, which keep A's own clock up to the landing."""
    rel = comp["rel"]["kind"]
    return rel == "free" or (rel == "double" and comp["form"] != "half_time") or \
        comp["form"] in ANY_TEMPO_FORMS


def _step_at_zero(comp: dict) -> dict | None:
    """The segment left of m = 0 when the clock hands over from A's clock to B's at m = 0."""
    segs = comp["clock"]
    for i in range(1, len(segs)):
        if abs(segs[i]["m0"]) < 1e-9 and segs[i - 1]["kind"].startswith("a_") \
                and segs[i]["kind"].startswith("b_"):
            return segs[i - 1]
    return None


def _check_edge(comp: dict, st: Static, src: str, sel: np.ndarray, code: str, out: _Out) -> None:
    """Rules 3/4. "ratio 1" is read as unity time-stretch: A's clip ratio equals rel.a_ratio
    (2 or 0.5 only in double joins) and, when warped, the clock there is A's own fitted clock."""
    aud = {cid: ct for cid, ct in st.clips.items() if (ct.audible & sel).any()}
    others = [cid for cid, ct in aud.items() if ct.clip["src"] != src]
    mine = [ct for ct in aud.values() if ct.clip["src"] == src]
    where = "start" if code == "SPAN_START" else "end"
    if others:
        out.add(code, "clips", f"{others} audible at the span {where}")
    if not mine:
        out.add(code, "clips", f"no {src.upper()} clip audible at the span {where}")
        return
    stems = [clip_stems(ct.clip["stem"]) for ct in mine]
    full = (len(mine) == 1 and stems[0] == "mix") or (
        all(isinstance(s, list) for s in stems) and sorted(sum(stems, [])) == sorted(STEM_NAMES))
    if not full:
        out.add(code, "clips", f"{src.upper()} at the span {where} is {[ct.clip['stem'] for ct in mine]}, "
                               "not one mix clip or a partition of the four stems")
    for ct in mine:
        c = ct.clip
        bad = []
        if not ct.audible[sel].all():
            bad.append("not audible throughout")
        if np.abs(ct.level[sel]).max(initial=0) > 1e-6 or not np.isfinite(ct.level[sel]).all():
            bad.append("gain != 0 dB")
        if any(np.abs(ct.eq[b][sel]).max(initial=0) > 1e-6 or not np.isfinite(ct.eq[b][sel]).all()
               for b in ("low", "mid", "high")):
            bad.append("EQ")
        if (ct.hp | ct.lp)[sel].any():
            bad.append("filter")
        if not ct.locked[sel].all():
            bad.append("not locked")
        seg0 = comp["clock"][0]["kind"]
        if src == "b" and (c["ratio"] != 1 or c["warp"] != "native"):
            bad.append(f"ratio {c['ratio']} warp {c['warp']}")
        if src == "a" and (c["ratio"] != comp["rel"]["a_ratio"] or (c["warp"] == "r2" and not seg0.startswith("a_"))):
            bad.append(f"ratio {c['ratio']} warp {c['warp']} on a {seg0} clock (not unity stretch)")
        if bad:
            out.add(code, f"clips.{c['id']}", ", ".join(bad))


def _check_step(comp: dict, st: Static, seg_a: dict, out: _Out) -> None:
    """Rule 7: at a step, A must be silent (as a locked clip) from t(0) - max(1/4 A beat, pickup)
    and entirely after the landing (only echo tails continue)."""
    beat_a = 60.0 / float(seg_a["bpm1"])
    t_land = float(clock_seconds(comp["clock"], [0.0])[0])
    first_b = [st.m[ct.audible & ct.locked & (st.m < 0)] for ct in st.clips.values() if ct.clip["src"] == "b"]
    first_b = [float(x[0] - st.h / 2) for x in first_b if len(x)]
    pickup_s = t_land - float(clock_seconds(comp["clock"], [min(first_b)])[0]) if first_b else 0.0
    m_lim = -max(0.25, pickup_s / beat_a)
    for cid, ct in st.clips.items():
        if ct.clip["src"] != "a":
            continue
        late = ct.audible & ct.locked & (st.m >= m_lim) & (st.m < 0)
        if late.any():
            out.add("STEP_A_AUDIBLE", f"clips.{cid}",
                    f"locked A audible {_fmt_runs(_runs(late, st.m, st.h))}, limit m = {m_lim:.3f}")
        after = ct.audible & (st.m >= 0)
        if after.any():
            out.add("STEP_A_AFTER", f"clips.{cid}", f"A audible {_fmt_runs(_runs(after, st.m, st.h))}")


def _check_echoes(comp: dict, st: Static, out: _Out) -> None:
    """§9 tail rule: fb <= min(echo_fb_max, 10^((-20 - send_db) * delay / (20 * D))), D = seconds
    from the throw (at + capture) to B's second beat (m = 1), delay in seconds of the throw's clock."""
    fb_max = float(CFG["echo_fb_max"])
    floor = float(CFG["tail_floor_db"])
    for i, mv in enumerate(comp["moves"]):
        if mv.get("type") != "echo":
            continue
        throw = float(mv["at"]) + float(mv["capture"])
        t_throw, t_b2 = clock_seconds(comp["clock"], [throw, 1.0])
        seg = next((s for s in comp["clock"] if s["m0"] <= throw < s["m1"]), comp["clock"][-1])
        delay_s = float(mv["delay"]) * 60.0 / float(seg["bpm0"])
        dt = float(t_b2 - t_throw)
        bound = fb_max if dt <= 0 else min(fb_max, 10 ** ((floor - float(mv["send_db"])) * delay_s / (20 * dt)))
        if float(mv["fb"]) > bound + 1e-9:
            out.add("ECHO_FB", f"moves[{i}]", f"fb {mv['fb']} > bound {bound:.4f}")


# ---------------------------------------------------------------------------------------------
# plan, feats, program and checks validation
# ---------------------------------------------------------------------------------------------
def validate_plan(plan: Any, deep: bool = True, feats: dict[str, dict] | None = None) -> list[Issue]:
    """SessionPlanMedley structure and cross-field consistency; with deep=True every
    transition's composition is validated too (feats: {track id: Feats} for rule 8)."""
    out = _Out()
    _check(plan, SessionPlanMedley, "", out)
    if not isinstance(plan, dict) or any(i.code in ("FIELD_MISSING", "FIELD_TYPE") and i.path.count(".") == 0
                                         for i in out):
        return list(out)
    order, trs, ns = plan["order"], plan["transitions"], plan["native_starts"]
    meta = plan["medley"]
    if plan.get("kind") != "medley" or meta.get("schema") != SCHEMA_ID:
        out.add("PLAN_KIND", "kind", f"{plan.get('kind')} / {meta.get('schema')}")
    ex = meta["excerpts"]
    if len(trs) != max(0, len(order) - 1) or len(ns) != len(order) or len(ex) != len(order):
        out.add("PLAN_LEN", "", f"order {len(order)}, transitions {len(trs)}, native_starts {len(ns)}, "
                                f"excerpts {len(ex)}")
        return list(out)
    for i, (o, e) in enumerate(zip(order, ex)):
        if e["track"] != o["id"]:
            out.add("PLAN_ALIGN", f"medley.excerpts[{i}]", f"{e['track']} != order {o['id']}")
    tiers = {t: 0 for t in TIERS}
    for i, tr in enumerate(trs):
        p = f"transitions[{i}]"
        a, b = order[i]["id"], order[i + 1]["id"]
        if (tr["index"], tr["a"], tr["b"], tr["key"]) != (i, a, b, f"{a}>{b}"):
            out.add("PLAN_ALIGN", p, f"index/a/b/key {tr['index']} {tr['key']} vs {a}>{b}")
        if abs(ns[i + 1] - tr["b_in_end"]) > 1e-6:
            out.add("PLAN_NATIVE", f"native_starts[{i + 1}]", f"{ns[i + 1]} != b_in_end {tr['b_in_end']}")
        if tr["override"]:
            out.add("PLAN_COMPAT", f"{p}.override", "must be {}")
        tiers[tr["tier"]] = tiers.get(tr["tier"], 0) + 1
        # R9: the native solo of track i+1 between this join's B-in end and the next join's A-out
        if i + 1 < len(trs):
            e = ex[i + 1]
            bar_s = e["bpb"] * 60.0 / e["bpm"]
            need = max(CFG["min_solo_bars"] * bar_s, CFG["min_solo_s"])
            solo = trs[i + 1]["a_out_start"] - tr["b_in_end"]
            if solo < need - 1e-6:
                out.add("PLAN_SOLO", f"transitions[{i + 1}].a_out_start", f"solo {solo:.2f} s < {need:.2f} s")
        comp = tr.get("composition")
        if comp is None:
            continue
        rk = comp.get("rel", {}).get("kind")
        mismatch = [k for k in ("form", "variant", "tier", "b_in", "a", "b") if tr.get(k) != comp.get(k)]
        if tr["beatmatch"] != (rk in ("lock", "double")):
            mismatch.append("beatmatch")
        if isinstance(comp.get("clock"), list) and comp["clock"] and isinstance(comp.get("span"), dict):
            try:
                t0, t_land, t1 = clock_seconds(comp["clock"], [comp["span"]["from"], 0.0, comp["span"]["to"]])
                if abs(tr["T"] - (t1 - t0)) > 1e-3:
                    mismatch.append(f"T {tr['T']} vs clock {t1 - t0:.4f}")
                if abs(tr["T_overlap"] - (t_land - t0)) > 1e-3:
                    mismatch.append(f"T_overlap {tr['T_overlap']} vs clock {t_land - t0:.4f}")
            except (KeyError, TypeError, ValueError):
                pass
        if isinstance(comp.get("a_ref"), dict) and abs(tr["exit_s"] - comp["a_ref"].get("exit_t", tr["exit_s"])) > 1e-6:
            mismatch.append("exit_s")
        if isinstance(comp.get("b_ref"), dict) and abs(tr["land_s"] - comp["b_ref"].get("land_t", tr["land_s"])) > 1e-6:
            mismatch.append("land_s")
        if mismatch:
            out.add("PLAN_COMPAT", p, ", ".join(mismatch))
        if deep:
            fs = feats or {}
            for iss in validate_composition(comp, fs.get(a), fs.get(b)):
                out.add(iss.code, f"{p}.composition.{iss.path}", iss.detail)
    stats = meta["stats"]
    if stats["songs"] != len(order) or sum(stats["tiers"].values()) != len(trs) or \
            any(stats["tiers"].get(t, 0) != n for t, n in tiers.items()):
        out.add("PLAN_STATS", "medley.stats", f"songs {stats['songs']}, tiers {stats['tiers']} vs {tiers}")
    return list(out)


def validate_feats(F: Any) -> list[Issue]:
    """Feats structure (numpy arrays allowed for list fields) and internal consistency."""
    out = _Out()
    _check(F, Feats, "", out, arrays=True)
    if not isinstance(F, dict) or any(i.code in ("FIELD_MISSING", "FIELD_TYPE") for i in out):
        return list(out)
    if F["version"] != FEATS_VERSION:
        out.add("FEATS_VERSION", "version", f"{F['version']} != {FEATS_VERSION}")
    bt = np.asarray(F["beats"]["t"], float)
    nbeat = len(bt)
    for k in ("refined", "pos", "vox_db", "vox_stem_db"):
        if k in F["beats"] and len(F["beats"][k]) != nbeat:
            out.add("FEATS_LEN", f"beats.{k}", f"{len(F['beats'][k])} != {nbeat}")
    if nbeat < 2 or np.any(np.diff(bt) <= 0):
        out.add("FEATS_ORDER", "beats.t", "beat times must be strictly ascending")
    bars = F["bars"]
    nbar = len(bars["t"])
    for k in ("beat", "rel_db", "low_db", "perc_db", "vox_db", "chroma", "label", "peak_db", "vox_run_s"):
        if k in bars and len(bars[k]) != nbar:
            out.add("FEATS_LEN", f"bars.{k}", f"{len(bars[k])} != {nbar}")
    for k, v in (bars.get("stem_rms") or {}).items():
        if len(v) != nbar:
            out.add("FEATS_LEN", f"bars.stem_rms.{k}", f"{len(v)} != {nbar}")
    if bool(F["stems"]) != ("stem_rms" in bars):
        out.add("FEATS_VALUE", "stems", "stems flag must match bars.stem_rms presence")
    if any(len(c) != 12 for c in bars["chroma"]):
        out.add("FEATS_LEN", "bars.chroma", "chroma rows must have 12 values")
    bi = np.asarray(bars["beat"], int)
    if len(bi) and (bi.min() < 0 or bi.max() >= nbeat):
        out.add("FEATS_ORDER", "bars.beat", "beat index out of range")
    elif len(bi) and not np.allclose(bt[bi], np.asarray(bars["t"], float), atol=1e-6):
        out.add("FEATS_ORDER", "bars.t", "bars.t must equal beats.t[bars.beat]")
    elif len(bi) and np.any(np.asarray(F["beats"]["pos"])[bi] != 0):
        out.add("FEATS_ORDER", "beats.pos", "bar downbeats must have pos 0")
    if not (0 <= F["last_loud_bar"] < max(nbar, 1)):
        out.add("FEATS_ORDER", "last_loud_bar", str(F["last_loud_bar"]))
    if not (1 <= F["phrase"]["P"] and 0 <= F["phrase"]["phase"] < F["phrase"]["P"]):
        out.add("FEATS_VALUE", "phrase", str(F["phrase"]))
    ot = np.asarray(F["onsets"]["t"], float)
    if len(ot) != len(F["onsets"]["strength"]):
        out.add("FEATS_LEN", "onsets.strength", "onsets t/strength lengths differ")
    if len(ot) > 1 and np.any(np.diff(ot) < 0):
        out.add("FEATS_ORDER", "onsets.t", "onsets not ascending")
    allowed = set(CFG["body_bars_allowed"])
    lands = F["landings"]
    n_max = int(CFG["highlight"]["top_landings"]) + int(CFG["highlight"].get("arrival_extra", 0))
    if len(lands) > n_max:
        out.add("FEATS_VALUE", "landings", f"{len(lands)} landings > {n_max}")
    if any(b["h"] > a["h"] + 1e-9 for a, b in zip(lands, lands[1:])):
        out.add("FEATS_ORDER", "landings", "landings must be sorted best h first")
    for i, ld in enumerate(lands):
        p = f"landings[{i}]"
        if not (0 <= ld["bar"] < nbar):
            out.add("FEATS_ORDER", f"{p}.bar", str(ld["bar"]))
        for k, e in enumerate(ld["exits"]):
            if e["n"] not in allowed or e["bar"] != ld["bar"] + e["n"]:
                out.add("FEATS_VALUE", f"{p}.exits[{k}]", f"n {e['n']} bar {e['bar']}")
        if ld["exits"] and abs(ld["h"] - max(e["h"] for e in ld["exits"])) > 1e-6:
            out.add("FEATS_VALUE", f"{p}.h", "landing h must be the best exit h")
    return list(out)


def _knots_ok(knots: list, p: str, out: _Out) -> None:
    xs = []
    for k in knots:
        if not (isinstance(k, (list, tuple)) and len(k) == 3 and _is_num(k[0]) and
                (k[1] is None or _is_num(k[1])) and k[2] in CURVES):
            out.add("PROG_KNOTS", p, f"bad knot {k!r}")
            return
        xs.append(k[0])
    if any(b < a for a, b in zip(xs, xs[1:])):
        out.add("PROG_KNOTS", p, "knots not sorted")


def validate_program(prog: Any) -> list[Issue]:
    """Program (dataclass or its JSON dict) structure and consistency."""
    out = _Out()
    d = to_jsonable(prog) if dataclasses.is_dataclass(prog) else prog
    if not isinstance(d, dict):
        out.add("FIELD_TYPE", "", "program must be an object")
        return list(out)
    names = [f.name for f in dataclasses.fields(Program)]
    for k in names:
        if k not in d:
            out.add("FIELD_MISSING", k, "Program")
    for k in d:
        if k not in names:
            out.add("FIELD_UNKNOWN", k, "Program")
    if out:
        return list(out)
    _check_json(d, "", out)
    cm, ctt = d["clock_m"], d["clock_t"]
    if not cm or len(cm) != len(ctt) or any(b <= a for a, b in zip(cm, cm[1:])) or \
            any(b <= a for a, b in zip(ctt, ctt[1:])):
        out.add("PROG_CLOCK", "clock_m", "clock tables empty, unequal or not increasing")
    if not (_is_num(d["T"]) and d["T"] > 0 and _is_num(d["t_land"]) and 0 <= d["t_land"] <= d["T"] + 1e-9):
        out.add("FIELD_VALUE", "T", f"T {d['T']} t_land {d['t_land']}")
        return list(out)
    edge = d["xf"] / d["sr"] + 1e-6
    ids = set()
    for i, c in enumerate(d["clips"]):
        p = f"clips[{i}]"
        ids.add(c["id"])
        src = c["source"]
        if src.get("kind") == "native":
            if not (src["s1"] > src["s0"]):
                out.add("PROG_SOURCE", p, "s1 <= s0")
        elif src.get("kind") == "r2":
            sa, da = src["src_anchors"], src["dst_anchors"]
            if len(sa) != len(da) or len(sa) < 2 or any(b <= a for a, b in zip(sa, sa[1:])) or \
                    any(b <= a for a, b in zip(da, da[1:])) or abs(sa[0] - src["s0"]) > 1e-6 or \
                    abs(sa[-1] - src["s1"]) > 1e-6 or abs(da[0]) > 1e-6 or abs(da[-1] - src["w_len"]) > 1e-6:
                out.add("PROG_SOURCE", p, "r2 anchors must run s0..s1 -> 0..w_len, strictly increasing")
        else:
            out.add("PROG_SOURCE", p, f"source kind {src.get('kind')!r}")
        t_prev = -math.inf
        for k, seg in enumerate(c["pos"]):
            if seg["t1"] <= seg["t0"] or seg["t0"] < t_prev - 1e-9 or seg["t0"] < -edge or \
                    seg["t1"] > d["T"] + edge or seg["kind"] not in ("copy", "vary"):
                out.add("PROG_POS", f"{p}.pos[{k}]", f"[{seg['t0']}, {seg['t1']}) {seg['kind']}")
            t_prev = seg["t1"]
        _knots_ok(c["gain_db"], f"{p}.gain_db", out)
        for lane in ("hp_hz", "lp_hz"):
            if c[lane] is not None:
                _knots_ok(c[lane], f"{p}.{lane}", out)
        for band, kn in c["eq_db"].items():
            if band not in ("low", "mid", "high"):
                out.add("FIELD_VALUE", f"{p}.eq_db.{band}", "band")
            _knots_ok(kn, f"{p}.eq_db.{band}", out)
        if c["track_gain_from"] not in ("a", "b"):
            out.add("FIELD_VALUE", f"{p}.track_gain_from", c["track_gain_from"])
    for i, s in enumerate(d["splices"]):
        if s["clip"] not in ids:
            out.add("PROG_REF", f"splices[{i}]", s["clip"])
    for i, e in enumerate(d["echoes"]):
        if e["clip"] not in ids:
            out.add("PROG_REF", f"echoes[{i}]", e["clip"])
    exp = d["expect"]
    out.extend(i for i in check_type(exp, Expect, "expect") if len(out) < _Out.CAP)
    return list(out)


def validate_checks(checks: Any) -> list[Issue]:
    out = _Out()
    _check(checks, Checks, "", out)
    if isinstance(checks, dict) and "status" in checks and "fail" in checks and not out:
        if (checks["status"] == "fail") != bool(checks["fail"]):
            out.add("CHECKS_STATUS", "status", f"{checks['status']} with fail {checks['fail']}")
    return list(out)


__all__ = [n for n in dir() if not n.startswith("_")]
