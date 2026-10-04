"""E3 StemStore (DESIGN §14 + AMENDMENTS 2): lookup by track id, offsets, residual-folded `other`,
version, the separate() refusal, and the engine reading a bound store. A synthetic store in tmp_path;
the real stems folder is only read (skipped when absent)."""

import json
import os

import numpy as np
import pytest
import soundfile as sf

import synth
from automix.medley import engine, stems
from automix.medley import schema as S
from automix.render import XF, crop

SR = 44100
SPID = "ABCDEFGHIJKLMNOPQRSTUV"                      # 22 characters, like a Spotify id
NAME = f"Artist - Title [sp-{SPID}]"
TID = f"spotify:{SPID}"
LAG = 37                                              # samples the synthetic stems lag the mix
REAL_STEMS = "/Users/dom/src/spooty/data/automix/stems"
REAL_MP3 = "/Users/dom/Desktop/mp3_downloads/50"


def write_stems(root, name, s, lag=0, skip=()):
    d = os.path.join(root, name)
    os.makedirs(d, exist_ok=True)
    for n in stems.NAMES:
        if n in skip:
            continue
        x = np.concatenate([np.zeros((lag, 2), np.float32), s.stems[n]])[: len(s.y)]
        sf.write(os.path.join(d, n + ".flac"), x, SR, subtype="PCM_16")
    return d


@pytest.fixture(scope="module")
def track():
    s = synth.make_track(120, [("a", 12, {"kick", "snare", "hat", "bass", "pad", "vox"})], seed=21)
    s.y *= 0.5                                        # headroom: the drums must not clip in 16-bit FLAC
    for n in s.stems:
        s.stems[n] *= 0.5
    return s


@pytest.fixture
def store(tmp_path, track):
    write_stems(str(tmp_path), NAME, track, lag=LAG)
    return stems.StemStore(str(tmp_path))


def test_lookup_by_id_or_path_and_completeness(tmp_path, store, track):
    assert stems.tid_of_dir(NAME) == TID
    assert stems.tid_of_dir("AES Dana - Unfold").startswith("file:")
    assert store.has(TID) and store.has("anything", f"/music/{NAME}.mp3")
    write_stems(str(tmp_path), f"Other - Song [sp-{'Z' * 22}]", track, skip=("other",))
    fresh = stems.StemStore(str(tmp_path))
    assert not fresh.has(f"spotify:{'Z' * 22}") and not fresh.has("spotify:nope")
    # a measured rejection hides the set
    with open(os.path.join(str(tmp_path), NAME, "meta.json"), "w") as fh:
        json.dump({"accepted": False}, fh)
    assert not stems.StemStore(str(tmp_path)).has(TID)


