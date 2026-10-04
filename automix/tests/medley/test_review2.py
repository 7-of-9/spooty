"""Fixer: regression tests for the reviews of the v1 build (timing audit #1-3, musical review
#1-7) and the ladder fixes found on the rebuild (planner-built fallback forms, the cut_on_one
repair rung)."""

import copy
from types import SimpleNamespace

import numpy as np
import pytest

from automix.medley import CFG
from automix.medley import build as B
from automix.medley import forms as FM
from automix.medley import highlights as HL
from automix.medley import planner as PL
from automix.medley import schema as S
from automix.medley import verify as V
from automix.medley.compile import compile_join
from helpers_e2 import load, locked_ctx, scaled
from test_integration import FakeSession, strong_onsets_bt, world  # noqa: F401  (fixture)
from test_planner import P, _fake, _info, _order, set3  # noqa: F401  (fixture)

SR = 44100
SLAMS = ("echo_slam", "roll_slam", "tape_stop_slam", "spin_slam", "cut_on_one", "air_cut")


@pytest.fixture(scope="module")
def F():
    return {n: load(n) for n in ("dance_no_more", "dreaming", "bluebird")}


def _lock3(F, vocal=False):
    """A lock join with a 3.7 % tempo difference (B slowed): every slam must ramp A onto B."""
    slow = scaled(F["dreaming"], 1.03, locked=True, track="spotify:slow")
    ctx = locked_ctx(F["dance_no_more"], 48, slow, 88)                  # lead none, no pickup
    if not vocal:
        ctx.ex = dict(ctx.ex, vocal_at_edge=False)
    return ctx


# --------------------------------------------------------------------------- timing #1: seam dips
def test_timing1_excerpt_gain_leaves_the_limiter_at_most_max_gr():
    """The v1 "seam dips" were the output limiter (identical whole-stream or per chunk) pulling
    B's first downbeat 2-4 dB down where the excerpt gain lifted a dynamic master (+4.8 dB):
    the gain is now capped at the MP3 limiter's ceiling + max_gr_db - the p95 bar true peak."""
    mg = CFG["loudness"]["max_gr_db"] - CFG["loudness"]["mp3_headroom_db"]    # GR at the MP3's limiter
    assert FM.excerpt_gain(-16.0, 0, -11.0, CFG) == pytest.approx(5.0)
    assert FM.excerpt_gain(-16.0, 0, -11.0, CFG, peak_db=-2.0, ceiling_db=-1.0) == pytest.approx(-1.0 + mg + 2.0)
    assert FM.excerpt_gain(-16.0, 0, -11.0, CFG, peak_db=-9.0, ceiling_db=-1.0) == pytest.approx(5.0)
    assert FM.excerpt_gain(-6.0, 0, -11.0, CFG, peak_db=0.5, ceiling_db=-1.0) == pytest.approx(-5.0)


def test_timing1_bar_peaks_and_body_peak():
    from automix.medley.feats import bar_peaks
    t = np.arange(4 * SR) / SR
    y = np.stack([np.sin(2 * np.pi * 997 * t)] * 2, 1).astype(np.float32)
    y[2 * SR:] *= 0.25
    pk = bar_peaks(y, np.array([0.0, 2.0]), 4.0)
    assert pk[0] == pytest.approx(0.0, abs=0.1) and pk[1] == pytest.approx(-12.04, abs=0.1)
    Fx = {"bars": {"t": [0.0, 2.0, 4.0, 6.0], "peak_db": [-1.0, -2.0, -3.0, -20.0]}}
    assert FM.body_peak(Fx, 0.0, 6.0) == pytest.approx(np.percentile([-1, -2, -3], CFG["loudness"]["peak_pct"]))
    assert CFG["loudness"]["peak_pct"] >= 90                           # v2: p75 still left 3.6 dB dips
    assert FM.body_peak({"bars": {"t": [0.0]}}, 0, 1) is None


