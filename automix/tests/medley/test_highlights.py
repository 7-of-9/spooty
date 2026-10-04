"""E1 highlight, relation and selection tests (DESIGN §5, §6, §7; Phase 1 test 2).

Synthetic Feats are built bar by bar (make_F) so every rule can be pinned; `compute` runs once
on synth audio; the acceptance landings run on the real feats cache when it exists."""

import os

import numpy as np
import pytest

from automix.medley import CFG
from automix.medley import feats as FE
from automix.medley import grid as G
from automix.medley import highlights as HL
from automix.medley import order as O
from automix.medley import schema as S

DATA = "/Users/dom/src/spooty/data/automix"
FOLDER = "/Users/dom/Desktop/mp3_downloads/50"
FEATS_DIR = os.path.join(DATA, "medley", "feats")


def make_F(rel, low=None, perc=None, vox=None, labels=None, bpm=126.0, bpb=4, track="spotify:t", beat_vox=None,
           jitter_ms=0.0, onsets=True, cls_ok=True, octave_ok=True, seed=0, duration=None, landings=True):
    """A valid Feats with a perfect (or jittered) grid; per-bar arrays as given (dB)."""
    rel = np.asarray(rel, float)
    nb = len(rel)
    low = np.zeros(nb) if low is None else np.asarray(low, float)
    perc = np.full(nb, -3.0) if perc is None else np.asarray(perc, float)
    vox = np.full(nb, -6.0) if vox is None else np.asarray(vox, float)
    labels = labels or ["chorus"] * nb
    per = 60.0 / bpm
    rng = np.random.default_rng(seed)
    bt = 0.5 + per * np.arange(nb * bpb) + rng.uniform(-jitter_ms, jitter_ms, nb * bpb) / 1000
    bt = np.round(bt, 3)
    pos = np.arange(nb * bpb) % bpb
    bars_t = bt[::bpb]
    dur = float(duration or bt[-1] + per)
    secs, start = [], 0
    for i in range(1, nb + 1):
        if i == nb or labels[i] != labels[start]:
            secs.append({"start": float(bars_t[start]), "end": float(bars_t[i]) if i < nb else dur,
                         "label": labels[start], "bar": start})
            start = i
    bar_s = per * bpb
    P = 1
    while P * bar_s < CFG["phrase_min_s"]:
        P *= 2
    votes = np.zeros(P)
    for s_ in secs:
        if s_["bar"] > 0:
            votes[s_["bar"] % P] += 1
    phase = int(np.argmax(votes))
    loud = np.where(rel > -6)[0]
    base = {lab: rng.standard_normal(12) for lab in sorted(set(labels))}     # repeated sections repeat
    C = np.array([base[lab] + 0.2 * rng.standard_normal(12) for lab in labels])
    C /= np.linalg.norm(C, axis=1, keepdims=True)
    bv = np.repeat(vox, bpb) if beat_vox is None else np.asarray(beat_vox, float)
    F = {
        "version": 1, "track": track, "file": track.split(":")[-1] + ".mp3", "sig": "1:1:1", "duration": dur,
        "bpb": bpb, "bpm": bpm, "bpm_bt": bpm, "bpm_a1": bpm, "meter_ok": True, "octave_ok": octave_ok,
        "grid_src": "a1", "grid_class": "free", "fit": None,
        "active": [float(bars_t[loud[0]]), float(bars_t[min(loud[-1] + 1, nb - 1)])],
        "beats": {"t": bt.tolist(), "refined": [1 if cls_ok else 0] * len(bt), "pos": pos.tolist(),
                  "vox_db": bv.tolist()},
        "bars": {"t": bars_t.tolist(), "beat": list(range(0, nb * bpb, bpb)), "rel_db": rel.tolist(),
                 "low_db": low.tolist(), "perc_db": perc.tolist(), "vox_db": vox.tolist(),
                 "chroma": C.tolist(), "label": list(labels)},
        "sections": secs, "phrase": {"P": P, "phase": phase, "conf": float(votes[phase] / max(1, votes.sum()))},
        "last_loud_bar": int(loud[-1]),
        "onsets": {"t": bt.tolist() if onsets else [], "strength": [1.0] * (len(bt) if onsets else 0),
                   "median_down_strength": 1.0},
        "kblocks": {"block_s": 0.4, "hop_s": 0.1, "ms": [0.01] * int(dur * 10 - 3)},
        "stems": False, "landings": [],
    }
    F["fit"] = G.fit_grid(bt, G.beat_weights(F["beats"]["refined"]), *F["active"], pos=pos, bpb=bpb)
    F["grid_class"] = G.classify(F["fit"], F)
    if F["fit"]:
        F["bpm"] = round(60 / F["fit"]["period_s"], 3)
    if landings:
        F["landings"] = HL.landings(None, F)
    return F


