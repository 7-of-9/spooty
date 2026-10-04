"""E4: build.py (ladder §16.2, plan patching, full mix, CLI) against the Phase 0 fixtures and a
toy world: three 120 BPM synth tracks, a fake session and a toy engine that renders
native-only, constant-tempo compositions from schema.static_eval lanes. The real verifier runs
on every render; Beat This is replaced by the part's strong onsets."""

import copy
import json
import os
import subprocess
import sys

import numpy as np
import pytest

import synth
from automix.audio import FFMPEG, split_bands
from automix.medley import CFG
from automix.medley import build as B
from automix.medley import schema as S
from automix.medley import verify as V
from automix.render import crop

SR = 44100
XF = int(0.015 * SR)
BPM, BEAT, BAR = 120.0, 0.5, 2.0
LAND_BAR, EXIT_BAR = 10, 26                     # every excerpt: land bar 10, exit bar 26 (32 s)


def t_of_bar(k: int) -> float:
    return 0.5 + k * BAR                        # synth tracks start at 0.5 s


# ---------------------------------------------------------------------------------------------
# toy world
# ---------------------------------------------------------------------------------------------
def toy_program(comp: dict) -> S.Program:
    """Native clips only, constant tempo: region t <-> source s is a pure offset per clip."""
    cm, ct = S.tabulate_clock(comp["clock"], comp["span"])
    tm = lambda m: float(S.clock_seconds(comp["clock"], [m])[0])     # noqa: E731
    f, to = comp["span"]["from"], comp["span"]["to"]
    T, t_land = tm(to), tm(0)
    st = S.static_eval(comp)
    clips = []
    for c in comp["clips"]:
        ref = comp["a_ref"] if c["src"] == "a" else comp["b_ref"]
        s_at = (ref["exit_t"] if c["src"] == "a" else ref["land_t"]) + c["u0"] * ref["period_s"]
        t_at = tm(c["at"])
        t0 = -XF / SR if c["at"] <= f else t_at
        t1 = T + XF / SR if c["at"] + c["len"] >= to else tm(c["at"] + c["len"])
        s0 = s_at + (t0 - t_at) - 1.0
        ctk = st.clips[c["id"]]
        lv = np.where(ctk.inside, ctk.level, -np.inf)
        knots = [[float(t), None if not np.isfinite(v) else float(v), "lin"] for t, v in zip(st.t, lv)]
        clips.append(S.ClipProgram(id=c["id"], src=c["src"], stems="mix",
                                   source={"kind": "native", "s0": s0, "s1": s0 + (t1 - t0) + 2.0},
                                   pos=[{"t0": t0, "t1": t1, "kind": "copy", "w0": 1.0}],
                                   gain_db=knots, hp_hz=None, lp_hz=None, eq_db={"low": [], "mid": [], "high": []},
                                   trim_db=0.0, track_gain_from=c["src"]))
    vac = [[tm(m["at"]), tm(m["at"] + m["len"])] for m in comp["moves"] if m["type"] == "vacuum"]
    exp = {"land_t": t_land, "vacuums": vac, "layered": [], "tonal": [], "ramps": [], "step_planned_lu": None,
           "silences": [], "gestures": [], "seams": [], "onsets": {}}
    return S.Program(version="1.0", sr=SR, xf=XF, T=T, t_land=t_land, clock_m=cm, clock_t=ct, clips=clips,
                     echoes=[], splices=[], grid=[[tm(m), m % comp["bpb"] == 0, "b" if m >= 0 else "a"]
                                                  for m in range(int(f), int(to) + 1)],
                     events=[[tm(a), tm(b), lab] for a, b, lab in comp["events"]], expect=exp)