# ------------------------------------------------------------------------ timing #2: lock steps
@pytest.mark.parametrize("form", SLAMS)
def test_timing2_lock_slams_ramp_a_onto_bs_tempo(F, form):
    """A slam in a lock join ramps A onto B's tempo while A is alone (R2, R5): no tempo step at
    the landing (v1: 14 lock echo/roll slams stepped 1.6-5 % there)."""
    ctx = _lock3(F)
    assert ctx.rel["kind"] == "lock" and abs(ctx.rel["stretch_pct"]) > 3
    fm = FM.FORMS[form]
    comp = fm.build(ctx, fm.variant_set(ctx)[0])
    assert comp is not None
    clk = comp["clock"]
    ramps = [s for s in clk if s["kind"] == "ramp"]
    assert len(ramps) == 1
    bars = (ramps[0]["m1"] - ramps[0]["m0"]) / comp["bpb"]
    assert CFG["ramp_bars"][0] <= bars <= CFG["ramp_bars"][1]
    assert abs(ramps[0]["bpm1"] / ramps[0]["bpm0"] - 1) * 100 / bars <= CFG["ramp_pct_per_bar"] + 1e-9
    for a, b in zip(clk, clk[1:]):                       # continuous everywhere, m = 0 included
        assert abs(a["bpm1"] - b["bpm0"]) <= CFG["limits"]["bpm_cont_tol"]
    assert ramps[0]["m1"] <= min(m["at"] for m in comp["moves"] if m["type"] != "eq") + 1e-9 or form == "air_cut"
    a = next(c for c in comp["clips"] if c["src"] == "a")
    assert a["warp"] == "r2" and comp["rel"]["stretch_pct"] == ctx.rel["stretch_pct"]
    assert S.validate_composition(comp, ctx.fa, ctx.fb) == []
    prog = compile_join(comp, ctx.fa, ctx.fb)
    assert S.validate_program(prog) == []


def test_timing2_free_slams_still_step_and_small_lock_differences_stay_native(F):
    ex = FM.exits_by_bar(F["bluebird"])[112][0]
    free = FM.JoinCtx({}, {}, F["bluebird"], F["dreaming"], dict(ex, vocal_at_edge=False), F["dreaming"]["landings"][0])
    assert free.rel["kind"] == "free"
    comp = FM.FORMS["roll_slam"].build(free, "roll")
    assert [s["kind"] for s in comp["clock"]][-1].startswith("b_") and not any(s["kind"] == "ramp" for s in comp["clock"])
    ctx = locked_ctx(F["dance_no_more"], 40, F["dreaming"], 80)          # -0.8 %: under slam_ramp_min_pct
    assert not ctx.slam_ramps
    comp = FM.FORMS["cut_on_one"].build(ctx, FM.FORMS["cut_on_one"].variant_set(ctx)[0])
    assert all(c["warp"] == "native" for c in comp["clips"])


# ---------------------------------------------------------------------------- timing #3: MP3 TP
def test_timing3_the_mp3_limiter_leaves_encoder_headroom(world, tmp_path, monkeypatch):  # noqa: F811
    """V7 is measured on the PCM; LAME overshoots its true peak by up to ~0.5 dB, so the MP3's
    limiter sits mp3_headroom_db under ceiling_db (v1's MP3 reached -0.50 dBTP)."""
    seen = []
    real = B.tp_limiter

    def spy(y, ceiling_db=-1.0, **kw):
        seen.append(ceiling_db)
        return real(y, ceiling_db, **kw)

    monkeypatch.setattr(B, "tp_limiter", spy)
    sess = FakeSession(world, str(tmp_path / "out" / "verify.json"))
    B.cli_build("/toy/x", str(tmp_path / "out"), data_dir=str(tmp_path), session=sess, no_verify=True,
                log=lambda *a: None)
    want = sess.state["params"]["ceiling_db"] - CFG["loudness"]["mp3_headroom_db"]
    assert CFG["loudness"]["mp3_headroom_db"] >= 0.5 and seen and all(c == pytest.approx(want) for c in seen)


# ------------------------------------------------------------------ musical #1: the same sound
def test_musical1_echo_settings_rotate_without_repeats_within_5(F):
    sets = CFG["forms"]["echo_sets"]
    assert len({(s["delay"], tuple(s["hp_hz"]), s["send_db"]) for s in sets}) == len(sets) >= 6
    got = []
    for i in range(12):
        ctx = _lock3(F)
        ctx.idx = i
        comp = FM.FORMS["echo_slam"].build(ctx, "echo")
        mv = next(m for m in comp["moves"] if m["type"] == "echo")
        got.append((mv["delay"], tuple(mv["hp_hz"]), mv["send_db"]))
    for i in range(len(got)):
        assert got[i] not in got[max(0, i - 5):i]


