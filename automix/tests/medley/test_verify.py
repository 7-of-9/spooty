"""E4: verify.py (DESIGN §16) on synthetic joins with known onsets (fixtures/synth.py).

A synthetic join is a 120 BPM region [-8, +4] master beats (T = 6 s, t_land = 4 s) built
from two synth tracks by plain crops and gain envelopes, with a matching Program, so every
check can be driven into pass and fail deliberately. Beat This is injected (a callable) except
in the one CPU smoke test."""

import json
import os

import numpy as np
import pytest

import synth
from automix.medley import CFG
from automix.medley import schema as S
from automix.medley import verify as V
from automix.render import crop

SR = 44100
XF = int(0.015 * SR)
BPM = 120.0
BEAT = 60.0 / BPM
FROM, TO = -8, 4
T = (TO - FROM) * BEAT                      # 6 s
T_LAND = -FROM * BEAT                       # 4 s
OFF = 4.5                                   # region t -> source s = t + OFF (a downbeat at t = 0)
P = {"ceiling_db": -1.0, "target_lufs": -11.0}


def tm(m: float) -> float:
    return (m - FROM) * BEAT


def track(parts, bars=12, seed=0, gain=0.4, **kw) -> synth.Synth:
    """A synth track at a realistic level (the raw synth peaks near 0 dBFS)."""
    s = synth.make_track(BPM, [("s", bars, set(parts))], seed=seed, **kw)
    s.y *= np.float32(gain)
    for k in s.stems:
        s.stems[k] *= np.float32(gain)
    return s


def region(y: np.ndarray, off: float = OFF, shift_s: float = 0.0) -> np.ndarray:
    """Region crop [-XF, T + XF] of a native track; shift_s > 0 makes it sound later."""
    i0 = int(round((off - shift_s) * SR)) - XF
    return crop(y, i0, i0 + XF + int(round(T * SR)) + XF)


def env(knots) -> np.ndarray:
    """Amplitude envelope over the region from [(t, amp)] knots (linear, held at the ends)."""
    t = (np.arange(XF + int(round(T * SR)) + XF) - XF) / SR
    xs, ys = zip(*knots)
    return np.interp(t, xs, ys).astype(np.float32)[:, None]


def feats_lite(s: synth.Synth) -> dict:
    """The Feats fields verify reads: median downbeat onset strength, kblocks, bar times."""
    t, st = V.onsets(s.y)
    at_down = [st[np.argmin(np.abs(t - d))] for d in s.downbeats if np.min(np.abs(t - d)) < 0.005]
    return {"onsets": {"t": t.tolist(), "strength": st.tolist(),
                       "median_down_strength": float(np.median(at_down)) if at_down else 1.0},
            "kblocks": {"block_s": 0.4, "hop_s": 0.1, "ms": V.kblocks(s.y)},
            "bars": {"t": [float(x) for x in s.downbeats]}, "bpb": 4}


def clip_prog(cid: str, src: str, t0: float, t1: float, gain_db=None, off: float = OFF) -> S.ClipProgram:
    s0 = off + t0 - 1.0
    return S.ClipProgram(id=cid, src=src, stems="mix",
                         source={"kind": "native", "s0": s0, "s1": off + t1 + 1.0},
                         pos=[{"t0": t0, "t1": t1, "kind": "copy", "w0": off + t0 - s0}],
                         gain_db=gain_db or [[t0, 0.0, "hold"]], hp_hz=None, lp_hz=None,
                         eq_db={"low": [], "mid": [], "high": []}, trim_db=0.0, track_gain_from=src)


def make_prog(b_from: float = T_LAND, a_to: float = T_LAND, splices=(), **expect) -> S.Program:
    cm = np.arange(FROM * 64, TO * 64 + 1) / 64
    exp = {"land_t": T_LAND, "vacuums": [], "layered": [], "tonal": [], "ramps": [], "step_planned_lu": None,
           "silences": [], "gestures": [], "seams": [], "onsets": {}}
    exp.update(expect)
    A = clip_prog("A", "a", -XF / SR, a_to, [[tm(-1), 0.0, "cos"], [a_to, None, "hold"]])
    B = clip_prog("B", "b", b_from, T + XF / SR)
    return S.Program(version="1.0", sr=SR, xf=XF, T=T, t_land=T_LAND, clock_m=cm.tolist(),
                     clock_t=((cm - FROM) * BEAT).tolist(), clips=[A, B], echoes=[], splices=list(splices),
                     grid=[[tm(m), m % 4 == 0, "a" if m < 0 else "b"] for m in range(FROM, TO + 1)],
                     events=[], expect=exp)


