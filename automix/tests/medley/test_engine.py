"""E3 engine (DESIGN §13): Program -> region audio. Region contract R11 (sample-exact native edges),
R2 warps and the WarpCache, loop seams, splices, varispeed gestures, the echo tail rule, stems
(8-channel warp, 4-stem partitions) and render_join. Synthetic audio from fixtures/synth.py."""

import threading

import numpy as np
import pytest

import synth
from automix.medley import CFG, dsp, engine
from automix.medley import schema as S
from automix.render import XF, crop, concat_xf

SR = 44100
E0 = -XF / SR                      # region time of out[0]
NOEQ = {"low": [], "mid": [], "high": []}


def clip(cid, src, source, pos, gain=None, eq=None, hp=None, lp=None, stems="mix", trim=0.0):
    return S.ClipProgram(id=cid, src=src, stems=stems, source=source, pos=pos, gain_db=gain or [],
                         hp_hz=hp, lp_hz=lp, eq_db={**NOEQ, **(eq or {})}, trim_db=trim, track_gain_from=src)


def native(s0, s1):
    return {"kind": "native", "s0": s0, "s1": s1}


def copy(t0, t1, w0):
    return {"t0": t0, "t1": t1, "kind": "copy", "w0": w0}


def program(T, t_land, clips, splices=(), echoes=(), beat=0.5, onsets=None):
    grid = [[round(k * beat, 6), k % 4 == 0, "a"] for k in range(int(T / beat) + 1)]
    expect = {"land_t": t_land, "vacuums": [], "layered": [], "tonal": [], "ramps": [],
              "step_planned_lu": None, "silences": [], "gestures": [], "seams": [], "onsets": onsets or {}}
    p = S.Program(version="1.0", sr=SR, xf=XF, T=T, t_land=t_land, clock_m=[0.0, T / beat],
                  clock_t=[0.0, T], clips=list(clips), echoes=list(echoes), splices=list(splices),
                  grid=grid, events=[], expect=expect)
    assert S.validate_program(p) == []
    return p


def at(t):
    """Output sample index of region time t."""
    return XF + int(round(t * SR))


def click_ratio(y, i):
    from test_dsp import click_ratio as cr
    return cr(y, i)


@pytest.fixture(scope="module")
def tracks():
    A = synth.make_track(120, [("a", 24, {"kick", "hat", "bass", "pad"})], seed=1)
    B = synth.make_track(126, [("b", 24, {"kick", "snare", "hat", "bass", "pad", "vox"})], seed=2)
    return A, B


@pytest.fixture
def r2_calls(monkeypatch):
    calls = []
    real = engine.timemap_stretch

    def spy(y, src, dst, sr=SR):
        calls.append(y.shape)
        return real(y, src, dst, sr)
    monkeypatch.setattr(engine, "timemap_stretch", spy)
    return calls


def edge_program(a_out, b_end, T=10.000013, t_land=8.0, b_in=4.0):
    """A native to the landing (cos out over the last 0.5 s), B native from b_in with its low
    band killed until the landing: the drop_swap skeleton with odd, non-sample-aligned seconds."""
    sa0 = a_out - 1.0
    A = clip("A", "a", native(sa0, a_out + t_land + 0.5), [copy(round(E0, 6), t_land, round(1.0 + E0, 6))],
             gain=[[t_land - 0.5, 0.0, "cos"], [t_land, None, "hold"]])
    sb0 = b_end - T - 0.7
    w_T = b_end - sb0                      # W second at t = T
    B = clip("B", "b", native(sb0, b_end + 0.5),
             [copy(b_in - 0.003, round(T + XF / SR, 6), round(w_T - (T - (b_in - 0.003)), 6))],
             gain=[[b_in, -12.0, "lin"], [t_land, 0.0, "hold"]],
             eq={"low": [[b_in, None, "hold"], [t_land, None, "hold"], [t_land, 0.0, "hold"]]})
    sp = [S.Splice(b_in - 0.003, "B", "edge_in", None, 3.0, 0.0), S.Splice(t_land, "B", "swap", None, 4.0, 0.0)]
    return program(T, t_land, [A, B], sp)