class Toy:
    """engine stand-in: render_join / compile_join / render_program for toy compositions.
    faults: [(form, variant substring, b_shift_s, lead_only)]: B sounds late in matching
    compositions, before the landing only (a flammed lead) or everywhere (a bad landing)."""

    def __init__(self):
        self.faults: list[tuple[str, str, float, bool]] = []
        self.calls: list[str] = []
        self._comp = None

    def compile_join(self, comp, fa, fb, sr):
        self._comp = comp
        return toy_program(comp)

    def render_program(self, prog, ya, yb, ga, gb, sa, sb, wc):
        self.calls.append("render_program")
        return self._render(self._comp, prog, ya, yb, ga, gb)

    def render_join(self, ya, yb, a, b, tr, p, parts=False, *, stems=None, feats=None, warp_cache=None, sink=None):
        from automix.render import track_gain
        comp = tr["composition"]
        self.calls.append("render_join")
        prog = toy_program(comp)
        out, pa, pb = self._render(comp, prog, ya, yb, track_gain(a, p), track_gain(b, p))
        if sink is not None:
            sink.update(prog=prog, out=out, pa=pa, pb=pb)
        return (out, pa, pb) if parts else out

    def _render(self, comp, prog, ya, yb, ga, gb):
        st = S.static_eval(comp)
        n = XF + int(round(prog.T * SR)) + XF
        t = (np.arange(n) - XF) / SR
        parts = {"a": np.zeros((n, 2), np.float32), "b": np.zeros((n, 2), np.float32)}
        hit = [(sh, lead) for f, v, sh, lead in self.faults if f == comp["form"] and v in comp["variant"]]
        for c in comp["clips"]:
            ref = comp["a_ref"] if c["src"] == "a" else comp["b_ref"]
            s_at = (ref["exit_t"] if c["src"] == "a" else ref["land_t"]) + c["u0"] * ref["period_s"]
            off = s_at - float(S.clock_seconds(comp["clock"], [c["at"]])[0])
            y, g = (ya, ga) if c["src"] == "a" else (yb, gb)
            i0 = int(round((off - XF / SR) * SR))
            x = crop(y, i0, i0 + n) * np.float32(g)
            for sh, lead in (hit if c["src"] == "b" else []):
                late = crop(y, i0 - int(round(sh * SR)), i0 - int(round(sh * SR)) + n) * np.float32(g)
                x = np.where(((t < prog.t_land) if lead else np.ones(n, bool))[:, None], late, x)
            ct = st.clips[c["id"]]
            # lanes step at the 1/64-beat grid edges, so a clip starting at m = 0 starts exactly
            # at t_land (the real engine starts B 3 ms early with a 2 ms fade, R8)
            k = np.clip(np.floor((np.interp(t, prog.clock_t, prog.clock_m) - comp["span"]["from"]) / st.h).astype(int),
                        0, len(st.m) - 1)
            amp = lambda db: np.where(ct.inside & np.isfinite(db), 10 ** (np.nan_to_num(db, neginf=0) / 20), 0.0)[k]  # noqa: E731
            lo, rest = split_bands(x, 150.0)
            mid, hi = split_bands(rest, 2500.0)
            y = lo * amp(ct.eq["low"])[:, None] + mid * amp(ct.eq["mid"])[:, None] + hi * amp(ct.eq["high"])[:, None]
            parts[c["src"]] += (y * amp(ct.level)[:, None]).astype(np.float32)
        return parts["a"] + parts["b"], parts["a"], parts["b"]


def strong_onsets_bt(mono, sr):
    """Beat This stand-in: every strong onset is a beat and a downbeat."""
    t, s = V.onsets(mono)
    keep = t[s >= 0.25 * np.percentile(s, 95)] if len(s) else t
    return keep, keep


class FakeAudio:
    def __init__(self, ys):
        self.ys = ys

    def get(self, path):
        return self.ys[path]


class FakeFeats:
    def __init__(self, by_id):
        self.by_id = by_id

    def get(self, t):
        return self.by_id[t["id"]]


