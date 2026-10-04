"""Build and verify a medley (DESIGN §16.2, §17.4): render every join, verify it, walk the
fallback ladder, then render the whole MP3 with chapters and write the report.

Two hosts use this module: the CLI (`automix medley build`, through `CliSession`, which is
read-only and never writes session.json) and, in Phase 2, the page's Session. A host
("session_like") provides:
    audio                AudioCache (.get(path) -> (n, 2) float32)
    mfeats               FeatStore (.get(track) -> Feats)
    stems, warp_cache    StemStore / engine.WarpCache (or None)
    state["params"]      automix params (or a .params attribute)
    plan()               the medley plan (SessionPlanMedley); it must re-plan when the verify
                         store's version changes (§11.4: failed hashes, bad landings)
    order_tracks(plan)   order track dicts with the excerpt gain folded into `lufs` (§15)
    verify_store(set_id) VerifyStore (or a .store attribute)
and optionally `engine` (render_join, compile_join, render_program) and `hooks` (Hooks).

The ladder (§16.2, at most CFG verify.max_renders renders per join, one kept for cut_on_one):
  1. repair the same form (<= max_repairs): generic composition edits keyed by the failing
     checks (generic_repair); V1 / V2b / V8 / V10 have no same-form repair;
  2. the join's next candidates with the same (j_B, X_A) (Hooks.alternatives; MemoHooks reads
     them from the planner's candidate memo);
  3. the composition's own `fallback` forms (echo_slam, roll_slam, ...) (Hooks.fallback);
  4. cut_on_one;
  5. if cut_on_one still fails V1, (B, j_B) goes into bad_landings and the set is re-planned.
Every render is stored in the VerifyStore under its composition hash (failing ones also in
`failed`), with the ladder's history so far.

Render tags: a V6 retry is recorded in the composition as the variant tag "xf10" (so it is
hashed and replayable). render_comp applies it to the compiled Program (patch_program:
xf 10 ms, same-source search +-3 ms) and renders with compile_join + render_program;
untagged compositions go through engine.render_join.
"""

from __future__ import annotations

import copy
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from types import SimpleNamespace

import numpy as np

from . import CFG, COMPILER_VERSION, MEDLEY_VERSION
from . import schema as S
from . import verify as VF
from .dsp import tp_limiter
from ..audio import FFMPEG, SR
from ..render import XF, crop, track_gain

XF10_TAG = "xf10"
VC = CFG["verify"]


def _s(t: float) -> int:
    return int(round(t * SR))


def _params(s) -> dict:
    return getattr(s, "params", None) or s.state["params"]


def _store(s, set_id=None) -> VF.VerifyStore:
    st = getattr(s, "verify_store", None)
    return st(set_id) if callable(st) else (st or s.store)


def _engine(s):
    eng = getattr(s, "engine", None)
    if eng is not None:
        return eng
    from . import engine as E
    try:
        from . import compile as C
    except ImportError:                  # pragma: no cover - E2's module not there yet
        C = None
    return SimpleNamespace(render_join=E.render_join, render_program=getattr(E, "render_program", None),
                           compile_join=getattr(C, "compile_join", None))


def _feats(s, track: dict) -> dict | None:
    try:
        return s.mfeats.get(track)
    except Exception:
        return None


def _tags(comp: dict) -> set[str]:
    return set((comp.get("variant") or "").split("."))


def _rehash(comp: dict) -> dict:
    comp["hash"] = S.canonical_hash(comp)
    return comp


# ---------------------------------------------------------------------------------------------
# rendering one join
# ---------------------------------------------------------------------------------------------
def patch_program(prog: S.Program, comp: dict) -> S.Program:
    """Apply the composition's render tags to its compiled Program (V6 retry: xf 3 -> 10 ms,
    same-source splice search +-1.5 -> +-3 ms)."""
    if XF10_TAG in _tags(comp):
        for sp in prog.splices:
            sp.xf_ms = max(float(sp.xf_ms), float(CFG["splice_xf_low_ms"]))
            if float(sp.search_ms) > 0:
                sp.search_ms = max(float(sp.search_ms), float(CFG["compile"]["splice_search_retry_ms"]))
    return prog


def render_comp(s, plan: dict, i: int, comp: dict) -> dict:
    """Render join i of `plan` with composition `comp`: {out, pa, pb, prog, a, b, fa, fb, ya, yb}.
    Arrays cover region seconds [-XF, T + XF], track gains applied, not limited."""
    p = _params(s)
    tracks = s.order_tracks(plan)
    a, b = tracks[i], tracks[i + 1]
    ya, yb = s.audio.get(a["path"]), s.audio.get(b["path"])
    fa, fb = _feats(s, a), _feats(s, b)
    eng = _engine(s)
    stems_used = any(S.uses_stems(c["stem"]) for c in comp["clips"])
    prog = None
    if XF10_TAG in _tags(comp) and not stems_used and eng.compile_join and eng.render_program:
        prog = patch_program(eng.compile_join(comp, fa, fb, SR), comp)
        out, pa, pb = eng.render_program(prog, ya, yb, track_gain(a, p), track_gain(b, p), None, None,
                                         getattr(s, "warp_cache", None))
    else:
        sink: dict = {}
        tr = dict(plan["transitions"][i], composition=comp)
        if comp["hash"] != plan["transitions"][i]["composition"]["hash"]:
            geo = _geo_fields(comp, fa, fb)      # the engine pins native edges to these
            if geo:
                tr.update(geo)
        out, pa, pb = eng.render_join(ya, yb, a, b, tr, p, parts=True, stems=getattr(s, "stems", None),
                                      feats=getattr(s, "mfeats", None), warp_cache=getattr(s, "warp_cache", None),
                                      sink=sink)
        prog = sink.get("prog")
        if prog is None and eng.compile_join:
            prog = eng.compile_join(comp, fa, fb, SR)
    if prog is None:
        raise RuntimeError("the engine returned no Program (sink['prog']) and no compiler is available")
    if not isinstance(prog, S.Program):
        prog = S.from_json(prog, S.Program)
    return {"out": out, "pa": pa, "pb": pb, "prog": prog, "a": a, "b": b, "fa": fa, "fb": fb, "ya": ya, "yb": yb}


class _Refs:
    """Body references (verify.body_ref) per (track, gain, window), computed once per build."""

    def __init__(self):
        self.memo: dict = {}

    def get(self, y, F, track_id: str, t0: float, t1: float, gain: float) -> dict:
        key = (track_id, round(gain, 6), round(t0, 3), round(t1, 3))
        if key not in self.memo:
            self.memo[key] = VF.body_ref(y, F, t0, t1, gain)
        return self.memo[key]


def verify_rendered(s, plan: dict, i: int, comp: dict, r: dict, *, attempt: int = 1, history=None,
                    hard=VF.HARD_PHASE1, bt=None, refs: _Refs | None = None, detail: dict | None = None) -> dict:
    """verify_join on a render_comp result, with native context (pre/post) and body refs."""
    p = _params(s)
    prog, a, b = r["prog"], r["a"], r["b"]
    ga, gb = track_gain(a, p), track_gain(b, p)
    ms = np.asarray(prog.clock_m, float)
    ts = np.asarray(prog.clock_t, float)
    beat = float(np.interp(min(1.0, ms[-1]), ms, ts) - np.interp(min(1.0, ms[-1]) - 1, ms, ts))
    ctx_s = max(4.0, 8 * beat + VF.V1_BT_PAD_S + 0.5)      # V1's Beat This window (V8 uses 3 s)
    a0 = VF._src_at(prog, "a", 0.0)
    b1 = VF._src_at(prog, "b", float(prog.T))
    pre = crop(r["ya"], _s(a0 - ctx_s), _s(a0)) * np.float32(ga) if a0 is not None else None
    post = crop(r["yb"], _s(b1), _s(b1 + ctx_s)) * np.float32(gb) if b1 is not None else None
    ex = (plan.get("medley") or {}).get("excerpts") or []
    ref = {}
    refs = refs or _Refs()
    for side, k, y, F, g in (("a", i, r["ya"], r["fa"], ga), ("b", i + 1, r["yb"], r["fb"], gb)):
        if k < len(ex):
            e = ex[k]
            ref[side] = refs.get(y, F, e["track"], float(e["land"]["t"]), float(e["exit"]["t"]), g)
    lag = {"a": VF.bt_lag(a, r["fa"]), "b": VF.bt_lag(b, r["fb"])}
    vox = vocal_windows(s, prog, a, b, r["fa"], r["fb"], ref, ga, gb)
    det = detail if detail is not None else {}
    checks = VF.verify_join(r["out"], r["pa"], r["pb"], prog, r["fa"], r["fb"], a, b, p, bt=bt, bt_cpu=bt is None,
                            pre=pre, post=post, ref=ref, comp=comp, hard=hard, attempt=attempt, history=history,
                            detail=det, lag=lag, stems_parts={"vox": vox} if vox else None)
    if comp.get("form") in S.CREATION_FORMS:
        creation_invariant(s, r, checks, det, hard, ga, gb)
    return checks