# ---------------------------------------------------------------------------------- region contract
def test_native_edges_are_sample_identical_to_crop(tracks):
    A, B = tracks
    a_out, b_end, ga, gb = 20.123457, 40.777777, 0.8123, 1.337
    prog = edge_program(a_out, b_end)
    out, pa, pb = engine.render_program(prog, A.y, B.y, ga, gb)
    assert out.shape == (int(round(prog.T * SR)) + 2 * XF, 2) and out.dtype == np.float32
    assert np.array_equal(out, pa + pb)
    ia, ib = int(round(a_out * SR)), int(round(b_end * SR))
    assert np.array_equal(out[:XF], crop(A.y, ia - XF, ia) * ga)
    assert np.array_equal(out[-XF:], crop(B.y, ib, ib + XF) * gb)
    # the first bar is A native, bit for bit
    assert np.array_equal(out[: at(1.0)], crop(A.y, ia - XF, ia - XF + at(1.0)) * ga)
    # render_clip-style joins are seamless: pre-roll + region + post-roll
    pre = crop(A.y, ia - 2 * SR, ia) * ga
    post = crop(B.y, ib, ib + 2 * SR + XF) * gb
    y = concat_xf([pre, out, post])
    native_a = crop(A.y, ia - 2 * SR, ia + 1000) * ga
    assert np.abs(y[: 2 * SR + 1000] - native_a[: 2 * SR + 1000]).max() < 1e-6
    tail = y[-(2 * SR + XF) - 1000:]
    native_b = crop(B.y, ib - 1000, ib + 2 * SR + XF) * gb
    assert np.abs(tail - native_b).max() < 1e-6
    # A is silent from the landing on, B before its entry
    assert np.all(pa[at(8.0):] == 0) and np.all(pb[: at(4.0 - 0.003)] == 0)


def test_anchor_pins_edges_to_the_transition_seconds(tracks):
    A, B = tracks
    prog = edge_program(20.123457, 40.777777)
    a2, b2 = 20.123457 + 1 / SR, 40.777777 - 2 / SR      # the plan's own rounding differs slightly
    out, _, _ = engine.render_program(prog, A.y, B.y, 1.0, 1.0, anchor={"a": a2, "b": b2, "T": prog.T})
    ia, ib = int(round(a2 * SR)), int(round(b2 * SR))
    assert np.array_equal(out[:XF], crop(A.y, ia - XF, ia))
    assert np.array_equal(out[-XF:], crop(B.y, ib, ib + XF))
    # an anchor that disagrees with the program by more than 5 ms is ignored
    out2, _, _ = engine.render_program(prog, A.y, B.y, 1.0, 1.0, anchor={"b": 41.0})
    ib = int(round(40.777777 * SR))
    assert np.array_equal(out2[-XF:], crop(B.y, ib, ib + XF))


def test_lane_steps_are_softened_per_splice():
    """A cut-in (gain step) and an EQ kill ramp as raised cosines over [t, t + xf_ms]."""
    ya = np.full((20 * SR, 2), 0.5, np.float32)
    yb = np.full((20 * SR, 2), 0.25, np.float32)
    T, tl = 4.0, 3.0
    A = clip("A", "a", native(5.0, 10.0), [copy(round(E0, 6), tl, round(1.0 + E0, 6))],
             eq={"low": [[1.5, 0.0, "hold"], [1.5, None, "hold"]]})
    B = clip("B", "b", native(5.0, 10.0), [copy(1.0, round(T + XF / SR, 6), 0.5)],
             gain=[[2.0, None, "hold"], [2.0, 0.0, "hold"]])
    sp = [S.Splice(1.5, "A", "eq", None, 10.0, 0.0), S.Splice(2.0, "B", "gain", None, 3.0, 0.0)]
    prog = program(T, tl, [A, B], sp)
    out, pa, pb = engine.render_program(prog, ya, yb, 1.0, 1.0, loud_guard=False)
    i, n = at(2.0), int(round(0.003 * SR))
    assert np.all(pb[at(1.0): i] == 0) and np.all(pb[i + n: -XF] == 0.25)
    assert np.allclose(pb[i: i + n, 0], 0.25 * dsp.raised_cos(n), atol=1e-7)
    j, m = at(1.5), int(round(0.010 * SR))
    assert np.allclose(pa[j - 500: j, 0], 0.5, atol=1e-4)            # DC is all low band
    assert np.allclose(pa[j: j + m, 0], 0.5 * (1 - dsp.raised_cos(m)), atol=2e-4)
    assert np.abs(pa[j + m: at(2.5), 0]).max() < 2e-4


