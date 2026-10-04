"""Creation forms (medley v5): one kit / one bassline at a time, pitch only on A's harmonic
stems, the variety rule, and the pieces the measured check and the pitch fix rely on."""

import copy
import random

import numpy as np
import pytest

from automix.medley import CFG
from automix.medley import creation as CR
from automix.medley import forms as FM
from automix.medley import planner as PL
from automix.medley import schema as S
from helpers_e2 import load, locked_ctx


def _with_stems(F: dict) -> dict:
    """A Feats copy with synthetic per-bar stem levels (every stem present, vocals louder in the
    second half of each 8 bars) so creation forms can pick their source windows."""
    G = copy.deepcopy(F)
    n = len(G["bars"]["t"])
    k = np.arange(n)
    G["bars"]["stem_rms"] = {"drums": [-6.0] * n, "bass": [-8.0] * n,
                             "vocals": list(np.where(k % 8 >= 4, -6.0, -10.0)), "other": [-7.0] * n}
    G["bars"]["vox_run_s"] = [0.0] * n
    G["stems"] = True
    return G


@pytest.fixture(scope="module")
def ctxs():
    fa, fb = _with_stems(load("dance_no_more")), _with_stems(load("dreaming"))
    out = {}
    for cams in (("8A", "8A"), ("8A", "10A"), ("8A", "3A")):
        c = locked_ctx(fa, 40, fb, 80, stems=True)
        c.ta, c.tb = dict(c.ta, camelot=cams[0]), dict(c.tb, camelot=cams[1])
        c.rel = FM.relation(c.ta, c.tb, fa, c.ex, fb, c.land)
        out[cams] = c
    return out


def _all_comps(ctx):
    got = {}
    for name in CR.CREATION:
        form = FM.FORMS[name]
        assert form.allowed(ctx), name
        for v in form.variant_set(ctx):
            comp = form.build(ctx, v)
            if comp is not None:
                got.setdefault(name, []).append(comp)
    return got


def test_every_creation_form_builds_valid_compositions(ctxs):
    got = _all_comps(ctxs[("8A", "8A")])
    assert set(got) == set(CR.CREATION)
    for name, comps in got.items():
        for comp in comps:
            assert comp["form"] == name
            assert not S.validate_composition(comp), (name, comp["variant"], S.validate_composition(comp))
            # a real middle: B sounds at least 4 bars before its landing
            b_first = min(c["at"] for c in comp["clips"] if c["src"] == "b")
            assert b_first <= -4 * comp["bpb"] or name == "tease_drop"


def test_parameters_vary_between_seeds(ctxs):
    got = _all_comps(ctxs[("8A", "8A")])
    shapes = {name: {S.canonical_json([c["clips"], c["moves"]]) for c in comps} for name, comps in got.items()}
    assert sum(len(v) > 1 for v in shapes.values()) >= 5        # seeds give different arrangements


def test_one_kit_and_one_bassline_at_any_instant(ctxs):
    """The static invariant on every built composition: never both sources' drums (or basses)."""
    tol = float(CFG["creation"]["static_overlap_beats"])
    for comps in _all_comps(ctxs[("8A", "10A")]).values():
        for comp in comps:
            st = S.static_eval(comp)
            for what in ("drums", "bass"):
                m = S.source_masks(comp, st, what)
                both = m.get("a", np.zeros(len(st.m), bool)) & m.get("b", np.zeros(len(st.m), bool))
                assert both.sum() * st.h <= tol + 1e-9, (comp["form"], comp["variant"], what)


def test_a_second_kit_is_rejected(ctxs):
    comp = copy.deepcopy(_all_comps(ctxs[("8A", "8A")])["mashup"][0])
    Bb = comp["bpb"]
    comp["clips"].append({"id": "B_extra", "src": "b", "stem": "drums", "at": -4 * Bb, "len": 2 * Bb,
                          "u0": -4 * Bb, "ratio": 1, "warp": "native", "gain_db": 0})
    comp["hash"] = S.canonical_hash(comp)
    assert "KIT_OVERLAP" in S.codes(S.validate_composition(comp))