def creation_invariant(s, r: dict, checks: dict, det: dict, hard, ga: float, gb: float) -> None:
    """Creation forms (medley v5): one drum kit and one bassline at any instant, measured on drum-
    only and bass-only re-renders from the stems. A second kit fails V3 (flams), a second bassline
    V4 (double bass); the numbers go to detail["stem_overlaps"]."""
    from .creation import stem_overlaps
    st = getattr(s, "stems", None)
    if st is None:
        return
    a, b = r["a"], r["b"]
    try:
        sa = st.bind(a["id"], a.get("path"), r["ya"])
        sb = st.bind(b["id"], b.get("path"), r["yb"])
    except (OSError, ValueError, KeyError):
        return
    ov = stem_overlaps(r["prog"], r["ya"], r["yb"], ga, gb, sa, sb, getattr(s, "warp_cache", None))
    det["stem_overlaps"] = ov
    res = det.setdefault("results", {})
    for code, ok, what in (("V3", ov["kit_ok"], "kit"), ("V4", ov["bass_ok"], "bass")):
        if ok:
            continue
        res[code] = "fail"
        det.setdefault("notes", []).append(f"{code}: both {what}s sound {ov[what + '_overlap_beats']} beats "
                                           f"(stems) at {ov[what + '_runs'][:3]}")
        if code in hard and code not in checks["fail"]:
            checks["fail"].append(code)
    if checks["fail"]:
        checks["status"] = "fail"


def vocal_windows(s, prog: S.Program, a: dict, b: dict, fa: dict | None, fb: dict | None, ref: dict,
                  ga: float, gb: float) -> dict:
    """V12's source vocal stems (fixer, review v1 musical #4: build never gave V12 its stems, so
    it never ran): {side: {s0, x (mono vocal stem from s0), ref_db (body bar level at unity
    gain), vocal (a sung track)}} over the source span the region plays, for sides whose stems
    exist."""
    st = getattr(s, "stems", None)
    out: dict = {}
    if st is None:
        return out
    T = float(prog.T)
    a0, b1 = VF._src_at(prog, "a", 0.0), VF._src_at(prog, "b", T)
    spans = {"a": (a0 - 1.0, a0 + 1.2 * T + 1.0) if a0 is not None else None,
             "b": (b1 - T - 1.0, b1 + 0.5) if b1 is not None else None}
    for side, t, F, g in (("a", a, fa, ga), ("b", b, fb, gb)):
        sp = spans[side]
        if sp is None or F is None or side not in ref or not F.get("stems"):
            continue
        try:
            if not st.has(t["id"], t.get("path")):
                continue
            s0 = max(0.0, sp[0])
            x = st.window(t["id"], t.get("path"), s0, sp[1], ["vocals"])["vocals"]
        except (OSError, ValueError, RuntimeError, KeyError):
            continue
        out[side] = {"s0": s0, "x": np.asarray(x, np.float32).mean(axis=1),
                     "ref_db": float(ref[side]["bar_db"]) - 20 * math.log10(max(g, 1e-6)),
                     "vocal": bool(F.get("vocal_track", True))}
    return out


def render_and_verify(s, i: int, plan: dict, comp: dict | None = None, *, store=None, hard=VF.HARD_PHASE1,
                      bt=None, sink: dict | None = None, **kw) -> dict:
    """§18: render join i (its planned composition unless `comp`), verify, store; -> Checks.
    `sink` (a dict) receives the render_comp result."""
    comp = comp or plan["transitions"][i]["composition"]
    r = render_comp(s, plan, i, comp)
    checks = verify_rendered(s, plan, i, comp, r, hard=hard, bt=bt, **kw)
    (store or _store(s)).put(comp["hash"], checks)
    if sink is not None:
        sink.update(r)
    return checks


# ---------------------------------------------------------------------------------------------
# medley v6: the measured blend score of a render, and the candidate search
# ---------------------------------------------------------------------------------------------
VACUUM_FORMS = ("roll_slam", "echo_slam", "air_cut", "tape_stop_slam", "spin_slam", "cut_on_one")


def _beat_s(prog: S.Program) -> float:
    ms, ts = np.asarray(prog.clock_m, float), np.asarray(prog.clock_t, float)
    m1 = min(1.0, ms[-1])
    return float(np.interp(m1, ms, ts) - np.interp(m1 - 1, ms, ts)) or 0.5


def blend_of(s, r: dict, comp: dict) -> dict:
    """verify.blend_render on a render_comp result (A's native body before the region and B's
    after it, BLEND ctx_s each, track gains applied) plus the selection penalties: {score, dip,
    holes, jump, clash, ..., traits, penalties, sel} (sel = score - penalties)."""
    p = _params(s)
    prog = r["prog"]
    ga, gb = track_gain(r["a"], p), track_gain(r["b"], p)
    cs = float(VF.BLEND["ctx_s"])
    a0 = VF._src_at(prog, "a", 0.0)
    b1 = VF._src_at(prog, "b", float(prog.T))
    pre = crop(r["ya"], _s(a0 - cs), _s(a0)) * np.float32(ga) if a0 is not None else None
    post = crop(r["yb"], _s(b1), _s(b1 + cs)) * np.float32(gb) if b1 is not None else None
    m = VF.blend_render(r["out"], r["pa"], r["pb"], pre, post, float(prog.t_land), _beat_s(prog), SR, XF)
    pen = VF.blend_penalties(comp, (CFG["creation"].get("form_prior") or {}).get(comp["form"]))
    m.update(traits=pen["traits"], penalties=pen["penalties"],
             sel=None if m.get("score") is None else round(float(m["score"]) - pen["total"], 1))
    return m


def _bars_of(comp: dict) -> float:
    return float(VF.comp_traits(comp)["bars"])


def plan_candidates(orig: dict, options: list[dict], recent: list[str], n: int) -> list[dict]:
    """Up to n compositions to render for one join, for real variety: the planned form at its
    SHORT / MEDIUM / LONG lengths, then other forms (best local score first, recent forms last)
    at a length class not yet tried, then the rest by local score. Unpitched only (the pitch
    slot is the ladder's). `options`: planner.join_options (local-score order)."""
    from .creation import length_class, pitched
    out, seen, keys = [], set(), set()

    def key(c):
        return (c["form"], length_class(_bars_of(c)))

    def add(c) -> bool:
        if c["hash"] in seen or key(c) in keys or len(out) >= n:
            return False
        seen.add(c["hash"]), keys.add(key(c))
        out.append(c)
        return True

    opts = [c for c in options if not pitched(c["variant"])]
    add(orig) if not pitched(orig["variant"]) else None
    for c in opts:                                   # the planned form at its other lengths
        if c["form"] == orig["form"]:
            add(c)
    rec = set(recent[-3:])
    forms = []
    for c in sorted(opts, key=lambda c: (c["form"] in rec, -float((c.get("score") or {}).get("local", 0.0)))):
        if c["form"] not in forms and c["form"] != orig["form"]:
            forms.append(c["form"])
    classes = ["M", "S", "L"]
    for k, f in enumerate(forms):                    # one length per other form, rotating classes
        if len(out) >= n:
            break
        mine = [c for c in opts if c["form"] == f]
        want = classes[k % 3]
        pick = next((c for c in mine if length_class(_bars_of(c)) == want), None) or mine[0]
        add(pick)
    for c in opts:                                   # fill: the best remaining (form, length)
        add(c)
    return out


def select_blend(rows: list[dict], recent: list[str], tie: float | None = None,
                 pass_score: float | None = None) -> int | None:
    """Index of the kept render among rows [{form, ok (hard checks), score, sel, bars}]: the best
    `sel` among renders that pass every hard check, a vacuum form (roll_slam, ...) only when its
    measured score passes (unless nothing else passes); within `tie` points of the best the
    shorter wins, a form used in the last 3 joins only breaks ties. None: nothing passes."""
    tie = float(VC.get("blend_tie_band", 3.0)) if tie is None else tie
    ps = float(VF.BLEND["pass"]) if pass_score is None else pass_score
    good = [k for k, r in enumerate(rows) if r["ok"] and r.get("sel") is not None]
    if not good:
        good = [k for k, r in enumerate(rows) if r["ok"]]
        return good[0] if good else None
    tiers = ([k for k in good if rows[k]["score"] >= ps],
             [k for k in good if rows[k]["form"] not in VACUUM_FORMS], good)
    pool = next(t for t in tiers if t)
    best = max(rows[k]["sel"] for k in pool)
    near = [k for k in pool if rows[k]["sel"] >= best - tie]
    rec = set(recent[-3:])
    return min(near, key=lambda k: (rows[k]["bars"], rows[k]["form"] in rec, -rows[k]["sel"], k))