def test_filter_lanes_leave_the_bypassed_part_exact(tracks):
    A, B = tracks
    prog = edge_program(20.123457, 40.777777)
    prog.clips[0].hp_hz = [[0.0, None, "hold"], [2.0, 40.0, "exp"], [7.0, 1000.0, "hold"]]
    out, pa, _ = engine.render_program(prog, A.y, B.y, 1.0, 1.0, loud_guard=False)
    ia = int(round(20.123457 * SR))
    ref = crop(A.y, ia - XF, ia - XF + at(8.0))
    assert np.array_equal(pa[: at(2.0) - 64], ref[: at(2.0) - 64])
    lo_out = dsp.bands3(pa[at(6.5): at(7.5)])[0]
    lo_ref = dsp.bands3(ref[at(6.5): at(7.5)])[0]
    assert 10 * np.log10((lo_out ** 2).mean() / (lo_ref ** 2).mean()) < -20


# ---------------------------------------------------------------------------------- R2 and WarpCache
def onsets_of(y, thr=0.2, quiet=0.02, gap_s=0.1):
    """Click onsets: first sample above thr after >= 10 ms below `quiet`."""
    e = np.abs(y).max(axis=1)
    out, last_loud = [], -10**9
    q = int(0.01 * SR)
    for i in np.nonzero(e > thr)[0]:
        if i - last_loud > gap_s * SR and e[max(0, i - q): i].max() < quiet * 10:
            out.append(i)
        last_loud = i
    return np.array(out)


def test_r2_places_source_beats_on_the_anchors(r2_calls):
    C = synth.click_track(120, bars=8)
    ratio = 1.02
    s0, s1 = 1.5, 14.0                                      # beats of the click track
    src = [s0 + 0.5 * k for k in range(int((s1 - s0) / 0.5) + 1)]
    dst = [(s - s0) * ratio for s in src]
    T = 10.0
    A = clip("A", "a", {"kind": "r2", "s0": s0, "s1": src[-1], "src_anchors": src, "dst_anchors": dst,
                        "w_len": dst[-1]}, [copy(round(E0, 6), round(T + XF / SR, 6), round(0.5 * ratio + E0, 6))])
    prog = program(T, T, [A], beat=0.5 * ratio)
    wc = engine.WarpCache()
    out, pa, pb = engine.render_program(prog, C.y, C.y, 1.0, 1.0, wc=wc, loud_guard=False)
    assert len(r2_calls) == 1 and r2_calls[0][1] == 2
    got = (onsets_of(out) - XF) / SR
    want = np.array([(s - 2.0) * ratio for s in C.onsets["click"] if 2.0 <= s < 2.0 + T / ratio])
    err = np.array([np.min(np.abs(got - w)) for w in want]) * 1000
    assert len(got) == len(want)
    assert np.median(err) <= 3 and err.max() <= 8          # V2b: warped median <= 3 ms, p95 <= 8 ms
    # warm: served from the cache, bit-identical, no Rubber Band process
    out2, _, _ = engine.render_program(prog, C.y, C.y, 1.0, 1.0, wc=wc, loud_guard=False)
    assert len(r2_calls) == 1 and np.array_equal(out, out2) and wc.hits == 1