def song(n_intro=16, n_break=8, n_drop=32, n_dip=8, n_drop2=8, n_outro=8, lead="nobass-nodrums", **kw):
    """intro | lead | drop | dip | drop 2 | outro: the drop is at bar n_intro + n_break and the
    dip after it gives the drop a natural exit before the track's last loud bar."""
    rel = [-7.0] * n_intro + [-5.0] * n_break + [0.0] * n_drop + [-8.0] * n_dip + [0.0] * n_drop2 + [-8.0] * n_outro
    low = ([-6.0] * n_intro + [-20.0 if lead.startswith("nobass") else -4.0] * n_break + [0.0] * n_drop
           + [-10.0] * n_dip + [0.0] * n_drop2 + [-8.0] * n_outro)
    perc = ([-3.0] * n_intro + [-10.0 if lead == "nobass-nodrums" else -2.0] * n_break + [-3.0] * n_drop
            + [-3.0] * (n_dip + n_drop2 + n_outro))
    labels = (["intro"] * n_intro + ["break"] * n_break + ["chorus"] * n_drop + ["bridge"] * n_dip
              + ["chorus"] * n_drop2 + ["outro"] * n_outro)
    return make_F(rel, low, perc, labels=labels, **kw)


# ------------------------------------------------------------------------ §5.1 candidates
def test_synthetic_feats_validate():
    F = song()
    assert S.validate_feats(F) == [] and F["grid_class"] == "locked"


def test_drop_is_the_top_landing_with_its_lead():
    F = song()
    ld = F["landings"][0]
    assert ld["bar"] == 24 and ld["label"] == "chorus" and ld["onset_ok"]
    assert ld["lead"]["type"] == "nobass-nodrums" and ld["lead"]["bars"] == 8
    assert ld["lead"]["t"] == pytest.approx(F["bars"]["t"][16], abs=1e-3)
    assert ld["t"] == pytest.approx(F["bars"]["t"][24], abs=1e-3)
    assert ld["win"]["cls"] == "locked" and all(e["win"]["cls"] == "locked" for e in ld["exits"])
    assert S.validate_feats(F) == []


def test_refinement_prefers_the_phrase_grid():
    """An all-in-one section that starts one bar early (a pickup bar) lands on the phrase grid."""
    F = song()
    F["sections"][2]["bar"] = 23                         # the chorus section starts a bar early
    cx = HL.Ctx(F)
    assert cx.conf >= 0.5 and HL.refine_bar(cx, 23) == 24


def test_breakdown_labelled_chorus_is_vetoed():
    """§5.1 step 3 (the Dreaming 0:46 case): a quiet or bass-less section is lead material."""
    rel = [-7.0] * 16 + [-8.0] * 8 + [0.0] * 32 + [-8.0] * 16
    labels = ["intro"] * 16 + ["chorus"] * 8 + ["chorus"] * 32 + ["outro"] * 16
    F = make_F(rel, labels=labels)
    F["sections"] = [{"start": F["bars"]["t"][0], "end": F["bars"]["t"][16], "label": "intro", "bar": 0},
                     {"start": F["bars"]["t"][16], "end": F["bars"]["t"][24], "label": "chorus", "bar": 16},
                     {"start": F["bars"]["t"][24], "end": F["bars"]["t"][56], "label": "chorus", "bar": 24},
                     {"start": F["bars"]["t"][56], "end": F["duration"], "label": "outro", "bar": 56}]
    cx = HL.Ctx(F)
    assert HL.vetoed(cx, 16) and not HL.vetoed(cx, 24)
    assert all(ld["bar"] != 16 for ld in HL.landings(None, F))