# ---------------------------------------------------------------------------------------------
# ladder rungs: generic repairs and the cut_on_one fallback
# ---------------------------------------------------------------------------------------------
def _ids(comp: dict, src: str) -> set[str]:
    return {c["id"] for c in comp["clips"] if c["src"] == src}


def _targets(mv: dict) -> set[str]:
    return {mv.get("clip")} | set(mv.get("clips") or []) | set(mv.get("in") or []) | set(mv.get("out") or [])


def _halve_layering(c: dict) -> bool:
    """V3/V4/V2a/V5 (§16.2): move B's earliest entry to half the layered length (8 -> 4 -> 2
    bars). B clips entering earlier are shortened (their source advances with them) and the
    level moves on them restart at the new entry. At 2 bars (or with trades, gates, loops on
    those clips) the form itself must change: returns False."""
    bpb = int(c["bpb"])
    st = S.static_eval(c)
    b_ids = _ids(c, "b")
    firsts = [float(st.m[ct.audible][0] - st.h / 2) for cid, ct in st.clips.items()
              if cid in b_ids and ct.audible.any() and st.m[ct.audible][0] < 0]
    if not firsts:
        return False
    old = min(firsts)
    bars = -old / bpb
    if bars <= 2 + 1e-9:
        return False
    new = -bpb * max(2, math.floor(bars / 2 + 1e-9))
    for cl in c["clips"]:
        if cl["src"] == "b" and cl["at"] < new:
            d = new - cl["at"]
            cl["at"], cl["len"], cl["u0"] = new, cl["len"] - d, cl["u0"] + d * cl["ratio"]
            if cl["len"] <= 0:
                return False
    for mv in c["moves"]:
        if not (_targets(mv) & b_ids) or mv["at"] >= new:
            continue
        if mv["type"] not in ("fade", "eq", "filter"):
            return False
        end = mv["at"] + float(mv.get("len", 0))
        mv["at"], mv["len"] = float(new), max(0.0, end - new)
    for ev in c["events"]:
        if abs(ev[0] - old) < 1e-6 and ev[1] >= new:
            ev[0] = float(new)
    tag = f"L{int(-new // bpb)}"
    c["variant"] = re.sub(r"(^|\.)L\d+", lambda m: m.group(1) + tag, c["variant"]) \
        if re.search(r"(^|\.)L\d+", c["variant"]) else f"{c['variant']}.{tag}"
    return True


def _top_out_earlier(c: dict) -> bool:
    """V5: A's top (mid/high EQ cuts) goes out 1 bar earlier."""
    bpb, f = int(c["bpb"]), float(c["span"]["from"])
    a_ids, done = _ids(c, "a"), False
    for mv in c["moves"]:
        if mv["type"] == "eq" and mv.get("clip") in a_ids and mv["band"] in ("mid_high", "mid", "high") \
                and mv["at"] - bpb >= f + bpb:
            mv["at"] -= bpb
            done = True
    return done


def _widen_air(c: dict) -> bool:
    """V11 (§16.2 air 1/2 -> 1 beat): A's low kill moves to -1, A's closing fade (ending in the
    last beat) doubles its length ending where it ended (at 0), or moves one fade length earlier
    (the amended R6 fade over [-1, -1/4] becomes [-1.75, -1]), a vacuum before 0 grows to 1 beat,
    and a cut of A moves twice as early."""
    a_ids, done = _ids(c, "a"), False
    for mv in c["moves"]:
        t, mine = mv["type"], mv.get("clip") in a_ids
        if t == "eq" and mine and mv["band"] == "low" and mv["to_db"] is None and -1 < mv["at"] < 0:
            mv["at"], done = -1.0, True
        elif t == "fade" and mine and mv["to_db"] is None and abs(mv["at"] + mv["len"]) < 1e-9 and mv["len"] < 2:
            mv["at"], mv["len"], done = mv["at"] - mv["len"], 2 * mv["len"], True
        elif t == "fade" and mine and mv["to_db"] is None and -1 < mv["at"] + mv["len"] < 0 and mv["len"] < 2:
            mv["at"], done = mv["at"] - mv["len"], True
        elif t == "vacuum" and abs(mv["at"] + mv["len"]) < 1e-9 and mv["len"] < 1:
            mv["at"], mv["len"], done = -1.0, 1.0, True
        elif t == "cut" and mine and mv["dir"] == "out" and -1 < mv["at"] <= 0:
            mv["at"], done = (-0.25 if mv["at"] > -0.25 else max(-1.0, 2 * mv["at"])), True
    return done


def _trim_a(c: dict, db: float) -> bool:
    """V7: the outgoing clip -3 dB. Span edges must stay at 0 dB (§8.9.3), so the trim is a
    1-bar ramp after the span-start bar, and every later A fade level moves by `db` too."""
    bpb, f = int(c["bpb"]), float(c["span"]["from"])
    at = f + bpb
    new = []
    for cl in c["clips"]:
        end = cl["at"] + cl["len"]
        if cl["src"] == "a" and end - at >= 0.5:
            new.append({"type": "fade", "clip": cl["id"], "at": at, "len": float(min(bpb, end - at)),
                        "from_db": 0.0, "to_db": db, "shape": "lin"})
    if not new:
        return False
    ids = {m["clip"] for m in new}
    for mv in c["moves"]:
        if mv["type"] == "fade" and mv.get("clip") in ids:
            mv["from_db"] = None if mv["from_db"] is None else mv["from_db"] + db
            mv["to_db"] = None if mv["to_db"] is None else mv["to_db"] + db
    c["moves"] = new + c["moves"]
    return True


def _shorten_gestures(c: dict) -> bool:
    """V9: every rate gesture ends 1/4 beat earlier."""
    done = False
    for mv in c["moves"]:
        t = mv["type"]
        if t in ("tape_stop", "rewind") and mv["len"] > 0.5:
            mv["len"], done = mv["len"] - 0.25, True
        elif t == "backspin" and mv["end_by"] - 0.25 > mv["at"]:
            mv["end_by"], done = mv["end_by"] - 0.25, True
        elif t == "roll" and mv["sizes"] and mv["sizes"][-1][1] > 0.25:
            mv["sizes"][-1] = [mv["sizes"][-1][0], mv["sizes"][-1][1] - 0.25]
            done = True
    return done


def _echo_throw(c: dict) -> bool:
    """V12 (§5.3; fixer, review v1 musical #4): instead of cutting A's sung line, A throws an echo
    from the beat at or before its cut point: capture the beat before the throw, cut A's vocal
    clips at the throw, the join's rotating echo settings (forms.echo_throw), ducked by B."""
    from .forms import tail_fb
    if any(m["type"] == "echo" for m in c["moves"]):
        return False
    m_c = VF.a_cut_m(c)
    if m_c is None:
        return False
    bpb, f = int(c["bpb"]), float(c["span"]["from"])
    throw = float(math.floor(m_c + 1e-9))
    if throw - 1 < f + bpb:
        return False
    vox = [cl for cl in c["clips"] if cl["src"] == "a" and VF._has_vocals(cl["stem"])
           and cl["at"] <= throw - 1 + 1e-9 and cl["at"] + cl["len"] >= throw - 1e-9]
    at0 = [cl for cl in c["clips"] if cl["src"] == "b" and cl["at"] <= 1e-9 < cl["at"] + cl["len"]]
    duck = next((cl["id"] for cl in at0 if cl["stem"] in ("mix", "bed")), at0[0]["id"] if at0 else None)
    if not vox or duck is None:
        return False
    sets = CFG["forms"]["echo_sets"]
    idx = int(re.sub(r"\D", "", c["id"]) or 1) - 1
    es = sets[idx % len(sets)]
    fb = tail_fb(SimpleNamespace(clock=c["clock"]), throw, es["delay"], es["send_db"], CFG)
    cc = CFG["compile"]
    c["moves"].append({"type": "echo", "at": throw - 1, "clip": vox[0]["id"], "capture": 1, "delay": es["delay"],
                       "fb": fb, "tail": CFG["forms"]["echo_tail_beats"], "hp_hz": list(es["hp_hz"]),
                       "send_db": es["send_db"], "duck": {"key": duck, "depth_db": cc["echo_duck_db"],
                                                         "release_beats": cc["echo_duck_release_beats"]}})
    for cl in vox:
        c["moves"].append({"type": "cut", "at": throw, "clip": cl["id"], "dir": "out", "ms": cc["cut_ms"]})
    c["events"].append([throw - 1, throw, "echo throw on A's line (V12)"])
    c["variant"] = f"{c['variant']}.throw"
    return True


