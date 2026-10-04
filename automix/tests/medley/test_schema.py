"""Phase 0 contract tests: CFG, the §8.9 rules with stable codes, hashing, JSON round trips and
the published fixtures (DESIGN.md §19 Phase 0 acceptance)."""

import copy
import json
import math

import numpy as np
import pytest

from automix.medley import CFG, COMPILER_VERSION, FEATS_VERSION, MEDLEY_VERSION, cfg
from automix.medley import schema as S


def codes_of(issues):
    return {i.code for i in issues}


# ------------------------------------------------------------------------------------ CFG
# integrator deviations from Appendix A: min_h 2.5 -> 1.5 (AMENDMENTS 1), air_beats 0.5 -> 1.0
# (amended R6), cands_per_join 48 -> 160 (per (X_A, j_B) pruning); fixer (review v1): + vacuum
# penalties, + the rock block's arc offset, beam_width 32 -> 128 and weights.h 1.0 -> 1.5 (the
# beam kept B's best landing on 52 of 85 songs instead of 33 of 79, musical #2)
APPENDIX_A = {
    "target_s": 1200, "target_songs": None, "min_h": 1.5, "min_duration_s": 100, "max_per_artist": None,
    "body_bars_allowed": [8, 12, 16, 24, 32], "body_s": [28, 64], "lead_body_max_s": 85,
    "min_solo_bars": 8, "min_solo_s": 12, "lead_max_bars": 8, "lead_max_s": 16, "phrase_min_s": 12,
    "land_min_rel_db": -3, "veto_rel_db": -4, "veto_low_db": -15, "arrival_db": 3, "arrival_low_db": 6,
    "natural_exit_db": 4, "dip_db": 3, "build_db": 2.5, "break_db": 3, "break_low_db": 8, "pickup_vox_db": 6,
    "grid_snap_s": 0.070, "refine_win_s": 0.035, "locked_rms_ms": 6, "locked_max_ms": 15, "verify_rms_ms": 15,
    "keep_locked": 0.9, "keep_verify": 0.8,
    "lock_max_pct": 6.0, "layer_perc_max_pct": 3.0, "double_tol_pct": 6.0, "ramp_pct_per_bar": 1.0,
    "ramp_bars": [2, 6],
    "crossover_low_hz": 150, "crossover_high_hz": 2500, "splice_pre_ms": 3, "splice_xf_ms": 3,
    "splice_xf_low_ms": 10, "splice_search_ms": 1.5, "air_beats": 1.0, "a_air_db": 6, "vacuum_beats": 0.5,
    "pickup_max_beats": 2, "lead_from_db": -12, "pulse_floor_db": -12, "pulse_ramp_ms": 2,
    "gate_attack_ms": 2, "gate_release_ms": 25, "echo_delay_beats": 0.75, "echo_send_db": -4,
    "echo_hp_hz": [400, 1500], "echo_fb_max": 0.55, "tail_floor_db": -20,
    "backspin": {"push": 0.125, "peak_rate": -3.5, "tau": 0.35, "end_by": -0.25},
    "tape_stop": {"len": 2, "k": 1.5}, "rewind": {"peak_rate": -10, "len_bars": 0.75, "gap_bars": 0.25},
    "roll_sizes": [[2, 4], [1, 2], [0.5, 1], [0.25, 0.5]], "roll_min_ms": 60, "roll_hp_hz": [40, 1000],
    "cands_per_join": 160, "beam_width": 128,         # integrator: 48 -> 160 (see forms.enumerate_candidates)
    "weights": {"bin": 2.0, "beat": 1.0, "key": 0.6, "loud": 0.5, "fit": 0.4, "exit": 0.5, "h": 1.5},
    "penalties": {"same_form": 0.6, "sig_within3": 0.8, "loud_within3": 0.6, "same_shape": 0.3,
                  "first_use": 0.3, "share": 2.0, "fallback": 1.0,      # integrator: + fallback
                  "vacuum_b2b": 1.0, "vacuum_share": 2.0},             # fixer: + vacuum terms
    "tier_targets": {"smooth": 0.55, "noticeable": 0.30, "signature": 0.15},
    "caps": {"spin": 2, "tape_stop": 2, "wheel": 1, "double_drop": 1, "tease": 3, "vocal_reveal": 2,
             "stutter": 4, "motif": 3},
    "excerpt_gain_clamp_db": 9, "arc_off_lu": {"house": 0, "dnb": 1, "swing": 0, "rock": 0, "close": -1},
    "loud_correct_max_db": 3, "r2_procs": 4, "warp_cache_mb": 768, "medley_clip_cache_mb": 400,
    "tau_key_default": 0.30,
}


def test_versions():
    assert (MEDLEY_VERSION, COMPILER_VERSION, FEATS_VERSION) == ("1.1", "1.0", 1)      # fixer: 1.1
    assert S.SCHEMA_ID == "claude-best-medley/1"


def test_cfg_holds_appendix_a_with_amendments():
    for k, v in APPENDIX_A.items():
        assert CFG[k] == v, k
    # AMENDMENTS 1 and 2
    assert CFG["target_songs"] is None and CFG["max_per_artist"] is None
    assert CFG["blocks"]["quota"] == "all"
    assert CFG["stems"]["names"] == ["drums", "bass", "vocals", "other"]
    assert CFG["stems"]["separate_in_build"] is False
    assert CFG["ops"]["serve_port"] == 4300 and CFG["ops"]["test_ports"] == [4301, 4309]


