"""E2 forms / planner tests (DESIGN §7, §10, §11, §8.1): relations, the B-in table, every form's
contract, the local score, enumeration, the beam and build_medley_plan against validate_plan."""

import copy
import json
import time

import numpy as np
import pytest

from automix.medley import CFG
from automix.medley import forms as FM
from automix.medley import planner as PL
from automix.medley import schema as S
from helpers_e2 import beatless, load, locked_ctx, scaled

P = {"target_lufs": -11.0, "ceiling_db": -1.0}


@pytest.fixture(scope="module")
def F():
    return {n: load(n) for n in ("dance_no_more", "dreaming", "bluebird")}


def track(Fx: dict, title: str, camelot: str) -> dict:
    return {"id": Fx["track"], "artist": f"artist {title}", "title": title, "file": Fx["file"],
            "bpm": Fx["bpm"], "duration": Fx["duration"], "camelot": camelot}


@pytest.fixture(scope="module")
def set3(F):
    """Three real tracks (DNM, Dreaming, Bluebird) plus three synthetic ones, as (tracks, feats)."""
    fs = {F[n]["track"]: F[n] for n in F}
    tr = [track(F["dance_no_more"], "Dance No More", "3A"), track(F["dreaming"], "Dreaming", "5A"),
          track(F["bluebird"], "Bluebird", "7A")]
    for k, (src, cam) in enumerate((("dreaming", "4A"), ("dance_no_more", "5A"), ("bluebird", "8A"))):
        G = scaled(F[src], 1.0 + 0.004 * (k + 1), track=f"spotify:synth{k}")
        fs[G["track"]] = G
        tr.append(track(G, f"Synth {k}", cam))
    return tr, fs


# ------------------------------------------------------------------------ relations and cells
def test_relation_from_the_feats_windows(F):
    fa, fb = F["dance_no_more"], F["dreaming"]
    ex = FM.exits_by_bar(fb)[96][0]                            # Dreaming exit window: verify
    rel = FM.relation({"camelot": "5A"}, {"camelot": "3A"}, fb, ex, fa, fa["landings"][0])
    assert rel["kind"] == "lock" and rel["a_ratio"] == 1 and 0 < rel["stretch_pct"] < 1.0
    assert rel["camelot"] == 2 and S.check_type(rel, S.Rel) == []
    ex_a = FM.exits_by_bar(fa)[40][0]                          # DNM exit window: free
    assert FM.relation({}, {}, fa, ex_a, fb, fb["landings"][0])["kind"] == "free"
    slow = scaled(fb, 126 / 87.0, locked=True)
    rel = FM.relation({}, {}, F["bluebird"], FM.exits_by_bar(F["bluebird"])[80][0], slow, slow["landings"][0])
    assert rel["kind"] == "double" and rel["a_ratio"] == 2 and abs(rel["stretch_pct"]) < 1


def test_b_in_table(F):
    ctx = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80)
    assert FM.cell(ctx) == ["tease_drop", "drop_swap", "stem_handover", "vocal_reveal", "cut_on_one"]
    ctx = locked_ctx(F["dreaming"], 96, F["dance_no_more"], 72)
    assert FM.cell(ctx)[:2] == ["phrase_trade", "drop_swap"]
    fc, fb = F["bluebird"], F["dreaming"]
    free = FM.JoinCtx({}, {}, fc, fb, FM.exits_by_bar(fc)[112][0], fb["landings"][0])
    assert FM.cell(free) == ["roll_slam", "tape_stop_slam", "spin_slam", "echo_slam", "cut_on_one"]
    bl = beatless(fb, 80, 4)
    pre = FM.JoinCtx({}, {}, fc, bl, FM.exits_by_bar(fc)[112][0], bl["landings"][0])
    assert FM.cell(pre) == ["echo_slam", "cut_on_one"]
    assert FM.FORMS["echo_slam"].variant_set(pre) == ["preroll"]
    assert not FM.FORMS["roll_slam"].allowed(pre) and FM.FORMS["cut_on_one"].allowed(pre)


