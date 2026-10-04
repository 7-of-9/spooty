"""E1 grid and feature-store tests: onsets, refinement, fitted grids, classes, consensus beats,
time lookups, BS.1770 windows, the FeatStore cache (DESIGN §4, §15; Phase 1 tests 1, 4, 5)."""

import json
import os
import shutil

import numpy as np
import pytest

from automix.medley import CFG, FEATS_VERSION
from automix.medley import feats as FE
from automix.medley import grid as G
from automix.medley import schema as S

SR = 44100
DATA = "/Users/dom/src/spooty/data/automix"
FOLDER = "/Users/dom/Desktop/mp3_downloads/50"


def _grid_beats(n=256, bpm=126.0, t0=0.5, bpb=4):
    per = 60 / bpm
    return t0 + per * np.arange(n), np.arange(n) % bpb, per


# ------------------------------------------------------------------------ onsets (§4.1 step 2)
@pytest.fixture(scope="module")
def drums(synth):
    return synth.make_track(bpm=126, sections=[("a", 12, {"kick", "snare", "hat", "bass", "pad", "vox"})])


def test_onsets_are_sample_accurate(synth, drums):
    """Kicks, snares and clicks are timed to the millisecond (the 1 ms target of §4.1)."""
    t, s = G.onsets(drums.y.mean(1).astype(np.float32), SR)
    for part in ("kick", "snare"):
        err = np.array([t[np.argmin(np.abs(t - x))] - x for x in drums.onsets[part]]) * 1000
        assert np.median(np.abs(err)) <= 1.0 and np.percentile(np.abs(err), 90) <= 1.5, (part, err)
    c = synth.click_track(bpm=120, bars=8)
    t, _ = G.onsets(c.y.mean(1).astype(np.float32), SR)
    err = np.array([t[np.argmin(np.abs(t - x))] - x for x in c.onsets["click"]]) * 1000
    assert np.max(np.abs(err)) <= 1.5
    assert np.all(np.diff(t) > 0) and np.all(np.round(t, 3) == t)


def test_refine_beats_on_audio(synth, drums):
    """Detector beats that run 22 ms late on a 20 ms frame grid are moved onto the kicks, and
    the measured detector lag is reported."""
    true = drums.beats
    det = np.round((true + 0.022) / 0.02) * 0.02
    mono = drums.y.mean(1).astype(np.float32)
    t, ref = G.refine_beats(mono, SR, det, pos=np.arange(len(det)) % 4)
    assert ref.mean() > 0.95
    assert np.max(np.abs(t[ref == 1] - true[ref == 1])) <= 0.0015
    on = G.onsets(mono, SR)
    _, _, lag = G.refine_with_onsets(det, *on)
    assert -0.03 < lag < -0.012


def test_refine_lag_correction_and_consistency():
    """Unrefined beats get the median detector lag; a refined beat that caught a stronger fill
    onset 25 ms early is re-picked onto the weaker true onset by the consistency pass, or left
    unrefined when there is none."""
    true, pos, per = _grid_beats(200)
    det = true + 0.020
    on_t = list(true)
    on_s = [1.0] * len(true)
    on_t[50], on_s[50] = true[50] - 0.025, 3.0            # a fill replaces beat 50's kick ...
    on_t.append(true[50]); on_s.append(0.8)                # ... which is still there, weaker
    on_t[120] = true[120] - 0.025; on_s[120] = 3.0         # beat 120: only the fill
    for k in range(150, 160):                              # a beatless stretch: no onsets
        on_t[k] = np.nan
    o = np.array(on_t)
    keep = ~np.isnan(o)
    order = np.argsort(o[keep])
    t, ref, lag = G.refine_with_onsets(det, o[keep][order], np.array(on_s)[keep][order], pos=pos)
    assert lag == pytest.approx(-0.020, abs=1e-6)
    assert ref[50] == 1 and t[50] == pytest.approx(true[50], abs=1e-4)
    assert ref[120] == 0 and t[120] == pytest.approx(det[120] + lag, abs=1e-4)
    assert np.all(ref[150:160] == 0) and np.allclose(t[150:160], true[150:160], atol=1e-4)
    assert np.all(np.diff(t) > 0)