def test_cfg_is_json_native_and_cfg_copies():
    assert json.loads(json.dumps(CFG, allow_nan=False)) == CFG
    c = cfg({"limits": {"perc_db": -18}, "min_h": 3})
    assert c["limits"]["perc_db"] == -18 and c["limits"]["max_T_s"] == 75 and c["min_h"] == 3
    assert CFG["limits"]["perc_db"] == -20 and CFG["min_h"] == 1.5
    c["weights"]["bin"] = 99
    assert CFG["weights"]["bin"] == 2.0


# -------------------------------------------------------------- §8.10 example (acceptance)
def test_example_810_validates(comp, feats):
    assert S.validate_composition(comp) == []
    assert S.validate_composition(comp, feats["dance_no_more"], feats["dreaming"]) == []
    assert comp["hash"] == S.canonical_hash(comp)


def test_example_810_clock_closed_form(comp):
    """§19 Phase 1 acceptance 3: t_land 13.3035 s, T 15.208 s, t(-16) = 1.890 + 3.794."""
    a, b = 127.02, 125.99
    t_a = 4 * 60 / a
    t_ramp = 60 * 8 / (b - a) * math.log(b / a)
    t_b = 16 * 60 / b
    t_m16, t_land, T = S.clock_seconds(comp["clock"], [-16, 0, 4])
    assert abs(t_m16 - (t_a + t_ramp)) < 1e-8 and abs(t_m16 - 5.684) < 5e-4
    assert abs(t_land - (t_a + t_ramp + t_b)) < 1e-8
    assert round(float(t_land), 4) == 13.3035       # the design's figure, to its 4 decimals
    assert abs(T - 15.208) < 5e-4
    m, t = S.tabulate_clock(comp["clock"], comp["span"])
    assert len(m) == 32 * 64 + 1 and m[0] == -28 and m[-1] == 4 and t[0] == 0
    assert np.all(np.diff(t) > 0)
    # the ramp is continuous in time and tempo at both ends
    eps = 1e-6
    for m0 in (-24, -16):
        lo, hi = S.clock_seconds(comp["clock"], [m0 - eps, m0 + eps])
        assert abs((hi - lo) / (2 * eps) - 60 / (a if m0 == -24 else b)) < 1e-4


def test_b_clip_warped_is_rejected(comp, rehash):
    comp["clips"][1]["warp"] = "r2"
    assert "B_WARP" in codes_of(S.validate_composition(rehash(comp)))


def test_b_clip_ratio_is_rejected(comp, rehash):
    comp["clips"][1]["ratio"] = 2
    assert {"B_WARP", "CLIP_RATIO"} <= codes_of(S.validate_composition(rehash(comp)))


def test_ramp_under_audible_b_is_rejected(comp, rehash):
    b = comp["clips"][1]
    b.update(at=-20, len=24, u0=-20)                 # B now sounds from -20, inside the ramp
    iss = S.validate_composition(rehash(comp))
    assert "RAMP_B_AUDIBLE" in codes_of(iss)
    assert all(i.code in S.CODES for i in iss)


def test_canonical_hash_is_stable_across_key_order_and_number_spelling(comp):
    def reverse_keys(o):
        if isinstance(o, dict):
            return {k: reverse_keys(o[k]) for k in reversed(list(o))}
        if isinstance(o, list):
            return [reverse_keys(x) for x in o]
        return o

    h = S.canonical_hash(comp)
    assert S.canonical_hash(reverse_keys(comp)) == h
    as_float = copy.deepcopy(comp)
    as_float["span"] = {"to": 4.0, "from": -28.0}
    as_float["clips"][0]["at"] = -28.0
    assert S.canonical_hash(as_float) == h
    noisy = copy.deepcopy(comp)
    noisy["clips"][0]["u0"] = -28 + 1e-12            # below the 1e-9 canonical rounding
    assert S.canonical_hash(noisy) == h
    # hash, score and checks are excluded; any real change is not
    extra = copy.deepcopy(comp)
    extra.update(hash="0" * 16, score={"local": 3.2, "terms": {"bin": 1.0}})
    assert S.canonical_hash(extra) == h
    changed = copy.deepcopy(comp)
    changed["moves"][1]["pattern"] = "332"
    assert S.canonical_hash(changed) != h
    assert len(h) == 16 and all(c in "0123456789abcdef" for c in h)


# ------------------------------------------------------------ §8.9 rules, one code each
def _drop(i):
    def f(c):
        del c["moves"][i]
    return f