def test_arrival_candidates_on_unlabelled_energy_jumps():
    rel = [-9.0] * 20 + [0.0] * 40 + [-9.0] * 12
    F = make_F(rel, labels=["unlabelled"] * 72)
    F["sections"] = [{"start": F["bars"]["t"][0], "end": F["duration"], "label": "unlabelled", "bar": 0}]
    cands = HL.candidates(HL.Ctx(F))
    assert any(abs(j - 20) <= 1 and any(w.startswith("arrival+") for w in why) for j, why in cands.items())
    # with novelty boundaries the phrase phase follows them and the arrival gets exits
    t = F["bars"]["t"]
    F["sections"] = [{"start": t[0], "end": t[20], "label": "unlabelled", "bar": 0},
                     {"start": t[20], "end": t[60], "label": "unlabelled", "bar": 20},
                     {"start": t[60], "end": F["duration"], "label": "unlabelled", "bar": 60}]
    F["phrase"] = {"P": 8, "phase": 4, "conf": 1.0}
    lds = HL.landings(None, F)
    assert lds and lds[0]["bar"] == 20 and lds[0]["prior"] == CFG["highlight"]["prior"]["unlabelled"]


def test_drop_promotion_for_inst_and_solo():
    F = song()
    F["bars"]["label"][24:56] = ["inst"] * 32
    F["sections"][2]["label"] = "inst"
    prior, drop = HL._prior(HL.Ctx(F), 24)
    assert drop and prior == CFG["highlight"]["drop_prior"]


# ------------------------------------------------------------------------ §5.2 leads and pickups
@pytest.mark.parametrize("lead,want", [("nobass-nodrums", "nobass-nodrums"), ("nobass-drums", "nobass-drums"),
                                       ("full", "build")])
def test_nobass_leads(lead, want):
    F = song(lead=lead)
    assert HL.lead_type(F, 24)["type"] == want


def test_fill_bars_before_the_landing_are_skipped():
    F = song()
    F["bars"]["low_db"][23] = 0.0                          # a 1-bar fill with bass
    ld = HL.lead_type(F, 24)
    assert ld["type"] == "nobass-nodrums" and ld["fill_bars"] == 1 and ld["bars"] == 8


def test_build_break_and_lead_cap():
    rel = [-4.0] * 16 + list(np.linspace(-5, -2.5, 8)) + [0.0] * 32 + [-8.0] * 8
    F = make_F(rel)
    assert HL.lead_type(F, 24) | {} and HL.lead_type(F, 24)["type"] == "build" and HL.lead_type(F, 24)["bars"] == 8
    low = [0.0] * 22 + [-10.0, -10.0] + [0.0] * 32 + [-8.0] * 8     # a 2-bar bass drop-out
    ld = HL.lead_type(make_F([0.0] * 56 + [-8.0] * 8, low), 24)
    assert ld["type"] == "break" and ld["bars"] == 2
    assert HL.lead_type(make_F([0.0] * 56 + [-8.0] * 8), 24)["type"] == "none"
    # 80 bpm: 8 bars are 24 s > lead_max_s, so a nobass run is capped at 5 bars (16 s)
    F = song(bpm=80.0, n_intro=16, n_break=8, n_drop=16, n_outro=8)
    assert HL.lead_type(F, 24)["bars"] == int(CFG["lead_max_s"] / (4 * 60 / 80))


def test_pickup_beats():
    F = song()
    bv = np.full(len(F["beats"]["t"]), -20.0)
    k = F["bars"]["beat"][24]
    bv[k - 2:k] = -4.0                                    # a vocal pickup on the last 2 beats
    F["beats"]["vox_db"] = bv.tolist()
    F["bars"]["vox_db"][24] = -2.0
    assert HL.lead_type(F, 24)["pickup_beats"] == 2
    bv[k - 2] = -20.0
    F["beats"]["vox_db"] = bv.tolist()
    assert HL.lead_type(F, 24)["pickup_beats"] == 1