def test_b_is_never_warped():
    C = synth.click_track(120, bars=2)
    Bc = clip("B", "b", {"kind": "r2", "s0": 0.5, "s1": 2.5, "src_anchors": [0.5, 2.5], "dst_anchors": [0, 2.0],
                         "w_len": 2.0}, [copy(0.0, 1.0, 0.0)])
    with pytest.raises(ValueError, match="never warped"):
        engine.render_program(program(1.0, 0.5, [Bc]), C.y, C.y, 1.0, 1.0)


def test_warp_cache_lru_and_single_flight():
    wc = engine.WarpCache(max_bytes=3 * 4000)
    for k in range(4):
        wc.put(f"k{k}", np.zeros(1000, np.float32))
    assert len(wc) == 3 and "k0" not in wc and wc.nbytes == 12000
    assert wc.get("k1") is not None and not wc.get("k1").flags.writeable
    wc.put("k4", np.zeros(1000, np.float32))               # k2 is now the least recent
    assert "k2" not in wc and "k1" in wc
    n = []
    ev = threading.Event()

    def slow():
        n.append(1)
        ev.wait(1.0)
        return np.ones(10, np.float32)
    ths = [threading.Thread(target=lambda: wc.get_or_compute("x", slow)) for _ in range(4)]
    for t in ths:
        t.start()
    ev.set()
    for t in ths:
        t.join()
    assert len(n) == 1 and np.array_equal(wc.get("x"), np.ones(10))


def test_fixture_program_renders_with_exact_b_edge(program, r2_calls):
    """The §8.10 drop_swap Program (warped A with a ramp, pulsed B lead, low swap) on synthetic
    tracks long enough for its source windows."""
    A = synth.make_track(127.02, [("x", 44, {"kick", "hat", "bass", "pad"})], seed=3)
    B = synth.make_track(125.99, [("x", 84, {"kick", "snare", "hat", "bass", "pad", "vox"})], seed=4)
    wc = engine.WarpCache()
    anchor = {"a": 62.913724, "b": 154.584917, "T": 15.208369}
    out, pa, pb = engine.render_program(program, A.y, B.y, 0.9, 1.1, wc=wc, anchor=anchor)
    # the Program's JSON form renders identically (E4 may keep programs as JSON)
    as_json = S.from_json(S.to_json(program))
    assert np.array_equal(engine.render_program(as_json, A.y, B.y, 0.9, 1.1, wc=wc, anchor=anchor)[0], out)
    assert out.shape == (int(round(15.208369 * SR)) + 2 * XF, 2)
    ib = int(round(154.584917 * SR))
    assert np.array_equal(out[-XF:], crop(B.y, ib, ib + XF) * 1.1)
    tl = at(program.t_land)
    assert np.all(pa[tl:] == 0)                              # A's cos fade ends at the landing
    assert np.all(pb[: at(5.680804)] == 0) and np.abs(pb[at(5.7): tl]).max() > 0
    assert len(r2_calls) == 1
    # R2 is not sample-coherent, so warped A is judged like V2b: A's kicks (alone before B
    # enters) land where the anchor map puts them, median <= 3 ms, max <= 8 ms
    a = program.clips[0]
    seg = a.pos[0]
    want = [seg["t0"] + np.interp(s, a.source["src_anchors"], a.source["dst_anchors"]) - seg["w0"]
            for s in A.onsets["kick"]]
    want = np.array([t for t in want if 0.05 < t < 5.6])
    got = dsp.rise_onsets(pa) - XF / SR
    err = np.array([np.min(np.abs(got - w)) for w in want]) * 1000
    assert len(want) >= 10 and np.median(err) <= 3 and err.max() <= 8