def test_musical1_beam_penalises_back_to_back_vacuums():
    infos = [_info() for _ in range(7)]
    joins = []
    for _ in range(6):
        v = _fake("echo_slam", 10, 26, 3.0, family="v", i=0)
        g = _fake("air_cut", 10, 26, 2.7, family="g", i=1)
        v.vacuum, g.vacuum = True, False
        joins.append([v, g])
    chosen, _, _ = PL.beam(infos, joins)
    vac = [q.vacuum for q in chosen]
    assert not any(a and b for a, b in zip(vac, vac[1:]))


def test_musical1_air_cut_is_a_lock_slam_without_a_vacuum(F):
    ctx = _lock3(F)
    comp = FM.FORMS["air_cut"].build(ctx, "air")
    assert not FM.is_vacuum(comp) and comp["tier"] == "noticeable"
    st = S.static_eval(comp)
    a = st.clips["A"]
    hold = CFG["forms"]["air_cut_hold_db"]
    last = (st.m > -0.2) & (st.m < 0)                                        # A plays into the one
    assert a.audible[last].all() and np.allclose(a.level[last], hold, atol=0.05)
    assert hold <= CFG["verify"]["air_db"] and not np.isfinite(a.eq["low"][last]).any()   # R6: low out
    assert S.validate_composition(comp, ctx.fa, ctx.fb) == []
    prog = compile_join(comp, ctx.fa, ctx.fb)
    assert not prog.expect.get("vacuums") and not prog.expect.get("silences")
    assert "air_cut" in FM.cell(ctx) and FM.FORMS["air_cut"].allowed(ctx)


# --------------------------------------------------------------- musical #2: the best landing
def test_musical2_beam_looks_ahead_at_bs_landing():
    """B's H is added when B's excerpt closes (the next join); the beam scores a candidate with
    B's best H as a look-ahead, so a slightly better join score cannot buy a weak landing."""
    a, b = _info(), _info(2)
    b.lands[10]["h"], b.lands[11]["h"] = 1.0, 3.0
    for (j, X), e in list(b._eh.items()):
        b._eh[(j, X)] = (e[0], b.lands[j]["h"])
    joins = [[_fake("drop_swap", 10, 26, 3.0, i=0), _fake("drop_swap", 11, 26, 2.8, i=1)]]
    chosen, _, _ = PL.beam([a, b], joins)
    assert chosen[0].j == 11


def test_musical2_a_drop_with_a_weak_on_time_onset_passes_the_onset_gate():
    """Dreaming 2:32.68: the bass stem jumps -66 -> -17 dB on the downbeat but the onset after
    the riser is 0.65 x the median: V1's drop floor accepts it, the planner keeps the landing."""
    drop = {"t": 152.68, "onset_ok": False, "onset_err_ms": 2.0, "onset_strength": 0.65,
            "contrast_db": 4.0, "low_jump_db": 12.0}
    assert FM.drop_ok(drop) and FM.measured_landing(drop)["v1_ok"]
    assert FM.measured_landing(drop)["t"] == pytest.approx(152.682)
    weak = dict(drop, contrast_db=0.5, low_jump_db=1.0)
    assert not FM.drop_ok(weak) and not FM.measured_landing(weak)["v1_ok"]
    assert CFG["verify"]["land_strength_drop"] <= CFG["highlight"]["drop_onset_ratio"]


# ------------------------------------------------------------------ musical #3: non-arrivals
def test_musical3_slam_bin_rewards_an_arrival(F):
    ctx = _lock3(F)
    comp = FM.FORMS["echo_slam"].build(ctx, "echo")
    ctx.land = dict(ctx.land, arrival=True)
    hit = FM.local_score(ctx, comp)[1]["bin"]
    ctx.land = dict(ctx.land, arrival=False)
    miss = FM.local_score(ctx, comp)[1]["bin"]
    bs = CFG["score"]["bin_slam"]
    assert hit - miss == pytest.approx(bs["onset"] - bs["no_arrival"])