# ------------------------------------------------------------------------ §5.3 exits, §5.4 H
def test_exit_rules():
    F = song()
    cx = HL.Ctx(F)
    bar_s = cx.bar_s
    ex = HL.exits(None, F, 24)
    ns = {e["n"] for e in ex}
    for n in CFG["body_bars_allowed"]:
        ok = CFG["body_s"][0] <= n * bar_s <= CFG["body_s"][1] and (8 + n) * bar_s <= CFG["lead_body_max_s"] \
            and (24 + n) < F["last_loud_bar"] and (HL.Ctx(F).on_phrase(24 + n) or 24 + n in cx.bounds)
        assert (n in ns) == ok, n
    e32 = next(e for e in ex if e["n"] == 32)
    assert e32["bar"] == 56 and e32["kind"] == "natural" and e32["natural"]      # the outro is 8 dB down
    assert e32["t"] == pytest.approx(F["bars"]["t"][56], abs=1e-3)
    assert ex == sorted(ex, key=lambda e: (-e["h"], e["n"]))


def test_exits_anchor_on_the_landing_when_the_phrase_grid_is_unreliable():
    """A landing one bar off a phrase grid nobody trusts (conf < 0.5) still gets exits n bars on
    (n a multiple of P); with a confident grid it would not."""
    F = song()
    F["sections"] = [dict(x) for x in F["sections"]]
    cx = HL.Ctx(F)
    assert not any(HL.exit_ok(cx, 25, n, 8) for n in (16, 24, 32) if 25 + n not in cx.bounds)
    F["phrase"] = {**F["phrase"], "conf": 0.3}
    cx = HL.Ctx(F)
    assert HL.exit_ok(cx, 25, 16, 8) and not HL.exit_ok(cx, 25, 12, 8)


def test_h_matches_the_formula():
    F = song()
    cx = HL.Ctx(F)
    j, n = 24, 32
    hh = CFG["highlight"]["h"]
    e = HL.exit_terms(cx, j, j + n)
    contrast = np.mean(cx.rel[j:j + 2]) - np.mean(cx.rel[j - 4:j])
    want = (1.0 + hh["level"] * e["level"] + hh["contrast"] * min(contrast, 10) + hh["rep"] * max(cx.rep(j, 8), 0)
            + hh["lead_q"] * 1.0 + hh["exit"] * 1 + hh["on_grid"] * 1 + hh["lull"] * e["lull"]
            + hh["dur"] * abs((cx.t_at(j + n) - cx.t_at(j - 8)) - 50)          # fixer: real seconds
            + hh["vocal_edge"] * e["vocal_at_edge"] + hh["verse_bar"] * e["verse_bars"]
            + hh["section_end"] * e["section_end"])
    assert HL.H(None, F, j, n) == pytest.approx(want, abs=1e-9)
    assert HL.s_out(None, F, 56, False, 24) == pytest.approx(CFG["highlight"]["s_out"]["natural"] +
                                                            CFG["highlight"]["s_out"]["vocal_at_edge"] * e["vocal_at_edge"])


def test_early_landings_are_penalised():
    F = song(n_intro=4, n_break=4, n_drop=40, n_outro=24)
    assert HL.Ctx(F).g[8] < CFG["highlight"]["early_s"]
    cx = HL.Ctx(F)
    lead = HL.lead_type(F, 8)
    e = HL.exit_terms(cx, 8, 24)
    base = HL._h(cx, 8, 16, lead, e, 1.0)
    cx.dur = 1.0                                          # not early any more: only the -0.4 changes
    cx.g = cx.g + 1000
    assert HL._h(cx, 8, 16, lead, e, 1.0) - base == pytest.approx(-CFG["highlight"]["h"]["early"])