# ---------------------------------------------------------------------------------- loops and splices
def loop_program(xf_ms=3.0, search_ms=1.5, repeats=6):
    """A plays 1 beat, then loops the beat at 3.0 s (from 3 ms before its onset) `repeats` times,
    then fades out into B at the landing."""
    s0 = 1.0
    t_s = 1.0
    w_loop = round(3.0 - 0.003 - s0, 6)
    pos = [copy(round(E0, 6), t_s, round(2.0 + E0 - s0, 6))]
    seams = []
    for k in range(repeats):
        t0 = t_s + 0.5 * k
        pos.append(copy(t0, t0 + 0.5, w_loop))
        seams.append(t0)
    t_end = t_s + 0.5 * repeats
    tl = t_end + 0.5
    pos.append(copy(t_end, tl, round(w_loop + 0.5, 6)))
    A = clip("A", "a", native(s0, 12.0), pos, gain=[[t_end, 0.0, "cos"], [tl, None, "hold"]])
    T = tl + 1.0
    B = clip("B", "b", native(5.0, 12.0), [copy(tl - 0.003, round(T + XF / SR, 6), 0.997)])
    sp = [S.Splice(t, "A", "pos", None, xf_ms, search_ms) for t in seams]
    return program(T, tl, [A, B], sp), seams


def test_loop_repeats_are_bit_identical_and_seams_clean():
    P = synth.make_track(120, [("p", 8, {"pad"})], seed=5)        # sustained chords: every seam jumps
    P.y[:] += (0.0003 * np.random.default_rng(0).standard_normal(P.y.shape)).astype(np.float32)
    prog, seams = loop_program()
    out, pa, _ = engine.render_program(prog, P.y, P.y, 1.0, 1.0, loud_guard=False)
    L, nx = int(0.5 * SR), int(round(0.003 * SR))
    bodies = [pa[at(t) + nx: at(t) + L] for t in seams[1:]]
    for b in bodies[1:]:
        assert np.array_equal(b, bodies[0])
    for t in seams:
        assert click_ratio(pa, at(t)) < 2
    # the loop body is the source beat at 3.0 s (moved by at most the search, 1.5 ms)
    src = crop(P.y, int(round(2.997 * SR)) - 200, int(round(2.997 * SR)) + L + 200)
    body = pa[at(seams[2]) + nx: at(seams[2]) + L - 200, 0]
    lag = [np.abs(src[200 + d + nx: 200 + d + nx + len(body), 0] - body).max() for d in range(-66, 67)]
    assert min(lag) == 0
    # control: the same seams hard-spliced (no fade, no search) click
    hard, _ = loop_program(xf_ms=0.02, search_ms=0.0)
    _, pa_h, _ = engine.render_program(hard, P.y, P.y, 1.0, 1.0, loud_guard=False)
    assert max(click_ratio(pa_h, at(t)) for t in seams) > 4


# ---------------------------------------------------------------------------------- varispeed gestures
OFF = 6 * SR                         # ramp origin at the gesture: float32 keeps ~0.003-sample precision


def ramp_track(seconds):
    n = int(seconds * SR)
    y = np.zeros((n, 2), np.float32)
    y[:, 0] = (np.arange(n) - OFF).astype(np.float32) / 2 ** 20   # reading it returns the position
    y[:, 1] = 0.3 * np.sin(np.arange(n) * 2 * np.pi * 330 / SR)
    return y


def gesture_program(rate_fn, t_g, t_end, T, laws=False, beat=0.5):
    """A native at rate 1 until t_g, then a vary segment following rate_fn(x beats) until t_end."""
    s0, s_g = 4.0, 6.0                                         # A plays track second s_g at t_g
    step = CFG["compile"]["vary_step_s"]
    tk = np.arange(int(round((t_end - t_g) / step)) + 1) * step
    fine = np.linspace(0, t_end - t_g, 20 * len(tk))
    r = rate_fn(fine / beat)
    w_f = np.concatenate([[0.0], np.cumsum((r[1:] + r[:-1]) / 2 * np.diff(fine))])
    w = (s_g - s0) + np.interp(tk, fine, w_f)
    pos = [copy(round(E0, 6), t_g, round(s_g - s0 - t_g + E0, 6)),
           {"t0": t_g, "t1": t_end, "kind": "vary", "w": [round(v, 9) for v in w]}]
    gain = lp = None
    if laws:
        g_db, lp_hz = dsp.vinyl_laws(rate_fn(tk / beat))
        gain = [[t_g + x, None if not np.isfinite(g) else float(g), "lin"] for x, g in zip(tk, g_db)]
        lp = [[t_g + x, float(f), "exp"] for x, f in zip(tk, lp_hz)]
    A = clip("A", "a", native(s0, 20.0), pos, gain=gain, lp=lp)
    true = (fine + t_g, (s0 + (s_g - s0) + w_f) * SR)               # exact curve (track samples)
    return program(T, T - 0.5, [A]), true