# ------------------------------------------------------------------------ fit_grid / classify (§4.2)
def test_fit_grid_recovers_tempo_and_jitter():
    rng = np.random.default_rng(1)
    true, pos, per = _grid_beats(300)
    jit = rng.uniform(-0.004, 0.004, len(true))
    w = np.ones(len(true))
    f = G.fit_grid(true + jit, w, 0, 1e9, pos=pos, bpb=4)
    assert f["period_s"] == pytest.approx(per, rel=1e-5)
    assert f["phase_s"] == pytest.approx(0.5, abs=0.002)
    assert f["rms_ms"] == pytest.approx(4 / np.sqrt(3), abs=0.4)
    assert f["max_ms"] <= 4.6 and f["keep"] == 1.0 and f["n"] == 300 and (f["k0"], f["k1"]) == (0, 299)
    assert S.check_type(f, S.Fit) == []


def test_fit_grid_groove_is_anchored_on_the_downbeat():
    """Claps on 2 and 4 that land 18 ms early are a groove, not grid error: the groove fit keeps
    rms ~0 and the grid on the kicks; the plain line splits the difference. Where the clap is
    absent (a breakdown) the beat sits on the line and is not penalised (hard-EM)."""
    true, pos, per = _grid_beats(256)
    t = true + np.where(pos % 2 == 1, -0.018, 0.0)
    t[100:132] = true[100:132]                           # breakdown: no clap, beats on the line
    w = np.ones(len(t))
    plain = G.fit_grid(t, w, 0, 1e9)
    groove = G.fit_grid(t, w, 0, 1e9, pos=pos, bpb=4)
    assert plain["rms_ms"] > 6
    assert groove["rms_ms"] < 0.5 and groove["max_ms"] < 1.0
    assert groove["phase_s"] == pytest.approx(0.5, abs=1e-4)
    assert G.classify(groove, {"meter_ok": True, "octave_ok": True, "bpb": 4}) == "locked"


def test_fit_grid_outliers_min_beats_and_hint():
    true, pos, per = _grid_beats(100)
    t = true.copy()
    t[[10, 40, 70]] += 0.08                               # > 40 ms: dropped
    t[[20, 21]] += 0.012
    w = np.ones(len(t))
    w[30:40] = 0.25
    f = G.fit_grid(t, w, 0, 1e9)
    assert f["keep"] == pytest.approx(0.97) and f["n"] == 97
    assert f["max_ms"] == pytest.approx(12, abs=0.6)
    assert G.fit_grid(t[:15], w[:15], 0, 1e9) is None                 # < 16 beats
    assert G.fit_grid(t, w, 0, 1e9, bpm_hint=63.0) is None             # a tempo-octave mismatch
    assert G.fit_grid(t, w, 5.0, 14.0)["k0"] == int(np.ceil((5.0 - 0.5) / per))


def test_classify_thresholds_and_r12():
    ok = {"meter_ok": True, "octave_ok": True, "bpb": 4}
    fit = {"rms_ms": 5.9, "max_ms": 14.9, "keep": 0.95}
    assert G.classify(fit, ok) == "locked"
    assert G.classify({**fit, "max_ms": 16}, ok) == "verify"
    assert G.classify({**fit, "rms_ms": 14.9}, ok) == "verify"
    assert G.classify({**fit, "keep": 0.85}, ok) == "verify"
    assert G.classify({**fit, "rms_ms": 15.1}, ok) == "free"
    assert G.classify({**fit, "keep": 0.79}, ok) == "free"
    assert G.classify(None, ok) == "free"
    for bad in ({"meter_ok": False}, {"octave_ok": False}, {"bpb": 3}):
        assert G.classify(fit, {**ok, **bad}) == "free"