def test_novelty_sections_find_the_changes():
    rng = np.random.default_rng(3)
    nb = 64
    rel = np.r_[np.full(16, -8.0), np.full(24, 0.0), np.full(24, -12.0)] + rng.normal(0, 0.3, nb)
    low = np.r_[np.full(16, -20.0), np.full(24, 0.0), np.full(24, -25.0)]
    C = np.tile(rng.standard_normal(12), (nb, 1))
    g = np.arange(nb) * 1.9
    secs = HL.novelty_sections(g, nb * 1.9, rel, low, np.zeros(nb), np.zeros(nb), C)
    starts = [s["bar"] for s in secs]
    assert starts[0] == 0 and any(abs(b - 16) <= 1 for b in starts) and any(abs(b - 40) <= 1 for b in starts)
    assert all(s["label"] == "unlabelled" for s in secs)


# ------------------------------------------------------------------------ compute() on synth audio
@pytest.fixture(scope="module")
def synth_feats(tmp_path_factory, synth):
    s = synth.make_track(bpm=126, sections=[("intro", 8, {"kick", "hat"}), ("break", 8, {"pad", "vox"}),
                                            ("drop", 24, {"kick", "snare", "hat", "bass", "pad", "vox"}),
                                            ("outro", 8, {"kick", "hat"})], tail_s=0.5)
    d = tmp_path_factory.mktemp("synth")
    path = d / "Synth - Track.mp3"
    path.write_bytes(b"not decoded: y is passed in")
    det = np.round((s.beats + 0.02) / 0.02) * 0.02          # Beat This style: late, 20 ms frames
    t = {"path": str(path), "id": "file:synth", "file": path.name, "beats": det.tolist(),
         "downbeats": det[::4].tolist(), "beats_per_bar": 4, "bpm": 126.0, "duration": s.duration, "version": 1}
    F, extras = FE.compute(t, y=s.y, data_dir=str(d))
    return s, F, extras


def test_compute_on_synth_audio(synth_feats):
    s, F, extras = synth_feats
    assert S.validate_feats(F) == []
    assert F["grid_src"] == "bt" and F["grid_class"] == "locked" and F["fit"]["rms_ms"] < 2
    assert F["bpm"] == pytest.approx(126.0, abs=0.05) and extras["lag_ms"] == pytest.approx(-20, abs=6)
    bt = np.asarray(F["beats"]["t"])
    ref = np.asarray(F["beats"]["refined"]) == 1
    err = np.abs(bt[ref] - s.beats[ref])
    assert np.percentile(err, 95) <= 0.002 and np.max(err) <= 0.003      # incl. rounding to 1 ms
    assert np.allclose(F["bars"]["t"], np.asarray(F["beats"]["t"])[F["bars"]["beat"]])
    assert F["sections"] and all(x["label"] == "unlabelled" for x in F["sections"])   # novelty (no structure)
    rel = np.asarray(F["bars"]["rel_db"])
    assert rel[16:40].mean() > rel[8:16].mean() + 3                 # the drop is louder than the break
    assert np.asarray(F["bars"]["low_db"])[8:16].max() < -15         # the break has no bass
    top = F["landings"][0]
    assert top["bar"] == 16 and top["lead"]["type"] == "nobass-nodrums" and top["onset_ok"]
    assert abs(top["t"] - s.downbeats[16]) <= 0.002
    import pyloudnorm
    ref_l = pyloudnorm.Meter(44100).integrated_loudness(s.y.astype(np.float64))
    assert FE.lufs_window(F["kblocks"], 0, F["duration"]) == pytest.approx(ref_l, abs=0.1)


# ------------------------------------------------------------------------ §7 relation
def _track(tid, camelot="8A", **kw):
    return {"id": tid, "camelot": camelot, "artist": kw.pop("artist", tid), "title": tid, "bucket": kw.pop("bucket", "dance"),
            **kw}