def tape_stop_rate(L=2.0, k=1.5):
    return lambda x: np.clip(1 - x / L, 0, None) ** k


def backspin_rate(push=0.125, peak=-3.5, tau=0.35, end=0.75):
    def r(x):
        x = np.asarray(x, float)
        up = peak + (1 - peak) * (1 + np.cos(np.pi * np.minimum(x, push) / push)) / 2
        dec = peak * np.exp(-(x - push) / tau) * np.clip(1 - (x - push) / (end - push), 0, 1) ** 2
        return np.where(x < push, up, np.where(x < end, dec, 0.0))
    return r


def recovered(pa):
    return pa[:, 0].astype(float) * 2 ** 20 + OFF


def test_tape_stop_rate_reaches_zero_on_time():
    y = ramp_track(30)
    t_g, beat, L = 2.0, 0.5, 2.0
    stop = t_g + L * beat
    prog, (tt, ss) = gesture_program(tape_stop_rate(L), t_g, stop + 0.5, stop + 1.0)
    out, pa, _ = engine.render_program(prog, y, y, 1.0, 1.0, loud_guard=False)
    p = recovered(pa)
    i_g, i_s = at(t_g), at(stop)
    rate = np.diff(p)
    assert abs(p[i_g] - p[i_g - 1] - 1.0) < 0.01                  # continuous into the gesture
    assert np.all(np.abs(rate[i_g - 1000: i_g - 1] - 1.0) < 1e-6)
    j = at(stop - 0.1)
    assert (p[j + 100] - p[j]) / 100 > 0.02                      # still moving 0.1 s before
    assert np.all(np.abs(rate[i_s: at(stop + 0.45)]) < 1e-3)     # stopped at the stop time
    want = np.interp((np.arange(i_g, at(stop + 0.45)) - XF) / SR, tt, ss)
    assert np.abs(p[i_g: at(stop + 0.45)] - want).max() < 0.1
    # with the compiler's vinyl laws: silent once the rate is 0
    prog2, _ = gesture_program(tape_stop_rate(L), t_g, stop + 0.5, stop + 1.0, laws=True)
    _, pa2, _ = engine.render_program(prog2, y, y, 1.0, 1.0, loud_guard=False)
    assert np.all(pa2[i_s + 2: at(stop + 0.45)] == 0)
    assert np.abs(pa2[at(t_g + 0.1): at(t_g + 0.3), 1]).max() > 0.1


def test_backspin_follows_its_rate_curve_through_the_sinc_path():
    y = ramp_track(30)
    t_g, beat = 3.0, 0.5
    end = t_g + 0.75 * beat
    prog, (tt, ss) = gesture_program(backspin_rate(), t_g, end + 0.25, end + 1.0)
    out, pa, _ = engine.render_program(prog, y, y, 1.0, 1.0, loud_guard=False)
    p = recovered(pa)
    rate = np.diff(p)
    assert rate[at(t_g + 0.125 * beat) + 20] < -3.0             # reverse at the peak rate
    assert np.all(np.abs(rate[at(end): at(end + 0.2)]) < 1e-3)  # forced to 0 by end_by
    want = np.interp((np.arange(at(t_g), at(end + 0.2)) - XF) / SR, tt, ss)
    assert np.abs(p[at(t_g): at(end + 0.2)] - want).max() < 0.5    # PCHIP of 1 ms + sinc reads