@pytest.fixture(scope="module")
def tracks():
    a = track({"kick", "hat", "bass", "pad"}, seed=1)
    b = track({"kick", "snare", "hat", "bass", "pad"}, seed=2, root=60)
    return {"a": a, "b": b, "fa": feats_lite(a), "fb": feats_lite(b)}


def slam(tr, a_env=None, b_shift=0.0, b_gain=1.0, b_env=None):
    """A fades out over its last two beats (the air) and B slams native at t_land."""
    a_env = a_env if a_env is not None else env([(tm(-2), 1.0), (tm(-1), 0.4), (T_LAND - 0.001, 0.0)])
    b_env = b_env if b_env is not None else env([(T_LAND - 0.004, 0.0), (T_LAND - 0.003, 1.0)])
    pa = region(tr["a"].y) * a_env
    pb = region(tr["b"].y, shift_s=b_shift) * b_env * np.float32(b_gain)
    return pa + pb, pa, pb


def context(tr, b_gain=1.0):
    pre = crop(tr["a"].y, int((OFF - 4.0) * SR), int(OFF * SR))
    post = crop(tr["b"].y, int((OFF + T) * SR), int((OFF + T + 4.0) * SR)) * np.float32(b_gain)
    ref = {"a": V.body_ref(tr["a"].y, tr["fa"], 1.0, 9.0), "b": V.body_ref(tr["b"].y, tr["fb"], 1.0, 9.0)}
    return pre, post, ref


def run(tr, out, pa, pb, prog, *, bt_shift_ms=0.0, bt=True, hard=V.HARD_ALL, ctx=True, b_gain=1.0, detail=None):
    pre, post, ref = context(tr, b_gain) if ctx else (None, None, None)
    off = (len(pre) / SR) if ctx else XF / SR

    def fake_bt(mono, sr):
        # the verifier crops [t_land - 8 beats - V1_BT_PAD_S, ...] from pre + region + post;
        # its downbeats are B's bar lines at 4-beat spacing around t_land (+ shift)
        i0 = max(0.0, off + T_LAND - 8 * BEAT - V.V1_BT_PAD_S)
        d = T_LAND + off - i0 + np.arange(-4, 5) * 4 * BEAT + bt_shift_ms / 1000
        return d, d                               # beats are not used by V1
    return V.verify_join(out, pa, pb, prog, tr["fa"], tr["fb"], {"lufs": -11.0}, {"lufs": -11.0}, P,
                         bt=fake_bt if bt else None, bt_cpu=False, pre=pre, post=post, ref=ref,
                         hard=hard, detail=detail)


# ---------------------------------------------------------------------------------------------
def test_onsets_match_synth_to_1ms():
    s = track({"kick", "hat"}, bars=8, jitter_ms=3, seed=3)
    t, st = V.onsets(s.y)
    truth = np.concatenate([s.onsets["kick"], s.onsets["hat"]])
    d = np.array([t[np.argmin(np.abs(t - x))] - x for x in truth]) * 1000
    assert np.all(np.abs(d) < 5)
    assert abs(np.median(d)) <= 1.0 and np.median(np.abs(d)) <= 1.0
    # the drums stem gives the same kicks
    t2, _ = V.onsets(s.stems["drums"])
    assert np.median([np.min(np.abs(t2 - x)) for x in s.onsets["kick"]]) * 1000 <= 1.0


