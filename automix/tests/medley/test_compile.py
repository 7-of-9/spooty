"""E2 compiler tests (DESIGN §12, Phase 1 acceptance 3-4): the Clock, moves -> lanes -> Program
for the §8.10 example and every form, splices, loops, echoes, gestures and the region edges."""

import copy
import math

import numpy as np
import pytest

from automix.medley import CFG
from automix.medley import forms as FM
from automix.medley import schema as S
from automix.medley.compile import (Clock, CompileError, Lane, SrcMap, compile_join, make_clock,
                                    transition_fields)
from helpers_e2 import beatless, load, locked_ctx, scaled

NEG = -math.inf


@pytest.fixture(scope="module")
def F():
    return {n: load(n) for n in ("dance_no_more", "dreaming", "bluebird")}


@pytest.fixture(scope="module")
def prog810(F):
    from conftest import load_fixture
    return compile_join(load_fixture("comp_drop_swap.json"), F["dance_no_more"], F["dreaming"])


def lane_steps(knots):
    by = {}
    for k in knots:
        by.setdefault(float(k[0]), []).append(k[1])
    return [x for x, vs in by.items() if len(vs) > 1 and vs[0] != vs[-1]]


def assert_splices_cover_steps(prog):
    """Every lane step (two knots at one time) has a Splice at that time (the engine's contract)."""
    at = {(s.clip, round(s.t, 6)) for s in prog.splices}
    for c in prog.clips:
        lanes = [c.gain_db] + [kn for kn in c.eq_db.values()]
        for kn in lanes:
            for x in lane_steps(kn):
                assert (c.id, round(x, 6)) in at, (c.id, x)


# ------------------------------------------------------------------------------------ Clock
def test_clock_closed_form_810(comp):
    ck = make_clock(comp)
    # §8.10: a_fit 4 beats at 127.02, ramp 8 beats 127.02 -> 125.99, b_fit 16 beats to m = 0
    b0, b1 = 127.02, 125.99
    ramp = 60 * 8 / (b1 - b0) * math.log(b1 / b0)
    t_land = 4 * 60 / b0 + ramp + 16 * 60 / b1
    assert abs(ck.t_land - t_land) < 1e-8 and abs(ck.t_land - 13.3035) < 1e-4
    assert abs(ck.T - (t_land + 4 * 60 / b1)) < 1e-8
    ms = np.linspace(-28, 4, 257)
    assert np.max(np.abs(ck.m(ck.t(ms)) - ms)) < 1e-5            # inverse (1/64-beat table)
    assert len(ck.m_tab) == 32 * 64 + 1 and ck.t_tab[0] == 0.0


def test_clock_refined_segments_use_tau(F):
    bt = F["dreaming"]["beats"]["t"]
    src = SrcMap(bt[100], None, bt)
    assert src.s(0) == pytest.approx(bt[100]) and src.s(3) == pytest.approx(bt[103])
    assert src.u(src.s(2.5)) == pytest.approx(2.5)
    segs = [{"m0": -8, "m1": 0, "kind": "a_refined", "bpm0": 120.0, "bpm1": 120.0}]
    ck = Clock(segs, {"from": -8, "to": 0}, {"a_refined": src.s})
    assert ck.T == pytest.approx(bt[100] - bt[92])
    assert ck.t(-4) == pytest.approx(bt[96] - bt[92])