MUTATIONS = {
    "gap": (lambda c: c["clock"][1].update(m0=-23), "CLOCK_GAP"),
    "cover": (lambda c: c["clock"][2].update(m1=3), "CLOCK_COVER"),
    "ramp_slope": (lambda c: (c["clock"][1].update(bpm1=120.0), c["clock"][2].update(bpm0=120.0, bpm1=120.0),
                              c["b_ref"].update(period_s=0.5)), "RAMP_SLOPE"),
    "ramp_len": (lambda c: (c["clock"][0].update(m1=-20), c["clock"][1].update(m0=-20)), "RAMP_LEN"),
    "fit_bpm": (lambda c: c["a_ref"].update(period_s=0.48), "CLOCK_FIT_BPM"),
    "jump": (lambda c: c["clock"][2].update(bpm0=126.5, bpm1=126.5), "CLOCK_JUMP"),
    "kind": (lambda c: (c["clock"][2].update(m1=0), c["clock"].append(
        {"m0": 0, "m1": 4, "kind": "a_fit", "bpm0": 125.99, "bpm1": 125.99})), "CLOCK_KIND"),
    "start_eq": (lambda c: c["moves"].append({"type": "eq", "clip": "A", "band": "high", "at": -28, "len": 0,
                                              "to_db": -3, "curve": "hold"}), "SPAN_START"),
    "start_b": (lambda c: c["clips"][1].update(at=-28, len=32, u0=-28), "SPAN_START"),
    "end_a": (lambda c: (c["clips"][0].update(len=32), _drop(4)(c)), "SPAN_END"),
    "end_filter": (lambda c: c["moves"].append({"type": "filter", "clip": "B", "kind": "lp", "at": 3.5, "len": 0,
                                                "hz": [8000, 8000]}), "SPAN_END"),
    "end_loop": (lambda c: c["moves"].append({"type": "loop", "clip": "B", "at": 3, "size": 0.5, "count": 2,
                                              "slip": True}), "SPAN_END"),
    "knot_order": (lambda c: c.update(lanes={"B": {"gain": [[-2, 0, "lin"], [-3, -6, "hold"]]}}), "KNOT_ORDER"),
    "knot_range": (lambda c: c.update(lanes={"B": {"gain": [[-40, 0, "hold"]]}}), "KNOT_RANGE"),
    "knot_null_pos": (lambda c: c.update(lanes={"B": {"pos": [[-2, None, "lin"]]}}), "KNOT_FORMAT"),
    "gesture_clock": (lambda c: c["moves"].append({"type": "roll", "clip": "A", "at": -26, "sizes": [[1, 4]]}),
                      "GESTURE_CLOCK"),
    "r4": (lambda c: c["rel"].update(a_class="verify"), "R4_OVERLAP"),
    "r4_stretch": (lambda c: c["rel"].update(stretch_pct=-3.5), "R4_OVERLAP"),
    "r10": (lambda c: (c["clips"][0].update(stem="top"), c["clips"].append(
        {"id": "A2", "src": "a", "stem": "low", "at": -28, "len": 28, "u0": -28, "ratio": 1, "warp": "r2",
         "gain_db": 0})), "R10_MIXED"),
    "size": (lambda c: (c["clock"][0].update(m0=-200), c["span"].update({"from": -200}),
                        c["clips"][0].update(at=-200, len=200, u0=-200)), "SIZE_SPAN"),
    "size_t": (lambda c: (c["clock"][0].update(m0=-160), c["span"].update({"from": -160}),
                          c["clips"][0].update(at=-160, len=160, u0=-160)), "SIZE_T"),
    "unknown": (lambda c: c.update(foo=1), "FIELD_UNKNOWN"),
    "missing": (lambda c: c.pop("fallback"), "FIELD_MISSING"),
    "enum": (lambda c: c.update(b_in="drop"), "FIELD_VALUE"),
    "move_type": (lambda c: c["moves"].append({"type": "wobble", "at": 0}), "FIELD_VALUE"),
    "move_unknown_param": (lambda c: c["moves"][0].update(q=0.7), "FIELD_UNKNOWN"),
    "clip_ref": (lambda c: c["moves"][0].update(clip="Z"), "CLIP_REF"),
    "dup": (lambda c: c["clips"][1].update(id="A"), "ID_DUP"),
    "numpy": (lambda c: c["a_ref"].update(exit_t=np.float64(76.14)), "NOT_JSON"),
    "nan": (lambda c: c["rel"].update(ratio=float("nan")), "NOT_JSON"),
    "tier": (lambda c: c.update(tier="signature"), "TIER_MISMATCH"),
    "loud": (lambda c: c.update(loud=True), "LOUD_MISMATCH"),
    "rel_ratio": (lambda c: c["rel"].update(a_ratio=2), "REL_RATIO"),
    "clip_range": (lambda c: c["clips"][1].update(len=30), "CLIP_RANGE"),
    "move_range": (lambda c: c["moves"][2].update(at=-40), "MOVE_RANGE"),
    "move_src": (lambda c: c["moves"].append({"type": "tape_stop", "clip": "B", "at": 1, "len": 2, "k": 1.5}),
                 "MOVE_SRC"),
    "gate_steps": (lambda c: c["moves"].append({"type": "gate", "clips": ["A", "B"], "at": -8, "len": 4,
                                                "steps": ["AB"]}), "MOVE_PARAM"),
    "pulse_pattern": (lambda c: c["moves"][1].pop("pattern"), "MOVE_PARAM"),
    "event": (lambda c: c["events"].append([2, 1, "backwards"]), "EVENT_RANGE"),
}


