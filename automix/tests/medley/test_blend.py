"""medley v6: the measured blend score (verify.blend_*), the rating priors and penalties, and the
ladder's candidate search (build.plan_candidates / select_blend / ladder)."""
import copy

import numpy as np
import pytest

from automix.medley import CFG
from automix.medley import build as B
from automix.medley import verify as V
from test_integration import sess, strong_onsets_bt, world  # noqa: F401  (fixtures)

SR = 22050
BEAT = 0.5


def _groove(seconds: float, level: float = 0.3, seed: int = 0) -> np.ndarray:
    """A steady groove: a 55 Hz kick every beat plus noise and a chord, in half-beat terms flat."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    kick = np.sin(2 * np.pi * 55 * t) * np.exp(-((t % BEAT) / 0.12))
    chord = sum(np.sin(2 * np.pi * f * t) for f in (220.0, 277.18, 329.63)) / 3
    return (level * (0.6 * kick + 0.25 * chord + 0.15 * rng.standard_normal(n))).astype(np.float32)


def test_steady_join_scores_high():
    y = _groove(32.0)
    m = V.blend_join(y, SR, 8.0, 24.0, BEAT)
    assert m["score"] >= 95 and m["holes"] < 0.05 and abs(m["dip"]) < 3


@pytest.mark.parametrize("phase", [0.08, 0.19, 0.37])
def test_steady_kicks_are_not_holes_at_different_frame_phases(phase):
    y = np.roll(_groove(32.0), int(phase * SR))
    m = V.blend_join(y, SR, 8.0, 24.0, BEAT)
    assert m["score"] >= 95 and m["holes"] < 0.05


def test_gradual_level_change_is_smoother_than_a_step():
    y = _groove(32.0)
    t = np.arange(len(y)) / SR
    smooth = y * 10 ** (np.clip((t - 8) / 16, 0, 1) * 12 / 20)
    step = y * np.where(t < 16, 1.0, 10 ** (12 / 20))
    a = V.blend_join(smooth, SR, 8.0, 24.0, BEAT)
    b = V.blend_join(step, SR, 8.0, 24.0, BEAT)
    assert a["jump"] < 1 and b["jump"] > 10
    assert b["loss"]["jump"] > a["loss"]["jump"] + 20


def test_mid_mix_hole_and_rise_score_low():
    y = _groove(32.0)
    hole = y.copy()
    hole[int(12 * SR):int(16 * SR)] *= 0.05              # 2 bars of near silence mid-mix
    m = V.blend_join(hole, SR, 8.0, 24.0, BEAT)
    assert m["score"] < 60 and m["holes"] > 0.2 and m["dip"] > 9
    rise = y.copy()
    rise[: int(20 * SR)] *= 0.25                         # B arrives 12 dB louder: a sudden rise
    r = V.blend_join(rise, SR, 8.0, 24.0, BEAT)
    assert r["jump"] > 6 and r["score"] < V.blend_join(y, SR, 8.0, 24.0, BEAT)["score"] - 10


def test_low_band_hole_alone_is_seen():
    y = _groove(32.0)
    lo = y.copy()
    seg = slice(int(10 * SR), int(20 * SR))
    lo[seg] = V._filt(lo[seg], "highpass", 300.0, sr=SR)  # bass and kick gone for 10 s
    m = V.blend_join(lo, SR, 8.0, 24.0, BEAT)
    assert m["holes"] > 0.4 and m["score"] < 80


def test_chroma_clash():
    n = int(8 * SR)
    t = np.arange(n) / SR

    def chord(fs):
        return (sum(np.sin(2 * np.pi * f * t) for f in fs) / len(fs) * 0.3).astype(np.float32)

    a = chord([220.0, 277.18, 329.63])                   # A major
    same, _ = V.chroma_clash(a, chord([220.0, 277.18, 329.63, 440.0]), SR)
    clash, ov = V.chroma_clash(a, chord([233.08, 293.66, 349.23]), SR)   # Bb major over A major
    assert ov >= 7 and same is not None and clash is not None
    assert same < 0.2 and clash > V.BLEND["clash_high"] > same
    none, ov0 = V.chroma_clash(a, np.zeros_like(a), SR)
    assert none is None and ov0 == 0


def test_blend_render_uses_region_parts():
    pre, post = _groove(8.0, seed=1), _groove(8.0, seed=2)
    out = _groove(16.0, seed=3)
    m = V.blend_render(out, out * 0.5, out * 0.5, pre, post, 12.0, BEAT, SR)
    assert m["score"] >= 90 and m["clash"] is not None and m["clash"] < 0.1 and m["mix_s"] == 12.0


def test_form_priors_bayesian():
    R = {"x|1": {"value": 20, "form": "loop_rewind"}, "x|2": {"value": 20, "form": "loop_rewind"},
         "x|3": {"value": 80, "form": "drum_swap"}, "x|4": {"value": "bad", "form": "mashup"}}
    p = V.form_priors(R)
    assert p["loop_rewind"] == pytest.approx(((2 * 60 + 40) / 4 - 60) / 40)    # -0.5
    assert p["drum_swap"] == pytest.approx(((2 * 60 + 80) / 3 - 60) / 40)
    assert "mashup" not in p
    R["x|5"] = {"value": 100, "form": "loop_rewind"}                          # a later rating shifts it
    assert V.form_priors(R)["loop_rewind"] > p["loop_rewind"]


def _comp(form="drum_swap", bars=4, semis=0.0, loop=0):
    clips = [{"id": "A_oth", "src": "a", "at": -40.0, "stem": "other"},
             {"id": "B_x", "src": "b", "at": -4.0 * bars, "stem": "drums"}]
    if semis:
        clips[0]["pitch"] = {"semis": semis, "m0": -40.0, "m1": -36.0}
    moves = [{"type": "loop", "at": -4.0 * bars, "clip": "B_x", "count": loop}] if loop else []
    return {"form": form, "variant": "c0", "bpb": 4, "clips": clips, "moves": moves}


def test_penalties_loop_pitch_length_prior():
    base = V.blend_penalties(_comp())
    assert base["total"] == 0 and base["traits"]["bars"] == 4
    assert V.blend_penalties(_comp(bars=16))["penalties"]["length"] == pytest.approx(0.8 * 12)
    p = V.blend_penalties(_comp(semis=1.0))
    assert p["penalties"]["pitch"] == V.PENALTY["pitch"] and not p["traits"]["glide_under_b"]
    under = _comp(semis=1.0)
    under["clips"][0]["pitch"].update(m0=-20.0, m1=-8.0)      # the glide runs while B plays
    assert V.blend_penalties(under)["traits"]["glide_under_b"]
    l2, l3 = V.blend_penalties(_comp(loop=2)), V.blend_penalties(_comp(loop=3))
    assert l2["penalties"]["loop"] == V.PENALTY["loop_base"] and l3["penalties"]["loop"] > l2["penalties"]["loop"]
    assert V.blend_penalties(_comp(), prior=-0.5)["penalties"]["prior"] == pytest.approx(10.0)


def _opt(form, variant, bars, local, h=None):
    c = _comp(form, bars)
    c.update(variant=variant, hash=h or f"{form}-{variant}", score={"local": local})
    return c


def test_plan_candidates_variety_and_lengths():
    orig = _opt("mashup", "r0", 16, 9.0)
    opts = [orig, _opt("mashup", "c0", 8, 8.5), _opt("mashup", "s0", 4, 8.4), _opt("mashup", "r1", 14, 8.3),
            _opt("drum_swap", "c0", 8, 8.2), _opt("drum_swap", "s0", 3, 8.1), _opt("tease_drop", "s0", 4, 8.0),
            _opt("loop_rewind", "c0", 6, 7.0), _opt("echo_slam", "e0", 0, 5.0), _opt("mashup", "c0p", 8, 9.5)]
    got = B.plan_candidates(orig, opts, recent=["tease_drop"], n=5)
    keys = [(c["form"], c["variant"]) for c in got]
    assert len(got) == 5 and keys[0] == ("mashup", "r0")
    assert {"mashup"} < {f for f, _ in keys} and len({f for f, _ in keys}) >= 3     # real variety
    assert {("mashup", "c0"), ("mashup", "s0")} <= set(keys)                         # S / M / L of the plan
    assert ("mashup", "r1") not in keys                                              # one per (form, length)
    assert not any(v.endswith("p") for _, v in keys)                                 # pitch is the ladder's slot
    assert keys.index(("drum_swap", "c0")) < len(keys) and ("tease_drop", "s0") not in keys[:4]


def _row(form, ok, score, sel, bars):
    return {"form": form, "ok": ok, "score": score, "sel": sel, "bars": bars}


def test_select_blend_shorter_wins_ties_and_hard_checks_rule():
    rows = [_row("mashup", True, 90, 85, 16), _row("mashup", True, 88, 83.5, 4), _row("drum_swap", False, 99, 99, 4)]
    assert B.select_blend(rows, []) == 1                      # within 3 points: the shorter
    rows[1]["sel"] = 80
    assert B.select_blend(rows, []) == 0                      # clearly worse: the longer stays
    # a vacuum form only when its measured score passes, unless nothing else passes
    rows = [_row("roll_slam", True, 45, 45, 0), _row("drum_swap", True, 70, 62, 8)]
    assert B.select_blend(rows, []) == 1
    rows = [_row("roll_slam", True, 45, 45, 0), _row("call_response", True, 50, 40, 8)]
    assert B.select_blend(rows, []) == 1                      # neither passes 60: no vacuum
    assert B.select_blend([_row("roll_slam", True, 45, 45, 0)], []) == 0
    # variety only breaks ties
    rows = [_row("drum_swap", True, 90, 90, 4), _row("mashup", True, 89, 88.5, 4)]
    assert B.select_blend(rows, ["drum_swap"]) == 1
    rows[1]["sel"] = 70
    assert B.select_blend(rows, ["drum_swap"]) == 0
    # Variety must not force a longer transition when scores are tied.
    rows = [_row("drum_swap", True, 90, 90, 3), _row("mashup", True, 89, 89, 16)]
    assert B.select_blend(rows, ["drum_swap"]) == 0
    assert B.select_blend([_row("x", False, 99, 99, 0)], []) is None


def test_ladder_candidate_search_keeps_best_passing(sess):  # noqa: F811
    sess.engine.faults.append(("drop_swap", "L4", 0.040, True))   # the planned 4-bar lead flams
    plan = sess.plan()
    hooks = B.Hooks(plan)
    orig = plan["transitions"][0]["composition"]
    alts = []
    for k in range(3):
        c = copy.deepcopy(orig)
        c["variant"] = f"alt{k}"
        alts.append(B._rehash(c))
    hooks.options = lambda i, c: [orig] + alts
    hooks.variant = lambda *a: None
    res = B.ladder(sess, 0, plan, hooks=hooks, bt=strong_onsets_bt, store=sess.store, log=lambda *a: None)
    hist = res.checks["history"]
    assert hist[0]["fail"] == ["V3"] and len(hist) <= CFG["verify"]["blend_renders"]
    assert res.comp["variant"].startswith("alt") and res.checks["status"] != "fail"
    assert res.blend["chosen_by"] == "blend" and res.blend["score"] is not None
    assert all("blend" in a and "score" in a["blend"] for a in res.attempts)
    assert all(h.get("blend") is not None for h in hist)