# ----------------------------------------------------------------------- §8.10 program
def test_810_program_matches_the_fixture(prog810, program, plan):
    assert S.validate_program(prog810) == []
    assert prog810.T == pytest.approx(program.T, abs=1e-6)
    assert prog810.t_land == pytest.approx(program.t_land, abs=1e-6)
    assert prog810.xf == program.xf == int(0.015 * 44100)
    assert np.allclose(prog810.clock_t, program.clock_t, atol=2e-6)
    assert [c.id for c in prog810.clips] == ["A", "B"]
    A, B = prog810.clips
    assert A.source["kind"] == "r2" and B.source["kind"] == "native"
    # region edges: A from -xf at a_out_start, B to T + xf at b_in_end (render_region contract)
    tr = plan["transitions"][0]
    xf_s = prog810.xf / prog810.sr
    a0 = A.pos[0]
    assert a0["t0"] == pytest.approx(-xf_s, abs=1e-6)
    b_last = B.pos[-1]
    assert b_last["t1"] == pytest.approx(prog810.T + xf_s, abs=1e-6)
    s_end = B.source["s0"] + b_last["w0"] + (prog810.T - b_last["t0"])
    assert s_end == pytest.approx(tr["b_in_end"], abs=1e-5)
    # B enters 3 ms before t(-16) (no onset within 15 ms there), reading b_in_start - 3 ms
    b0 = B.pos[0]
    assert b0["t0"] == pytest.approx(tr["b_enter_s"] - 0.003, abs=1e-6)
    assert B.source["s0"] + b0["w0"] == pytest.approx(tr["b_in_start"] - 0.003, abs=1e-5)


def test_r2_anchors_come_only_from_the_fitted_grid(prog810, comp):
    """R3 (acceptance 4): every interior anchor is a fitted beat exit_t + u * period_s -> t(m)."""
    A = prog810.clips[0]
    src, dst = A.source["src_anchors"], A.source["dst_anchors"]
    ref, per = comp["a_ref"]["exit_t"], comp["a_ref"]["period_s"]
    u = (np.array(src[1:-1]) - ref) / per
    assert np.allclose(u, np.round(u), atol=1e-5)
    ck = make_clock(comp)
    t = ck.t(np.round(u))                                          # A clip: ratio 1, u = m
    assert np.allclose(np.diff(dst[1:-1]), np.diff(t), atol=2e-6)
    assert src[0] == A.source["s0"] and src[-1] == A.source["s1"] and dst[0] == 0 and dst[-1] == A.source["w_len"]
    # locked playback on W: the copy segment reads W at the default mapping for u = m
    a0 = A.pos[0]
    w_at_28 = np.interp(ref - 28 * per, src, dst)
    assert a0["w0"] + (0 - a0["t0"]) == pytest.approx(w_at_28, abs=1e-5)


def test_810_lanes_follow_the_move_semantics(prog810, comp):
    ck = make_clock(comp)
    A, B = prog810.clips

    def g(kn, m, kind="db"):
        return float(S.eval_knots(kn, [ck.t(m)], kind)[0])

    # B: low killed during the lead and back from the landing; pulsed eqpow -12 -> 0 over [-16, -1]
    assert g(B.eq_db["low"], -8) == NEG and g(B.eq_db["low"], 0.5) == 0
    G = float(S.ramp_db(-12, 0, np.array([0.155 / 15]), "eqpow")[0])
    assert g(B.gain_db, -16 + 0.155) == pytest.approx(G - 12, abs=0.02)        # step 0 is '.', floor -12
    assert g(B.gain_db, -16 + 0.625) == pytest.approx(float(S.ramp_db(-12, 0, np.array([0.625 / 15]), "eqpow")[0]), abs=0.05)
    assert g(B.gain_db, 1) == 0
    # A: mids/highs -8 dB by -1 (key clash), low out at -1/2, gain cos to -inf over [-1, 0]
    assert g(A.eq_db["mid"], -1) == pytest.approx(-8) and g(A.eq_db["high"], -0.9) == pytest.approx(-8)
    assert g(A.eq_db["low"], -0.75) == 0 and g(A.eq_db["low"], -0.45) == NEG
    assert g(A.gain_db, -0.5) == pytest.approx(20 * math.log10(0.5), abs=0.01)
    assert g(A.gain_db, 0.001) == NEG
    assert_splices_cover_steps(prog810)
    sw = [s for s in prog810.splices if s.kind == "swap"]
    assert len(sw) == 1 and sw[0].clip == "B" and sw[0].xf_ms == 4
    assert sw[0].t + sw[0].xf_ms / 1000 <= prog810.t_land + 0.003          # B's low is in by the attack