def test_forms_declare_the_contract():
    for name, f in FM.FORMS.items():
        assert f.name == name and f.tier == S.FORM_TIER[name] and f.loud == (name in S.LOUD_FORMS)
        assert f.base == CFG["base_f"][name]
        for meth in ("allowed", "variants", "build", "profile"):
            assert callable(getattr(f, meth))
    assert set(FM.FORMS) >= {"drop_swap", "roll_slam", "echo_slam", "cut_on_one", "phrase_trade",
                             "half_time", "stem_handover", "stutter_stitch", "tape_stop_slam", "spin_slam"}
    assert FM.FORMS["stem_handover"].needs_stems


def test_stem_forms_need_stems(F):
    no = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80)
    yes = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80, stems=True)
    assert not FM.FORMS["stem_handover"].allowed(no) and FM.FORMS["stem_handover"].allowed(yes)
    nd = locked_ctx(F["dreaming"], 96, F["dance_no_more"], 24)
    nd.rel["b_class"] = "verify"                                # no R4, no stems: drop_swap is out
    assert not FM.FORMS["drop_swap"].allowed(nd) and FM.FORMS["phrase_trade"].allowed(nd)
    assert FM.FORMS["phrase_trade"].variant_set(nd) == ["cuts"]


# ------------------------------------------------------------------------ §8.10 reproduced
def test_drop_swap_reproduces_the_810_example(F, comp):
    ctx = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80)
    ctx.rel.update(ratio=0.99189, stretch_pct=-0.81, chroma=0.22)
    got = FM.FORMS["drop_swap"].build(ctx, "L4.pulse-offbeat")
    for k in ("form", "variant", "tier", "loud", "b_in", "bpb", "span", "fallback"):
        if k != "fallback":
            assert got[k] == comp[k], k
    assert got["a_ref"]["exit_t"] == comp["a_ref"]["exit_t"] and got["b_ref"]["land_t"] == comp["b_ref"]["land_t"]
    assert [(s["m0"], s["m1"], s["kind"]) for s in got["clock"]] == [(s["m0"], s["m1"], s["kind"]) for s in comp["clock"]]
    for a, b in zip(got["clock"], comp["clock"]):
        assert a["bpm0"] == pytest.approx(b["bpm0"], abs=0.01) and a["bpm1"] == pytest.approx(b["bpm1"], abs=0.01)
    assert got["clips"] == comp["clips"]
    # the §8.10 moves, in order, with the amended R6 air (A's low out at -1, A's top cos over
    # [-1, -1/4]) in place of the example's (-1/2, [-1, 0)), plus R7: Dreaming has a 2-beat
    # pickup, so A's top leaves by -2
    air_old = [{"type": "eq", "clip": "A", "band": "low", "at": -0.5, "len": 0, "to_db": None, "curve": "hold"},
               {"type": "fade", "clip": "A", "at": -1, "len": 1, "from_db": 0, "to_db": None, "shape": "cos"}]
    air_new = [{"type": "eq", "at": -1.0, "clip": "A", "band": "low", "len": 0, "to_db": None, "curve": "hold"},
               {"type": "fade", "at": -1, "clip": "A", "len": 0.75, "from_db": 0, "to_db": None, "shape": "cos"}]
    want = [m for m in comp["moves"] if m not in air_old]
    assert len(want) == len(comp["moves"]) - 2
    extra = [m for m in got["moves"] if m not in comp["moves"]]
    assert [m for m in got["moves"] if m in comp["moves"]] == want
    assert extra == [{"type": "eq", "at": -3, "clip": "A", "band": "mid_high", "len": 1, "to_db": None, "curve": "cos"}] \
        + air_new
    assert S.validate_composition(got, ctx.fa, ctx.fb) == []
    assert got["hash"] == S.canonical_hash(got)


