"""Integrator: regression tests for REVIEW-external-1 (confirmed defects 1-7, the lead's
additions A-C) and the integration fixes found on the real 79-track build (V1 context and
Beat This lag, V3 live sources, V6 silent splices, the true-peak limiter, measured landings,
onset-checked landings in the planner, per-(X, j) candidate pruning)."""

import copy
from types import SimpleNamespace

import numpy as np
import pytest

from automix.medley import CFG
from automix.medley import compile as C
from automix.medley import dsp as D
from automix.medley import forms as FM
from automix.medley import highlights as HL
from automix.medley import schema as S
from automix.medley import verify as V
from helpers_e2 import load, locked_ctx
from test_verify import (BEAT, OFF, SR, T, T_LAND, env, make_prog, region, run, slam, tm, track,
                         feats_lite)


@pytest.fixture(scope="module")
def tr():
    a = track({"kick", "hat", "bass", "pad"}, seed=1)
    b = track({"kick", "snare", "hat", "bass", "pad"}, seed=2, root=60)
    return {"a": a, "b": b, "fa": feats_lite(a), "fb": feats_lite(b)}


# ---------------------------------------------------------------------------------------- #1
def _cx(rel, low=None, conf=0.0):
    rel = np.asarray(rel, float)
    low = np.asarray(low if low is not None else rel, float)
    return SimpleNamespace(c=CFG, conf=conf, nb=len(rel), rel=rel, low=low, on_phrase=lambda k: False)


def test_1_landing_refinement_keeps_j_against_a_loud_riser_bar():
    # bar 3 is a riser (+5 dB step), bar 4 the true drop (+5 dB step): the old loop adopted
    # j - 1 first and the drop had to beat it by 0.5 dB, so B landed a bar early
    rel = [-10, -10, -10, -5, 0, 0, 0, 0]
    assert HL.refine_bar(_cx(rel), 4) == 4
    # a neighbour that is clearly the bigger step (> sc[j] + 0.5 dB) still wins
    rel = [-10, -10, -10, -10, -9, 0, 0, 0]
    assert HL.refine_bar(_cx(rel), 4) == 5
    rel = [-10, -10, -10, -2, -1, -1, -1, -1]            # j - 1 +8 dB vs j +1 dB
    assert HL.refine_bar(_cx(rel), 4) == 3


# ---------------------------------------------------------------------------------------- #2
def test_2_v2b_fails_when_the_expected_onsets_match_nothing(tr):
    b = tr["b"]
    on = np.sort(np.concatenate([b.onsets[k] for k in ("kick", "snare")]))
    t = on - OFF
    exp = {"B": [[float(x), 100.0] for x in t if T_LAND + 0.01 < x < T - 0.01]}
    assert len(exp["B"]) >= 3
    out, pa, pb = slam(tr)
    ok = run(tr, out, pa, pb, make_prog(onsets=exp))
    assert ok["fid_med_ms"] <= 1.0 and "V2b" not in ok["fail"]
    # B displaced by 30 ms everywhere: nothing matches within 20 ms -> fail (was a silent pass)
    out, pa, pb = slam(tr, b_shift=0.030)
    det = {}
    bad = run(tr, out, pa, pb, make_prog(onsets=exp), bt=False, detail=det)
    assert "V2b" in bad["fail"], det
    assert any("matched 0/" in n for n in det["notes"])