def test_810_expectations(prog810):
    e = prog810.expect
    assert S.check_type(e, S.Expect, "expect") == []
    assert e["land_t"] == prog810.t_land and e["ramps"] == [[pytest.approx(1.889466, abs=1e-5),
                                                            pytest.approx(5.683804, abs=1e-5)]]
    (l0, l1), = e["layered"]
    assert l0 == pytest.approx(5.6838, abs=0.01) and prog810.t_land - 0.05 < l1 <= prog810.t_land
    assert e["vacuums"] == [] and e["silences"] == [] and e["seams"] == []
    assert len(e["onsets"]["A"]) > 20 and len(e["onsets"]["B"]) > 20
    tb = np.array([o[0] for o in e["onsets"]["B"]])
    assert tb.min() >= prog810.clips[1].pos[0]["t0"] - 1e-6
    assert [g[1] for g in prog810.grid[::4]] == [True] * 9 and prog810.grid[16][2] == "both"


def test_pulse_steps_sit_on_the_16th_grid(prog810, comp):
    """Phase 3 acceptance: the pulse pattern's gain steps are within +-1 ms of the 1/16 grid."""
    ck = make_clock(comp)
    B = prog810.clips[1]
    t = np.arange(ck.t(-16) + 0.003, ck.t(-1) - 0.003, 1e-4)
    G = S.ramp_db(-12, 0, np.clip((ck.m(t) + 16) / 15, 0, 1), "eqpow")
    P = S.eval_knots(B.gain_db, t, "db") - G                      # the pattern offset, 0 or -12 dB
    assert np.all((np.abs(P) < 0.05) | (np.abs(P + 12) < 0.05) | (np.abs(P + 6) < 6))
    cross = t[1:][np.diff(np.sign(P + 6)) != 0]                    # mid-level crossings = the steps
    grid = ck.t(np.arange(-16, -1, 0.25))
    assert len(cross) >= 20
    for x in cross:
        assert np.min(np.abs(grid - x)) <= 0.001


def test_program_json_round_trip(prog810):
    back = S.from_json(S.to_json(prog810), S.Program)
    assert S.canonical_json(back) == S.canonical_json(prog810)


# ------------------------------------------------------------------------ slams
def test_roll_slam_loops_are_bit_identical(comp_slam, F):
    prog = compile_join(comp_slam, F["dreaming"], F["bluebird"])
    A = prog.clips[0]
    ck = make_clock(comp_slam)
    # the 2-beat stage: two repeats reading the same W span (a copy of identical samples)
    segs = A.pos
    assert all(s["kind"] == "copy" for s in segs)
    stage2 = [s for s in segs if ck.t(-8) - 0.004 <= s["t0"] < ck.t(-4) - 0.004]
    assert len(stage2) == 2
    w_first = stage2[0]["w0"] + (ck.t(-8) - stage2[0]["t0"])
    w_second = stage2[1]["w0"] + (ck.t(-6) - stage2[1]["t0"])
    assert abs(w_first - w_second) < 0.0012                        # the repeat restarts at the loop start
    later = [s for s in segs if s["t0"] > ck.t(-6) - 0.004]
    w0s = {round(s["w0"], 6) for s in later[:-1]}                    # all repeats read from one point
    assert len(w0s) == 1
    # 8 loop seams (1 + 1 + 1 + 1 extra repeats + 4 stage starts); REVIEW #4: only those with a
    # source onset within +-10 ms are snapped (and listed for V9); the others stay on the grid
    pos = [s for s in prog.splices if s.kind == "pos"]
    assert len(pos) == 8 and 1 <= len(prog.expect["seams"]) <= 8
    for t in prog.expect["seams"]:
        assert any(abs(s.t - (t - 0.003)) < 1e-5 or abs(s.t - t) < 1e-5 for s in pos)
    # vacuum [-1/2, 0) is silent; taper -3 dB on the 1/4 stage; HP 40 -> 1000 Hz from -8
    assert prog.expect["vacuums"] == [[pytest.approx(ck.t(-0.5), abs=1e-6), pytest.approx(ck.t(0), abs=1e-6)]]
    (s0, s1), = prog.expect["silences"]
    # (the vacuum's fade ends splice_pre_ms before -1/2, so the silence starts up to 6 ms early)
    assert s0 == pytest.approx(ck.t(-0.5) - 0.003, abs=0.004) and s1 == pytest.approx(ck.t(0), abs=0.004)
    g = S.eval_knots(A.gain_db, [ck.t(-0.75), ck.t(-1.5)], "db")
    assert g[0] == pytest.approx(-3) and g[1] == 0
    hp = S.eval_knots(A.hp_hz, [ck.t(-8) + 1e-4, ck.t(-0.5) - 1e-4], "hz")
    assert hp[0] == pytest.approx(40, rel=1e-2) and hp[1] == pytest.approx(1000, rel=1e-2)
    assert_splices_cover_steps(prog)