def generic_repair(comp: dict, checks: dict, n: int = 1, fa: dict | None = None, fb: dict | None = None,
                   log=None) -> dict | None:
    """§16.2 rung 1: the same form, edited for every failing check; None when a failing check
    has no same-form repair (V1, V2b, V10, and V8, whose B trim would break the span-end
    contract of §8.9.4) or the edited composition no longer validates."""
    fail = set(checks.get("fail") or [])
    if not fail or fail & {"V1", "V2b", "V10", "V8"}:
        return None
    c = copy.deepcopy(comp)
    ok = True
    if fail & {"V3", "V4", "V2a", "V5"}:
        ok &= _halve_layering(c)
    if "V5" in fail:
        _top_out_earlier(c)
    if "V11" in fail:
        ok &= _widen_air(c)
    if "V7" in fail:
        ok &= _trim_a(c, -3.0)
    if "V6" in fail:
        ok &= XF10_TAG not in _tags(c)
        c["variant"] = f"{c['variant']}.{XF10_TAG}"
    if "V9" in fail:
        ok &= _shorten_gestures(c)
    if "V12" in fail:
        ok &= _echo_throw(c)
    if not ok:
        return None
    _rehash(c)
    issues = S.validate_composition(c, fa, fb)
    if issues:
        if log:
            log(f"    repair of {comp['form']} dropped: {issues[0]}")
        return None
    return c


def cut_on_one_from(comp: dict, fa: dict | None = None, fb: dict | None = None) -> dict | None:
    """§10.13 cut_on_one on the same excerpts (a_ref, b_ref, rel) as `comp`: A native on its own
    clock up to 0, cut at -v; B native from 0, or from -pickup (R7) under A's clock. Rule 7 of
    §8.9 (the tempo step at 0) needs A silent from t(0) - max(1/4 beat, pickup), so v >= 1/4
    always (the design's v = 0 case cannot validate). span.from = -(g + 1) bars with g the bars
    spanned by the cut (and B's pickup), so the span-start bar is plain A (§8.9.3)."""
    bpb = int(comp["bpb"])
    rel = copy.deepcopy(comp["rel"])
    ar = rel["a_ratio"]
    per_a, per_b = comp["a_ref"].get("period_s"), comp["b_ref"].get("period_s")
    if per_a:
        a_kind, a_bpm = "a_fit", 60.0 / per_a / ar
    else:
        a_kind, a_bpm = "a_refined", float((fa or {}).get("bpm") or 120.0) / ar
    if per_b:
        b_kind, b_bpm = "b_fit", 60.0 / per_b
    else:
        b_kind, b_bpm = "b_refined", float((fb or {}).get("bpm") or 120.0)
    pick = 0
    for ld in (fb or {}).get("landings") or []:
        if ld["bar"] == comp["b_ref"]["land_bar"]:
            pick = int(ld["lead"].get("pickup_beats") or 0)
    pick = min(pick, int(CFG["pickup_max_beats"]))
    beat_a, beat_b = 60.0 / a_bpm, (per_b or 60.0 / b_bpm)
    pick_m = pick * beat_b / beat_a                     # B's pickup in master (A clock) beats
    v = max(0.25, pick_m)
    f = -float(bpb) * (1 + math.ceil(v / bpb - 1e-9))  # §10 slams: -(g + 1) bars, g = the cut's bars
    to = float(bpb)
    b_at = -pick_m if pick else 0.0
    variant = f"v{v:g}" + (f".pickup{pick}" if pick else "")
    land_lab = f"land {comp['b_ref']['land_t']:.2f} s"
    c = {"id": comp["id"], "a": comp["a"], "b": comp["b"], "form": "cut_on_one", "variant": variant,
         "tier": S.tier_of("cut_on_one", variant), "loud": S.is_loud("cut_on_one", variant), "b_in": "slam",
         "rel": rel, "bpb": bpb, "a_ref": copy.deepcopy(comp["a_ref"]), "b_ref": copy.deepcopy(comp["b_ref"]),
         "clock": [{"m0": f, "m1": 0.0, "kind": a_kind, "bpm0": a_bpm, "bpm1": a_bpm},
                   {"m0": 0.0, "m1": to, "kind": b_kind, "bpm0": b_bpm, "bpm1": b_bpm}],
         "span": {"from": f, "to": to},
         "clips": [{"id": "A", "src": "a", "stem": "mix", "at": f, "len": -f, "u0": f * ar, "ratio": ar,
                    "warp": "native", "gain_db": 0.0},
                   {"id": "B", "src": "b", "stem": "mix", "at": b_at, "len": to - b_at, "u0": float(-pick),
                    "ratio": 1, "warp": "native", "gain_db": 0.0}],
         "moves": [{"type": "cut", "clip": "A", "at": -v, "dir": "out", "ms": float(CFG["compile"]["cut_ms"])}],
         "events": [[-v, 0.0, "cut A"]] + ([[b_at, 0.0, f"B pickup {pick} beats"]] if pick else [])
         + [[0.0, 0.0, land_lab]],
         "fallback": [], "hash": ""}
    _rehash(c)
    return None if S.validate_composition(c, fa, fb) else c


class Hooks:
    """Where the ladder's new compositions come from (§16.2 rungs 1-4).

    repair(i, comp, checks, n, fa, fb)  -> Composition | None       (default generic_repair)
    alternatives(i, comp)               -> [Composition]             same (j_B, X_A), local-score
                                                                     order (default: planner's
                                                                     join_alternatives(plan, i))
    fallback(i, comp, form, fa, fb)     -> Composition | None       (default: planner's
                                                                     fallback_join(plan, i, form),
                                                                     else cut_on_one_from)"""

    def __init__(self, plan: dict | None = None, planner=None, log=None):
        self.plan, self.planner, self.log = plan, planner, log

    def repair(self, i, comp, checks, n, fa=None, fb=None):
        return generic_repair(comp, checks, n, fa, fb, log=self.log)

    def alternatives(self, i, comp):
        f = getattr(self.planner, "join_alternatives", None)
        return list(f(self.plan, i) or []) if f and self.plan is not None else []

    def options(self, i, comp):
        f = getattr(self.planner, "join_options", None)
        return list(f(self.plan, i) or []) if f and self.plan is not None else []

    def variant(self, i, comp, form, variant):
        f = getattr(self.planner, "join_variant", None)
        return f(self.plan, i, form, variant) if f and self.plan is not None else None

    def fallback(self, i, comp, form, fa=None, fb=None):
        f = getattr(self.planner, "fallback_join", None)
        if f and self.plan is not None:
            c = f(self.plan, i, form)
            if c is not None:
                return c
        return cut_on_one_from(comp, fa, fb) if form == "cut_on_one" else None


class MemoHooks(Hooks):
    """Hooks over the planner's candidate memo (the `memo` given to build_medley_plan: lists of
    candidates with .X, .j, .form, .S, .comp and .valid per (A, B) pair). Rung 2 = the other
    candidates with the same (X_A, j_B) in local-score order; rung 3 = the best candidate of the
    fallback form with the same excerpts; cut_on_one_from when the memo has none. Failed hashes
    and bad landings in the store are skipped."""

    def __init__(self, plan: dict | None, memo: dict, store=None, log=None, source: dict | None = None):
        super().__init__(plan, log=log)
        self.memo, self.store = memo, store
        # the plan object build_medley_plan returned (the ladder works on a deep copy, which the
        # planner's registry does not know): fallback forms the memo pruned are built from it
        self.source = source

    def _cands(self, comp: dict) -> list:
        X, j = comp["a_ref"]["exit_bar"], comp["b_ref"]["land_bar"]
        out = []
        for lst in self.memo.values():
            for q in lst if isinstance(lst, list) else []:
                qc = getattr(q, "comp", None)
                if isinstance(qc, dict) and qc.get("a") == comp["a"] and qc.get("b") == comp["b"] \
                        and getattr(q, "X", None) == X and getattr(q, "j", None) == j \
                        and getattr(q, "valid", None) is not False:
                    out.append(q)
        out.sort(key=lambda q: (-float(getattr(q, "S", 0.0)), getattr(q, "id", 0)))
        return out

    def _at_join(self, q, comp: dict) -> dict | None:
        c = copy.deepcopy(q.comp)
        c["id"] = comp["id"]                    # as the planner places it at this join
        _rehash(c)
        if self.store is not None and (self.store.is_failed(c["hash"])
                                       or self.store.is_bad_landing(c["b"], c["b_ref"]["land_bar"])):
            return None
        return c

    def alternatives(self, i, comp):
        out, seen = [], {comp["hash"]}
        for q in self._cands(comp):
            c = self._at_join(q, comp)
            if c is not None and c["hash"] not in seen:
                seen.add(c["hash"])
                out.append(c)
        return out

    def fallback(self, i, comp, form, fa=None, fb=None):
        for q in self._cands(comp):
            if getattr(q, "form", None) == form and (c := self._at_join(q, comp)) is not None:
                return c
        c = self._built(i, comp, form)
        if c is not None:
            return c
        return cut_on_one_from(comp, fa, fb) if form == "cut_on_one" else None

    def _same_join(self, i, comp: dict) -> dict | None:
        trs = (self.source or {}).get("transitions") or []
        if i >= len(trs):
            return None
        pc = trs[i]["composition"]
        if (pc["a"], pc["b"], pc["a_ref"]["exit_bar"], pc["b_ref"]["land_bar"]) != \
                (comp["a"], comp["b"], comp["a_ref"]["exit_bar"], comp["b_ref"]["land_bar"]):
            return None
        return self.source

    def _place(self, c: dict, comp: dict) -> dict | None:
        c = copy.deepcopy(c)
        c["id"] = comp["id"]
        _rehash(c)
        if self.store is not None and (self.store.is_failed(c["hash"])
                                       or self.store.is_bad_landing(c["b"], c["b_ref"]["land_bar"])):
            return None
        return c

    def options(self, i, comp):
        """medley v6: every form x length variant for join i's excerpts (planner.join_options on
        the source plan), placed at this join; failed hashes skipped."""
        src = self._same_join(i, comp)
        if src is None:
            return []
        from .planner import join_options
        return [c for c in (self._place(q, comp) for q in join_options(src, i)) if c is not None]

    def variant(self, i, comp, form, variant):
        src = self._same_join(i, comp)
        if src is None:
            return None
        from .planner import join_variant
        q = join_variant(src, i, form, variant)
        return self._place(q, comp) if q is not None else None

    def _built(self, i, comp: dict, form: str) -> dict | None:
        """`form` built for join i's excerpts by the planner (fallback_join on the source plan),
        when the memo's pruning dropped it (fixer: a layered join failing V3 or V12 fell straight
        through to cut_on_one, which cannot pass V12 on a sung exit, instead of echo_slam)."""
        src = self.source
        trs = (src or {}).get("transitions") or []
        if i >= len(trs):
            return None
        pc = trs[i]["composition"]
        if (pc["a"], pc["b"], pc["a_ref"]["exit_bar"], pc["b_ref"]["land_bar"]) != \
                (comp["a"], comp["b"], comp["a_ref"]["exit_bar"], comp["b_ref"]["land_bar"]):
            return None
        from .planner import fallback_join
        c = fallback_join(src, i, form)
        if c is None:
            return None
        c = copy.deepcopy(c)
        c["id"] = comp["id"]
        _rehash(c)
        if self.store is not None and (self.store.is_failed(c["hash"])
                                       or self.store.is_bad_landing(c["b"], c["b_ref"]["land_bar"])):
            return None
        return c