# ---------------------------------------------------------------------------------------- #3
def test_3_v1_strength_is_gain_invariant_and_matches_the_feats_ratio(tr):
    """One detector on ungained audio: the same render at +6 dB track gain scores the same
    landing strength, equal to the Feats ratio at the landing (a native B)."""
    out, pa, pb = slam(tr)
    ch0 = run(tr, out, pa, pb, make_prog(), bt=False)
    g = 10 ** (6 / 20)
    pb6 = pb * np.float32(g)
    ch6 = V.verify_join(pa + pb6, pa, pb6, make_prog(), tr["fa"], tr["fb"], {"lufs": -11.0}, {"lufs": -17.0},
                        {"ceiling_db": -1.0, "target_lufs": -11.0}, bt=None, bt_cpu=False)
    assert ch6["land_strength"] == pytest.approx(ch0["land_strength"], rel=0.02)
    fb = tr["fb"]
    k = int(np.argmin(np.abs(np.asarray(fb["onsets"]["t"]) - (OFF + T_LAND))))
    feats_ratio = fb["onsets"]["strength"][k] / fb["onsets"]["median_down_strength"]
    # B enters from silence 3 ms early here, which only adds strength: never below the Feats ratio
    assert ch0["land_strength"] >= 0.95 * feats_ratio


# ---------------------------------------------------------------------------------------- #4
def test_4_loop_seams_move_content_at_most_15_ms(comp_slam):
    fa, fb = load("dreaming"), load("bluebird")
    base = C.compile_join(comp_slam, fa, fb)
    # every onset of A 50 ms late: within 1/4 beat of each seam (the old fallback snapped the
    # roll 50 ms off the grid) but never within 10 ms: no seam may snap now
    far = copy.deepcopy(fa)
    far["onsets"]["t"] = [x + 0.050 for x in fa["onsets"]["t"]]
    none = copy.deepcopy(fa)
    none["onsets"]["t"], none["onsets"]["strength"] = [], []
    p_far, p_none = C.compile_join(comp_slam, far, fb), C.compile_join(comp_slam, none, fb)
    assert p_far.expect["seams"] == [] and p_none.expect["seams"] == []
    A_far, A_none = p_far.clips[0].pos, p_none.clips[0].pos
    assert [(s["t0"], s["w0"]) for s in A_far] == [(s["t0"], s["w0"]) for s in A_none]
    # with the real onsets, every snapped seam reads content within 15 ms of the unsnapped one
    A_real = base.clips[0].pos
    for s in A_real:
        near = min(A_none, key=lambda q: abs(q["t0"] - s["t0"]))
        if abs(near["t0"] - s["t0"]) < 0.02:
            w_real = s["w0"] + (near["t0"] - s["t0"])
            assert abs(w_real - near["w0"]) <= 0.015 + 1e-6


# ---------------------------------------------------------------------------------------- #5
def test_5_amended_air_low_out_at_minus_1_top_out_by_minus_quarter():
    fa, fb = load("dance_no_more"), load("dreaming")
    ctx = locked_ctx(fa, 40, fb, 80)
    ctx.land["lead"] = dict(ctx.land["lead"], pickup_beats=0)   # (a pickup kills A's top earlier, R7)
    ctx.ex = dict(ctx.ex, vocal_at_edge=False)      # (a sung exit throws an echo instead, §5.3)
    comp = FM.FORMS["drop_swap"].build(ctx, "L4.eqpow")
    assert S.validate_composition(comp, fa, fb) == []
    st = S.static_eval(comp)
    A = st.clips["A"]

    def at(m):
        return int(np.argmin(np.abs(st.m - m)))
    low = A.level + A.eq["low"]
    top = A.level + np.maximum(A.eq["mid"], A.eq["high"])
    assert np.isfinite(low[at(-1.2)]) and not np.isfinite(low[at(-0.9)])        # low out at -1
    assert np.isfinite(top[at(-0.6)]) and not np.isfinite(top[at(-0.2)])        # top gone by -1/4
    assert CFG["air_beats"] == 1.0


# ---------------------------------------------------------------------------------------- #7
def test_7_verify_never_touches_the_servers_beat_model():
    with open(V.__file__) as fh:
        src = fh.read()
    assert "analyze._beat_model =" not in src and "_beat_model = " not in src.replace("_bt_own", "")