# ------------------------------------------------------------------------ consensus (§4.1 step 1)
def test_consensus_snaps_a1_to_beat_this_and_checks_meter_octave():
    true, pos, per = _grid_beats(200, bpm=125.0)
    bt_beats = np.round(true / 0.02) * 0.02
    a1 = np.round((true + 0.03) / 0.01) * 0.01
    a1[77] += 0.09                                         # too far from any BT beat: not snapped ...
    t = {"beats": bt_beats.tolist(), "downbeats": bt_beats[::4].tolist(), "beats_per_bar": 4, "bpm": 125.0,
         "duration": 100.0}
    s = {"beats": a1.tolist(), "beat_positions": (pos + 1).tolist(), "bpm": 125,
         "segments": [{"start": 0, "end": 100.0, "label": "chorus"}]}
    cs = G.consensus(t, s)
    assert cs["src"] == "a1" and cs["bpb"] == 4 and cs["meter_ok"] and cs["octave_ok"]
    assert np.allclose(np.delete(cs["beats"], 77), np.delete(bt_beats, 77))
    assert abs(cs["beats"][77] - true[77]) < 0.015 and cs["filled"] == cs["dropped"] == 1   # ... re-gridded
    assert np.array_equal(G.consensus_downbeats(t, s), cs["beats"][cs["pos"] == 0])
    # meter and octave disagreements (R12)
    s3 = {**s, "beat_positions": (np.arange(200) % 3 + 1).tolist()}
    assert not G.consensus(t, s3)["meter_ok"] and G.consensus(t, s3)["bpb"] == 3
    assert not G.consensus(t, {**s, "bpm": 62})["octave_ok"]
    # a stale structure (does not tile the file) is ignored: Beat This alone
    cs_bt = G.consensus(t, {**s, "segments": [{"start": 0, "end": 60.0, "label": "x"}]})
    assert cs_bt["src"] == "bt" and np.array_equal(cs_bt["pos"], pos)


def test_consensus_repairs_gaps_and_duplicates():
    true, pos, per = _grid_beats(120)
    b = np.delete(true, [30, 31, 80])                      # a 3-beat gap and a 2-beat gap
    p = np.delete(pos, [30, 31, 80])
    b = np.insert(b, 50, b[49] + per * 0.45)               # a spurious beat
    p = np.insert(p, 50, 0)
    out, op, filled, dropped = G.repair(b, p, 4)
    assert (filled, dropped) == (3, 1)
    assert np.allclose(out, true, atol=1e-9) and np.array_equal(op, pos)


def test_repair_regrids_a_breakdown_tracked_at_the_wrong_spacing():
    """The detector lost the beat for 30 beats (it tracked 20 at 1.5x spacing): the stretch is
    re-gridded between its anchors because they are a whole number of beats apart."""
    true, pos, per = _grid_beats(200)
    b = np.r_[true[:100], np.linspace(true[100], true[130], 21)[1:-1], true[130:]]
    p = np.r_[pos[:100], np.zeros(19, int), pos[130:]]
    out, op, added, removed = G.repair(b, p, 4)
    assert (added, removed) == (30, 19)                    # beats 100..129 back, the 19 wrong ones out
    assert np.allclose(out, true, atol=1e-9) and np.array_equal(op, pos)