def test_echo_slam_program(F):
    ctx = FM.JoinCtx({}, {}, F["bluebird"], F["dreaming"], FM.exits_by_bar(F["bluebird"])[112][0],
                     F["dreaming"]["landings"][2])
    comp = FM.FORMS["echo_slam"].build(ctx, "echo")
    prog = compile_join(comp, ctx.fa, ctx.fb)
    ck = make_clock(comp, fa=ctx.fa, fb=ctx.fb)
    e, = prog.echoes
    assert e.clip == "A" and e.part == "a"
    assert e.capture[0] == pytest.approx(ck.t(-2), abs=1e-6) and e.capture[1] == pytest.approx(ck.t(-1), abs=1e-6)
    assert e.delay_s == pytest.approx(0.75 * ck.beat_s(-1.5), rel=1e-3)
    assert 0 < e.fb <= CFG["echo_fb_max"] and e.duck["key"] == "B" and e.send_db == -4
    assert e.hp_hz[0][1] == 400 and e.hp_hz[-1][1] == 1500
    A = prog.clips[0]
    assert S.eval_knots(A.gain_db, [ck.t(-1) + 0.001], "db")[0] == NEG     # the dry is cut by -1


def test_gestures_reach_rate_zero_before_the_landing(comp_slam, F, rehash):
    """Phase 3 acceptance: tape stop / backspin reach rate 0 >= 1/4 beat before the landing."""
    for mv in ({"type": "tape_stop", "clip": "A", "at": -2.5, "len": 2, "k": 1.5},
               {"type": "backspin", "clip": "A", "at": -1, "push": 0.125, "peak_rate": -3.5, "tau": 0.35,
                "end_by": -0.25}):
        c = copy.deepcopy(comp_slam)
        c["moves"] = [m for m in c["moves"] if m["type"] != "roll"] + [mv]
        c["form"] = "tape_stop_slam" if mv["type"] == "tape_stop" else "spin_slam"
        c["tier"], c["loud"] = "signature", True
        prog = compile_join(rehash(c), F["dreaming"], F["bluebird"])
        ck = make_clock(c)
        g, = prog.expect["gestures"]
        assert g["kind"] == mv["type"] and g["stop_t"] <= ck.t(-0.25) + 1e-6
        A = prog.clips[0]
        vary = [s for s in A.pos if s["kind"] == "vary"]
        assert len(vary) == 1 and A.pos[-1]["t1"] <= g["stop_t"] + 1e-6         # no audio after the stop
        w = np.array(vary[0]["w"])
        assert abs(w[-1] - w[-2]) < 5e-5                                     # rate ~ 0 at the stop
        if mv["type"] == "backspin":
            assert np.min(np.diff(w)) < 0                                   # it runs backwards
        assert A.lp_hz is not None and S.eval_knots(A.lp_hz, [g["stop_t"] - 0.002], "hz")[0] < 3000
        assert S.eval_knots(A.gain_db, [g["stop_t"] + 0.01], "db")[0] == NEG