def test_clean_slam_passes_every_hard_check(tracks):
    out, pa, pb = slam(tracks)
    det = {}
    ch = run(tracks, out, pa, pb, make_prog(), detail=det)
    assert S.validate_checks(ch) == []
    assert list(ch) == [k for k in S.Checks.__annotations__ if k != "blend"]   # blend: the ladder's
    assert ch["status"] in ("pass", "warn"), det
    assert ch["fail"] == []
    assert abs(ch["land_err_ms"]) <= 2 and ch["land_strength"] >= 0.8
    assert abs(ch["bt_down_err_ms"]) <= 1
    assert ch["flams"] == 0 and ch["clicks"] == 0 and ch["dbl_bass_beats"] <= 1
    assert ch["a_air_db"] <= -6
    assert ch["tp_dbtp"] <= -0.8 and ch["limiter_ms_over6"] == 0
    assert ch["gaps_unplanned"] == 0 and ch["gesture_ok"] is True
    assert ch["vocal_edge_db"] is None
    # planned step from the kblocks + track gains matches the render
    assert abs(ch["step_lu"] - ch["step_planned_lu"]) <= 0.5
    json.dumps(ch)


def test_v1_late_landing_fails(tracks):
    out, pa, pb = slam(tracks, b_shift=0.015)
    ch = run(tracks, out, pa, pb, make_prog())
    assert "V1" in ch["fail"] and ch["status"] == "fail"
    assert 13 <= ch["land_err_ms"] <= 17


def test_v1_weak_onset_and_beat_this_disagreement(tracks):
    out, pa, pb = slam(tracks)
    strong = dict(tracks, fb={**tracks["fb"], "onsets": {**tracks["fb"]["onsets"],
                                                         "median_down_strength": 1e6}})
    ch = run(strong, out, pa, pb, make_prog())
    assert "V1" in ch["fail"] and ch["land_strength"] < 0.8
    ch = run(tracks, out, pa, pb, make_prog(), bt_shift_ms=60)
    assert "V1" in ch["fail"] and 55 <= ch["bt_down_err_ms"] <= 65
    ch = run(tracks, out, pa, pb, make_prog(), bt=False)       # no Beat This: onset criteria only
    assert ch["bt_down_err_ms"] is None and "V1" not in ch["fail"]


def test_v3_flams_need_two_parts_20_to_90_ms_apart():
    a = track({"kick"}, seed=4)
    b = track({"kick"}, seed=5)
    tr = {"a": a, "b": b, "fa": feats_lite(a), "fb": feats_lite(b)}
    lay = env([(tm(-4) - 0.004, 0.0), (tm(-4) - 0.003, 1.0)])
    prog = make_prog(b_from=tm(-4), layered=[[tm(-4), T_LAND]])
    for shift, want in ((0.040, True), (0.0, False), (0.150, False)):
        pa = region(a.y) * env([(tm(-1), 1.0), (T_LAND - 0.001, 0.0)])
        pb = region(b.y, shift_s=shift) * lay
        ch = run(tr, pa + pb, pa, pb, prog)
        assert (ch["flams"] > 0) == want, (shift, ch["flams"])
        assert ("V3" in ch["fail"]) == want


def test_v4_double_bass(tracks):
    lay = env([(tm(-4) - 0.004, 0.0), (tm(-4) - 0.003, 1.0)])
    pa = region(tracks["a"].y) * env([(0.0, 1.0), (T_LAND - 0.01, 1.0), (T_LAND, 0.0)])
    pb = region(tracks["b"].y) * lay
    ch = run(tracks, pa + pb, pa, pb, make_prog(b_from=tm(-4)))
    assert ch["dbl_bass_beats"] >= 3 and "V4" in ch["fail"]
    from automix.audio import split_bands
    lo, hi = split_bands(pb, 150.0)
    pb2 = np.where((np.arange(len(pb)) < XF + int(T_LAND * SR))[:, None], hi, pb).astype(np.float32)
    ch = run(tracks, pa + pb2, pa, pb2, make_prog(b_from=tm(-4)))
    assert ch["dbl_bass_beats"] <= 1 and "V4" not in ch["fail"]