def test_relation_lock_double_free():
    a = song(bpm=127.0, track="spotify:a")
    b = song(bpm=126.0, track="spotify:b")
    r = O.relation(_track("a", "3A"), _track("b", "5A"), a, b)
    assert r["kind"] == "lock" and r["a_ratio"] == 1 and r["stretch_pct"] == pytest.approx((126 / 127 - 1) * 100, abs=0.02)
    assert r["camelot"] == 2 and r["a_class"] == r["b_class"] == "locked"
    assert S.check_type({k: v for k, v in r.items() if k not in ("a_win", "b_win")}, S.Rel) == []
    assert S.check_type(r, S.Relation) == []
    fast = song(bpm=174.0, track="spotify:f")
    slow = song(bpm=87.5, track="spotify:s")
    r = O.relation(_track("f"), _track("s"), fast, slow)
    assert r["kind"] == "double" and r["a_ratio"] == 2 and abs(r["stretch_pct"]) < 1
    assert O.relation(_track("s"), _track("f"), slow, fast)["a_ratio"] == 0.5
    far = song(bpm=100.0, track="spotify:c")
    r = O.relation(_track("a"), _track("c"), a, far)
    assert r["kind"] == "free" and r["stretch_pct"] == 0.0
    # verify windows may lock but never double; bpb != 4 never locks
    loose = song(bpm=126.0, track="spotify:v", jitter_ms=18, seed=4)
    rr = O.relation(_track("a"), _track("v"), a, loose)
    assert rr["b_class"] == "verify" and rr["kind"] == "lock"
    three = song(bpm=126.0, track="spotify:w", bpb=3)
    assert O.relation(_track("a"), _track("w"), a, three)["kind"] == "free"


# ------------------------------------------------------------------------ §6 selection and order
def test_eligibility_reasons():
    good = song(track="spotify:g")
    low = song(track="spotify:l")
    low["landings"][0]["h"] = low["landings"][0]["h_base"] = 1.0
    for ld in low["landings"][1:]:
        ld["h"] = ld["h_base"] = 0.5        # eligibility reads h_base (H without exit ranking)
    no_on = song(track="spotify:n", onsets=False)
    short = song(track="spotify:s", n_intro=4, n_break=4, n_drop=24, n_outro=4)
    none = song(track="spotify:e")
    none["landings"] = []
    fs = {"g": good, "l": low, "n": no_on, "s": short, "e": none}
    tracks = [_track(k) for k in ("g", "l", "n", "s", "e", "x")]
    ok, out = O.eligibility(tracks, fs)
    assert [t["id"] for t in ok] == ["g"]
    assert {o["track"]: o["reason"] for o in out} == {"l": "low_h", "n": "no_landing", "s": "too_short",
                                                      "e": "no_excerpt", "x": "needs_prep"}
    for o in out:
        assert S.check_type(o, S.Excluded) == []


def test_block_membership():
    F = song(bpm=125.0)
    t = _track("x")
    assert O.block_of(t, F, 0.6)[0] == "house"
    # fixer (review v1 musical #5): rock goes to the rock block, chill to close, and a locked
    # 4/4 dance track keeps its tempo block at any energy
    assert O.block_of({**t, "bucket": "rock"}, F, 0.6)[0] == "rock"
    assert O.block_of({**t, "bucket": "rock"}, F, 0.2)[0] == "close"          # a rock ballad closes
    assert O.block_of({**t, "bucket": "chill"}, F, 0.6)[0] == "close"
    assert O.block_of(t, F, 0.2)[0] == "house"
    assert O.block_of(t, song(bpm=174.0), 0.6)[0] == "dnb"
    assert O.block_of(t, song(bpm=95.0), 0.6)[0] == "swing"
    assert O.block_of(t, song(bpm=145.0), 0.6) == ("rock", "145.0 bpm outside the house/dnb/swing ranges; energy 0.60")
    assert O.block_of(t, song(bpm=145.0), 0.2) == ("close", "145.0 bpm outside the house/dnb/swing ranges")
    assert O.block_of(t, song(bpm=125.0, jitter_ms=40, seed=2), 0.2) == ("close", "grid free")


def _library():
    spec = [("h1", 124.0), ("h2", 126.0), ("h3", 128.0), ("h4", 125.0), ("d1", 172.0), ("d2", 174.0), ("d3", 176.0),
            ("s1", 87.0), ("s2", 92.0), ("s3", 95.0), ("c1", 140.0), ("c2", 100.0)]
    fs, tracks, energy = {}, [], {}
    for i, (tid, bpm) in enumerate(spec):
        fs[tid] = song(bpm=bpm, track=f"spotify:{tid}", seed=i)
        tracks.append(_track(tid, camelot=f"{i % 12 + 1}A", bucket="rock" if tid == "c2" else "dance"))
        energy[tid] = 0.4 + 0.04 * i
    return tracks, fs, energy