# ------------------------------------------------------------------ musical #4: sung exits
def test_musical4_a_sung_exit_allows_only_echo_throwing_forms(F):
    ex = FM.exits_by_bar(F["bluebird"])[112][0]
    sung = FM.JoinCtx({}, {}, F["bluebird"], F["dreaming"], dict(ex, vocal_at_edge=True),
                      dict(F["dreaming"]["landings"][0], lead=dict(F["dreaming"]["landings"][0]["lead"], pickup_beats=0)))
    assert sung.rel["kind"] == "free"
    ok = {n for n, f in FM.FORMS.items() if f.allowed(sung)}
    # tape stop and backspin cut A's line within the last bar; the roll cuts it 2 bars earlier,
    # where (no stems here) no vocal run is known
    assert ok & {"tape_stop_slam", "spin_slam"} == set() and {"echo_slam", "cut_on_one", "roll_slam"} <= ok
    assert FM.FORMS["roll_slam"].cut_bars == 2
    q = FM.local_score(sung, FM.FORMS["cut_on_one"].build(sung, FM.FORMS["cut_on_one"].variant_set(sung)[0]))
    assert q[1]["rt"] == pytest.approx(CFG["score"]["vocal_edge_noecho"])
    clear = FM.JoinCtx({}, {}, F["bluebird"], F["dreaming"], dict(ex, vocal_at_edge=False), F["dreaming"]["landings"][0])
    assert FM.FORMS["roll_slam"].allowed(clear)


def _v12_join(comp, program, vocal_db, pause_at=None):
    """A minimal _Join for _v12_src: A's source vocal stem at vocal_db (rel. its body bar level)
    around the composition's cut point, optionally pausing from `pause_at` (source s)."""
    t_of_m = lambda m: float(np.interp(m, program.clock_m, program.clock_t))  # noqa: E731
    m_c = V.a_cut_m(comp)
    s_c = V._src_at(program, "a", t_of_m(m_c))
    s0 = s_c - 5.0
    x = np.full(int(10 * SR), 10 ** (vocal_db / 20), np.float32) * np.sin(np.arange(int(10 * SR)) * 0.05).astype(np.float32)
    x *= np.sqrt(2)
    if pause_at is not None:
        x[int((pause_at - s0) * SR):] = 0
    J = SimpleNamespace(stems_parts={"vox": {"a": {"s0": s0, "x": x, "ref_db": 0.0, "vocal": True}}}, prog=program,
                        t_of_m=t_of_m, sr=SR, notes=[], T=float(program.T), tl=float(program.t_land), beat=0.47)
    return J, s_c


def test_musical4_v12_fails_a_cut_through_a_sung_line_unless_a_throws_an_echo(comp, program):
    J, s_c = _v12_join(comp, program, -10.0)
    assert V._v12_src(J, comp, J.stems_parts["vox"])[0] == "fail"
    J, _ = _v12_join(comp, program, -10.0, pause_at=s_c + 0.05)            # the line ends at the cut
    assert V._v12_src(J, comp, J.stems_parts["vox"])[0] == "pass"
    J, _ = _v12_join(comp, program, -40.0)                                 # no vocal there
    assert V._v12_src(J, comp, J.stems_parts["vox"])[0] == "pass"
    thrown = B.generic_repair(comp, {"fail": ["V12"]})
    assert thrown is not None and any(m["type"] == "echo" for m in thrown["moves"])
    J, _ = _v12_join(thrown, program, -10.0)
    assert V._v12_src(J, thrown, J.stems_parts["vox"])[0] == "pass"
    assert "V12" in V.HARD_PHASE1


def test_ladder_repairs_its_cut_on_one_when_budget_remains(world, tmp_path, monkeypatch):  # noqa: F811
    """Rung 4b: the fallback cut_on_one failing V12 (a cut through a sung line) gets its echo
    throw before the join is given up as failed."""
    sess = FakeSession(world, str(tmp_path / "verify.json"))
    sess.engine.faults.append(("drop_swap", "", 0.040, True))           # every drop_swap flams
    real = B.verify_rendered

    def fake(s, plan, i, comp, r, **kw):
        ch = real(s, plan, i, comp, r, **kw)
        if comp["form"] == "cut_on_one" and "throw" not in comp["variant"]:
            ch = dict(ch, status="fail", fail=sorted(set(ch["fail"]) | {"V12"}))
        return ch

    monkeypatch.setattr(B, "verify_rendered", fake)
    plan = sess.plan()
    hooks = B.Hooks(plan)
    hooks.repair = lambda i, c, ch, n, fa=None, fb=None: None if c["form"] == "drop_swap" else \
        B.generic_repair(c, ch, n, fa, fb)
    res = B.ladder(sess, 0, plan, hooks=hooks, bt=strong_onsets_bt, store=sess.store, log=lambda *a: None)
    forms = [(h["form"], h["variant"]) for h in res.checks["history"]]
    assert forms[0][0] == "drop_swap" and forms[-2][0] == "cut_on_one" and forms[-1][1].endswith(".throw")
    assert res.checks["status"] != "fail" and len(forms) <= CFG["verify"]["max_renders"]