# -------------------------------------------------------------------------------- addition A
def test_A_groove_disagreement_refuses_percussive_layering():
    fa, fb = load("dance_no_more"), load("dreaming")
    ctx = locked_ctx(fa, 40, fb, 80)
    comp = FM.FORMS["drop_swap"].build(ctx, "L4.eqpow")
    wins = [(-16.0, -1.0)]
    prof = {"perc_windows": wins}
    assert FM.groove_ok(ctx, comp, prof) in (True, False)
    # make A's beat-2/4 hits 25 ms late against its grid (a clap groove) and B straight
    ea, pa = comp["a_ref"]["exit_t"], ctx.pa
    lb, pb = comp["b_ref"]["land_t"], ctx.pb

    def grid(ref, per, m0, m1, off24):
        t, s = [], []
        for u in range(int(m0) - 8, int(m1) + 8):
            t.append(ref + u * per + (off24 if u % 2 else 0.0))
            s.append(100.0)
        return t, s
    A2, B2 = copy.deepcopy(fa), copy.deepcopy(fb)
    A2["onsets"] = dict(fa["onsets"], median_down_strength=100.0)
    B2["onsets"] = dict(fb["onsets"], median_down_strength=100.0)
    A2["onsets"]["t"], A2["onsets"]["strength"] = grid(ea, pa, -16, -1, 0.025)
    B2["onsets"]["t"], B2["onsets"]["strength"] = grid(lb, pb, -16, -1, 0.0)
    ctx.fa, ctx.fb = A2, B2
    assert FM.groove_ok(ctx, comp, prof) is False
    A2["onsets"]["t"], _ = grid(ea, pa, -16, -1, 0.004)                    # within 10 ms
    assert FM.groove_ok(ctx, comp, prof) is True


# -------------------------------------------------------------------------------- addition B
def test_B_beat_this_lag_is_measured_and_subtracted(tr):
    fb = dict(tr["fb"], beats={"t": list(tr["b"].beats), "refined": [1] * len(tr["b"].beats)})
    late = {"beats": [float(x) + 0.020 for x in tr["b"].beats]}
    assert V.bt_lag(late, fb) == pytest.approx(0.020, abs=1e-6)
    assert V.bt_lag({}, fb) == 0.0 and V.bt_lag(late, None) == 0.0
    # V1: a Beat This that runs 35 ms late passes only once its lag is known
    out, pa, pb = slam(tr)
    ch = run(tr, out, pa, pb, make_prog(), bt_shift_ms=45)
    assert "V1" in ch["fail"]
    ch = V.verify_join(out, pa, pb, make_prog(), tr["fa"], tr["fb"], {"lufs": -11.0}, {"lufs": -11.0},
                       {"ceiling_db": -1.0, "target_lufs": -11.0}, bt=lambda m, sr: _bt_all(m, 0.045),
                       bt_cpu=False, lag={"b": 0.030})
    assert abs(ch["bt_down_err_ms"]) <= 40 and "V1" not in ch["fail"]


def _bt_all(mono, shift):
    """Beat This stand-in: B's bar lines of the synthetic region (+ shift s), on the crop that
    verify passes without context (region only: its t = 0 is sample xf)."""
    xf = int(0.015 * SR) / SR
    d = xf + T_LAND + np.arange(-4, 3) * 4 * BEAT + shift
    return d, d