@pytest.mark.parametrize("name", sorted(MUTATIONS))
def test_rule_violations_have_stable_codes(name, comp, rehash):
    mutate, code = MUTATIONS[name]
    mutate(comp)
    if name not in ("numpy", "nan"):
        rehash(comp)
    iss = S.validate_composition(comp)
    assert code in codes_of(iss), [str(i) for i in iss]
    assert all(i.code in S.CODES for i in iss)
    with pytest.raises(S.SchemaError) as exc:
        S.ensure_valid(iss, "composition")
    assert exc.value.issues == iss


def test_hash_mismatch_and_format(comp):
    comp["a_ref"]["exit_t"] = 76.15
    assert "HASH_MISMATCH" in codes_of(S.validate_composition(comp))
    assert S.validate_composition(comp, check_hash=False) == []
    comp["hash"] = "<sha1-16>"
    assert "HASH_FORMAT" in codes_of(S.validate_composition(comp))


def test_r4_uses_feats_to_exempt_a_nobass_nodrums_lead(comp, feats, rehash):
    """Rule 8 with Feats: B's lead bars that are nobass-nodrums are not percussive (§7 lets
    drop_swap layer them without R4); the drum fill in Dreaming's last lead bar still is."""
    comp["rel"]["a_class"] = "verify"
    rehash(comp)
    fa, fb = feats["dance_no_more"], copy.deepcopy(feats["dreaming"])
    iss = [i for i in S.validate_composition(comp, fa, fb) if i.code == "R4_OVERLAP"]
    assert iss and "[-4" in iss[0].detail              # only the last lead bar (bar 79) overlaps
    fb["bars"]["perc_db"][79], fb["bars"]["low_db"][79] = -10.0, -20.0
    assert S.validate_composition(comp, fa, fb) == []


# --------------------------------------------------------- step joins (rules 6, 7) on j02
def test_roll_slam_example_validates(comp_slam, feats):
    assert S.validate_composition(comp_slam) == []
    assert S.validate_composition(comp_slam, feats["dreaming"], feats["bluebird"]) == []


SLAM_MUTATIONS = {
    "no_vacuum": (lambda c: c["moves"].pop(2), "STEP_A_AUDIBLE"),
    "a_after": (lambda c: c["clips"][0].update(len=14), "STEP_A_AFTER"),
    "tape_stop_len": (lambda c: c["moves"].append({"type": "tape_stop", "clip": "A", "at": -6, "len": 5, "k": 1.5}),
                      "GESTURE_LEN"),
    "rewind_len": (lambda c: c["moves"].append({"type": "rewind", "clip": "A", "at": -8, "len": 5,
                                                "peak_rate": -10, "then_u": -8, "gap": 1}), "GESTURE_LEN"),
    "reach_step": (lambda c: c["moves"].append({"type": "loop", "clip": "A", "at": -1, "size": 1, "count": 2,
                                                "slip": False}), "GESTURE_CLOCK"),
    "echo_fb": (lambda c: c["moves"].append({"type": "echo", "clip": "A", "at": -2, "capture": 1, "delay": 0.75,
                                             "fb": 0.9, "tail": 8, "hp_hz": [400, 1500], "send_db": -4}), "ECHO_FB"),
    "step_in_lock": (lambda c: (c.update(form="phrase_trade", loud=False), c["rel"].update(kind="lock")),
                     "CLOCK_JUMP"),
    "backspin_end": (lambda c: c["moves"].append({"type": "backspin", "clip": "A", "at": -1, "push": 0.125,
                                                  "peak_rate": -3.5, "tau": 0.35, "end_by": -0.1}), "MOVE_PARAM"),
}


@pytest.mark.parametrize("name", sorted(SLAM_MUTATIONS))
def test_step_join_violations(name, comp_slam, rehash):
    mutate, code = SLAM_MUTATIONS[name]
    mutate(comp_slam)
    iss = S.validate_composition(rehash(comp_slam))
    assert code in codes_of(iss), [str(i) for i in iss]


def test_step_pickup_extends_the_silence(comp_slam, rehash):
    """A B pickup of 2 A-beats before the landing means locked A must stop by then (rule 7)."""
    pa, pb = comp_slam["a_ref"]["period_s"], comp_slam["b_ref"]["period_s"]
    comp_slam["clips"][1].update(at=-2, len=6, u0=-2 * pa / pb)   # native: B reaches u = 0 at t(0)
    del comp_slam["moves"][1]                                       # no roll: A stays locked
    comp_slam["moves"][-1]["keep"] = ["B"]                          # the pickup sounds in the vacuum
    iss = S.validate_composition(rehash(comp_slam))
    assert "STEP_A_AUDIBLE" in codes_of(iss), [str(i) for i in iss]
    comp_slam["moves"].append({"type": "cut", "clip": "A", "at": -2, "dir": "out"})
    assert S.validate_composition(rehash(comp_slam)) == []


def test_valid_echo_within_tail_rule(comp_slam, rehash):
    comp_slam["moves"].append({"type": "echo", "clip": "A", "at": -2, "capture": 1, "delay": 0.75, "fb": 0.3,
                               "tail": 8, "hp_hz": [400, 1500], "send_db": -4})
    assert S.validate_composition(rehash(comp_slam)) == []