def test_repair_leaves_tempo_changes_and_edges_alone():
    per1, per2 = 0.5, 60 / 126
    a = 0.5 + per1 * np.arange(100)
    trans = a[-1] + np.cumsum([0.62, 0.41, 0.58, 0.37, 0.61, 0.44, 0.55])     # 3.58 s: not whole beats
    c = trans[-1] + per2 * np.arange(1, 101)
    b = np.r_[a, trans, c]
    p = np.arange(len(b)) % 4
    out, op, added, removed = G.repair(b, p, 4)
    assert (added, removed) == (0, 0) and np.array_equal(out, b)
    # a half-tempo intro (an edge) is not re-gridded either
    true, pos, per = _grid_beats(200)
    b = np.r_[true[:40:2], true[40:]]
    out, _, added, removed = G.repair(b, np.r_[pos[:40:2], pos[40:]], 4)
    assert (added, removed) == (0, 0)


def test_fit_grid_survives_an_index_break():
    """A stretch at the wrong spacing (not repaired) shifts every later beat index; the robust
    start keeps the fit on the majority instead of collapsing."""
    true, pos, per = _grid_beats(400)
    t = np.r_[true[:60], true[60:120:2], true[120:]]      # 30 beats lost inside the first 120
    f = G.fit_grid(t, np.ones(len(t)), 0, 1e9)
    assert f is not None and f["keep"] > 0.75 and f["period_s"] == pytest.approx(per, rel=1e-6)


# ------------------------------------------------------------------------ time lookups
def test_grid_time_and_refined_time():
    assert G.grid_time((10.0, 0.5), 4) == 12.0
    assert G.grid_time({"land_t": 10.0, "period_s": 0.5}, -2.5) == 8.75
    assert np.allclose(G.grid_time((10.0, 0.5), [0, 1]), [10.0, 10.5])
    b = np.array([1.0, 1.5, 2.1, 2.6, 3.1, 3.6])
    assert G.refined_time(b, 2, 0.5) == pytest.approx(2.35)
    assert G.refined_time(b, 0, -1) == pytest.approx(1.0 - 2.1 / 4)       # extrapolated
    assert np.allclose(G.refined_time(b, 5, [0, 1]), [3.6, 3.6 + 2.1 / 4])


def test_bar_time_uses_the_fit_only_for_locked_windows(feats):
    F = feats["bluebird"]
    ld = next(x for x in F["landings"] if x["bar"] == 48)
    win = G.fit_bars(F, 48 - 9, 48 + 8)
    assert win["cls"] in ("locked", "verify")
    fit = win["fit"]
    assert G.bar_time(F, 48, win) == pytest.approx(fit["phase_s"] + F["bars"]["beat"][48] * fit["period_s"])
    assert abs(G.bar_time(F, 48, win) - ld["t"]) < 0.02
    assert G.bar_time(F, 48, {"cls": "free", "fit": fit}) == F["bars"]["t"][48]


# ------------------------------------------------------------------------ loudness (§15, Phase 1 test 5)
def _pyln(y, t0, t1):
    import pyloudnorm
    return pyloudnorm.Meter(SR).integrated_loudness(y[int(t0 * SR): int(t1 * SR)].astype(np.float64))


def test_lufs_window_matches_pyloudnorm_on_synth(synth):
    s = synth.make_track(bpm=124, sections=[("a", 6, {"kick", "hat"}), ("b", 6, {"pad", "vox"}),
                                            ("c", 8, {"kick", "snare", "hat", "bass", "pad", "vox"})])
    kb = FE.kblocks(s.y)
    assert FE.lufs_window(kb, 0, s.duration) == pytest.approx(_pyln(s.y, 0, s.duration), abs=0.02)
    rng = np.random.default_rng(5)
    for _ in range(20):
        t0 = rng.uniform(0, s.duration - 12)
        t1 = t0 + rng.uniform(8, s.duration - t0)
        assert FE.lufs_window({"block_s": 0.4, "hop_s": 0.1, "ms": kb}, t0, t1) == pytest.approx(_pyln(s.y, t0, t1), abs=0.1)
    silent = np.zeros((SR * 3, 2), np.float32)
    assert FE.lufs_window(FE.kblocks(silent), 0, 3) == CFG["loudness"]["abs_gate_lufs"]