def test_drop_swap_caps_the_lead_on_a_key_clash(F):
    ctx = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80)
    assert not ctx.key_ok and {v.split(".")[0] for v in FM.FORMS["drop_swap"].variant_set(ctx)} == {"L4", "L2"}
    ctx.rel.update(camelot=1)
    assert {v.split(".")[0] for v in FM.FORMS["drop_swap"].variant_set(ctx)} == {"L8", "L4"}
    comp = FM.FORMS["drop_swap"].build(ctx, "L8.eqpow")
    eq = [m for m in comp["moves"] if m["type"] == "eq" and m["band"] == "mid_high" and m["to_db"] is not None]
    assert eq[0]["to_db"] == -6 and eq[0]["at"] == -16             # min(4, L) bars, -6 dB when in key


def test_drop_swap_fill_cuts_a_without_r4(F):
    """Without R4 a percussive B fill before the landing must not meet A's beat: A leaves first."""
    ctx = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80)
    ctx.rel["a_class"] = "verify"
    j = ctx.j
    ctx.fb = copy.deepcopy(ctx.fb)
    ctx.fb["bars"]["perc_db"][j - 1] = 0.0                       # the last lead bar becomes a drum fill
    comp = FM.FORMS["drop_swap"].build(ctx, "L4.eqpow")
    cuts = [m for m in comp["moves"] if m["type"] == "cut"]
    assert len(cuts) == 1 and cuts[0]["clip"] == "A" and -4.5 <= cuts[0]["at"] <= -4 and cuts[0]["at"] * 2 % 1 == 0
    assert not any(m["type"] == "fade" and m["clip"] == "A" for m in comp["moves"])   # no air re-open
    assert S.validate_composition(comp, ctx.fa, ctx.fb) == []


# ------------------------------------------------------------------------ profile and score
def test_profile_windows(F):
    ctx = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80)
    comp = FM.FORMS["drop_swap"].build(ctx, "L4.eqpow")
    pr = FM.FORMS["drop_swap"].profile(comp, ctx.fa, ctx.fb)
    # B's lead is nobass-nodrums; only its 1-bar fill is percussive (allowed: R4 holds here)
    assert 0 < pr["perc"] <= 4 and FM.local_score(ctx, comp)[1]["beat"] == 1.0
    assert pr["perc"] == pytest.approx(sum(b - a for a, b in pr["perc_windows"]))
    assert 10 <= pr["layered"] <= 16 and 0 < pr["tonal"] <= 16
    ctx2 = locked_ctx(F["dreaming"], 96, F["dance_no_more"], 24)
    cuts = FM.FORMS["phrase_trade"].build(ctx2, "cuts")
    pr2 = FM.profile_of(cuts, ctx2.fa, ctx2.fb)
    assert pr2["perc"] == 0 and pr2["layered"] == 0 and pr2["tonal"] == 0   # one source at a time


def test_local_score_terms_and_r4_rejection(F):
    ctx = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80)
    comp = FM.FORMS["drop_swap"].build(ctx, "L4.eqpow")
    S_, terms = FM.local_score(ctx, comp)
    assert set(terms) == {"base", "bin", "beat", "key", "loud", "fit", "exit", "rt"}
    w = CFG["weights"]
    want = (terms["base"] + w["bin"] * terms["bin"] + w["beat"] * terms["beat"] + w["key"] * terms["key"]
            + w["loud"] * terms["loud"] + w["fit"] * terms["fit"] + w["exit"] * terms["exit"] + terms["rt"])
    assert S_ == pytest.approx(want, abs=1e-3)
    assert terms["bin"] == 1.0 and terms["beat"] == 1.0 and terms["key"] < 1       # cam 2 clash
    # the same layered composition without R4 (verify window): statically rejected
    comp2 = copy.deepcopy(comp)
    comp2["rel"]["a_class"] = "verify"
    bad = copy.deepcopy(comp2)
    for m in bad["moves"]:
        if m["type"] == "eq" and m["clip"] == "B" and m["band"] == "low":
            m["band"] = "mid"                                      # B's bass stays in: percussive
    ctx.fb = copy.deepcopy(ctx.fb)
    for b in range(ctx.j - 4, ctx.j):
        ctx.fb["bars"]["perc_db"][b] = 0.0
    assert FM.local_score(ctx, bad) is None
    # ratings prior: layered forms on lock pairs rated >= 80 get +0.2
    ctx.ratings = {f"{ctx.a}>{ctx.b}": 90}
    assert FM.local_score(ctx, comp)[1]["rt"] == 0.2