# ------------------------------------------------------------- reference semantics
def test_static_eval_follows_the_lane_rules(comp, comp_slam):
    st = S.static_eval(comp)

    def at(cid, m):
        i = int(np.argmin(np.abs(st.m - m)))
        ct = st.clips[cid]
        return ct, i

    ct, i = at("A", -0.75)
    assert ct.eq["mid"][i] == -8 and ct.eq["high"][i] == -8 and ct.eq["low"][i] == 0
    ct, i = at("A", -0.25)
    assert ct.eq["low"][i] == -np.inf and ct.audible[i]
    ct, i = at("A", 0.5)
    assert not ct.audible[i]
    ct, i = at("B", -8)
    assert ct.eq["low"][i] == -np.inf and -12 < ct.gain[i] < 0
    ct, i = at("B", 0.5)
    assert ct.eq["low"][i] == 0 and ct.gain[i] == 0          # the swap lifted the held kill
    ss = S.static_eval(comp_slam)
    a = ss.clips["A"]
    assert not a.audible[ss.window(-0.5, 0)].any()             # vacuum
    assert a.moved[ss.window(-8, -0.5)].all() and not a.moved[ss.window(-12, -8)].any()
    assert a.hp[ss.window(-8, 0)].all() and not a.hp[ss.window(-12, -8)].any()
    taper = ss.window(-1, -0.5)
    assert np.allclose(a.gain[taper], -3)                      # 1/4-beat roll tapered by -3 dB


def test_eval_knots_curves():
    kn = [[0, 0.0, "lin"], [1, -6.0, "hold"], [2, -6.0, "exp"], [3, None, "hold"]]
    v = S.eval_knots(kn, [-1, 0, 0.5, 1, 1.5, 2.5, 3, 4], "db")
    assert v[0] == 0 and v[1] == 0 and v[3] == -6 and v[4] == -6 and v[6] == -np.inf and v[7] == -np.inf
    assert abs(v[2] - 20 * np.log10((1 + 10 ** (-6 / 20)) / 2)) < 1e-9     # lin = linear amplitude
    assert abs(v[5] - (-6 + (S.DB_FLOOR + 6) / 2)) < 1e-9                   # exp = linear in dB
    e = S.eval_knots([[0, None, "eqpow"], [1, 0.0, "hold"]], [0.5], "db")[0]
    assert abs(e - 20 * np.log10(np.sin(np.pi / 4))) < 1e-9                 # equal power: -3.01 dB
    splice = S.eval_knots([[1, 0.0, "hold"], [1, None, "hold"]], [0.999, 1.0], "db")
    assert splice[0] == 0 and splice[1] == -np.inf
    hz = S.eval_knots([[0, 40.0, "exp"], [1, 1000.0, "hold"], [2, None, "hold"]], [0.5, 1.5, 2.5], "hz")
    assert abs(hz[0] - 200.0) < 1e-6 and hz[1] == 1000 and np.isnan(hz[2])
    pos = S.eval_knots([[0, -8.0, "lin"], [2, -6.0, "hold"]], [1], "pos")
    assert pos[0] == -7
    ramp = S.ramp_db(-12, 0, np.linspace(0, 1, 101), "eqpow")
    assert np.all(np.diff(ramp) >= 0) and ramp.max() <= 1e-12               # never overshoots


# --------------------------------------------------------------------- JSON helpers
def test_json_round_trips(comp, program):
    assert S.from_json(S.to_json(comp)) == comp
    again = S.from_json(S.to_json(program), S.Program)
    assert again == program
    assert isinstance(again.clips[0], S.ClipProgram) and isinstance(again.splices[0], S.Splice)
    e = S.EchoProgram(clip="A", capture=(1.0, 1.5), delay_s=0.35, fb=0.4, tail_s=3.0, hp_hz=[[1.0, 400.0, "exp"]],
                      lp_hz=8000.0, send_db=-4.0, duck=None, part="a")
    e2 = S.from_json(S.to_json(e), S.EchoProgram)
    assert e2 == e and isinstance(e2.capture, tuple)
    assert S.to_jsonable({"x": np.float32(1.5), "y": np.arange(3), "z": (1, 2)}) == {"x": 1.5, "y": [0, 1, 2],
                                                                                     "z": [1, 2]}
    with pytest.raises(ValueError):
        S.to_json({"x": float("inf")})
    with pytest.raises(ValueError):
        S.to_json({1: 2})
    assert S.canonical_json({"b": 1.0, "a": [2.5, -0.0]}) == '{"a":[2.5,0],"b":1}'


def test_helpers():
    assert S.tier_of("drop_swap") == "smooth" and S.tier_of("drop_swap", "L4+wheel8") == "signature"
    assert S.is_loud("roll_slam") and S.is_loud("phrase_trade", "+wheel4") and not S.is_loud("echo_slam")
    assert set(S.FORM_TIER) == set(S.FORM_NAMES) and set(CFG["base_f"]) == set(S.FORM_NAMES)
    assert S.clip_stems("top") == ["vocals", "other"] and S.clip_stems("bed") == ["drums", "bass"]
    assert S.clip_stems("mix") == "mix" and S.clip_stems(["other", "drums"]) == ["drums", "other"]
    assert S.uses_stems("vocals") and not S.uses_stems("high")
    assert S.rating_key("spotify:a>spotify:b", "drop_swap", "8b72dc2e72301d0b") == \
        "spotify:a>spotify:b|drop_swap|8b72dc2e"