def test_B_v13_subtracts_each_tracks_lag():
    plan = {"order": [{"id": "a", "duration": 30.0}, {"id": "b", "duration": 30.0}],
            "transitions": [{"a_out_start": 10.0, "T": 4.0, "T_overlap": 2.0, "b_enter_s": 1.0}],
            "native_starts": [2.0, 20.0], "final_end": 30.0}
    feats = {k: {"bars": {"t": list(np.arange(0, 30, 2.0))},
                 "beats": {"t": list(np.arange(0, 30, 0.5)), "refined": [1] * 60}} for k in "ab"}
    tracks = {k: {"id": k, "beats": list(np.arange(0, 30, 0.5) + 0.025)} for k in "ab"}
    tl = V.mix_timeline(plan)
    want = []
    for row in tl:
        s0, s1 = row["body_src"]
        want += [row["body_out"] + d - s0 for d in feats[row["track"]]["bars"]["t"] if s0 + 0.05 <= d <= s1 - 0.05]
    want += [row["land_out"] for row in tl if "land_out" in row]
    late = np.sort(np.asarray(want)) + 0.025                     # Beat This 25 ms late everywhere
    bt = lambda mono, sr: (late, late)                            # noqa: E731
    r = V.verify_mix("", plan, tracks, feats=feats, bt=bt, y=np.zeros((SR, 2), np.float32))
    assert r["status"] == "pass" and r["body_frac"] == 1.0 and r["lag_ms"]["a"] == pytest.approx(25.0)
    r = V.verify_mix("", plan, {k: {"id": k} for k in "ab"}, feats=feats, bt=bt, y=np.zeros((SR, 2), np.float32))
    assert r["body_frac"] == 0.0                                  # no lag known: 25 ms > 20 ms


# -------------------------------------------------------------------------------- addition C
def test_C_a_deliberately_wrong_render_fails_v1_and_v3():
    """B shifted 40 ms late in a layered lead and at the landing: V1 and V3 must both fail."""
    a = track({"kick", "hat"}, seed=4)
    b = track({"kick", "snare"}, seed=5)
    t = {"a": a, "b": b, "fa": feats_lite(a), "fb": feats_lite(b)}
    lay = env([(tm(-4) - 0.004, 0.0), (tm(-4) - 0.003, 1.0)])
    prog = make_prog(b_from=tm(-4), layered=[[tm(-4), T_LAND]])
    pa = region(a.y) * env([(tm(-1), 1.0), (T_LAND - 0.001, 0.0)])
    good = region(b.y) * lay
    ch = run(t, pa + good, pa, good, prog)
    assert "V1" not in ch["fail"]
    wrong = region(b.y, shift_s=0.040) * lay
    ch = run(t, pa + wrong, pa, wrong, prog)
    assert "V1" in ch["fail"] and "V3" in ch["fail"], ch


# ------------------------------------------------------------------------ integration fixes
def test_v3_a_cut_before_bs_entry_is_a_sequence_not_a_flam(tr):
    """A plays to 80 ms before B's pickup starts: pairs 20-90 ms apart across the cut are not
    flams (the sources are never live together); the same hits layered are."""
    a = track({"kick"}, seed=4)
    b = track({"kick"}, seed=5)
    t = {"a": a, "b": b, "fa": feats_lite(a), "fb": feats_lite(b)}
    cut = tm(-2) + 0.060                                   # just after A's hit on beat -2
    prog = make_prog(b_from=cut + 0.002, a_to=cut)
    pa = region(a.y) * env([(cut - 0.001, 1.0), (cut, 0.0)])
    pb = region(b.y, shift_s=0.040) * env([(cut + 0.001, 0.0), (cut + 0.002, 1.0)])
    ch = run(t, pa + pb, pa, pb, prog, bt=False)
    assert ch["flams"] == 0


def test_v6_ignores_splices_of_a_silent_clip_and_silence_beside_an_entry(tr):
    out, pa, pb = slam(tr)
    # an edge of A's clip after A went silent (its fade ended at t_land): not a click
    sp = [S.Splice(t=T_LAND + 0.25, clip="A", kind="edge_out", onset=None, xf_ms=3.0, search_ms=0.0)]
    ch = run(tr, out, pa, pb, make_prog(splices=sp), bt=False)
    assert ch["clicks"] == 0
    # a real click in running audio is still caught
    x = out.copy()
    i = int((tm(-4) + 0.0) * SR) + int(0.015 * SR)
    x[i] += 0.5
    sp = [S.Splice(t=tm(-4), clip="A", kind="gain", onset=None, xf_ms=3.0, search_ms=0.0)]
    ch = run(tr, x, pa, pb, make_prog(splices=sp), bt=False)
    assert ch["clicks"] == 1