def feats_for(s: synth.Synth, tid: str) -> dict:
    i0, i1 = int(8 * SR), int(28 * SR)                           # onsets of a 20 s excerpt
    t, st = V.onsets(s.y[i0:i1])
    t = t + i0 / SR
    down = [st[np.argmin(np.abs(t - d))] for d in s.downbeats if i0 / SR < d < i1 / SR and np.min(np.abs(t - d)) < 0.005]
    return {"track": tid, "bpm": BPM, "bpb": 4, "grid_class": "locked",
            "onsets": {"t": t.tolist(), "strength": st.tolist(), "median_down_strength": float(np.median(down))},
            "kblocks": {"block_s": 0.4, "hop_s": 0.1, "ms": V.kblocks(s.y)},
            "bars": {"t": [float(x) for x in s.downbeats], "perc_db": [0.0] * len(s.downbeats),
                     "low_db": [0.0] * len(s.downbeats)},
            "landings": [{"bar": LAND_BAR, "lead": {"pickup_beats": 0}}, {"bar": LAND_BAR + 1, "lead": {"pickup_beats": 0}}]}


def drop_comp(i: int, a: str, b: str, land_bar: int = LAND_BAR) -> dict:
    """A §10.1-style drop_swap on the toy grid: 4-bar B lead with its low killed, A's mid/high
    -8 dB over the lead, air (A low out at -1/2, cos fade over the last beat), low swap at 0."""
    c = {"id": f"j{i:02d}", "a": a, "b": b, "form": "drop_swap", "variant": "L4.eqpow", "tier": "smooth",
         "loud": False, "b_in": "swap",
         "rel": {"kind": "lock", "ratio": 1.0, "a_ratio": 1, "stretch_pct": 0.0, "camelot": 0, "chroma": None,
                 "a_class": "locked", "b_class": "locked"},
         "bpb": 4, "a_ref": {"exit_bar": EXIT_BAR, "exit_t": t_of_bar(EXIT_BAR), "period_s": BEAT},
         "b_ref": {"land_bar": land_bar, "land_t": t_of_bar(land_bar), "period_s": BEAT},
         "clock": [{"m0": -20, "m1": -16, "kind": "a_fit", "bpm0": BPM, "bpm1": BPM},
                   {"m0": -16, "m1": 4, "kind": "b_fit", "bpm0": BPM, "bpm1": BPM}],
         "span": {"from": -20, "to": 4},
         "clips": [{"id": "A", "src": "a", "stem": "mix", "at": -20, "len": 20, "u0": -20, "ratio": 1,
                    "warp": "native", "gain_db": 0},
                   {"id": "B", "src": "b", "stem": "mix", "at": -16, "len": 20, "u0": -16, "ratio": 1,
                    "warp": "native", "gain_db": 0}],
         "moves": [{"type": "eq", "clip": "B", "band": "low", "at": -16, "len": 0, "to_db": None, "curve": "hold"},
                   {"type": "fade", "clip": "B", "at": -16, "len": 15, "from_db": -12, "to_db": 0, "shape": "eqpow"},
                   {"type": "eq", "clip": "A", "band": "mid_high", "at": -16, "len": 15, "to_db": -8, "curve": "lin"},
                   {"type": "eq", "clip": "A", "band": "low", "at": -0.5, "len": 0, "to_db": None, "curve": "hold"},
                   {"type": "fade", "clip": "A", "at": -1, "len": 1, "from_db": 0, "to_db": None, "shape": "cos"},
                   {"type": "swap", "at": 0, "out": ["A"], "in": ["B"], "band": "low", "ms": 4}],
         "events": [[-16, 0, "B lead in"], [-0.5, 0, "air"], [0, 0, "land"]],
         "fallback": ["roll_slam", "cut_on_one"], "hash": ""}
    return B._rehash(c)