FROZEN_CODES = {
    "FIELD_MISSING", "FIELD_TYPE", "FIELD_VALUE", "FIELD_UNKNOWN", "NOT_JSON", "ID_DUP", "CLIP_REF",
    "HASH_FORMAT", "HASH_MISMATCH", "TIER_MISMATCH", "LOUD_MISMATCH", "REL_RATIO", "CLIP_RATIO", "CLIP_RANGE",
    "MOVE_RANGE", "MOVE_SRC", "MOVE_PARAM", "EVENT_RANGE", "SPAN_ORDER", "CLOCK_EMPTY", "CLOCK_ORDER",
    "CLOCK_GAP", "CLOCK_COVER", "CLOCK_BPM", "CLOCK_KIND", "CLOCK_FIT_BPM", "CLOCK_JUMP", "RAMP_SLOPE",
    "RAMP_LEN", "RAMP_B_AUDIBLE", "B_WARP", "SPAN_START", "SPAN_END", "KNOT_FORMAT", "KNOT_ORDER",
    "KNOT_RANGE", "GESTURE_LEN", "GESTURE_CLOCK", "STEP_A_AUDIBLE", "STEP_A_AFTER", "ECHO_FB", "R4_OVERLAP",
    "R10_MIXED", "KIT_OVERLAP", "BASS_OVERLAP", "PITCH_B",  # creation forms (medley v5)
    "SIZE_SPAN", "SIZE_T", "PLAN_KIND", "PLAN_LEN", "PLAN_ALIGN", "PLAN_NATIVE", "PLAN_SOLO",
    "PLAN_COMPAT", "PLAN_STATS", "FEATS_VERSION", "FEATS_LEN", "FEATS_ORDER", "FEATS_VALUE", "PROG_CLOCK",
    "PROG_SOURCE", "PROG_POS", "PROG_KNOTS", "PROG_REF", "CHECKS_STATUS",
}


def test_codes_are_frozen():
    """Codes are part of the contract: renaming one breaks consumers (ladder, page, logs)."""
    assert set(S.CODES) == FROZEN_CODES


# ------------------------------------------------------------------------ fixtures
def test_feats_fixtures_validate(feats):
    for name, F in feats.items():
        assert S.validate_feats(F) == [], name
        assert F["version"] == FEATS_VERSION and F["track"].startswith("spotify:")


def test_feats_landings_are_realistic(feats):
    """The hand-verified landings of §19 (±1 bar) are among each fixture's top 3."""
    for name, want in (("dance_no_more", 45.88), ("dreaming", 152.68), ("bluebird", 66.62)):
        F = feats[name]
        bar = 4 * F["fit"]["period_s"]
        assert any(abs(ld["t"] - want) <= bar for ld in F["landings"]), name
    assert all(abs(ld["t"] - 46.0) > 2 for ld in feats["dreaming"]["landings"])   # the 0:46 veto


def test_broken_feats_are_rejected(feats):
    F = copy.deepcopy(feats["bluebird"])
    F["bars"]["rel_db"] = F["bars"]["rel_db"][:-1]
    assert "FEATS_LEN" in codes_of(S.validate_feats(F))
    F = copy.deepcopy(feats["bluebird"])
    F["bars"]["t"] = np.asarray(F["bars"]["t"])              # numpy arrays are allowed in Feats
    assert S.validate_feats(F) == []
    F["version"] = 0
    assert "FEATS_VERSION" in codes_of(S.validate_feats(F))
    F = copy.deepcopy(feats["bluebird"])
    F["landings"] = list(reversed(F["landings"]))
    assert "FEATS_ORDER" in codes_of(S.validate_feats(F))


def test_program_fixture(program, comp):
    assert S.validate_program(program) == []
    assert program.version == COMPILER_VERSION and program.sr == 44100 and program.xf == int(0.015 * 44100)
    t = S.clock_seconds(comp["clock"], program.clock_m)
    assert np.allclose(t, program.clock_t, atol=2e-6)
    assert abs(program.t_land - 13.3035) < 1e-4 and abs(program.T - 15.2084) < 1e-4
    a = next(c for c in program.clips if c.id == "A")
    b = next(c for c in program.clips if c.id == "B")
    assert a.source["kind"] == "r2" and b.source["kind"] == "native"
    # A's anchors are A's fitted beats (exit_t + u * period), R3
    src = np.asarray(a.source["src_anchors"][1:-1])
    u = (src - comp["a_ref"]["exit_t"]) / comp["a_ref"]["period_s"]
    assert np.allclose(u, np.round(u), atol=1e-4)
    # the region edge contract: A starts at -xf, B runs to T + xf
    assert a.pos[0]["t0"] == pytest.approx(-program.xf / program.sr, abs=1e-6)
    assert b.pos[-1]["t1"] == pytest.approx(program.T + program.xf / program.sr, abs=1e-6)
    assert program.expect["onsets"]["A"] and program.expect["onsets"]["B"]
    bad = S.to_jsonable(program)
    bad["clips"][0]["source"]["dst_anchors"][3] = -1
    bad["clips"][1]["gain_db"] = list(reversed(bad["clips"][1]["gain_db"]))
    bad["splices"][0]["clip"] = "Q"
    assert {"PROG_SOURCE", "PROG_KNOTS", "PROG_REF"} <= codes_of(S.validate_program(bad))