def test_v6_click_at_a_splice_without_source_onset():
    # no saw bass here: synth.py's naive sawtooth has a discontinuity every period
    a, b = track({"kick", "hat", "pad"}, seed=1), track({"kick", "snare", "hat", "pad"}, seed=2)
    tracks = {"a": a, "b": b, "fa": feats_lite(a), "fb": feats_lite(b)}
    t_sp = tm(-2.25)                                   # between hits: no source onset nearby
    out, pa, pb = slam(tracks)
    sp = S.Splice(t=t_sp, clip="A", kind="gain", onset=None, xf_ms=3, search_ms=0)
    ch = run(tracks, out, pa, pb, make_prog(splices=[sp]))
    assert ch["clicks"] == 0
    k = XF + int(t_sp * SR)
    bad = out.copy()
    bad[k:k + 2] += 0.5                                # a two-sample spike: a hard discontinuity
    ch = run(tracks, bad, pa, pb, make_prog(splices=[sp]))
    assert ch["clicks"] == 1 and "V6" in ch["fail"]
    exempt = S.Splice(t=t_sp, clip="A", kind="gain", onset=t_sp + 0.003, xf_ms=3, search_ms=0)
    ch = run(tracks, bad, pa, pb, make_prog(splices=[exempt]))
    assert ch["clicks"] == 0


def test_v7_true_peak_and_gain_reduction(tracks):
    out, pa, pb = slam(tracks)
    ch = run(tracks, out * 8, pa * 8, pb * 8, make_prog())
    assert "V7" in ch["fail"] and ch["limiter_ms_over6"] > 50


def test_v8_step_against_planned(tracks):
    out, pa, pb = slam(tracks, b_gain=10 ** (6 / 20))
    ch = run(tracks, out, pa, pb, make_prog(), b_gain=10 ** (6 / 20))
    assert 5 <= ch["step_lu"] - ch["step_planned_lu"] <= 7 and "V8" in ch["fail"]
    out, pa, pb = slam(tracks, b_gain=10 ** (2.5 / 20))
    det = {}
    ch = run(tracks, out, pa, pb, make_prog(), b_gain=10 ** (2.5 / 20), detail=det)
    assert "V8" not in ch["fail"] and "V8" in det["warn"]
    # an explicit plan value overrides the kblocks estimate
    out, pa, pb = slam(tracks)
    ch = run(tracks, out, pa, pb, make_prog(step_planned_lu=-5.0))
    assert ch["step_planned_lu"] == -5.0 and "V8" in ch["fail"]


def test_v11_air_needs_a_quiet_end_of_the_last_beat(tracks):
    # A held at full level with a kick on -1/4 (A's grid moved 1/4 beat early)
    hold = env([(0.0, 1.0), (T_LAND - 0.001, 1.0), (T_LAND, 0.0)])
    pa = region(tracks["a"].y, shift_s=-0.125) * hold
    _, _, pb = slam(tracks)
    ch = run(tracks, pa + pb, pa, pb, make_prog())
    assert ch["a_air_db"] > -4 and "V11" in ch["fail"]
    # R6's sanctioned shapes pass: a cut at -1/4 (cut_on_one) ...
    cut = env([(0.0, 1.0), (tm(-0.25) - 0.003, 1.0), (tm(-0.25) + 0.002, 0.0)])
    out, pa, pb = slam(tracks, a_env=cut)
    assert run(tracks, out, pa, pb, make_prog())["a_air_db"] <= -6
    # ... and a cos fade over the last beat with the low band out from -1/2 (drop_swap)
    from automix.audio import split_bands
    t = (np.arange(len(pa)) - XF) / SR
    x = np.clip((t - tm(-1)) / BEAT, 0, 1)
    fade = ((1 + np.cos(np.pi * x)) / 2).astype(np.float32)[:, None]
    lo, hi = split_bands(region(tracks["a"].y), 150.0)
    pa2 = (np.where((t < tm(-0.5))[:, None], lo, 0) + hi) * fade * (t < T_LAND)[:, None]
    pa2 = pa2.astype(np.float32)
    ch = run(tracks, pa2 + pb, pa2, pb, make_prog())
    assert ch["a_air_db"] <= -6