def test_fit_table(F):
    fc, fb = F["bluebird"], F["dreaming"]
    ctx = FM.JoinCtx({}, {}, fc, fb, FM.exits_by_bar(fc)[112][0], fb["landings"][0])
    assert FM.FIT["echo_slam"](ctx) in (0.6, 1.0)
    ctx.rel["a_class"] = "free"
    assert FM.FIT["roll_slam"](ctx) == 0.0


# ------------------------------------------------------------------------ enumeration
def test_enumeration_is_valid_pruned_and_deterministic(F):
    fa, fb = F["dreaming"], F["dance_no_more"]
    pc = FM.PairCtx({"id": fa["track"], "camelot": "5A"}, {"id": fb["track"], "camelot": "3A"}, fa, fb, seed=3)
    c1 = FM.enumerate_candidates(pc, 0)
    c2 = FM.enumerate_candidates(pc, 0)
    assert [q.comp["hash"] for q in c1] == [q.comp["hash"] for q in c2]
    assert 0 < len(c1) <= CFG["cands_per_join"]
    assert [q.id for q in c1] == list(range(len(c1))) and [q.S for q in c1] == sorted((q.S for q in c1), reverse=True)
    for q in c1:
        assert q.check(fa, fb), (q.form, q.variant, q.X, q.j)
        assert q.comp["score"]["local"] == q.S and q.comp["hash"] == S.canonical_hash(q.comp)
        f = FM.beam_fields(FM.JoinCtx(pc.ta, pc.tb, fa, fb, FM.exits_by_bar(fa)[q.X][0],
                                      next(ld for ld in fb["landings"] if ld["bar"] == q.j)), q.comp)
        assert f == q.fields
    forms = {}
    for q in c1:
        forms.setdefault(q.form, []).append(q)
    xs = set(FM.exits_by_bar(fa))
    js = {ld["bar"] for ld in fb["landings"]}
    assert {(q.X, q.j) for q in c1 if q.form == "cut_on_one"} == {(x, j) for x in xs for j in js}
    assert "drop_swap" in forms and "phrase_trade" in forms            # a lock pair
    assert len({q.form for q in c1 if q.form != "cut_on_one"}) >= 3


def test_variants_are_seeded(F):
    ctx = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80)
    f = FM.FORMS["drop_swap"]
    picks = {tuple(f.variants(ctx, FM.stable_rng(s, "a", "b", "drop_swap"))) for s in range(12)}
    assert all(len(p) == 2 for p in picks) and len(picks) > 3
    assert f.variants(ctx, FM.stable_rng(5, "a", "b", "drop_swap")) == \
        f.variants(ctx, FM.stable_rng(5, "a", "b", "drop_swap"))


# ------------------------------------------------------------------------ beam
def _fake(form, j, X, S_, tier=None, loud=None, family=None, a_out=100.0, b_end=10.0, i=0):
    q = FM.Cand(X, j, form, form, tier or S.FORM_TIER.get(form, "noticeable"),
                S.is_loud(form) if loud is None else loud, family or form, S_, {}, {"variant": form},
                fields={"a_out_start": a_out, "b_in_start": 1.0, "b_in_end": b_end}, id=i)
    return q


def _info(n_land=1):
    lands = {}
    for j in range(n_land):
        lands[10 + j] = {"t": 10.0, "h": 3.0, "win": {"fit": {"period_s": 0.5}, "cls": "locked"},
                         "exits": [{"bar": 26 + j, "h": 3.0}]}
    return PL.TrackInfo({"id": "x"}, {"bpb": 4, "bpm": 120.0}, lands)