# ---------------------------------------------------------------------------------------------
# the ladder
# ---------------------------------------------------------------------------------------------
@dataclass
class JoinResult:
    comp: dict                          # the composition kept for this join
    checks: dict | None                 # its Checks (history = every render of the ladder)
    prog: S.Program
    region: str | None = None           # .npy of the kept render's `out`, for the full mix
    bad_landing: bool = False
    attempts: list = field(default_factory=list)   # [{form, variant, hash, status, fail, warn, notes, blend}]
    blend: dict | None = None           # v6: the kept render's measured blend score + sub-metrics


def ladder(s, i: int, plan: dict, *, hooks: Hooks | None = None, store=None, hard=VF.HARD_PHASE1, bt=None,
           refs: _Refs | None = None, regions_dir: str | None = None, recent: list[str] | None = None,
           log=print) -> JoinResult:
    """§16.2 for join i of `plan`. medley v6 first: the candidate search (plan_candidates, about
    VC blend_renders renders: forms x SHORT / MEDIUM / LONG, then at most one pitched render when
    the best overlap clashes), every render scored by its measured blend; the best one passing
    every hard check is kept (select_blend). Only when none passes does the §16.2 ladder run
    (repairs, alternatives, fallback forms, cut_on_one) with its own max_renders."""
    store = store or _store(s)
    hooks = hooks or Hooks(plan, log=log)
    refs = refs or _Refs()
    recent = list(recent or [])
    max_r, max_rep = int(VC["max_renders"]), int(VC["max_repairs"])
    orig = plan["transitions"][i]["composition"]
    history: list[dict] = []
    tried: list[tuple[dict, dict, dict]] = []        # (comp, checks, render)
    seen: set[str] = set()
    fab = {}
    lim = {"n": max_r}

    def run(c: dict | None) -> dict | None:
        if c is None or c["hash"] in seen or len(tried) >= lim["n"]:
            return None
        seen.add(c["hash"])
        r = render_comp(s, plan, i, c)
        fab.setdefault("fa", r["fa"]), fab.setdefault("fb", r["fb"])
        det: dict = {}
        ch = verify_rendered(s, plan, i, c, r, attempt=len(tried) + 1, hard=hard, bt=bt, refs=refs, detail=det)
        try:
            bl = blend_of(s, r, c)
        except (ValueError, IndexError, FloatingPointError) as e:      # scoring never fails a join
            bl = {"score": None, "error": str(e)}
        history.append({"form": c["form"], "variant": c["variant"], "hash": c["hash"], "fail": list(ch["fail"]),
                        "blend": bl.get("score")})
        ch["history"] = copy.deepcopy(history)
        ch["blend"] = bl
        store.put(c["hash"], ch)
        r["detail"], r["blend"] = det, bl
        for k in ("ya", "yb", "pa", "pb"):           # keep the big arrays out of the tried list
            r.pop(k, None)
        tried.append((c, ch, r))
        log(f"    try {len(tried)}: {c['form']} {c['variant']} {bl.get('traits', {}).get('bars', '?')}b -> {ch['status']}"
            + (f" {','.join(ch['fail'])}" if ch["fail"] else "") + (f" (warn {','.join(det['warn'])})" if det["warn"] else "")
            + f" blend {bl.get('score')} sel {bl.get('sel')}")
        return ch

    def ok(ch):
        return ch is not None and ch["status"] != "fail"

    def finish(k: int, bad: bool = False, how: str = "ladder") -> JoinResult:
        c, ch, r = tried[k]
        ch = dict(ch, attempt=k + 1, history=copy.deepcopy(history))
        store.put(c["hash"], ch)
        path = None
        if regions_dir:
            path = os.path.join(regions_dir, f"{i:03d}-{c['hash']}.npy")
            np.save(path, np.asarray(r["out"], np.float32))
        atts = [{"form": cc["form"], "variant": cc["variant"], "hash": cc["hash"], "status": hh["status"],
                 "fail": hh["fail"], "warn": rr["detail"].get("warn", []), "notes": rr["detail"].get("notes", []),
                 "blend": {kk: rr["blend"].get(kk) for kk in ("score", "sel", "dip", "holes", "jump", "clash")},
                 "bars": (rr["blend"].get("traits") or {}).get("bars")}
                for cc, hh, rr in tried]
        bl = dict(r.get("blend") or {}, chosen_by=how, renders=len(tried))
        return JoinResult(c, ch, r["prog"], path, bad, atts, bl)

    def rows():
        return [{"form": c["form"], "ok": ok(ch) and not rr["blend"].get("rejected"), "score": rr["blend"].get("score"), "sel": rr["blend"].get("sel"),
                 "bars": float((rr["blend"].get("traits") or {}).get("bars") or 0.0)} for c, ch, rr in tried]

    # v6: the measured candidate search
    nb = int(VC.get("blend_renders", 0) or 0)
    opts = hooks.options(i, orig) if nb and hasattr(hooks, "options") else []
    if nb and opts:
        from .creation import pitched
        creation = any(c["form"] in S.CREATION_FORMS for c in opts)
        n = nb if creation else max(2, nb // 2)
        lim["n"] = n
        for c in plan_candidates(orig, opts, recent, n - 1 if creation else n):
            run(c)
        # the pitch slot: only when the best unshifted overlap clashes (and a pitched variant exists)
        k = select_blend(rows(), recent)
        if k is not None and len(tried) < n:
            c0, _, r0 = tried[k]
            cl = r0["blend"].get("clash")
            if c0["form"] in S.CREATION_FORMS and cl is not None and cl >= VF.BLEND["clash_high"] \
                    and not pitched(c0["variant"]):
                cp = hooks.variant(i, c0, c0["form"], c0["variant"].split(".")[0] + "p")
                if cp is not None and VF.comp_traits(cp)["pitch_semis"] and run(cp) is not None:
                    _, chp, rp = tried[-1]
                    gain = (rp["blend"].get("score") or 0) - (r0["blend"].get("score") or 0)
                    if not (ok(chp) and gain >= float(VC.get("blend_pitch_gain", 10.0))):
                        rp["blend"]["sel"] = None           # not clearly better: never kept
                        rp["blend"]["rejected"] = f"pitch gain {gain:+.1f} < {VC.get('blend_pitch_gain', 10.0)}"
        elif len(tried) < n:                        # spare slot: the next best option
            for c in opts:
                if c["hash"] not in seen and not pitched(c["variant"]):
                    run(c)
                    break
        k = select_blend(rows(), recent)
        if k is not None:
            return finish(k, how="blend")
        log(f"    no candidate passes the hard checks: the ladder")
        lim["n"] = len(tried) + max_r
    # the §16.2 ladder
    k0 = next((k for k, (c, _, _) in enumerate(tried) if c["hash"] == orig["hash"]), None)
    if k0 is None:
        n0 = len(tried)
        if ok(run(orig)):
            return finish(len(tried) - 1)
        k0 = n0 if len(tried) > n0 else None
    reserve = 0 if orig["form"] == "cut_on_one" else 1

    def budget() -> int:
        return lim["n"] - len(tried) - reserve

    # 1. repair the same form
    cur = k0
    for n in range(1, max_rep + 1):
        if budget() <= 0 or cur is None:
            break
        c = hooks.repair(i, tried[cur][0], tried[cur][1], n, fab.get("fa"), fab.get("fb"))
        ch = run(c)
        if ch is None:
            break
        if ok(ch):
            return finish(len(tried) - 1)
        cur = len(tried) - 1
    # 2. next candidates with the same excerpts (cut_on_one is rung 4: as an "alternative" it
    # spent the last free render before rung 3's echo_slam, which a sung exit needs; fixer)
    for c in hooks.alternatives(i, orig):
        if budget() <= 0:
            break
        if c["form"] == "cut_on_one":
            continue
        if ok(run(c)):
            return finish(len(tried) - 1)
    # 3. the composition's fallback forms, then 4. cut_on_one
    forms = [f for f in (orig.get("fallback") or ["echo_slam", "roll_slam"]) if f not in ("cut_on_one", orig["form"])]
    if any("V12" in ch["fail"] for _, ch, _ in tried):       # a sung cut: the echo throw first (§5.3)
        forms.sort(key=lambda f: f != "echo_slam")
    for form in forms:
        if budget() <= 0:
            break
        if ok(run(hooks.fallback(i, orig, form, fab.get("fa"), fab.get("fb")))):
            return finish(len(tried) - 1)
    cut = None
    if orig["form"] != "cut_on_one":
        c = hooks.fallback(i, orig, "cut_on_one", fab.get("fa"), fab.get("fb"))
        n0 = len(tried)
        if ok(run(c)):
            return finish(len(tried) - 1)
        cut = tried[-1] if len(tried) > n0 else None
        # 4b. the fallback's own repair while renders remain (fixer: cut_on_one through a sung
        # line fails V12, and its repair is the echo throw of §5.3)
        if cut is not None and "V1" not in cut[1]["fail"] and len(tried) < lim["n"]:
            if ok(run(hooks.repair(i, cut[0], cut[1], 1, fab.get("fa"), fab.get("fb")))):
                return finish(len(tried) - 1)
    elif k0 is not None:
        cut = tried[k0]
    # 5. still failing: keep the attempt with the fewest failed checks (later rungs win ties)
    best = min(range(len(tried)), key=lambda k: (len(tried[k][1]["fail"]), -k))
    bad = cut is not None and "V1" in cut[1]["fail"]
    if bad:
        store.mark_bad_landing(orig["b"], int(orig["b_ref"]["land_bar"]))
        log(f"    V1 fails even for cut_on_one: bad landing {orig['b']} bar {orig['b_ref']['land_bar']}")
    return finish(best, bad)


# ---------------------------------------------------------------------------------------------
# plan patching
# ---------------------------------------------------------------------------------------------
GEO_KEYS = ("a_out_start", "a_out_end", "b_in_start", "b_in_end", "T", "T_overlap", "bars", "b_enter_s",
            "grid", "events_s", "land_s", "exit_s")


def _geo_fields(comp: dict, fa: dict | None, fb: dict | None) -> dict | None:
    """compile.transition_fields (E2), the one derivation the planner uses; None without it."""
    try:
        from .compile import transition_fields as tf
    except ImportError:
        return None
    return {k: v for k, v in tf(comp, fa, fb).items() if k in GEO_KEYS}


def transition_fields(comp: dict, prog: S.Program | None = None, fa: dict | None = None,
                      fb: dict | None = None) -> dict:
    """The Transition compatibility fields (§8.3) of a kept composition: the geometry from
    compile.transition_fields when that module is present (else program_fields on its compiled
    Program), plus the form / variant / tier / b_in / reason / relation fields."""
    rel = comp["rel"]
    beatmatch = rel["kind"] in ("lock", "double")
    out = {"style": "medley", "beatmatch": beatmatch,
           "reason": f"{comp['form']} · {comp['variant']} · {rel['kind']}"
                     + (f" {rel['stretch_pct']:+.1f}%" if beatmatch else "") + f" · cam {rel['camelot']}",
           "key_distance": int(rel["camelot"]), "stretch_pct": rel["stretch_pct"] if beatmatch else None,
           "form": comp["form"], "variant": comp["variant"], "tier": comp["tier"], "b_in": comp["b_in"],
           "composition": comp}
    geo = _geo_fields(comp, fa, fb)
    if geo is None:
        if prog is None:
            raise ValueError("transition_fields needs the compiled Program without medley.compile")
        geo = program_fields(comp, prog)
    out.update(geo)
    return out


def program_fields(comp: dict, prog: S.Program) -> dict:
    """The geometric Transition fields from the compiled Program alone: native A at the region
    start / at A's last audible sample, native B at its first audible point / at span.to (from
    B's pos lane), T, T_overlap, bars, b_enter_s, grid, events_s, land_s, exit_s."""
    T = float(prog.T)
    st = S.static_eval(comp)
    b_ids = _ids(comp, "b")
    firsts = [float(st.m[ct.audible][0] - st.h / 2) for cid, ct in st.clips.items() if cid in b_ids and ct.audible.any()]
    b_enter = float(S.clock_seconds(comp["clock"], [min(firsts)])[0]) if firsts else float(prog.t_land)
    a_end, a_end_src = None, None
    for cp in prog.clips:
        if cp.src == "a" and (sp := VF.audible_span(cp, T)):
            if a_end is None or sp[1] > a_end:
                a_end, a_end_src = sp[1], VF.clip_source_s(cp, sp[1])
    b_first = [cp for cp in prog.clips if cp.src == "b" and VF.clip_source_s(cp, b_enter) is not None]
    return {
        "a_out_start": round(float(VF._src_at(prog, "a", 0.0)), 6),
        "a_out_end": round(float(a_end_src if a_end_src is not None else comp["a_ref"]["exit_t"]), 6),
        "b_in_start": round(float(VF.clip_source_s(b_first[0], b_enter) if b_first else comp["b_ref"]["land_t"]), 6),
        "b_in_end": round(float(VF._src_at(prog, "b", T)), 6),
        "T": round(T, 6), "T_overlap": round(float(prog.t_land), 6),
        "bars": (float(comp["span"]["to"]) - float(comp["span"]["from"])) / int(comp["bpb"]),
        "b_enter_s": round(b_enter, 6), "grid": [list(g) for g in prog.grid],
        "events_s": [list(e) for e in prog.events],
        "land_s": comp["b_ref"]["land_t"], "exit_s": comp["a_ref"]["exit_t"],
    }


def patch_plan(plan: dict, i: int, res: JoinResult, fa: dict | None = None, fb: dict | None = None) -> None:
    """Put a ladder result into plan["transitions"][i] (fields re-derived when the kept
    composition is not the planned one) and its checks summary."""
    tr = plan["transitions"][i]
    if res.comp["hash"] != tr["composition"]["hash"]:
        tr.update(transition_fields(res.comp, res.prog, fa, fb))
    tr["checks_summary"] = S.checks_summary(res.checks)


def refresh_plan(plan: dict) -> dict:
    """Recompute what depends on the transitions: native_starts, order starts, total_seconds,
    medley.stats (tiers and verification counts)."""
    trs = plan["transitions"]
    for i, tr in enumerate(trs):
        plan["native_starts"][i + 1] = tr["b_in_end"]
    tl = VF.mix_timeline(plan)
    for i, o in enumerate(plan["order"]):
        o["start"] = round(0.0 if i == 0 else tl[i - 1]["chapter_next"], 3)
    last = tl[-1]
    total = last["body_out"] + (last["body_src"][1] - last["body_src"][0])
    plan["total_seconds"] = round(total, 3)
    st = plan["medley"]["stats"]
    st["songs"], st["total_s"] = len(plan["order"]), round(total, 3)
    st["tiers"] = {t: sum(1 for tr in trs if tr["tier"] == t) for t in S.TIERS}
    sums = [tr.get("checks_summary") for tr in trs]
    st["verified"] = sum(1 for c in sums if c and c["status"] == "pass")
    st["warned"] = sum(1 for c in sums if c and c["status"] == "warn")
    st["failed"] = sum(1 for c in sums if c and c["status"] == "fail")
    st["unverified"] = sum(1 for c in sums if c is None)
    return plan


# ---------------------------------------------------------------------------------------------
# build_all
# ---------------------------------------------------------------------------------------------
def build_all(s, set_id=None, progress=None, *, store=None, hooks=None, hard=VF.HARD_PHASE1, bt=None,
              verify: bool = True, regions_dir: str | None = None, max_rounds: int = 3, log=print) -> dict:
    """Render and verify every join with the ladder; re-plan while bad landings are added.
    Returns {"plan": the patched plan (a copy), "joins": [JoinResult], "rounds": n}."""
    store = store or _store(s, set_id)
    refs = _Refs()
    done: dict[str, JoinResult] = {}             # planned composition hash -> result
    plan, rounds = None, 0
    for rounds in range(1, max_rounds + 1):
        plan = copy.deepcopy(s.plan())
        trs = plan["transitions"]
        hk = hooks(plan) if callable(hooks) and not isinstance(hooks, Hooks) else (hooks or Hooks(plan, log=log))
        if isinstance(hk, Hooks):
            hk.plan = plan
        replan = False
        results = []
        for i, tr in enumerate(trs):
            h = tr["composition"]["hash"]
            if h not in done:                    # (a re-plan may pick a composition kept earlier)
                log(f"[{i + 1}/{len(trs)}] {tr['key']} {tr['form']} {tr['variant']}")
                if verify:
                    done[h] = ladder(s, i, plan, hooks=hk, store=store, hard=hard, bt=bt, refs=refs,
                                     regions_dir=regions_dir, recent=[x.comp["form"] for x in results], log=log)
                else:
                    r = render_comp(s, plan, i, tr["composition"])
                    path = None
                    if regions_dir:
                        path = os.path.join(regions_dir, f"{i:03d}-{h}.npy")
                        np.save(path, np.asarray(r["out"], np.float32))
                    done[h] = JoinResult(tr["composition"], None, r["prog"], path)
                done.setdefault(done[h].comp["hash"], done[h])
            res = done[h]
            ot = s.order_tracks(plan)
            patch_plan(plan, i, res, _feats(s, ot[i]), _feats(s, ot[i + 1]))
            results.append(res)
            replan |= res.bad_landing
            if progress:
                progress(i + 1, len(trs), f"{tr['key']}: {res.checks['status'] if res.checks else 'rendered'}")
        for res in results:
            res.bad_landing = False              # acted on by this re-plan
        if not replan:
            break
        log(f"re-planning with {len(store.bad_landings)} bad landing(s)")
    refresh_plan(plan)
    return {"plan": plan, "joins": results, "rounds": rounds}


# ---------------------------------------------------------------------------------------------
# full mix
# ---------------------------------------------------------------------------------------------
def _fade(n: int, rising: bool) -> np.ndarray:
    x = np.linspace(0.0, 1.0, max(n, 1), dtype=np.float64)
    g = 0.5 - 0.5 * np.cos(np.pi * (x if rising else 1 - x))
    return g.astype(np.float32)[:, None]


def mix_chapters(plan: dict, tracks: list[dict]) -> tuple[list[dict], list[dict]]:
    """(chapters, timeline): chapter i+1 starts where B first sounds in region i (b_enter_s)."""
    tl = VF.mix_timeline(plan)
    last = tl[-1]
    total = last["body_out"] + (last["body_src"][1] - last["body_src"][0])
    starts = [0.0] + [row["chapter_next"] for row in tl[:-1]]
    chapters = [{"start": round(st, 3), "end": round(starts[k + 1] if k + 1 < len(starts) else total, 3),
                 "title": f"{t.get('artist', '')} - {t.get('title', t['id'])}".strip(" -")}
                for k, (st, t) in enumerate(zip(starts, tracks))]
    return chapters, tl


def render_medley(s, plan: dict, out_path: str, region_of, *, title: str, log=print) -> dict:
    """Stream the whole medley into ffmpeg (MP3 320k + chapters), like render.render_full:
    bodies are native [native_starts[i], a_out_start of join i] (the last ends at final_end),
    regions come from region_of(i) (region seconds [-XF, T + XF]); each chunk is limited and
    joined with an XF crossfade. first_fade_s / final_fade_s fade the first / last body."""
    p = _params(s)
    tracks = s.order_tracks(plan)
    trs, starts = plan["transitions"], plan["native_starts"]
    chapters, tl = mix_chapters(plan, tracks)
    meta = out_path[:-4] + ".ffmeta"
    esc = lambda x: re.sub(r"([=;#\\\n])", r"\\\1", x)       # noqa: E731
    with open(meta, "w") as fh:
        fh.write(f";FFMETADATA1\ntitle={esc(title)}\n")
        for ch in chapters:
            fh.write(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={int(ch['start'] * 1000)}\nEND={int(ch['end'] * 1000)}\n"
                     f"title={esc(ch['title'])}\n")
    proc = subprocess.Popen(
        [FFMPEG, "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "pipe:0",
         "-i", meta, "-map_metadata", "1", "-map_chapters", "1", "-map", "0:a", "-codec:a", "libmp3lame",
         "-b:a", "320k", "-id3v2_version", "3", out_path], stdin=subprocess.PIPE)
    ramp = np.linspace(0, 1, XF, dtype=np.float32)[:, None]
    carry = None
    written = 0

    # V7 is checked on the PCM at ceiling_db; LAME overshoots the PCM true peak by up to ~0.5 dB,
    # so the MP3's limiter sits mp3_headroom_db lower (fixer, review v1 timing #3)
    ceiling = float(p["ceiling_db"]) - float(CFG["loudness"]["mp3_headroom_db"])

    def emit(chunk: np.ndarray, overlaps: bool) -> None:
        nonlocal carry, written
        chunk = tp_limiter(np.asarray(chunk, np.float32), ceiling)   # V7: true-peak aware
        if carry is not None and overlaps and len(chunk) >= XF:
            chunk = chunk.copy()
            chunk[:XF] = carry * (1 - ramp) + chunk[:XF] * ramp
        elif carry is not None:
            proc.stdin.write(carry.astype(np.float32).tobytes())
            written += len(carry)
        if len(chunk) >= XF:
            proc.stdin.write(chunk[:-XF].astype(np.float32).tobytes())
            written += len(chunk) - XF
            carry = chunk[-XF:]
        else:
            proc.stdin.write(chunk.astype(np.float32).tobytes())
            written += len(chunk)
            carry = None

    try:
        for i, t in enumerate(tracks):
            y = s.audio.get(t["path"])
            end = trs[i]["a_out_start"] if i < len(trs) else float(plan.get("final_end") or t["duration"])
            body = crop(y, _s(starts[i]), _s(max(end, starts[i] + 2 * XF / SR))) * np.float32(track_gain(t, p))
            if i == 0 and float(plan.get("first_fade_s") or 0) > 0:
                n = min(len(body), _s(float(plan["first_fade_s"])))
                body[:n] *= _fade(n, True)
            if i == len(tracks) - 1 and float(plan.get("final_fade_s") or 0) > 0:
                n = min(len(body), _s(float(plan["final_fade_s"])))
                body[len(body) - n:] *= _fade(n, False)
            emit(body, overlaps=i > 0)
            if i < len(trs):
                emit(region_of(i), overlaps=True)
            log(f"  [{i + 1}/{len(tracks)}] {t.get('artist', '')} - {t.get('title', t['id'])}")
        if carry is not None:
            proc.stdin.write(carry.astype(np.float32).tobytes())
            written += len(carry)
    finally:
        proc.stdin.close()
        rc = proc.wait()
        if os.path.exists(meta):
            os.remove(meta)
    if rc != 0:
        raise RuntimeError(f"ffmpeg exited {rc}")
    return {"chapters": chapters, "timeline": tl, "seconds": round(written / SR, 3)}


def write_cue(path: str, mp3: str, title: str, chapters: list[dict]) -> None:
    with open(path, "w") as fh:
        fh.write(f'TITLE "{title}"\nFILE "{os.path.basename(mp3)}" MP3\n')
        for n, ch in enumerate(chapters, 1):
            mm, ss = divmod(ch["start"], 60)
            ff = int((ss - int(ss)) * 75)
            artist, _, name = ch["title"].partition(" - ")
            fh.write(f'  TRACK {n:02d} AUDIO\n    PERFORMER "{artist}"\n    TITLE "{name}"\n'
                     f"    INDEX 01 {int(mm):02d}:{int(ss):02d}:{ff:02d}\n")


# ---------------------------------------------------------------------------------------------
# CLI host
# ---------------------------------------------------------------------------------------------
def load_tracks(folder: str, data_dir: str, log=print) -> list[dict]:
    """E1's read-only loader (cached analyses + segments + metadata; never analyses)."""
    from .load import load_tracks as _lt, unanalysed
    missing = unanalysed(folder, os.path.join(data_dir, "analysis"))
    if missing:
        log(f"  {len(missing)} file(s) have no analysis (run automix analyze): skipped")
    return _lt(folder, data_dir)


class CliSession:
    """The read-only host `automix medley build` uses (never writes session.json)."""

    def __init__(self, folder: str, data_dir: str, out_dir: str, seed: int | None = None,
                 limit_joins: int | None = None, log=print):
        from ..audio import AudioCache
        from ..params import defaults
        from .feats import FeatStore
        self.folder, self.data_dir, self.log = folder, data_dir, log
        self.state = {"params": defaults()}
        self.tracks = load_tracks(folder, data_dir, log)
        self.by_id = {t["id"]: t for t in self.tracks}
        self.audio = AudioCache(size=6)
        self.mfeats = FeatStore(os.path.join(data_dir, "medley", "feats"), data_dir)
        try:
            from .stems import StemStore
            self.stems = StemStore(os.path.join(data_dir, CFG["stems"]["dir"]))
        except ImportError:
            self.stems = None
        try:
            from .engine import WarpCache
            self.warp_cache = WarpCache(int(CFG["warp_cache_mb"]) << 20)
        except ImportError:
            self.warp_cache = None
        self.store = VF.VerifyStore(os.path.join(out_dir, "verify.json"))
        # v6: per-form rating priors (Bayesian mean of medley-ratings.json) for the beam and the ladder
        CFG["creation"]["form_prior"] = VF.load_form_priors(os.path.join(data_dir, "medley-ratings.json"))
        self.seed = int(seed) if seed is not None else int(time.time()) % 100000
        self.memo: dict = {}
        self.doc_medley = {"version": 1, "seed": self.seed, "target_s": CFG["target_s"],
                           "blocks": list(CFG["blocks"]["order"]), "pins": {}}
        from ..plan import energy_scores
        from .order import select_and_order
        order = list(select_and_order(self.tracks, self.mfeats, energy_scores(self.tracks, self.state["params"]),
                                      CFG, self.seed))
        self.order_ids = order[: limit_joins + 1] if limit_joins else order
        self.limited = order[len(self.order_ids):]           # dropped by --limit-joins, not excluded
        self._plan, self._plan_key = None, None

    def plan(self) -> dict:
        key = self.store.version
        if self._plan_key != key:
            from .planner import build_medley_plan
            self._plan = build_medley_plan(self.tracks, self.order_ids, self.state["params"], self.doc_medley,
                                           self.mfeats, self.stems, self.store, self.memo)
            self._plan_key = key
        return self._plan

    def order_tracks(self, plan: dict) -> list[dict]:
        """§15: one gain everywhere; lufs = target - excerpt gain (the clamped gain_db)."""
        ex = {e["track"]: e for e in plan["medley"]["excerpts"]}
        tgt = float(self.state["params"]["target_lufs"])
        return [dict(self.by_id[o["id"]], lufs=tgt - float(ex[o["id"]]["gain_db"])) for o in plan["order"]]

    def verify_store(self, set_id=None) -> VF.VerifyStore:
        return self.store


def cli_prep(folder: str, data_dir: str, log=print, rederive: bool = False) -> dict:
    """`automix medley prep <folder> [--rederive]`: E1's feats.prep (resumable, <= CFG
    ops.max_cpu_procs CPU workers, writes feats/README.json with the class histogram and
    tau_key); --rederive re-derives landings and stem features without audio analysis."""
    from .feats import prep
    return prep(folder, data_dir, log=log, rederive=rederive)


def _table(plan: dict, joins: list[JoinResult], log=print) -> None:
    log(f"\n{'#':>3} {'form':<15} {'b_in':<7} {'relation':<14} {'status':<6} {'land ms':>7} {'flams':>5} "
        f"{'bass':>5} {'air':>6} {'tries':>5}  join")
    for i, (tr, res) in enumerate(zip(plan["transitions"], joins)):
        rel = tr["composition"]["rel"]
        rtxt = rel["kind"] + (f" {rel['stretch_pct']:+.1f}%" if rel["kind"] == "lock" else
                              f" {rel['a_ratio']:g}:1" if rel["kind"] == "double" else "")
        c = res.checks
        if c:
            row = (f"{c['status']:<6} {c['land_err_ms']:7.1f} {c['flams']:5d} {c['dbl_bass_beats']:5.1f} "
                   f"{c['a_air_db']:6.1f} {len(c['history']):5d}")
        else:
            row = f"{'-':<6} {'':>7} {'':>5} {'':>5} {'':>6} {'':>5}"
        fail = f"  fail {','.join(c['fail'])}" if c and c["fail"] else ""
        bl = (res.blend or {}).get("score")
        log(f"{i + 1:>3} {tr['form']:<15} {tr['b_in']:<7} {rtxt:<14} {row}  {tr['a'][-8:]} > {tr['b'][-8:]}"
            f"  blend {bl if bl is not None else '-'}{fail}")


def cli_build(folder: str, out_dir: str, seed: int | None = None, limit_joins: int | None = None, *,
              data_dir: str, strict: bool = False, no_verify: bool = False, mix_check: bool = True,
              log=print, session=None) -> str:
    """`automix medley build`: plan, render + verify every join with the ladder, render
    <out>/medley-<stamp>.mp3 with chapters, plus .json (plan + report), .cue and verify.json."""
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    s = session or CliSession(folder, data_dir, out_dir, seed, limit_joins, log)
    hard = VF.HARD_ALL if strict else VF.HARD_PHASE1
    regions = tempfile.mkdtemp(prefix=".regions-", dir=out_dir)
    try:
        store = s.verify_store()
        hooks = getattr(s, "hooks", None)
        if hooks is None and isinstance(getattr(s, "memo", None), dict):
            hooks = lambda plan: MemoHooks(plan, s.memo, store, log, source=s.plan())      # noqa: E731
        rep = build_all(s, None, store=store, hard=hard, verify=not no_verify, regions_dir=regions,
                        hooks=hooks, bt=getattr(s, "bt", None), log=log)
        plan, joins = rep["plan"], rep["joins"]
        stamp = time.strftime("%Y%m%d-%H%M%S")
        mp3 = os.path.join(out_dir, f"medley-{stamp}.mp3")
        title = f"Claude_Best · Medley - {os.path.basename(folder.rstrip('/'))}"
        paths = {i: res.region for i, res in enumerate(joins)}
        log(f"rendering {mp3}")
        mix = render_medley(s, plan, mp3, lambda i: np.load(paths[i]), title=title, log=log)
    finally:
        shutil.rmtree(regions, ignore_errors=True)
    write_cue(mp3[:-4] + ".cue", mp3, title, mix["chapters"])
    vmix = None
    if mix_check and not no_verify:
        log("V13: Beat This (CPU) on the whole mix")
        feats = {}
        for t in s.order_tracks(plan):
            F = _feats(s, t)
            if F is not None:
                feats[t["id"]] = F
        vmix = VF.verify_mix(mp3, plan, s.tracks, feats=feats, timeline=mix["timeline"], bt=getattr(s, "bt", None))
        log(f"V13 {vmix['status']}: body downbeats {vmix['body_frac']:.1%} within {VC['v13_body_ms']} ms, "
            f"landings {vmix['land_frac']:.1%} within {VC['v13_land_ms']} ms")
    store = s.verify_store()
    meta = plan["medley"]
    limited = set(getattr(s, "limited", []) or [])
    report = {
        "kind": "medley", "title": title, "folder": folder, "created": stamp, "seed": meta.get("seed"),
        "medley_version": MEDLEY_VERSION, "compiler": COMPILER_VERSION, "mp3": os.path.basename(mp3),
        "checks": "off" if no_verify else "strict" if strict else "phase1",
        "params": {k: _params(s)[k] for k in ("target_lufs", "ceiling_db")},
        "seconds": mix["seconds"], "build_seconds": round(time.time() - t0, 1), "rounds": rep["rounds"],
        "chapters": mix["chapters"], "timeline": mix["timeline"], "stats": meta["stats"],
        "excluded": [e for e in meta.get("excluded", []) if e["track"] not in limited],
        "limited": len(limited), "needs_prep": meta.get("needs_prep", []),
        "joins": [{"index": i, "key": tr["key"], "form": tr["form"], "variant": tr["variant"], "b_in": tr["b_in"],
                   "relation": tr["composition"]["rel"]["kind"], "hash": tr["composition"]["hash"],
                   "checks": res.checks, "attempts": res.attempts, "blend": res.blend}
                  for i, (tr, res) in enumerate(zip(plan["transitions"], joins))],
        "verify_mix": vmix,
        "store": {"path": os.path.basename(store.path), "version": store.version, "failed": len(store.failed),
                  "bad_landings": store.bad_landings},
        "plan": plan,
    }
    with open(mp3[:-4] + ".json", "w") as fh:
        fh.write(S.to_json(report, indent=1))
    _table(plan, joins, log)
    st = meta["stats"]
    log(f"\n{st['songs']} songs · {st['total_s'] / 60:.1f} min · " + " / ".join(f"{v} {k}" for k, v in st["tiers"].items())
        + f" · {st['verified']} verified · {st['warned']} warn · {st['failed']} fail"
        + (f" · {len(report['excluded'])} excluded" if report["excluded"] else "")
        + (f" · {len(limited)} left out by --limit-joins" if limited else ""))
    for e in report["excluded"]:
        log(f"  excluded {e['track']}: {e['reason']} ({e.get('detail', '')})")
    log(mp3)
    return mp3