def test_v9_gaps_and_enforcement_levels(tracks):
    out, pa, pb = slam(tracks)
    gap = env([(0.0, 1.0), (1.999, 1.0), (2.0, 0.0), (2.3, 0.0), (2.301, 1.0)])
    pa2 = pa * gap
    ch = run(tracks, pa2 + pb, pa2, pb, make_prog())
    assert ch["gaps_unplanned"] == 1 and "V9" in ch["fail"]
    det = {}
    ch = run(tracks, pa2 + pb, pa2, pb, make_prog(), hard=V.HARD_PHASE1, detail=det)
    assert "V9" not in ch["fail"] and "V9" in det["warn"] and ch["status"] == "warn", det
    ch = run(tracks, pa2 + pb, pa2, pb, make_prog(vacuums=[[2.0, 2.3]]))
    assert ch["gaps_unplanned"] == 0
    late = [{"kind": "tape_stop", "clip": "A", "t0": 2.0, "t1": 3.95, "stop_t": 3.95}]
    ch = run(tracks, out, pa, pb, make_prog(gestures=late))
    assert ch["gesture_ok"] is False and "V9" in ch["fail"]


def test_v2a_v2b_v10_on_a_locked_layer():
    # no saw bass (synth.py's naive sawtooth makes an "onset" every period) and no snare (its
    # noise burst stops dead after 150 ms, which reads as an off-grid onset)
    a, b = track({"kick", "hat", "pad"}, seed=1), track({"kick", "hat", "pad"}, seed=2, root=60)
    tracks = {"a": a, "b": b, "fa": feats_lite(a), "fb": feats_lite(b)}
    lay = env([(tm(-4) - 0.004, 0.0), (tm(-4) - 0.003, 10 ** (-6 / 20))])
    pa = region(a.y) * env([(tm(-1), 1.0), (T_LAND - 0.001, 0.0)])
    pb = region(b.y) * lay
    # expected onsets = the Feats onsets (same detector on the native track) mapped to the region
    def expect(F, t0, t1):
        return [[float(x - OFF), float(s)] for x, s in zip(F["onsets"]["t"], F["onsets"]["strength"])
                if t0 < x - OFF < t1]
    exp_a, exp_b = expect(tracks["fa"], 0.05, tm(-1)), expect(tracks["fb"], tm(-4), T - 0.05)
    prog = make_prog(b_from=tm(-4), layered=[[tm(-4), T_LAND]], onsets={"A": exp_a, "B": exp_b})
    det = {}
    ch = run(tracks, pa + pb, pa, pb, prog, detail=det)
    assert ch["grid_med_ms"] is not None and ch["grid_med_ms"] <= CFG["verify"]["v2a_med_ms"]
    assert ch["fid_med_ms"] <= 1.0
    assert ch["tempo_jump_pct"] <= 1.2
    assert det["results"]["V2a"] == "pass" and det["results"]["V2b"] == "pass" and det["results"]["V10"] == "pass"


def test_fallbacks_without_context_or_feats(tracks):
    out, pa, pb = slam(tracks)
    bare = dict(tracks, fa={}, fb={})
    ch = run(bare, out, pa, pb, make_prog(), ctx=False, bt=False)
    assert S.validate_checks(ch) == []
    assert abs(ch["land_err_ms"]) <= 2 and ch["a_air_db"] <= -6


def test_verify_json_matches_checks_schema_on_fixture_program(program):
    """The Phase 0 program fixture drives the verifier's program plumbing (no audio meaning)."""
    n = XF + int(round(program.T * SR)) + XF
    rng = np.random.default_rng(0)
    pa = (rng.standard_normal((n, 2)) * 0.01).astype(np.float32)
    pb = (rng.standard_normal((n, 2)) * 0.01).astype(np.float32)
    ch = V.verify_join(pa + pb, pa, pb, S.to_jsonable(program), {}, {}, {}, {}, P, bt_cpu=False)
    assert S.validate_checks(ch) == []
    assert V.clip_source_s(program.clips[0], 0.0) == pytest.approx(62.913724, abs=1e-6)
    assert V.clip_source_s(program.clips[1], program.T) == pytest.approx(154.584917, abs=1e-6)