def test_plan_fixture(plan, feats):
    fs = {F["track"]: F for F in feats.values()}
    assert S.validate_plan(plan, feats=fs) == []
    tr = plan["transitions"][0]
    assert (tr["a_out_start"], tr["b_in_start"], tr["b_in_end"]) == pytest.approx((62.914, 145.060, 154.585),
                                                                                  abs=1e-3)
    assert (tr["T"], tr["T_overlap"], tr["b_enter_s"]) == pytest.approx((15.208, 13.304, 5.684), abs=1e-3)
    assert plan["order"][0]["excerpt"]["exit_t"] == 76.14


PLAN_MUTATIONS = {
    "native": (lambda p: p["native_starts"].__setitem__(1, 150.0), "PLAN_NATIVE"),
    "override": (lambda p: p["transitions"][0]["override"].update(bars=8), "PLAN_COMPAT"),
    "compat_T": (lambda p: p["transitions"][0].update(T=16.0), "PLAN_COMPAT"),
    "compat_form": (lambda p: p["transitions"][0].update(form="roll_slam"), "PLAN_COMPAT"),
    "stats": (lambda p: p["medley"]["stats"].update(songs=3), "PLAN_STATS"),
    "len": (lambda p: p["native_starts"].append(1.0), "PLAN_LEN"),
    "align": (lambda p: p["medley"]["excerpts"][1].update(track="spotify:x"), "PLAN_ALIGN"),
    "kind": (lambda p: p.update(kind="crossfade"), "FIELD_VALUE"),
    "missing": (lambda p: p["transitions"][0].pop("b_enter_s"), "FIELD_MISSING"),
    "unknown": (lambda p: p["transitions"][0].update(anchors=[]), "FIELD_UNKNOWN"),
    "deep": (lambda p: p["transitions"][0]["composition"]["clips"][1].update(warp="r2"), "B_WARP"),
}


@pytest.mark.parametrize("name", sorted(PLAN_MUTATIONS))
def test_plan_violations(name, plan):
    mutate, code = PLAN_MUTATIONS[name]
    mutate(plan)
    assert code in codes_of(S.validate_plan(plan))


def test_plan_solo_rule(plan):
    """R9 across two joins: the middle track's native solo must last max(8 bars, 12 s)."""
    p = copy.deepcopy(plan)
    t2 = copy.deepcopy(p["transitions"][0])
    t2.update(index=1, a=p["order"][1]["id"], b=p["order"][0]["id"],
              key=f"{p['order'][1]['id']}>{p['order'][0]['id']}", a_out_start=t2["b_in_end"] + 5.0)
    t2.pop("composition")
    p["transitions"].append(t2)
    p["order"].append(copy.deepcopy(p["order"][0]))
    p["native_starts"].append(t2["b_in_end"])
    p["medley"]["excerpts"].append(copy.deepcopy(p["medley"]["excerpts"][0]))
    p["medley"]["stats"].update(songs=3, tiers={"smooth": 2, "noticeable": 0, "signature": 0})
    iss = S.validate_plan(p)
    assert codes_of(iss) == {"PLAN_SOLO"}, [str(i) for i in iss]
    p["transitions"][1]["a_out_start"] = p["transitions"][0]["b_in_end"] + 16.0
    assert S.validate_plan(p) == []


def test_order_rows_are_open_but_json(plan):
    plan["order"][0]["energy"] = 0.71                   # existing summary keys pass through
    assert S.validate_plan(plan) == []
    plan["order"][0]["energy"] = np.float64(0.71)
    assert "NOT_JSON" in codes_of(S.validate_plan(plan))


def test_checks_contract():
    ck = {"status": "warn", "attempt": 1, "land_err_ms": 2.1, "land_strength": 1.3, "bt_down_err_ms": 12.0,
          "grid_med_ms": 3.0, "grid_p90_ms": 7.5, "fid_med_ms": 0.6, "fid_p95_ms": 2.0, "flams": 0,
          "dbl_bass_beats": 0.25, "chroma_mean": 0.12, "clicks": 0, "tp_dbtp": -1.1, "limiter_ms_over6": 0,
          "step_lu": 0.8, "step_planned_lu": 0.5, "overlap_excess_lu": 0.0, "gaps_unplanned": 0,
          "gesture_ok": True, "tempo_jump_pct": 0.4, "a_air_db": -9.0, "vocal_edge_db": None, "fail": [],
          "history": [{"form": "drop_swap", "variant": "L4.eqpow", "hash": "0123456789abcdef", "fail": []}]}
    assert S.validate_checks(ck) == []
    summ = S.checks_summary(ck)
    assert list(summ) == list(S.CHECKS_SUMMARY_KEYS) and S.check_type(summ, S.ChecksSummary) == []
    assert S.checks_summary(None) is None
    bad = dict(ck, status="fail")
    assert "CHECKS_STATUS" in codes_of(S.validate_checks(bad))
    bad = dict(ck, flams=0.5)
    assert "FIELD_TYPE" in codes_of(S.validate_checks(bad))
    doc = {"version": 3, "entries": {"0123456789abcdef": ck}, "failed": [], "bad_landings": [["spotify:x", 80]]}
    assert S.check_type(doc, S.VerifyDoc) == []