class FakeSession:
    """The session_like contract of build.py over the toy world."""

    def __init__(self, world, store_path, n_tracks=3):
        from automix.params import defaults
        self.world = world
        self.state = {"params": dict(defaults(), target_lufs=-11.0)}
        self.ids = [f"spotify:TOY{k:019d}" for k in range(n_tracks)]
        self.tracks = [{"id": tid, "path": f"/toy/{k}.mp3", "artist": f"Toy {k}", "title": f"Track {k}",
                        "file": f"Toy {k} - Track {k}.mp3", "bpm": BPM, "duration": world[k].duration,
                        "downbeats": world[k].downbeats.tolist()}
                       for k, tid in enumerate(self.ids)]
        self.by_id = {t["id"]: t for t in self.tracks}
        self.audio = FakeAudio({t["path"]: world[k].y for k, t in enumerate(self.tracks)})
        self.mfeats = FakeFeats({tid: world.feats[k] for k, tid in enumerate(self.ids)})
        self.stems = self.warp_cache = None
        self.engine = Toy()
        self.store = V.VerifyStore(store_path)
        self.bt = strong_onsets_bt
        self.plans = 0

    def verify_store(self, set_id=None):
        return self.store

    def order_tracks(self, plan):
        return [dict(self.by_id[o["id"]], lufs=-11.0) for o in plan["order"]]

    def plan(self):
        """A planner stand-in: after a bad landing it lands one bar later (another candidate)."""
        self.plans += 1
        bad = {tid for tid, _ in self.store.bad_landings}
        comps = [drop_comp(i, a, b, LAND_BAR + (1 if b in bad else 0))
                 for i, (a, b) in enumerate(zip(self.ids[:-1], self.ids[1:]))]
        if bad:
            self.engine.faults.clear()
        return make_plan(self, comps)


def make_plan(s: FakeSession, comps: list[dict]) -> dict:
    trs = []
    for i, c in enumerate(comps):
        tr = {"index": i, "key": f"{c['a']}>{c['b']}", "a": c["a"], "b": c["b"], "k": 1.0, "requested": "medley",
              "override": {}, "checks_summary": None}
        tr.update(B.transition_fields(c, toy_program(c)))
        trs.append(tr)
    ex, order = [], []
    for k, tid in enumerate(s.ids):
        land = comps[k - 1]["b_ref"]["land_bar"] if k else LAND_BAR
        e = {"track": tid, "block": "house", "bpb": 4, "grid_class": "locked", "bpm": BPM,
             "lead": {"type": "nobass-nodrums", "bars": 4, "t": t_of_bar(land - 4), "pickup_beats": 0},
             "land": {"bar": land, "t": t_of_bar(land), "label": "chorus", "why": "chorus", "rel_db": 0.0},
             "exit": {"bar": EXIT_BAR, "t": t_of_bar(EXIT_BAR), "kind": "natural", "s_out": 0.4, "vocal_clear": None},
             "body_bars": EXIT_BAR - land, "body_lufs": -11.0, "arc_off_lu": 0, "gain_db": 0.0, "h": 3.0,
             "labels": ["chorus"]}
        ex.append(e)
        t = s.tracks[k]
        order.append({"id": tid, "artist": t["artist"], "title": t["title"], "file": t["file"], "bpm": BPM,
                      "duration": t["duration"], "start": 0.0,
                      "excerpt": {"lead_t": e["lead"]["t"], "land_t": e["land"]["t"], "exit_t": e["exit"]["t"],
                                  "lead_type": e["lead"]["type"], "labels": e["labels"]}})
    plan = {"kind": "medley", "order": order, "transitions": trs, "total_seconds": 0.0,
            "native_starts": [ex[0]["lead"]["t"]] + [tr["b_in_end"] for tr in trs],
            "first_fade_s": 0, "final_end": t_of_bar(EXIT_BAR), "final_fade_s": 2 * BAR,
            "medley": {"schema": S.SCHEMA_ID, "medley_version": "1.0", "compiler": "1.0", "seed": 7,
                       "target_s": CFG["target_s"], "excerpts": ex, "motif": None, "needs_prep": [],
                       "excluded": [{"track": "spotify:EXCLUDED0000000000000", "reason": "too_short",
                                     "detail": "85 s < 100 s"}],
                       "stats": {"songs": len(order), "total_s": 0.0,
                                 "tiers": {"smooth": 0, "noticeable": 0, "signature": 0},
                                 "verified": 0, "warned": 0, "failed": 0, "unverified": len(trs)}}}
    return B.refresh_plan(plan)