def test_tp_limiter_keeps_true_peaks_under_the_ceiling():
    rng = np.random.default_rng(0)
    n = SR * 2
    # a hot, clipped-looking signal with inter-sample overs (a sine near fs/4, phase-shifted)
    t = np.arange(n) / SR
    y = (1.6 * np.sin(2 * np.pi * 11025 * t + 0.7) + 0.05 * rng.standard_normal(n)).astype(np.float32)
    y = np.stack([y, y], 1)
    from automix.audio import limiter
    old = V.true_peak_db(limiter(y, -1.0))
    new = V.true_peak_db(D.tp_limiter(y, -1.0))
    assert old > -0.8 and new <= -0.99
    quiet = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)[:, None].repeat(2, 1)
    assert np.array_equal(D.tp_limiter(quiet, -1.0), quiet)                # bit-exact below


def test_measured_landing_moves_t_onto_the_onset():
    ld = {"bar": 35, "t": 60.961, "onset_err_ms": -9.4}
    m = FM.measured_landing(ld)
    assert m["t"] == pytest.approx(60.9516) and m["t_fit"] == 60.961
    assert FM.measured_landing(m) is m                                   # idempotent
    assert FM.measured_landing({"t": 1.0, "onset_err_ms": None})["t"] == 1.0
    assert FM.measured_landing({"t": 1.0, "onset_err_ms": 20.0})["t"] == 1.0


def test_clip_start_prerolls_on_an_onset_just_before_the_segment(comp_slam):
    """B's landing attack 9 ms before its planned start: the clip opens 3 ms before the attack
    (the source onset is found although it lies outside the pre-rolled first segment)."""
    fa, fb = load("dreaming"), load("bluebird")
    base = C.compile_join(comp_slam, fa, fb)
    B = next(cp for cp in base.clips if cp.src == "b")
    land_s = comp_slam["b_ref"]["land_t"]
    fb2 = copy.deepcopy(fb)
    ot = np.asarray(fb2["onsets"]["t"], float)
    keep = np.abs(ot - land_s) > 0.030
    fb2["onsets"]["t"] = list(ot[keep]) + [land_s - 0.009]
    fb2["onsets"]["strength"] = list(np.asarray(fb2["onsets"]["strength"])[keep]) + [200.0]
    prog = C.compile_join(comp_slam, fa, fb2)
    B2 = next(cp for cp in prog.clips if cp.src == "b")
    edge = [s for s in prog.splices if s.clip == B2.id and s.kind == "edge_in"][0]
    assert edge.onset == pytest.approx(prog.t_land - 0.009, abs=1e-4)
    assert B2.pos[0]["t0"] == pytest.approx(prog.t_land - 0.012, abs=1e-4)
    assert B.pos[0]["t0"] > B2.pos[0]["t0"]


def test_v1_beat_this_phase_falls_back_to_bs_downbeats_after_a_tempo_step(tr):
    """Beat This smooths across a tempo step and puts B's first downbeat 110 ms early while its
    next ones sit on the landing's bar grid: V1 takes the median phase and passes; a landing a
    beat off still fails."""
    out, pa, pb = slam(tr)
    xf = int(0.015 * SR) / SR

    def bt(shift_first, shift_all=0.0):
        def f(mono, sr):
            d = xf + T_LAND + np.arange(-1, 3) * 4 * BEAT + shift_all
            d[1] += shift_first
            return d, d
        return f
    kw = dict(bt_cpu=False)
    args = (out, pa, pb, make_prog(), tr["fa"], tr["fb"], {"lufs": -11.0}, {"lufs": -11.0},
            {"ceiling_db": -1.0, "target_lufs": -11.0})
    ch = V.verify_join(*args, bt=bt(-0.110), **kw)
    assert "V1" not in ch["fail"] and abs(ch["bt_down_err_ms"]) <= 1
    ch = V.verify_join(*args, bt=bt(0.0, BEAT), **kw)                    # every downbeat a beat late
    assert "V1" in ch["fail"]