def test_hand_lanes_are_applied_last(comp, F, rehash):
    c = copy.deepcopy(comp)
    c["lanes"] = {"B": {"gain": [[-8, -6.0, "lin"], [-4, -6.0, "hold"]]}}
    prog = compile_join(rehash(c), F["dance_no_more"], F["dreaming"])
    ck = make_clock(c)
    B = prog.clips[1]
    v = S.eval_knots(B.gain_db, [ck.t(-6), ck.t(-10)], "db")
    assert v[0] == pytest.approx(-6) and v[1] < -6.5


def test_compile_rejects_invalid_compositions(comp, comp_slam, F, rehash):
    bad = copy.deepcopy(comp)
    bad["clips"][1]["warp"] = "r2"
    with pytest.raises(CompileError) as e:
        compile_join(rehash(bad), F["dance_no_more"], F["dreaming"])
    assert e.value.code == "B_WARP"
    free = copy.deepcopy(comp_slam)
    free["a_ref"]["period_s"] = None
    free["clock"][0]["kind"] = "a_refined"
    with pytest.raises(CompileError) as e:
        compile_join(rehash(free), None, F["bluebird"])
    assert e.value.code == "FEATS_MISSING"
    prog = compile_join(rehash(free), F["dreaming"], F["bluebird"])     # refined beats place A
    assert S.validate_program(prog) == []


def test_lane_add_and_write_from():
    ln = Lane(0.0, 0.0, 10.0)
    ln.write_from(2.0, [[2.0, 4.0, 0.0, -12.0, "lin"]])
    ln.add(3.0, 5.0, [[3.0, 5.0, -6.0, -6.0, "hold"]])
    xs = np.array([1.0, 2.5, 3.5, 4.5, 6.0])
    got = S.eval_knots(ln.knots(), xs, "db")
    want = [0.0, float(S.ramp_db(0, -12, np.array([0.25]), "lin")[0]),
            float(S.ramp_db(0, -12, np.array([0.75]), "lin")[0]) - 6, -18.0, -12.0]
    assert np.allclose(got, want, atol=1e-3)
    assert [s[0] for s in ln.steps()] == [3.0, 5.0]


# ------------------------------------------------------------------ every form compiles
def _contexts(F):
    fa, fb, fc = F["dance_no_more"], F["dreaming"], F["bluebird"]
    slow = scaled(fb, 126 / 87.0, locked=True)
    bl = beatless(fb, 80, 4)
    ex112 = FM.exits_by_bar(fc)[112][0]
    return {
        "810": locked_ctx(fa, 40, fb, 80),
        "810+stems": locked_ctx(fa, 40, fb, 80, stems=True),
        "nobass-drums+stems": locked_ctx(fb, 96, fa, 24, stems=True),
        "build": locked_ctx(fb, 96, fa, 72),
        "double": FM.JoinCtx({}, {}, fc, slow, FM.exits_by_bar(fc)[80][0], slow["landings"][0]),
        "double-clear": FM.JoinCtx({}, {}, fc, slow, dict(FM.exits_by_bar(fc)[80][0], vocal_at_edge=False),
                                   slow["landings"][0]),
        "double+stems": FM.JoinCtx({}, {}, fc, slow, FM.exits_by_bar(fc)[80][0], slow["landings"][0], stems_b=True),
        # the exit at 80 runs through a sung line and B has a pickup: air() cannot throw there
        "double+stems-clear": FM.JoinCtx({}, {}, fc, slow, dict(FM.exits_by_bar(fc)[80][0], vocal_at_edge=False),
                                         slow["landings"][0], stems_b=True),
        "free-pickup": FM.JoinCtx({}, {}, fc, fb, ex112, fb["landings"][0]),
        "free-preroll": FM.JoinCtx({}, {}, fc, bl, ex112, bl["landings"][0]),
        # fixer: the fixture exits mostly run through a sung line (no stems: the vox proxy), which
        # allows only echo-throwing forms (§5.3); clear copies cover the other slams
        "free-clear": FM.JoinCtx({}, {}, fc, fb, dict(ex112, vocal_at_edge=False), fb["landings"][0]),
        "lock-none": locked_ctx(fb, 96, fa, 80),
        "lock-none-clear": locked_ctx(fb, 104, fa, 80),
    }