def test_memo_hooks_build_fallback_forms_the_memo_pruned(set3):  # noqa: F811
    tr, fs = set3
    plan = PL.build_medley_plan(tr, _order(tr, [1, 0, 2, 3]), P, {"seed": 9}, fs)
    work = copy.deepcopy(plan)                    # build_all's copy: unknown to the planner registry
    comp = work["transitions"][0]["composition"]
    assert B.MemoHooks(work, {}, None).fallback(0, comp, "echo_slam") is None
    got = B.MemoHooks(work, {}, None, source=plan).fallback(0, comp, "echo_slam")
    want = PL.fallback_join(plan, 0, "echo_slam")
    assert (got is None) == (want is None)
    if got is not None:
        assert got["form"] == "echo_slam" and got["id"] == comp["id"] and got["hash"] == S.canonical_hash(got)
        assert (got["a_ref"]["exit_bar"], got["b_ref"]["land_bar"]) == (comp["a_ref"]["exit_bar"], comp["b_ref"]["land_bar"])
    other = dict(comp, b_ref=dict(comp["b_ref"], land_bar=comp["b_ref"]["land_bar"] + 1))
    assert B.MemoHooks(work, {}, None, source=plan).fallback(0, other, "echo_slam") is None


# ------------------------------------------------------------------ musical #5: energy arc
def test_musical5_order_cost_weighs_energy_steps_and_bucket_changes():
    from automix.medley import order as O
    oc = CFG["order_cost"]
    assert oc["step"] >= 4 and oc["bucket"] > 0
    assert CFG["blocks"]["order"] == ["house", "dnb", "swing", "rock", "close"]
    Fx = {"bpm": 120.0, "bpb": 4, "landings": [], "bars": {}}
    a = {"id": "a", "camelot": "8A", "bucket": "rock", "artist": "x"}
    b = {"id": "b", "camelot": "8A", "bucket": "chill", "artist": "y"}
    v, terms = O.pair_cost(a, b, Fx, Fx, 0.8, 0.1, "close", 1.0)
    assert terms["bucket"] == oc["bucket"] and terms["step"] == pytest.approx(oc["step"] * (0.7 - oc["step_free"]))


# ------------------------------------------------------------------ musical #6: the set's end
def _cx(bar_t, dur, conf=0.0, P=4, bounds=(), last_loud=None):
    cx = HL.Ctx.__new__(HL.Ctx)
    cx.c, cx.g, cx.nb, cx.dur = CFG, np.asarray(bar_t, float), len(bar_t), dur
    cx.conf, cx.P, cx.phase = conf, P, 0
    cx.bounds = sorted(set(bounds) | {len(bar_t)})
    cx.last_loud = len(bar_t) - 1 if last_loud is None else last_loud
    return cx


def test_musical6_body_length_is_checked_in_real_seconds():
    """Heartbreaker: bars halve at bar 67 (2.44 -> 1.14 s), so "16 bars" of the median bar lasted
    18.3 s, under body_s[0] = 28 s."""
    bar_t = np.r_[np.arange(0, 67) * 2.44, 67 * 2.44 + np.arange(0, 60) * 1.14]
    cx = _cx(bar_t, float(bar_t[-1] + 1.14))
    assert cx.span_s(64, 80) == pytest.approx(3 * 2.44 + 13 * 1.14)
    assert not HL.exit_ok(cx, 64, 16, 0)                                  # 18.1 s
    assert HL.exit_ok(cx, 40, 16, 0)                                      # 39 s of 2.44 s bars