# ---------------------------------------------------------------------------------- echo
def test_echo_obeys_the_tail_rule_ducks_and_ends_by_T():
    C = synth.click_track(120, bars=6)
    pad = synth.make_track(120, [("p", 6, {"pad"})], seed=7)
    T, tl = 6.0, 4.0                    # grid beat 0.5 s: B's second beat is 4.5
    # A plays the click track with t = source - 1.0; clicks at t = 0, 0.5, ...; dry cut at 3.75
    A = clip("A", "a", native(0.5, 8.0), [copy(round(E0, 6), 3.75, round(0.5 + E0, 6))],
             gain=[[3.75, 0.0, "hold"], [3.75, None, "hold"]])
    B = clip("B", "b", native(2.0, 12.0), [copy(tl - 0.003, round(T + XF / SR, 6), 1.997)])
    e = S.EchoProgram(clip="A", capture=(3.49, 3.75), delay_s=0.375, fb=0.9, tail_s=4.0,
                      hp_hz=[[0.0, 20.0, "hold"]], lp_hz=None, send_db=-4.0,
                      duck={"key": "B", "depth_db": 6.0, "release_s": 0.125}, part="a")
    ons = {"B": [[4.0 + 0.5 * k, 100.0] for k in range(5)]}
    prog = program(T, tl, [A, B], [S.Splice(3.75, "A", "gain", None, 5.0, 0.0)], [e], onsets=ons)
    out, pa, pb = engine.render_program(prog, C.y, pad.y, 1.0, 1.0, loud_guard=False)

    def peak(t, w=0.004):
        return float(np.abs(pa[at(t) - 20: at(t + w)]).max())
    dry = peak(3.5)
    fb = dsp.tail_rule_fb(0.375, -4.0, 4.5 - 3.75)
    assert fb < CFG["echo_fb_max"]
    r1, r2, r3, r4 = (peak(3.5 + 0.375 * k) for k in (1, 2, 3, 4))
    assert abs(r1 / dry - 10 ** (-4 / 20)) < 0.03                # first repeat at the send level
    assert 0.75 * fb < r2 / r1 <= 1.001 * fb                      # x fb, minus the 1 kHz loop HP
    assert 20 * np.log10(r3 / dry) <= CFG["tail_floor_db"] + 0.5  # ~-20 dB by B's second beat
    assert r4 / r3 < 0.6 * fb                                     # ducked by B's onset at 5.0
    assert np.all(pa[at(T):] == 0)                                # the tail is gone by T
    ib = int(round((1.997 + 2.0 + (T - (tl - 0.003))) * SR))
    assert np.array_equal(out[-XF:], crop(pad.y, ib, ib + XF))


# ---------------------------------------------------------------------------------- stems
def test_stem_clips_share_one_8ch_warp_and_partition_the_mix(r2_calls):
    A = synth.make_track(120, [("a", 12, {"kick", "hat", "bass", "pad", "vox"})], seed=8)
    B = synth.make_track(124, [("b", 12, {"kick", "hat", "bass", "pad", "vox"})], seed=9)
    s0, s1 = 1.5, 12.0
    src = [s0 + 0.5 * k for k in range(int((s1 - s0) / 0.5) + 1)]
    dst = [(s - s0) * 1.01 for s in src]
    r2 = {"kind": "r2", "s0": s0, "s1": src[-1], "src_anchors": src, "dst_anchors": dst, "w_len": dst[-1]}
    T, tl = 8.0, 6.0
    posA = [copy(round(E0, 6), tl, round(0.5 * 1.01 + E0, 6))]
    gA = [[tl - 0.5, 0.0, "cos"], [tl, None, "hold"]]
    top_a = clip("At", "a", r2, posA, gain=gA, stems=["vocals", "other"])
    bed_a = clip("Ab", "a", r2, posA, gain=gA, stems=["drums", "bass"])
    b_end = 16.0
    posB = [copy(tl - 0.003, round(T + XF / SR, 6), round(b_end - (T - (tl - 0.003)) - 8.0, 6))]
    top_b = clip("Bt", "b", native(8.0, 17.0), posB, stems=["vocals", "other"])
    bed_b = clip("Bb", "b", native(8.0, 17.0), posB, stems=["drums", "bass"])
    prog = program(T, tl, [top_a, bed_a, top_b, bed_b])
    stems_a = {n: A.stems[n] for n in ("drums", "bass", "vocals")}
    out, pa, pb = engine.render_program(prog, A.y, B.y, 1.0, 1.2, stems_a, B.stems, loud_guard=False)
    assert r2_calls == [(int(round(src[-1] * SR)) - int(round(s0 * SR)), 8)]
    ib = int(round(b_end * SR))
    assert np.abs(out[-XF:] - crop(B.y, ib, ib + XF) * 1.2).max() < 1e-6
    with pytest.raises(ValueError, match="needs stems"):
        engine.render_program(prog, A.y, B.y, 1.0, 1.0, None, B.stems)