def test_beam_rotates_forms_and_respects_caps():
    infos = [_info() for _ in range(6)]
    joins = [[_fake("spin_slam", 10, 26, 4.0, i=0), _fake("drop_swap", 10, 26, 3.5, i=1),
              _fake("roll_slam", 10, 26, 3.4, i=2)] for _ in range(5)]
    chosen, j0, diag = PL.beam(infos, joins)
    forms = [q.form for q in chosen]
    assert forms.count("spin_slam") <= CFG["caps"]["spin"]              # hard cap
    assert all(a != b for a, b in zip(forms, forms[1:]))                # same-form penalty rotates
    assert j0 == 10 and diag["relaxed"] == []
    again, _, _ = PL.beam(infos, joins)
    assert [q.form for q in again] == forms                              # deterministic


def test_beam_enforces_the_native_solo_and_exit_match():
    """R9 feasibility: a candidate whose region starts too soon after the previous B-in is skipped
    while another fits; an X that is not an exit of the chosen landing never links."""
    infos = [_info(), _info(2), _info()]
    j0 = [_fake("drop_swap", 10, 26, 5.0, b_end=50.0, i=0), _fake("roll_slam", 11, 26, 3.0, b_end=50.0, i=1)]
    j1 = [_fake("drop_swap", 10, 26, 9.0, a_out=55.0, i=0),               # solo 5 s < 16 s
          _fake("echo_slam", 10, 27, 8.0, a_out=90.0, i=1),               # X 27 is an exit of landing 11 only
          _fake("cut_on_one", 10, 26, 1.0, a_out=90.0, i=2)]
    chosen, _, diag = PL.beam(infos, [j0, j1])
    assert (chosen[0].j, chosen[1].X) in ((10, 26), (11, 27))
    assert chosen[1].form != "drop_swap" and diag["relaxed"] == []


def test_beam_relaxes_rather_than_failing():
    infos = [_info(), _info(), _info()]
    j0 = [_fake("drop_swap", 10, 26, 5.0, b_end=95.0)]
    j1 = [_fake("roll_slam", 10, 26, 3.0, a_out=96.0)]                     # solo 1 s
    chosen, _, diag = PL.beam(infos, [j0, j1])
    assert len(chosen) == 2 and diag["relaxed"] == [{"join": 1, "level": 1}]


# ------------------------------------------------------------------------ the plan
def _order(tr, idx):
    return [tr[i]["id"] for i in idx]


def test_plan_validates_and_is_deterministic(set3):
    tr, fs = set3
    ids = _order(tr, [1, 0, 2, 3, 4, 5])
    memo = {}
    t0 = time.perf_counter()
    plan = PL.build_medley_plan(tr, ids, P, {"seed": 11, "target_s": 1200}, fs, memo=memo)
    cold = time.perf_counter() - t0
    assert S.validate_plan(plan, feats=fs) == []
    t0 = time.perf_counter()
    again = PL.build_medley_plan(tr, ids, P, {"seed": 11, "target_s": 1200}, fs, memo=memo)
    warm = time.perf_counter() - t0
    assert S.canonical_json(again) == S.canonical_json(plan)
    assert warm < 0.3 and warm < cold
    fresh = PL.build_medley_plan(tr, ids, P, {"seed": 11}, fs)
    assert S.canonical_json(fresh["transitions"]) == S.canonical_json(plan["transitions"])
    assert [o["id"] for o in plan["order"]] == ids and len(plan["transitions"]) == 5
    json.loads(S.to_json(plan))                                          # JSON-native throughout
    for i, trn in enumerate(plan["transitions"]):
        comp = trn["composition"]
        assert comp["id"] == f"j{i + 1:02d}" and comp["hash"] == S.canonical_hash(comp)
        assert plan["native_starts"][i + 1] == trn["b_in_end"]
        ex_b = plan["medley"]["excerpts"][i + 1]
        assert ex_b["land"]["t"] == trn["land_s"] and comp["b_ref"]["land_bar"] == ex_b["land"]["bar"]
        assert plan["medley"]["excerpts"][i]["exit"]["bar"] == comp["a_ref"]["exit_bar"]
        assert trn["b_in"] == comp["b_in"] and trn["override"] == {} and trn["style"] == "medley"
    st = plan["medley"]["stats"]
    assert st["songs"] == 6 and st["unverified"] == 5 and sum(st["tiers"].values()) == 5
    starts = [o["start"] for o in plan["order"]]
    assert starts == sorted(starts) and starts[0] == 0 and starts[-1] < plan["total_seconds"]