def test_pitch_shift_only_on_a_harmonic_stems(ctxs):
    # medley v6: at most 1 semitone (8A -> 10A needs 2: no shift), and only on "p" variants
    assert CR.pitch_semis(ctxs[("8A", "10A")]) == 0
    assert CR.pitch_semis(ctxs[("8A", "3A")]) == 1         # 8A + 1 semitone = 3A
    assert CR.pitch_semis(ctxs[("8A", "8A")]) == 0
    ctx = ctxs[("8A", "3A")]
    for comps in _all_comps(ctx).values():                  # default variants: pitch OFF
        assert not any(c.get("pitch") for comp in comps for c in comp["clips"])
    n = 0
    for name in CR.CREATION:
        comp = FM.FORMS[name].build(ctx, "c0p")
        if comp is None:
            continue
        n += 1
        pitched = [c for c in comp["clips"] if c.get("pitch")]
        assert pitched and all(abs(c["pitch"]["semis"]) <= 1 for c in pitched)
        assert all(c["src"] == "a" and c["warp"] == "r2" and c["stem"] in ("bass", "vocals", "other")
                   for c in pitched)
        assert not any(c.get("pitch") for c in comp["clips"] if c["src"] == "b" or c["stem"] == "drums")
        # the glide happens while A is alone (the ramp), never while B plays
        g = pitched[0]["pitch"]
        assert g["m1"] <= min(c["at"] for c in comp["clips"] if c["src"] == "b")
        from automix.medley import verify as VF
        assert not VF.comp_traits(comp)["glide_under_b"]
    assert n >= 3
    comp = copy.deepcopy(_all_comps(ctx)["drum_swap"][0])
    b = next(c for c in comp["clips"] if c["src"] == "b")
    b["pitch"] = {"semis": 1.0, "m0": -8.0, "m1": -4.0}
    comp["hash"] = S.canonical_hash(comp)
    assert "PITCH_B" in S.codes(S.validate_composition(comp))


def test_camelot_shift():
    assert CR.shift_camelot("8B", 1) == "3B"         # C -> C#
    assert CR.shift_camelot("8A", -2) == "6A"
    assert CR.shift_camelot("12A", 1) == "7A"


def test_variety_rule_and_spread():
    opts = {f: [{"form": f}] for f in CR.CREATION}
    recent, counts, seq = [], {}, []
    rng = random.Random(3)
    for _ in range(21):
        f = CR.choose_form(opts, recent, counts, rng)
        seq.append(f)
        recent.append(f)
        counts[f] = counts.get(f, 0) + 1
    assert CR.variety_ok(seq)
    assert set(seq) == set(CR.CREATION) and max(counts.values()) - min(counts.values()) <= 1
    assert not CR.variety_ok(["mashup", "drum_swap", "loop_rewind", "mashup"])
    assert CR.variety_ok(["mashup", "drum_swap", "loop_rewind", "tease_drop", "mashup"])


def test_beam_never_repeats_a_creation_form_within_the_window():
    def q(form, S_, i):
        return FM.Cand(26, 10, form, "r0", "signature", False, form, S_, {}, {"variant": "r0"},
                       fields={"a_out_start": 100.0, "b_in_start": 1.0, "b_in_end": 10.0}, id=i)
    lands = {10: {"t": 10.0, "h": 3.0, "win": {"fit": {"period_s": 0.5}, "cls": "locked"},
                  "exits": [{"bar": 26, "h": 3.0}]}}
    infos = [PL.TrackInfo({"id": "x"}, {"bpb": 4, "bpm": 120.0}, lands) for _ in range(11)]
    joins = [[q("mashup", 9.0, 0), q("drum_swap", 8.5, 1), q("loop_rewind", 8.0, 2), q("tease_drop", 7.9, 3),
              q("gated_weave", 7.8, 4), q("echo_slam", 4.0, 5)] for _ in range(10)]
    chosen, _, _ = PL.beam(infos, joins)
    forms = [c.form for c in chosen]
    assert CR.variety_ok(forms)
    assert "echo_slam" not in forms                    # a creation fits every join: no slam


def test_only_stem_programs(program):
    for what in ("drums", "bass"):
        p = CR.only_stem(program, what)
        for cp, orig in zip(p.clips, program.clips):
            st = orig.stems
            carries = S.carries(st, what) if isinstance(st, str) else what in st
            assert cp.stems == ([what] if carries else [])


def test_pitch_map_shift_glides_without_latency():
    from automix.audio import pitch_map_shift
    sr = 44100
    t = np.arange(int(sr * 6)) / sr
    y = np.stack([0.3 * np.sin(2 * np.pi * 220 * t)] * 2, axis=1).astype(np.float32)
    out = pitch_map_shift(y, [[2.0, 0.0], [3.0, 2.0]], sr)
    assert out.shape == y.shape

    def f0(x):
        X = np.abs(np.fft.rfft(x * np.hanning(len(x))))
        return np.argmax(X) * sr / len(x)
    assert abs(f0(out[int(0.5 * sr):int(1.5 * sr), 0]) - 220) < 3
    assert abs(f0(out[int(4.0 * sr):int(5.5 * sr), 0]) - 220 * 2 ** (2 / 12)) < 4
    a, b = y[sr // 2: sr // 2 + 8192, 0], out[sr // 2: sr // 2 + 8192, 0]
    lag = np.argmax(np.correlate(b[200:-200], a, mode="valid")) - 200
    assert abs(lag) <= 2