def test_musical6_the_last_song_ends_on_a_section_with_a_long_fade():
    L = CFG["loudness"]
    Fx = {"bpb": 4, "bpm": 120.0, "duration": 300.0,
          "sections": [{"start": s} for s in (0.0, 96.0, 104.0, 112.0, 200.0)]}
    ti = PL.TrackInfo({"id": "z"}, Fx, {20: {"win": {"fit": {"period_s": 0.5}, "cls": "locked"}, "exits": []}})
    end, fade = PL.final_ending(ti, {"exit": {"t": 100.0}, "land": {"bar": 20}}, CFG)
    assert fade >= L["final_fade_min_s"] and end == 112.0                 # the first boundary >= 8 s on
    end, fade = PL.final_ending(ti, {"exit": {"t": 250.0}, "land": {"bar": 20}}, CFG)
    assert (end, fade) == (300.0, 0.0)                                    # the song's own ending
    Fx["sections"] = [{"start": 0.0}]
    end, fade = PL.final_ending(ti, {"exit": {"t": 100.0}, "land": {"bar": 20}}, CFG)
    assert end == pytest.approx(100.0 + fade) and fade >= L["final_fade_min_s"]


# ------------------------------------------------------------------ musical #7: verse bodies
def test_musical7_verse_bars_cost_and_a_section_end_pays():
    from test_highlights import song
    Fx = song()
    cx = HL.Ctx(Fx)
    j, n = 24, 16
    lead = HL.lead_type(Fx, j)
    e = HL.exit_terms(cx, j, j + n)
    base = HL._h(cx, j, n, lead, e, 1.0)
    hh = CFG["highlight"]["h"]
    assert HL._h(cx, j, n, lead, dict(e, verse_bars=10), 1.0) - base == pytest.approx(hh["verse_bar"] * (10 - e["verse_bars"]))
    assert HL._h(cx, j, n, lead, dict(e, section_end=not e["section_end"]), 1.0) - base == \
        pytest.approx(hh["section_end"] * (1 if not e["section_end"] else -1))
    assert hh["verse_bar"] < 0 < hh["section_end"] and hh["vocal_edge"] < 0


def test_ladder_keeps_cut_on_one_for_rung_4_and_throws_first_on_v12(world, tmp_path, monkeypatch):  # noqa: F811
    """v2 join 29: a cut_on_one "alternative" spent the last free render, so rung 3's echo_slam
    (the only form that passes V12 on a sung exit) never ran and the join ended failing V12."""
    sess = FakeSession(world, str(tmp_path / "verify.json"))
    real = B.verify_rendered

    def fake(s, plan, i, comp, r, **kw):
        ch = real(s, plan, i, comp, r, **kw)
        if comp["form"] != "echo_slam":                  # a sung exit: only the throw passes V12
            ch = dict(ch, status="fail", fail=sorted(set(ch["fail"]) | {"V12"}))
        return ch

    monkeypatch.setattr(B, "verify_rendered", fake)
    plan = sess.plan()
    comp = plan["transitions"][0]["composition"]
    echo = B._rehash(dict(copy.deepcopy(B.cut_on_one_from(comp)), form="echo_slam", variant="echo"))
    hooks = B.Hooks(plan)
    hooks.repair = lambda *a, **k: None
    hooks.alternatives = lambda i, c: [B.cut_on_one_from(c)] + [B._rehash(dict(copy.deepcopy(c), variant=f"alt{k}"))
                                                                for k in range(2)]
    hooks.fallback = lambda i, c, form, fa=None, fb=None: echo if form == "echo_slam" else \
        (B.cut_on_one_from(c) if form == "cut_on_one" else B._rehash(dict(copy.deepcopy(c), variant=f"fb-{form}")))
    comp["fallback"] = ["phrase_trade", "echo_slam", "roll_slam", "cut_on_one"]
    res = B.ladder(sess, 0, plan, hooks=hooks, bt=strong_onsets_bt, store=sess.store, log=lambda *a: None)
    forms = [h["form"] for h in res.checks["history"]]
    assert "cut_on_one" not in forms[:-1] and forms[-1] == "echo_slam" and res.checks["status"] != "fail"


def test_musical5_the_dnb_swing_bridge_weighs_the_energy_step():
    from automix.medley import order as O
    from test_highlights import song
    fs = {"d1": song(bpm=174.0, track="spotify:d1"), "s1": song(bpm=87.0, track="spotify:s1"),
          "s2": song(bpm=88.5, track="spotify:s2")}
    by = {k: {"id": k} for k in fs}
    mem = {"dnb": ["d1"], "swing": ["s1", "s2"]}
    get = lambda t: fs[t["id"]]  # noqa: E731
    assert O._dnb_swing_bridge(mem, by, get, CFG)[1] == "s1"                          # tempo alone
    assert O._dnb_swing_bridge(mem, by, get, CFG, {"d1": 0.8, "s1": 0.2, "s2": 0.75})[1] == "s2"