def test_plan_bodies_are_allowed_excerpts(set3):
    tr, fs = set3
    plan = PL.build_medley_plan(tr, _order(tr, [0, 1, 2, 3, 4, 5]), P, {"seed": 2}, fs)
    for e in plan["medley"]["excerpts"]:
        F = fs[e["track"]]
        ld = next(x for x in F["landings"] if x["bar"] == e["land"]["bar"])
        assert e["exit"]["bar"] in {x["bar"] for x in ld["exits"]}           # n is an allowed body
        assert e["body_bars"] in CFG["body_bars_allowed"]
        assert -9 <= e["gain_db"] <= 9 and e["lead"]["t"] <= e["land"]["t"] < e["exit"]["t"]


def test_needs_prep_and_excluded_tracks(set3):
    tr, fs = set3
    extra = {"id": "spotify:nofeats", "artist": "n", "title": "No feats", "file": "x.mp3", "bpm": 120.0,
             "duration": 200.0}
    tracks = tr + [extra]
    ids = _order(tr, [0, 1]) + ["spotify:nofeats"]
    plan = PL.build_medley_plan(tracks, ids, P, {"seed": 1}, fs)
    assert S.validate_plan(plan, feats=fs) == []
    m = plan["medley"]
    assert m["needs_prep"] == ["spotify:nofeats"] and len(plan["order"]) == 2
    reasons = {e["track"]: e["reason"] for e in m["excluded"]}
    assert reasons["spotify:nofeats"] == "needs_prep"
    for t in tr[2:]:
        assert t["id"] in reasons                                           # AMENDMENTS 1: reported


def test_verify_feedback_changes_the_plan(set3):
    tr, fs = set3
    ids = _order(tr, [1, 0, 2])
    memo = {}
    plan = PL.build_medley_plan(tr, ids, P, {"seed": 4}, fs, memo=memo)
    h0 = plan["transitions"][0]["composition"]["hash"]
    j1 = plan["transitions"][0]["composition"]["b_ref"]["land_bar"]
    doc = {"version": 1, "entries": {}, "failed": [h0], "bad_landings": []}
    p2 = PL.build_medley_plan(tr, ids, P, {"seed": 4}, fs, verify=doc, memo=memo)
    assert S.validate_plan(p2, feats=fs) == []
    assert p2["transitions"][0]["composition"]["hash"] != h0
    every = [PL._final_hash(q, 0) for cl in memo.values() for q in cl
             if q.comp["a"] == ids[0] and q.comp["b"] == ids[1]]
    p_all = PL.build_medley_plan(tr, ids, P, {"seed": 4}, fs, verify={"failed": every}, memo=memo)
    assert S.validate_plan(p_all, feats=fs) == [] and len(p_all["transitions"]) == 2   # kept, not lost
    doc = {"version": 2, "entries": {}, "failed": [], "bad_landings": [[ids[1], j1]]}
    p3 = PL.build_medley_plan(tr, ids, P, {"seed": 4}, fs, verify=doc, memo=memo)
    assert S.validate_plan(p3, feats=fs) == []
    assert p3["medley"]["excerpts"][1]["land"]["bar"] != j1
    # stored checks surface as the transition's summary and the plan stats
    ck = {"status": "pass", "attempt": 1, "land_err_ms": 1.0, "land_strength": 1.1, "bt_down_err_ms": None,
          "grid_med_ms": None, "grid_p90_ms": None, "fid_med_ms": 0.5, "fid_p95_ms": 1.0, "flams": 0,
          "dbl_bass_beats": 0.0, "chroma_mean": None, "clicks": 0, "tp_dbtp": -1.0, "limiter_ms_over6": 0.0,
          "step_lu": 0.5, "step_planned_lu": 0.3, "overlap_excess_lu": 0.0, "gaps_unplanned": 0,
          "gesture_ok": True, "tempo_jump_pct": 0.1, "a_air_db": -9.0, "vocal_edge_db": None, "fail": [],
          "history": []}
    doc = {"version": 3, "entries": {h0: ck}, "failed": [], "bad_landings": []}
    p4 = PL.build_medley_plan(tr, ids, P, {"seed": 4}, fs, verify=doc, memo=memo)
    t0 = p4["transitions"][0]
    assert t0["checks_summary"]["status"] == "pass" and t0["composition"]["checks"] == ck
    assert p4["medley"]["stats"]["verified"] == 1 and S.validate_plan(p4, feats=fs) == []