# ---------------------------------------------------------------------------------- loudness guard
def test_loudness_guard_trims_a_hot_overlap_and_keeps_edges():
    rng = np.random.default_rng(11)
    ya = (0.1 * rng.standard_normal((30 * SR, 2))).astype(np.float32)
    yb = (0.1 * rng.standard_normal((30 * SR, 2))).astype(np.float32)
    T, tl = 12.0, 9.0
    A = clip("A", "a", native(5.0, 20.0), [copy(round(E0, 6), tl, round(5.0 + E0, 6))],
             gain=[[tl - 0.25, 0.0, "cos"], [tl, None, "hold"]])
    B = clip("B", "b", native(2.0, 20.0), [copy(2.0, round(T + XF / SR, 6), 1.0)])
    prog = program(T, tl, [A, B])
    raw, _, _ = engine.render_program(prog, ya, yb, 1.0, 1.0, loud_guard=False)
    out, pa, pb = engine.render_program(prog, ya, yb, 1.0, 1.0)
    g = out[at(5.5): at(6.5)].std() / raw[at(5.5): at(6.5)].std()
    assert -3.05 <= 20 * np.log10(g) <= -1.0                      # +3 LU overlap, trimmed <= 3 dB
    assert np.array_equal(out[: at(2.0)], raw[: at(2.0)])          # first bar untouched
    assert np.array_equal(out[-at(0.0):], raw[-at(0.0):])


# ---------------------------------------------------------------------------------- render_join
def test_render_join_compiles_renders_and_fills_the_sink(monkeypatch, program, plan):
    from automix.render import track_gain
    seen = {}

    def fake_compile(comp, fa, fb, sr):
        seen["args"] = (comp["id"], fa, fb, sr)
        return program
    monkeypatch.setattr(engine, "_compile", fake_compile)
    A = synth.make_track(127.02, [("x", 44, {"kick", "hat", "bass", "pad"})], seed=3)
    B = synth.make_track(125.99, [("x", 84, {"kick", "hat", "bass", "pad"})], seed=4)
    tr = plan["transitions"][0]
    a = {"id": tr["a"], "path": "/nonexistent/a.mp3", "lufs": -8.0}
    b = {"id": tr["b"], "path": "/nonexistent/b.mp3", "lufs": -10.0}
    p = {"target_lufs": -9.0}
    sink = {}
    wc = engine.WarpCache()
    res = engine.render_join(A.y, B.y, a, b, tr, p, parts=True, warp_cache=wc, sink=sink)
    assert seen["args"] == ("j01", None, None, SR)
    out, pa, pb = res
    assert set(sink) == {"prog", "out", "pa", "pb", "clips"} and set(sink["clips"]) == {"A", "B"}
    assert sink["out"] is out and np.array_equal(out, pa + pb)
    ib = int(round(tr["b_in_end"] * SR))
    assert np.array_equal(out[-XF:], crop(B.y, ib, ib + XF) * track_gain(b, p))
    only = engine.render_join(A.y, B.y, a, b, tr, p, warp_cache=wc)
    assert isinstance(only, np.ndarray) and np.array_equal(only, out)