def test_every_form_variant_compiles(F):
    seen = set()
    for name, ctx in _contexts(F).items():
        for fname, form in FM.FORMS.items():
            if not form.allowed(ctx):
                continue
            for v in form.variant_set(ctx):
                comp = form.build(ctx, v)
                assert comp is not None, (name, fname, v)
                assert S.validate_composition(comp, ctx.fa, ctx.fb) == [], (name, fname, v)
                prog = compile_join(comp, ctx.fa, ctx.fb)
                assert S.validate_program(prog) == [], (name, fname, v)
                assert_splices_cover_steps(prog)
                assert prog.T == pytest.approx(transition_fields(comp, ctx.fa, ctx.fb)["T"], abs=1e-6)
                seen.add((fname, v.split(".")[-1] if fname == "drop_swap" else v))
    for want in [("drop_swap", "eqpow"), ("drop_swap", "steps"), ("drop_swap", "pulse-offbeat"),
                 ("drop_swap", "pulse-pump"), ("phrase_trade", "cuts"), ("phrase_trade", "tops"),
                 ("stem_handover", "handover"), ("half_time", "top"), ("half_time", "high"),
                 ("half_time", "straight"), ("roll_slam", "roll"), ("roll_slam", "roll-long"),
                 ("echo_slam", "echo"), ("echo_slam", "preroll"), ("cut_on_one", "fade"),
                 ("stutter_stitch", "stitch.gate-only"), ("tape_stop_slam", "stop"), ("spin_slam", "spin"),
                 ("air_cut", "air")]:
        assert want in seen, want


def test_stutter_gate_trades_the_tops_on_16ths(F):
    ctx = locked_ctx(F["dreaming"], 96, F["dance_no_more"], 24, stems=True)
    comp = FM.FORMS["stutter_stitch"].build(ctx, FM.FORMS["stutter_stitch"].variant_set(ctx)[0])
    prog = compile_join(comp, ctx.fa, ctx.fb)
    ck = make_clock(comp)
    A = next(c for c in prog.clips if c.id == "A_top")
    B = next(c for c in prog.clips if c.id == "B_top")
    pat = "".join(CFG["forms"]["stutter_steps"])
    for k, ch in enumerate(pat):
        t = ck.t(-8 + k * 0.25 + 0.125)
        ga, gb = S.eval_knots(A.gain_db, [t], "db")[0], S.eval_knots(B.gain_db, [t], "db")[0]
        assert (ga > -60) == (ch == "A") and (gb > -60) == (ch == "B"), k
    edges = ck.t(np.arange(-8 + 0.25, 0, 0.25))                 # interior 16th boundaries
    gates = [s for s in prog.splices if s.clip in ("A_top", "B_top") and np.min(np.abs(edges - s.t)) < 1e-5]
    assert len(gates) >= 10 and {s.xf_ms for s in gates} <= {CFG["gate_attack_ms"], CFG["gate_release_ms"]}


def test_stem_clips_compile_to_stem_lists(F):
    ctx = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80, stems=True)
    comp = FM.FORMS["stem_handover"].build(ctx, "handover")
    prog = compile_join(comp, ctx.fa, ctx.fb)
    st = {c.id: c.stems for c in prog.clips}
    assert st["A_vocals"] == ["vocals"] and st["B_top"] == ["vocals", "other"] and st["B_bass"] == ["bass"]
    assert all(isinstance(c.stems, list) for c in prog.clips if c.src == "a")          # R10


def test_transition_fields_match_the_plan_fixture(comp, plan, F):
    f = transition_fields(comp, F["dance_no_more"], F["dreaming"])
    tr = plan["transitions"][0]
    for k in ("a_out_start", "a_out_end", "b_in_start", "b_in_end", "T", "T_overlap", "b_enter_s", "bars"):
        assert f[k] == pytest.approx(tr[k], abs=1e-5), k
    assert f["grid"] == [list(g) for g in tr["grid"]]
    assert f["events_s"] == [list(e) for e in tr["events_s"]]