# ---------------------------------------------------------------------------------------------
def _checks(status="pass", fail=()):
    return {"status": status, "attempt": 1, "land_err_ms": 0.5, "land_strength": 1.2, "bt_down_err_ms": None,
            "grid_med_ms": None, "grid_p90_ms": None, "fid_med_ms": 0.0, "fid_p95_ms": 0.0, "flams": 0,
            "dbl_bass_beats": 0.0, "chroma_mean": None, "clicks": 0, "tp_dbtp": -1.2, "limiter_ms_over6": 0.0,
            "step_lu": 0.0, "step_planned_lu": 0.0, "overlap_excess_lu": 0.0, "gaps_unplanned": 0,
            "gesture_ok": True, "tempo_jump_pct": 0.0, "a_air_db": -9.0, "vocal_edge_db": None,
            "fail": list(fail), "history": []}


def test_verify_store_atomic_versioned(tmp_path):
    p = str(tmp_path / "sub" / "verify.json")
    st = V.VerifyStore(p)
    assert st.version == 0 and st.get("x") is None
    st.put("aaaa", _checks())
    st.put("bbbb", _checks("fail", ["V3"]))
    st.mark_bad_landing("spotify:B", 80)
    st.mark_bad_landing("spotify:B", 80)              # idempotent, no write
    assert st.version == 3 and st.failed == ["bbbb"] and st.is_failed("bbbb")
    assert os.stat(p).st_mode & 0o777 == 0o644
    assert st.bad_landings == [["spotify:B", 80]] and st.is_bad_landing("spotify:B", 80)
    assert os.listdir(tmp_path / "sub") == ["verify.json"]
    doc = json.load(open(p))
    assert set(doc) == {"version", "entries", "failed", "bad_landings"} and doc["version"] == 3
    again = V.VerifyStore(p)
    assert again.version == 3 and again.get("bbbb")["fail"] == ["V3"]
    again.put("bbbb", _checks("warn"))                # a later pass/warn clears the failed mark
    assert again.failed == [] and again.version == 4
    with pytest.raises(S.SchemaError):
        again.put("cccc", _checks("pass", ["V1"]))     # status disagrees with fail


def test_verify_mix_counts_body_downbeats_and_landings():
    a, b = track({"kick"}, bars=16, seed=6), track({"kick"}, bars=16, seed=7)
    plan = {"order": [{"id": "a", "duration": a.duration}, {"id": "b", "duration": b.duration}],
            "native_starts": [0.5, 10.5], "final_end": 20.5,
            "transitions": [{"a_out_start": 8.5, "T": 4.0, "T_overlap": 2.0, "b_enter_s": 1.0}]}
    tl = V.mix_timeline(plan)
    assert tl[0]["region_out"] == 8.0 and tl[1]["body_out"] == 12.0 and tl[0]["land_out"] == 10.0
    tracks = [{"id": "a", "downbeats": a.downbeats.tolist()}, {"id": "b", "downbeats": b.downbeats.tolist()}]
    want = [tl[0]["body_out"] + d - 0.5 for d in a.downbeats if 0.55 <= d <= 8.45]
    want += [tl[1]["body_out"] + d - 10.5 for d in b.downbeats if 10.55 <= d <= 20.45] + [10.0]
    good = lambda mono, sr: (np.asarray(want), np.asarray(want))
    r = V.verify_mix("", plan, tracks, bt=good, y=np.zeros((SR, 2), np.float32))
    assert r["status"] == "pass" and r["body_frac"] == 1.0 and r["land_frac"] == 1.0
    off = lambda mono, sr: (np.asarray(want) + 0.03, np.asarray(want) + 0.03)
    r = V.verify_mix("", plan, tracks, bt=off, y=np.zeros((SR, 2), np.float32))
    assert r["status"] == "fail" and r["body_frac"] == 0.0 and r["land_frac"] == 1.0


def test_beat_this_runs_on_cpu():
    """REVIEW-external-1 #7: a private CPU tracker; analyze._beat_model is never assigned."""
    pytest.importorskip("beat_this")
    from automix import analyze
    before = analyze._beat_model
    s = track({"kick", "snare", "hat", "bass"}, bars=8, seed=8)
    beats, downs = V.bt_beats(s.y)
    m = V.bt_model()
    assert m is not None and m.device.type == "cpu"
    assert analyze._beat_model is before
    hit = np.mean([np.min(np.abs(beats - x)) < 0.03 for x in s.beats[1:-1]])
    assert hit >= 0.8 and len(downs) >= 2