@pytest.mark.skipif(not os.path.isdir(FOLDER), reason="music folder not available")
def test_lufs_window_matches_pyloudnorm_on_a_real_track():
    from automix.audio import decode
    path = next(os.path.join(FOLDER, f) for f in os.listdir(FOLDER) if "7gDgphzQU0urJU3AtoLJup" in f)
    y = decode(path)
    kb = FE.kblocks(y)
    rng = np.random.default_rng(7)
    dur = len(y) / SR
    for _ in range(20):
        t0 = rng.uniform(0, dur - 30)
        t1 = t0 + rng.uniform(10, min(90, dur - t0))
        assert FE.lufs_window(kb, t0, t1) == pytest.approx(_pyln(y, t0, t1), abs=0.1)


# ------------------------------------------------------------------------ FeatStore
def test_featstore_round_trip(tmp_path, feats):
    F = json.loads(json.dumps(feats["bluebird"]))
    mp3 = tmp_path / F["file"]
    mp3.write_bytes(b"x" * 10)
    st = os.stat(mp3)
    F["sig"] = f"{st.st_size}:{int(st.st_mtime)}:1"
    t = {"id": F["track"], "path": str(mp3), "version": 1}
    store = FE.FeatStore(str(tmp_path / "medley" / "feats"), str(tmp_path))
    assert store.get(t) is None and store.missing([t]) == [t["id"]]
    v0 = store.version()
    kc = np.random.default_rng(0).random((len(F["bars"]["t"]), 12)).astype(np.float32)
    store.put(F, {"key_chroma": kc, "mix_ref_db": -20.0})
    G2 = store.get(t)
    assert isinstance(G2["beats"]["t"], np.ndarray) and isinstance(G2["onsets"]["t"], np.ndarray)
    assert np.allclose(G2["beats"]["t"], F["beats"]["t"]) and G2["landings"] == F["landings"]
    assert S.validate_feats(G2) == []
    assert np.allclose(store.key_chroma(t), kc) and store.extras(t)["mix_ref_db"] == -20.0
    assert store.version() != v0 and store.missing([t]) == [] and store.fresh(t)
    # stems appearing later make the entry stale (refresh), never missing
    d = tmp_path / "stems" / os.path.splitext(F["file"])[0]
    d.mkdir(parents=True)
    for n in ("drums", "bass", "vocals", "other"):
        (d / f"{n}.flac").write_bytes(b"")
    assert store.get(t) is not None and not store.fresh(t)
    shutil.rmtree(d)
    # a changed file invalidates the entry; so does a FEATS_VERSION bump
    os.utime(mp3, (st.st_mtime + 10, st.st_mtime + 10))
    assert store.get(t) is None
    assert store.get(str(mp3))["version"] == FEATS_VERSION


# ------------------------------------------------------------------------ the prepared folder (Phase 1 test 1)
@pytest.mark.skipif(not os.path.exists(os.path.join(DATA, "medley", "feats", "README.json")), reason="prep not run")
def test_prep_record():
    """feats/README.json records the class histogram, the rms distribution and tau_key (§4.2
    calibration gate), and every cached track validates."""
    root = os.path.join(DATA, "medley", "feats")
    doc = json.load(open(os.path.join(root, "README.json")))
    h = doc["class_hist"]
    assert set(h) == {"locked", "verify", "free"} and sum(h.values()) == len(doc["tracks"])
    assert doc["locked_rms_ms_chosen"] == CFG["locked_rms_ms"] and doc["gate"]["locked"] == h["locked"]
    assert 0.1 <= doc["tau_key"]["tau_key"] <= 0.9
    store = FE.FeatStore(root, DATA)
    for name in sorted(os.listdir(root))[:200]:
        if name.endswith(".json") and name != "README.json":
            F = store.get(os.path.join(FOLDER, name[:-5] + ".mp3"))
            assert F is not None and S.validate_feats(F) == [], name