@pytest.fixture(scope="module")
def world():
    # no saw bass: synth.py's naive sawtooth puts a flux peak in every period (~15 ms)
    parts = [{"kick", "hat", "pad"}, {"kick", "hat", "snare", "pad"}, {"kick", "hat", "pad"}]
    ws = [synth.make_track(BPM, [("s", 40, p)], seed=10 + k, root=57 + 2 * k) for k, p in enumerate(parts)]
    for w in ws:
        w.y *= np.float32(0.35)
    ws = type("World", (list,), {})(ws)
    ws.feats = [feats_for(w, f"spotify:TOY{k:019d}") for k, w in enumerate(ws)]
    return ws


@pytest.fixture
def sess(world, tmp_path):
    return FakeSession(world, str(tmp_path / "verify.json"))


# ---------------------------------------------------------------------------------------------
# fixtures: compat fields, repairs, cut_on_one
# ---------------------------------------------------------------------------------------------
def test_transition_fields_reproduce_the_plan_fixture(comp, program, plan, feats):
    """Both derivations (the compiler's, and program_fields on the compiled Program) give the
    fixture plan's compatibility fields."""
    tr = plan["transitions"][0]
    geo = ("a_out_start", "a_out_end", "b_in_start", "b_in_end", "T", "T_overlap", "b_enter_s", "land_s",
           "exit_s", "bars")
    pf = B.program_fields(comp, program)
    for k in geo:
        assert pf[k] == pytest.approx(tr[k], abs=2e-6), k
    assert pf["grid"] == tr["grid"] and pf["events_s"] == tr["events_s"]
    f = B.transition_fields(comp, program, feats["dance_no_more"], feats["dreaming"])
    for k in geo + ("beatmatch", "stretch_pct", "key_distance", "form", "variant", "tier", "b_in"):
        assert f[k] == pytest.approx(tr[k], abs=2e-3), k


def test_generic_repairs_on_the_8_10_example(comp, feats):
    fa, fb = feats["dance_no_more"], feats["dreaming"]
    fail = lambda *c: {"fail": list(c)}                          # noqa: E731
    r = B.generic_repair(comp, fail("V3"), 1, fa, fb)           # layering 4 -> 2 bars
    assert r is not None and r["hash"] != comp["hash"] and S.validate_composition(r, fa, fb) == []
    b = next(c for c in r["clips"] if c["id"] == "B")
    assert (b["at"], b["len"], b["u0"]) == (-8, 12, -8) and r["variant"] == "L2.pulse-offbeat"
    lead = [m for m in r["moves"] if m.get("clip") == "B" and m["type"] in ("eq", "fade")]
    assert all(m["at"] == -8 for m in lead) and lead[1]["len"] == 7
    assert B.generic_repair(r, fail("V4"), 2, fa, fb) is None   # at 2 bars the form must change
    air = B.generic_repair(comp, fail("V11"), 1, fa, fb)
    mv = {(m["type"], m.get("band")): m for m in air["moves"] if m.get("clip") == "A"}
    assert mv[("eq", "low")]["at"] == -1 and (mv[("fade", None)]["at"], mv[("fade", None)]["len"]) == (-2, 2)
    trim = B.generic_repair(comp, fail("V7"), 1, fa, fb)
    assert trim["moves"][0] == {"type": "fade", "clip": "A", "at": -24, "len": 4.0, "from_db": 0.0, "to_db": -3.0,
                                "shape": "lin"}
    assert S.validate_composition(trim, fa, fb) == []
    xf = B.generic_repair(comp, fail("V6"), 1, fa, fb)
    assert xf["variant"].endswith(".xf10") and B.generic_repair(xf, fail("V6"), 2, fa, fb) is None
    for code in ("V1", "V8", "V2b", "V10"):
        assert B.generic_repair(comp, fail(code, "V11"), 1, fa, fb) is None