def test_validation_is_fast(comp):
    import time
    t0 = time.perf_counter()
    for _ in range(10):
        S.validate_composition(comp)
    assert (time.perf_counter() - t0) / 10 < 0.05


# ------------------------------------------------------------------------ synth
def test_synth_onsets_are_sample_exact(synth):
    s = synth.click_track(bpm=120, bars=2)
    idx = np.round(s.onsets["click"] * s.sr).astype(int)
    assert len(idx) == 8 and np.allclose(s.onsets["click"], s.beats)
    assert np.all(np.abs(s.y[idx, 0]) > 0.4) and s.y[idx[0] - 1, 0] == 0
    assert np.allclose(np.diff(s.beats), 0.5, atol=1 / s.sr)


def test_synth_track_stems_and_sections(synth):
    s = synth.make_track(bpm=126, sections=[("intro", 2, {"kick", "hat"}), ("break", 2, {"pad"}),
                                            ("drop", 4, {"kick", "snare", "hat", "bass", "pad", "vox"})], seed=3)
    total = s.stems["drums"] + s.stems["bass"] + s.stems["vocals"] + s.stems["other"]
    assert np.array_equal(total, s.y)
    assert len(s.beats) == 32 and len(s.downbeats) == 8 and s.bars[2]["section"] == "break"
    kicks = s.onsets["kick"]
    assert len(kicks) == 24 and np.all(np.isin(kicks, s.beats))
    k0 = int(round(kicks[0] * s.sr))
    assert s.stems["drums"][k0 - 1, 0] == 0 and s.stems["drums"][k0, 0] != 0
    hats = s.onsets["hat"]
    assert np.allclose(hats[0] - s.beats[0], 60 / 126 / 2, atol=1 / s.sr)
    j = synth.make_track(bpm=126, jitter_ms=5, seed=1)
    assert 0 < np.max(np.abs(np.diff(j.beats) - 60 / 126)) <= 0.0101
    flam = synth.mix_parts(s.y, s.y, offset_s=0.03)
    assert len(flam) == len(s.y) + int(round(0.03 * s.sr))


def test_double_join_uses_a_ratio(rehash):
    """half_time (double): master beats are B's; A runs 2 source beats per master beat on a fit
    whose master bpm is A's / 2, so the span start is still unity stretch."""
    pa, pb = 60 / 174.0, 60 / 86.9
    c = {
        "id": "j05", "a": "spotify:dnb", "b": "spotify:swing", "form": "half_time", "variant": "straight",
        "tier": "smooth", "loud": False, "b_in": "double",
        "rel": {"kind": "double", "ratio": 86.9 / 174.0, "a_ratio": 2, "stretch_pct": -0.11, "camelot": 1,
                "chroma": 0.4, "a_class": "locked", "b_class": "locked"},
        "bpb": 4, "a_ref": {"exit_bar": 120, "exit_t": 170.0, "period_s": pa},
        "b_ref": {"land_bar": 16, "land_t": 44.0, "period_s": pb},
        "clock": [{"m0": -12, "m1": -8, "kind": "a_fit", "bpm0": 87.0, "bpm1": 87.0},
                  {"m0": -8, "m1": 0, "kind": "ramp", "bpm0": 87.0, "bpm1": 60 / pb},
                  {"m0": 0, "m1": 4, "kind": "b_fit", "bpm0": 60 / pb, "bpm1": 60 / pb}],
        "span": {"from": -12, "to": 4},
        "clips": [{"id": "A", "src": "a", "stem": "mix", "at": -12, "len": 12, "u0": -24, "ratio": 2,
                   "warp": "r2", "gain_db": 0},
                  {"id": "B", "src": "b", "stem": "mix", "at": 0, "len": 4, "u0": 0, "ratio": 1,
                   "warp": "native", "gain_db": 0}],
        "moves": [{"type": "eq", "clip": "A", "band": "low", "at": -0.5, "len": 0, "to_db": None, "curve": "hold"},
                  {"type": "fade", "clip": "A", "at": -1, "len": 1, "from_db": 0, "to_db": None, "shape": "cos"},
                  {"type": "swap", "at": 0, "out": ["A"], "in": ["B"], "band": "all"}],
        "events": [[0, 0, "land"]], "fallback": ["echo_slam", "cut_on_one"], "hash": "",
    }
    assert S.validate_composition(rehash(c)) == []
    c["clock"][0].update(bpm0=174.0, bpm1=174.0)
    assert "CLOCK_FIT_BPM" in codes_of(S.validate_composition(rehash(c)))
    c["clock"][0].update(bpm0=87.0, bpm1=87.0)
    c["clips"][0]["ratio"] = 1
    assert "SPAN_START" in codes_of(S.validate_composition(rehash(c)))