def test_truncated_or_mismatched_stems_are_not_usable(tmp_path, track):
    """A half-written stem (the separation job died mid-write) must not count as a stem set:
    other = mix - stems would then carry drums. Frame counts must agree, and match the mix."""
    name = f"Cut - Short [sp-{'Q' * 22}]"
    d = write_stems(str(tmp_path), name, track)
    st = stems.StemStore(str(tmp_path))
    n = len(track.y)
    assert st.has(f"spotify:{'Q' * 22}") and st.has(f"spotify:{'Q' * 22}", duration_s=n / SR)
    assert not st.has(f"spotify:{'Q' * 22}", duration_s=n / SR + 0.5)      # stems shorter than the mix
    x, _ = sf.read(os.path.join(d, "vocals.flac"), dtype="float32")
    sf.write(os.path.join(d, "vocals.flac"), x[: n // 2], SR, subtype="PCM_16")   # truncated
    assert not stems.StemStore(str(tmp_path)).has(f"spotify:{'Q' * 22}")


def test_measure_offset_finds_the_lag_and_residual(store, track):
    res = stems.measure_offset(store.dir_for(TID), track.y)
    assert abs(res["offset_s"] * SR - LAG) < 0.1 * SR / 1000       # within 0.1 ms
    assert res["spread_ms"] <= 0.1 and res["residual_db"] < -40 and res["ok"]


def test_window_aligns_and_folds_the_residual_into_other(tmp_path, store, track):
    s0, s1 = 3.25, 9.5
    i0, i1 = int(round(s0 * SR)), int(round(s1 * SR))
    raw = store.window(TID, None, s0, s1, ["drums"])                # no offset known yet: lags
    assert np.abs(raw["drums"] - track.stems["drums"][i0:i1]).max() > 0.05
    res = store.check(TID, f"/music/{NAME}.mp3", mix=track.y, write=True)
    meta = json.load(open(os.path.join(str(tmp_path), NAME, "meta.json")))
    assert meta["accepted"] is True and abs(meta["offset_s"] - LAG / SR) < 1e-4 and res["ok"]
    w = stems.StemStore(str(tmp_path)).window(TID, None, s0, s1, stems.NAMES, mix=track.y)
    assert set(w) == set(stems.NAMES) and all(v.shape == (i1 - i0, 2) and v.dtype == np.float32 for v in w.values())
    assert np.abs(w["drums"] - track.stems["drums"][i0:i1]).max() < 2 / 32768   # 16-bit FLAC
    total = w["drums"] + w["bass"] + w["vocals"] + w["other"]
    assert np.abs(total - track.y[i0:i1]).max() < 1e-6             # exact sum to the mix
    # without the mix, other.flac is read
    w2 = store.window(TID, None, s0, s1, ["other"])
    assert np.abs(w2["other"] - track.stems["other"][i0:i1]).max() < 2 / 32768


def test_version_tracks_complete_sets(tmp_path, store, track):
    v1 = store.version()
    assert v1 == stems.StemStore(str(tmp_path)).version()
    write_stems(str(tmp_path), f"New - One [sp-{'Q' * 22}]", track)
    assert stems.StemStore(str(tmp_path)).version() != v1


def test_separate_never_runs(tmp_path):
    with pytest.raises(RuntimeError, match="disabled"):
        stems.separate("/music/x.mp3", str(tmp_path))


def test_engine_reads_a_bound_store(tmp_path, store, track):
    """A B edge made of a stem partition (top + bed) read through StemStore is the native mix."""
    store.check(TID, f"/music/{NAME}.mp3", mix=track.y)
    bound = store.bind(TID, None, track.y)
    T, b_end = 4.0, 12.0
    E0 = round(-XF / SR, 6)
    pos = [{"t0": 1.0, "t1": round(T + XF / SR, 6), "kind": "copy", "w0": round(b_end - (T - 1.0) - 5.0, 6)}]

    def mk(cid, st):
        return S.ClipProgram(id=cid, src="b", stems=st, source={"kind": "native", "s0": 5.0, "s1": 13.0},
                             pos=pos, gain_db=[], hp_hz=None, lp_hz=None,
                             eq_db={"low": [], "mid": [], "high": []}, trim_db=0.0, track_gain_from="b")
    A = S.ClipProgram(id="A", src="a", stems="mix", source={"kind": "native", "s0": 1.0, "s1": 6.0},
                      pos=[{"t0": E0, "t1": 1.0, "kind": "copy", "w0": round(1.0 + E0, 6)}], gain_db=[],
                      hp_hz=None, lp_hz=None, eq_db={"low": [], "mid": [], "high": []}, trim_db=0.0,
                      track_gain_from="a")
    expect = {"land_t": 1.0, "vacuums": [], "layered": [], "tonal": [], "ramps": [], "step_planned_lu": None,
              "silences": [], "gestures": [], "seams": [], "onsets": {}}
    prog = S.Program(version="1.0", sr=SR, xf=XF, T=T, t_land=1.0, clock_m=[0.0, 8.0], clock_t=[0.0, T],
                     clips=[A, mk("Bt", ["vocals", "other"]), mk("Bb", ["drums", "bass"])], echoes=[],
                     splices=[], grid=[], events=[], expect=expect)
    out, pa, pb = engine.render_program(prog, track.y, track.y, 1.0, 0.7, None, bound, loud_guard=False)
    ib = int(round(b_end * SR))
    assert np.abs(out[-XF:] - crop(track.y, ib, ib + XF) * 0.7).max() < 1e-6
    i15 = int(round((b_end - T + 1.5) * SR))           # the whole B stretch after its fade-in
    ref = crop(track.y, i15, ib)[: len(pb) - 2 * XF - int(1.5 * SR)] * 0.7
    assert np.abs(pb[XF + int(1.5 * SR): -XF] - ref).max() < 1e-6


def _real_pair():
    if not (os.path.isdir(REAL_STEMS) and os.path.isdir(REAL_MP3)):
        return None
    for name in sorted(os.listdir(REAL_STEMS)):
        d = os.path.join(REAL_STEMS, name)
        mp3 = os.path.join(REAL_MP3, name + ".mp3")
        if os.path.isfile(mp3) and all(os.path.isfile(os.path.join(d, n + ".flac")) for n in stems.NAMES):
            return name, mp3
    return None


@pytest.mark.skipif(_real_pair() is None, reason="real stems or MP3 folder not present")
def test_real_stems_are_aligned_and_readable():
    """Read-only on the live stems folder: the demucs output sits at offset 0 and sums to the
    decoded MP3 once the residual is folded into other."""
    from automix.audio import decode
    name, mp3 = _real_pair()
    st = stems.StemStore(REAL_STEMS)
    tid = stems.tid_of_dir(name)
    assert st.has(tid) and st.has(tid, mp3)
    mix = decode(mp3)
    res = stems.measure_offset(st.dir_for(tid), mix)
    assert abs(res["offset_s"]) * 1000 < 0.1 and res["spread_ms"] <= 0.1 and res["residual_db"] <= -15
    w = st.window(tid, mp3, 60.0, 70.0, stems.NAMES, mix=mix)
    i0, i1 = 60 * SR, 70 * SR
    assert all(v.shape == (i1 - i0, 2) for v in w.values())
    assert np.abs(sum(w.values()) - mix[i0:i1]).max() < 1e-5
    assert not os.path.exists(os.path.join(st.dir_for(tid), "meta.json.tmp"))