def test_cut_on_one_fallback_validates(comp, comp_slam, feats):
    fa, fb, fc = feats["dance_no_more"], feats["dreaming"], feats["bluebird"]
    c = B.cut_on_one_from(comp, fa, fb)                         # Dreaming has a 2-beat pickup at bar 80
    assert c is not None and S.validate_composition(c, fa, fb) == []
    assert c["form"] == "cut_on_one" and c["tier"] == "noticeable" and c["b_in"] == "slam"
    b = next(x for x in c["clips"] if x["src"] == "b")
    cut = c["moves"][0]
    assert b["at"] < 0 and cut["at"] <= b["at"] and c["span"]["from"] == -8
    c2 = B.cut_on_one_from(comp_slam, fb, fc)                    # free relation, verify-class A
    assert c2 is not None and S.validate_composition(c2, fb, fc) == []
    assert c2["clock"][0]["kind"] == "a_fit" and c2["clock"][1]["bpm0"] == pytest.approx(174.0017, abs=1e-3)


def test_patch_program_applies_the_v6_retry(comp, program):
    p = copy.deepcopy(program)
    B.patch_program(p, comp)
    assert [sp.xf_ms for sp in p.splices] == [sp.xf_ms for sp in program.splices]
    tagged = dict(comp, variant=comp["variant"] + ".xf10")
    B.patch_program(p, tagged)
    assert all(sp.xf_ms >= CFG["splice_xf_low_ms"] for sp in p.splices)
    assert all(sp.search_ms in (0.0, CFG["compile"]["splice_search_retry_ms"]) for sp in p.splices)


# ---------------------------------------------------------------------------------------------
# the ladder on the toy world
# ---------------------------------------------------------------------------------------------
def test_toy_plan_is_a_valid_medley_plan(sess):
    plan = sess.plan()
    assert S.validate_plan(plan, deep=True) == []
    assert plan["medley"]["stats"]["unverified"] == 2


def test_render_and_verify_stores_checks(sess):
    plan = sess.plan()
    sink = {}
    ch = B.render_and_verify(sess, 0, plan, bt=strong_onsets_bt, sink=sink)
    assert S.validate_checks(ch) == [] and sess.store.get(plan["transitions"][0]["composition"]["hash"]) == ch
    assert abs(ch["land_err_ms"]) <= 2 and ch["flams"] == 0 and ch["dbl_bass_beats"] <= 1
    assert isinstance(sink["prog"], S.Program)


def test_ladder_repairs_a_flammed_lead_then_passes(sess):
    sess.engine.faults.append(("drop_swap", "L4", 0.040, True))   # the 4-bar lead flams by 40 ms
    plan = sess.plan()
    res = B.ladder(sess, 0, plan, bt=strong_onsets_bt, store=sess.store, log=lambda *a: None)
    hist = res.checks["history"]
    assert hist[0]["fail"] == ["V3"] and len(hist) == 2 and hist[1]["variant"] == "L2.eqpow"
    assert res.checks["status"] != "fail" and res.checks["attempt"] == 2 and res.comp["form"] == "drop_swap"
    assert res.comp["hash"] == hist[1]["hash"] and sess.store.failed == [hist[0]["hash"]]
    assert sess.store.get(res.comp["hash"])["history"] == hist


def test_ladder_falls_back_to_cut_on_one(sess):
    sess.engine.faults.append(("drop_swap", "", 0.015, False))   # B lands 15 ms late in drop_swap
    plan = sess.plan()
    res = B.ladder(sess, 0, plan, bt=strong_onsets_bt, store=sess.store, log=lambda *a: None)
    forms = [h["form"] for h in res.checks["history"]]
    assert forms == ["drop_swap", "cut_on_one"]                  # V1: no repair; roll_slam: no builder
    assert res.comp["form"] == "cut_on_one" and res.checks["status"] != "fail"
    assert "V1" in res.checks["history"][0]["fail"] and not res.bad_landing