def test_select_and_order_blocks_bridge_and_determinism():
    tracks, fs, energy = _library()
    plan = O.plan_order(tracks, fs, energy, seed=0)
    order = plan["order"]
    assert sorted(order) == sorted(t["id"] for t in tracks) and not plan["excluded"]   # every eligible song
    assert plan["block_order"] == ["house", "dnb", "swing", "close"]
    assert set(order[:4]) == {"h1", "h2", "h3", "h4"} and set(order[4:7]) == {"d1", "d2", "d3"}
    assert set(order[7:10]) == {"s1", "s2", "s3"} and set(order[10:]) == {"c1", "c2"}
    br = plan["bridge"]["dnb>swing"]
    assert br and order[6] == br["a"] and order[7] == br["b"] and br["dev_pct"] <= 6
    assert O.select_and_order(tracks, fs, energy, seed=0) == order                      # deterministic
    assert O.select_and_order(tracks, fs, energy, seed=7) == O.select_and_order(tracks, fs, energy, seed=7)


def test_small_blocks_fold_into_close():
    tracks, fs, energy = _library()
    keep = [t for t in tracks if t["id"] not in ("d1",)]
    plan = O.plan_order(keep, {k: v for k, v in fs.items() if k != "d1"}, energy)
    assert "dnb" not in plan["blocks"] and {"d2", "d3"} <= set(plan["blocks"]["close"])
    assert "folded into close" in plan["why"]["d2"] and plan["bridge"]["dnb>swing"] is None


def test_house_prefers_rising_tempo_and_no_same_artist_neighbours():
    tracks, fs, energy = _library()
    for t in tracks:
        if t["id"] in ("h1", "h3"):
            t["artist"] = "Same Artist"
    order = O.plan_order(tracks, fs, {k: 0.6 for k in energy})["order"][:4]
    assert abs(order.index("h1") - order.index("h3")) > 1
    bpms = [fs[i]["bpm"] for i in order]
    assert sum(b < a - 1 for a, b in zip(bpms, bpms[1:])) <= 1


# ------------------------------------------------------------------------ real tracks (Phase 1 test 2)
ACCEPT = {"7gDgphzQU0urJU3AtoLJup": 45.88, "15vNoLXoliW2XdTUDlNlWk": 152.68, "7e8WWf2iBY4sPJDYAeGgW0": 66.62}


def _real(sid):
    if not os.path.isdir(FOLDER) or not os.path.isdir(FEATS_DIR):
        pytest.skip("music folder or feats cache not available")
    path = next((os.path.join(FOLDER, f) for f in os.listdir(FOLDER) if sid in f), None)
    F = FE.FeatStore(FEATS_DIR, DATA).get(path) if path else None
    if F is None:
        pytest.skip("track not prepped")
    return F


@pytest.mark.parametrize("sid,want", sorted(ACCEPT.items()))
def test_acceptance_landings(sid, want):
    """Dance No More 0:45.88, Dreaming 2:32.68 (not 2:31.71), Bluebird 1:06.62, within 1 bar,
    among the top 3; Dreaming's 0:46 "chorus" is vetoed."""
    F = _real(sid)
    bar = 4 * 60 / F["bpm"]
    assert any(abs(ld["t"] - want) <= bar for ld in F["landings"])
    if sid == "15vNoLXoliW2XdTUDlNlWk":
        assert F["landings"][0]["t"] == pytest.approx(152.68, abs=0.05)
        assert all(abs(ld["t"] - 46.0) > 2 for ld in F["landings"])
        assert all(abs(ld["t"] - 151.71) > 0.5 for ld in F["landings"])
        assert HL.vetoed(HL.Ctx(F), int(np.argmin(np.abs(np.asarray(F["bars"]["t"]) - 46.0))))