def test_single_track_and_numpy_feats(set3):
    tr, fs = set3
    one = PL.build_medley_plan(tr, [tr[0]["id"]], P, {"seed": 0}, fs)
    assert S.validate_plan(one) == [] and one["transitions"] == [] and len(one["native_starts"]) == 1
    # FeatStore hands out numpy arrays for the big list fields: the plan stays JSON-native
    npf = {}
    for k, F in fs.items():
        G = copy.deepcopy(F)
        for grp, keys in (("beats", ("t", "refined", "pos", "vox_db")), ("onsets", ("t", "strength")),
                          ("bars", ("t", "beat", "rel_db", "low_db", "perc_db", "vox_db", "chroma"))):
            for key in keys:
                G[grp][key] = np.asarray(G[grp][key])
        G["kblocks"]["ms"] = np.asarray(G["kblocks"]["ms"])
        npf[k] = G
    plan = PL.build_medley_plan(tr, _order(tr, [1, 0, 2]), P, {"seed": 0}, npf)
    json.loads(S.to_json(plan))
    assert S.validate_plan(plan, feats=fs) == []


def test_stems_enable_stem_variants(set3, F):
    tr, fs = set3

    class Stems:
        def has(self, tid, path=None):
            return True

        def version(self):
            return "v1"

    ids = _order(tr, [1, 0, 2, 3, 4, 5])
    plan = PL.build_medley_plan(tr, ids, P, {"seed": 5}, fs, stems=Stems())
    assert S.validate_plan(plan, feats=fs) == []
    memo = {}
    PL.build_medley_plan(tr, ids, P, {"seed": 5}, fs, stems=Stems(), memo=memo)
    variants = {(q.form, q.variant) for cl in memo.values() for q in cl}
    assert ("phrase_trade", "tops") in variants or any(f == "stem_handover" for f, _ in variants) or \
        any(q.comp["clips"][-1]["stem"] == "bed" for cl in memo.values() for q in cl)


def test_ladder_hooks_rebuild_the_planned_join(set3):
    """E4's ladder asks the planner for alternatives (same j_B, X_A) and fallback forms."""
    tr, fs = set3
    ids = _order(tr, [1, 0, 2, 3])
    plan = PL.build_medley_plan(tr, ids, P, {"seed": 9}, fs)
    for i, trn in enumerate(plan["transitions"]):
        comp = trn["composition"]
        alts = PL.join_alternatives(plan, i)
        assert all(a["hash"] != comp["hash"] for a in alts)
        scores = [a["score"]["local"] for a in alts]
        assert scores == sorted(scores, reverse=True)
        for a in alts + [PL.fallback_join(plan, i, "cut_on_one")]:
            assert a["id"] == comp["id"] and a["hash"] == S.canonical_hash(a)
            assert a["a_ref"]["exit_bar"] == comp["a_ref"]["exit_bar"]
            assert a["b_ref"]["land_bar"] == comp["b_ref"]["land_bar"]
            assert S.validate_composition(a, fs[trn["a"]], fs[trn["b"]]) == []
        fb = PL.fallback_join(plan, i, "echo_slam")
        assert fb is None or (fb["form"] == "echo_slam" and fb["b_ref"]["land_bar"] == comp["b_ref"]["land_bar"])
    assert PL.join_alternatives(copy.deepcopy(plan), 0) == []              # an unknown plan object
    assert PL.fallback_join(json.loads(json.dumps(plan)), 0, "cut_on_one") is None