def test_ladder_budget_and_bad_landing(sess):
    sess.engine.faults += [("drop_swap", "", 0.015, False), ("cut_on_one", "", 0.015, False)]
    plan = sess.plan()
    hooks = B.Hooks(plan)
    hooks.alternatives = lambda i, c: [dict(B._rehash(dict(copy.deepcopy(c), variant=f"alt{k}")))
                                       for k in range(4)]
    res = B.ladder(sess, 0, plan, hooks=hooks, bt=strong_onsets_bt, store=sess.store, log=lambda *a: None)
    forms = [h["form"] for h in res.checks["history"]]
    assert len(forms) == CFG["verify"]["max_renders"] and forms[-1] == "cut_on_one"
    assert res.checks["status"] == "fail" and res.bad_landing
    assert sess.store.bad_landings == [[plan["transitions"][0]["b"], LAND_BAR]]


def test_memo_hooks_use_the_planners_candidates(sess):
    """Rung 2/3 from the planner memo: same (X_A, j_B) in local-score order, fallback by form,
    failed hashes and bad landings skipped, cut_on_one_from when the memo has no such form."""
    from types import SimpleNamespace as NS
    plan = sess.plan()
    comp = plan["transitions"][0]["composition"]
    alt = B._rehash(dict(copy.deepcopy(comp), variant="L4.steps"))
    other_j = B._rehash(copy.deepcopy(comp) | {"b_ref": dict(comp["b_ref"], land_bar=LAND_BAR + 1)})
    cut = B.cut_on_one_from(comp)
    memo = {"pair": [NS(X=EXIT_BAR, j=LAND_BAR, form="drop_swap", S=2.0, id=1, valid=True, comp=comp),
                     NS(X=EXIT_BAR, j=LAND_BAR, form="drop_swap", S=1.5, id=2, valid=None, comp=alt),
                     NS(X=EXIT_BAR, j=LAND_BAR, form="cut_on_one", S=0.4, id=3, valid=True, comp=cut),
                     NS(X=EXIT_BAR, j=LAND_BAR + 1, form="drop_swap", S=3.0, id=4, valid=True, comp=other_j),
                     NS(X=EXIT_BAR, j=LAND_BAR, form="roll_slam", S=0.9, id=5, valid=False, comp=cut)]}
    hk = B.MemoHooks(plan, memo, sess.store)
    alts = hk.alternatives(0, comp)
    assert [c["variant"] for c in alts] == ["L4.steps", cut["variant"]]
    assert all(c["id"] == comp["id"] for c in alts)
    assert hk.fallback(0, comp, "cut_on_one")["hash"] == alts[1]["hash"]
    assert hk.fallback(0, comp, "roll_slam") is None                  # invalid candidate: skipped
    sess.store.mark_failed(alts[0]["hash"])
    assert [c["variant"] for c in hk.alternatives(0, comp)] == [cut["variant"]]
    assert B.MemoHooks(plan, {}, sess.store).fallback(0, comp, "cut_on_one")["form"] == "cut_on_one"


def test_build_all_replans_after_a_bad_landing(sess, tmp_path):
    sess.engine.faults += [("drop_swap", "", 0.015, False), ("cut_on_one", "", 0.015, False)]
    rep = B.build_all(sess, None, bt=strong_onsets_bt, regions_dir=str(tmp_path), log=lambda *a: None)
    plan = rep["plan"]
    assert rep["rounds"] == 2 and sess.plans == 2
    assert plan["transitions"][0]["composition"]["b_ref"]["land_bar"] == LAND_BAR + 1
    assert all(tr["checks_summary"]["status"] != "fail" for tr in plan["transitions"])
    assert S.validate_plan(plan, deep=True) == []
    st = plan["medley"]["stats"]
    assert st["verified"] + st["warned"] == 2 and st["unverified"] == 0
    assert all(os.path.exists(j.region) for j in rep["joins"])


def test_cli_build_writes_mp3_chapters_report(world, tmp_path, capsys):
    out = tmp_path / "out"
    sess = FakeSession(world, str(out / "verify.json"))          # CliSession keeps it in --out
    mp3 = B.cli_build("/toy/Claude_Best", str(out), data_dir=str(tmp_path), session=sess, log=print)
    base = mp3[:-4]
    assert os.path.exists(mp3) and os.path.exists(base + ".cue") and os.path.exists(out / "verify.json")
    assert not [p for p in os.listdir(out) if p.startswith(".regions")]
    rep = json.load(open(base + ".json"))
    assert rep["kind"] == "medley" and rep["checks"] == "phase1" and len(rep["joins"]) == 2
    assert rep["excluded"][0]["reason"] == "too_short" and rep["verify_mix"] is not None
    assert S.validate_plan(rep["plan"], deep=True) == []
    for j in rep["joins"]:
        assert S.validate_checks(j["checks"]) == [] and j["attempts"]
    probe = json.loads(subprocess.run([FFMPEG.replace("ffmpeg", "ffprobe"), "-v", "error", "-show_chapters",
                                       "-show_format", "-of", "json", mp3], check=True, capture_output=True).stdout)
    starts = [float(c["start_time"]) for c in probe["chapters"]]
    want = [c["start"] for c in rep["chapters"]]
    assert len(starts) == 3 and np.allclose(starts, want, atol=0.002)
    assert probe["format"]["tags"]["title"].startswith("Claude_Best · Medley - ")
    assert float(probe["format"]["duration"]) == pytest.approx(rep["plan"]["total_seconds"], abs=0.1)
    # the MP3 holds each landing where the plan says (B's landing kick on the grid)
    y = V._decode_mono(mp3)
    t, st = V.onsets(y[: int(90 * SR)])
    land = rep["timeline"][0]["land_out"]
    assert np.min(np.abs(t - land)) * 1000 <= 10
    text = capsys.readouterr().out
    assert "form" in text and "verified" in text


def test_cli_build_no_verify_renders_only(world, tmp_path, capsys):
    out = tmp_path / "out"
    sess = FakeSession(world, str(out / "verify.json"))
    sess.limited = ["spotify:EXCLUDED0000000000000"]            # as if cut by --limit-joins
    mp3 = B.cli_build("/toy/x", str(out), data_dir=str(tmp_path), session=sess, no_verify=True, log=print)
    rep = json.load(open(mp3[:-4] + ".json"))
    assert rep["checks"] == "off" and rep["verify_mix"] is None and rep["excluded"] == [] and rep["limited"] == 1
    assert all(j["checks"] is None for j in rep["joins"]) and rep["stats"]["unverified"] == 2
    assert sess.store.version == 0 and S.validate_plan(rep["plan"], deep=True) == []


def test_cli_medley_subcommand_parses(monkeypatch, tmp_path):
    from automix import cli
    seen = {}
    monkeypatch.setattr(B, "cli_build", lambda folder, out, seed, limit, **kw: seen.update(
        folder=folder, out=out, seed=seed, limit=limit, **kw))
    monkeypatch.setattr(sys, "argv", ["automix", "medley", "build", str(tmp_path), "--out", str(tmp_path / "o"),
                                      "--seed", "5", "--limit-joins", "3", "--strict"])
    cli.main()
    assert seen["seed"] == 5 and seen["limit"] == 3 and seen["strict"] is True and seen["no_verify"] is False
    assert seen["out"] == str(tmp_path / "o") and seen["mix_check"] is True
    monkeypatch.setattr(B, "cli_prep", lambda folder, data, log=None, rederive=False: seen.update(prep=folder))
    monkeypatch.setattr(sys, "argv", ["automix", "medley", "prep", str(tmp_path)])
    cli.main()
    assert seen["prep"] == str(tmp_path)
