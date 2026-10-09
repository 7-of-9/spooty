"""Render transition regions, preview clips and the full mix.

Every join between native audio and a processed region overlaps by XF samples
with a linear crossfade, so stretched/filtered audio never clicks against the
untouched track.
"""

from __future__ import annotations

import io
import subprocess

import numpy as np
import soundfile as sf

from .audio import (FFMPEG, SR, echo_tail, fade_curve, highpass, limiter, split_bands,
                    timemap_stretch)

XF = int(0.015 * SR)
PAD = 0.5


def track_gain(t: dict, p: dict) -> float:
    lufs = t.get("lufs")
    if lufs is None or not np.isfinite(lufs):
        return 1.0
    return float(np.clip(10 ** ((p["target_lufs"] - lufs) / 20), 0.1, 4.0))


def crop(y: np.ndarray, start: int, end: int) -> np.ndarray:
    """y[start:end] with zero padding outside the array."""
    n = end - start
    out = np.zeros((max(n, 0), 2), dtype=np.float32)
    s0, e0 = max(start, 0), min(end, len(y))
    if e0 > s0:
        out[s0 - start: e0 - start] = y[s0:e0]
    return out


def _s(t: float) -> int:
    return int(round(t * SR))


def _stretched(y: np.ndarray, anchors_src: list[float], anchors_dst: list[float],
               lead: float, trail: float, f_start: float, f_end: float, T: float) -> np.ndarray:
    """Stretch the anchored span of y plus PAD of context each side; return
    output covering [-lead, T + trail] seconds relative to the first anchor."""
    s0 = max(0.0, anchors_src[0] - PAD)
    s1 = min(len(y) / SR, anchors_src[-1] + PAD)
    pre, post = anchors_src[0] - s0, s1 - anchors_src[-1]
    dpre = pre * f_start
    src = [0.0] + [a - s0 for a in anchors_src] + [s1 - s0]
    dst = [0.0] + [dpre + t for t in anchors_dst] + [dpre + T + post * f_end]
    # drop duplicate zero-length pads
    pts = [(s, d) for i, (s, d) in enumerate(zip(src, dst)) if i == 0 or s > src[i - 1] + 1e-6]
    src, dst = [p[0] for p in pts], [p[1] for p in pts]
    seg = y[_s(s0): _s(s1)]
    out = timemap_stretch(seg, src, dst)
    return crop(out, _s(dpre - lead), _s(dpre - lead) + XF + _s(T) + XF)


def _envelopes(n: int, style: str, p: dict, spec: dict) -> dict[str, np.ndarray]:
    """Gain curves over the core region (without lead/trail)."""
    curve = p["fade_curve"]
    if style == "bassswap":
        # the handover (swap_at) is where A and B trade places: B's highs fade in over the
        # stretch before it, A's highs fade out over the stretch after it, the bass swaps
        # at it. 0.5 = the classic symmetric swap; 0.9 = B stays out until late.
        h = min(max(spec["swap_at"], 0.05), 0.95)
        sw = int(n * h)
        i0 = int(n * (h - min(h, 0.5)))
        i2 = int(n * min(1.0, h + min(1.0 - h, 0.5)))
        beat = spec.get("beat_len", 0.5)
        swap_len = max(1, min(int(beat * SR), n - sw))
        a_hi = np.ones(n, np.float32)
        a_hi[sw:i2] = fade_curve(i2 - sw, curve, rising=False)
        a_hi[i2:] = 0.0
        b_hi = np.zeros(n, np.float32)
        b_hi[i0:sw] = fade_curve(sw - i0, curve, rising=True)
        b_hi[sw:] = 1.0
        a_lo = np.zeros(n, np.float32)
        a_lo[:sw] = 1
        a_lo[sw: sw + swap_len] = np.linspace(1, 0, swap_len)
        b_lo = 1 - a_lo
        return {"a_hi": a_hi, "a_lo": a_lo, "b_hi": b_hi, "b_lo": b_lo}
    if style == "cut":
        down = np.linspace(1, 0, n, dtype=np.float32)
        return {"a": down, "b": 1 - down}
    h = float(spec.get("handover", 0.5))
    return {"a": fade_curve(n, curve, rising=False, handover=h),
            "b": fade_curve(n, curve, rising=True, handover=h)}


def render_region(ya: np.ndarray, yb: np.ndarray, a: dict, b: dict, spec: dict, p: dict,
                  parts: bool = False):
    """Audio for output time [-XF, T + XF] around the transition (gains applied).
    With parts=True also returns the A and B contributions (out = a_part + b_part)."""
    ga, gb = track_gain(a, p), track_gain(b, p)
    T = spec["T"]
    n = _s(T)
    lead = XF / SR
    style = spec["style"]

    T_o = spec.get("T_overlap", T)
    n_o = _s(T_o)
    if spec.get("beatmatch"):
        an = spec["anchors"]
        ta, tb, tt = an["a"], an["b"], an["t"]
        tt_a = tt[: len(ta)]                       # A exists only during the overlap
        f_a_end = (tt_a[-1] - tt_a[-2]) / max(ta[-1] - ta[-2], 1e-6)
        f_b_start = (tt[1] - tt[0]) / max(tb[1] - tb[0], 1e-6)
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as ex:   # two rubberband processes at once
            fa = ex.submit(_stretched, ya, ta, tt_a, lead, lead, 1.0, f_a_end, T_o)
            fb = ex.submit(_stretched, yb, tb, tt, lead, lead, f_b_start, 1.0, T)
            sa, sb = fa.result() * ga, fb.result() * gb
        spec = {**spec, "beat_len": T_o / max(len(ta) - 1, 1)}
    elif style == "echo":
        sa = crop(ya, _s(spec["a_out_start"]) - XF, _s(spec["a_out_start"]) + n + XF) * ga
        sb = crop(yb, _s(spec["b_in_start"]) - XF, _s(spec["b_in_start"]) + n + XF) * gb
    else:
        sa = crop(ya, _s(spec["a_out_start"]) - XF, _s(spec["a_out_start"]) + n + XF) * ga
        sb = crop(yb, _s(spec["b_in_start"]) - XF, _s(spec["b_in_start"]) + n + XF) * gb

    total = n + 2 * XF
    sa, sb = sa[:total], sb[:total]
    if len(sa) < total:
        sa = np.pad(sa, ((0, total - len(sa)), (0, 0)))
    if len(sb) < total:
        sb = np.pad(sb, ((0, total - len(sb)), (0, 0)))
    pa = np.zeros((total, 2), np.float32)       # what A contributes after fades / EQ / echo
    pb = np.zeros((total, 2), np.float32)       # what B contributes

    def done():
        out = pa + pb
        return (out, pa, pb) if parts else out

    if style == "echo":
        d = max(1, _s(spec.get("echo_delay", 0.375)))
        src = crop(ya, _s(spec["a_out_start"]) - d, _s(spec["a_out_start"])) * ga
        wet = echo_tail(src, d / SR, float(p["echo_feedback"]), T + lead)[d: d + n + XF]
        wet = highpass(wet, 160.0)
        env = np.linspace(1, 0, len(wet), dtype=np.float32) ** 1.2
        fa_n = min(_s(spec.get("echo_fade", 1.0)), total - XF)   # fader throw, not a gate
        env_a = np.zeros(total, np.float32)
        env_a[:XF] = 1
        if fa_n > 0:
            env_a[XF: XF + fa_n] = fade_curve(fa_n, "s_curve", rising=False)
        pa += sa * env_a[:, None]
        pa[XF: XF + len(wet)] += wet * env[:, None] * 0.9
        bin_ = np.ones(total, np.float32)
        bin_[:XF] = 0
        ramp = min(_s(0.02), n)
        bin_[XF: XF + ramp] = np.linspace(0, 1, ramp)
        pb += sb * bin_[:, None]
        return done()

    env = _envelopes(n_o, style, p, spec)
    if n > n_o:   # glide zone after the overlap: A is gone, B at full level
        for key in list(env):
            fill = 0.0 if key.startswith("a") else 1.0
            env[key] = np.concatenate([env[key], np.full(n - n_o, fill, np.float32)])
    core = slice(XF, XF + n)
    if "a_hi" in env:
        lo_a, hi_a = split_bands(sa, p["crossover_hz"])
        lo_b, hi_b = split_bands(sb, p["crossover_hz"])
        pa[:XF] = sa[:XF]
        pa[core] = lo_a[core] * env["a_lo"][:, None] + hi_a[core] * env["a_hi"][:, None]
        pb[core] = lo_b[core] * env["b_lo"][:, None] + hi_b[core] * env["b_hi"][:, None]
        pb[XF + n:] = sb[XF + n:]
    else:
        pa[:XF] = sa[:XF]
        pa[core] = sa[core] * env["a"][:, None]
        pb[core] = sb[core] * env["b"][:, None]
        pb[XF + n:] = sb[XF + n:]
    return done()


def concat_xf(chunks: list[np.ndarray]) -> np.ndarray:
    """Concatenate chunks that each overlap the previous one by XF samples."""
    ramp = np.linspace(0, 1, XF, dtype=np.float32)[:, None]
    out = [chunks[0]]
    for c in chunks[1:]:
        prev = out[-1]
        if len(prev) < XF or len(c) < XF:
            out.append(c)
            continue
        joined = prev[-XF:] * (1 - ramp) + c[:XF] * ramp
        out[-1] = prev[:-XF]
        out.append(joined)
        out.append(c[XF:])
    return np.concatenate(out) if out else np.zeros((0, 2), np.float32)


def render_clip(cache, order_tracks: list[dict], plan: dict, i: int, p: dict) -> tuple[bytes, dict]:
    """Preview WAV of transition i with pre/post-roll; returns (wav bytes, markers)."""
    tr = plan["transitions"][i]
    a, b = order_tracks[i], order_tracks[i + 1]
    ya, yb = cache.get(a["path"]), cache.get(b["path"])
    body_a_start = plan["native_starts"][i]
    pre_start = max(body_a_start, tr["a_out_start"] - p["preroll_s"])
    pre = crop(ya, _s(pre_start), _s(tr["a_out_start"])) * track_gain(a, p)
    region, part_a, part_b = render_region(ya, yb, a, b, tr, p, parts=True)
    b_end = (plan["transitions"][i + 1]["a_out_start"] if i + 1 < len(plan["transitions"])
             else b["duration"])
    post_end = min(b_end, tr["b_in_end"] + p["postroll_s"])
    post = crop(yb, _s(tr["b_in_end"]), _s(max(post_end, tr["b_in_end"])) + XF) * track_gain(b, p)
    y = limiter(concat_xf([pre, region, post]), p["ceiling_db"])
    buf = io.BytesIO()
    sf.write(buf, y, SR, format="WAV", subtype="PCM_16")
    o_start = (len(pre) - XF) / SR
    markers = {"overlap_start": o_start, "overlap_end": o_start + tr.get("T_overlap", tr["T"]),
               "glide_end": o_start + tr["T"],
               "duration": len(y) / SR, "a_native_at_start": pre_start,
               "b_native_at_end": post_end}
    markers.update(_mix_profile(len(y), pre, part_a, part_b, post))
    markers.update(_clip_beats(a, b, tr, pre_start, post_end, o_start))
    return buf.getvalue(), markers


def _mix_profile(total: int, pre, part_a, part_b, post, bins: int = 600) -> dict:
    """Per-bin share of B in what you hear (0 = all A, 1 = all B), aligned with the
    page's 600 waveform bins. Uses the post-fade/EQ contributions, before the limiter."""
    ea = np.zeros(total, np.float64)
    eb = np.zeros(total, np.float64)
    p0 = len(pre)
    ea[:min(p0, total)] += (pre.mean(axis=1) ** 2)[:total]
    r0 = p0 - XF
    ra = (part_a.mean(axis=1) ** 2)[: max(0, total - r0)]
    rb = (part_b.mean(axis=1) ** 2)[: max(0, total - r0)]
    ea[r0: r0 + len(ra)] += ra
    eb[r0: r0 + len(rb)] += rb
    q0 = r0 + len(part_a) - XF
    pq = (post.mean(axis=1) ** 2)[: max(0, total - q0)]
    eb[q0: q0 + len(pq)] += pq
    step = max(1, total // bins)
    n = min(bins, total // step)
    A = np.sqrt(ea[: n * step].reshape(n, step).mean(axis=1))
    B = np.sqrt(eb[: n * step].reshape(n, step).mean(axis=1))
    share = np.where(A + B > 1e-4, B / np.maximum(A + B, 1e-9), np.nan)
    return {"mix": [None if np.isnan(v) else round(float(v), 2) for v in share]}


def _clip_beats(a: dict, b: dict, tr: dict, pre_start: float, post_end: float, o_start: float) -> dict:
    """Beat ticks in clip seconds: A's native beats before/through the overlap, B's through
    and after it; a single shared grid where the overlap is beatmatched. [t, is_downbeat]."""
    def ticks(track, t0, t1, offset):
        downs = np.asarray(track.get("downbeats") or [])
        out = []
        for bt in track.get("beats") or []:
            if t0 <= bt <= t1:
                is_down = bool(len(downs)) and float(np.min(np.abs(downs - bt))) < 0.03
                out.append([round(bt - t0 + offset, 3), is_down])
        return out
    T, T_o = tr["T"], tr.get("T_overlap", tr["T"])
    beats_a = ticks(a, pre_start, tr["a_out_start"], 0.0)
    beats_b = ticks(b, tr["b_in_end"], post_end, o_start + T)
    grid = []
    if tr.get("beatmatch") and tr.get("anchors"):
        bpb = int(a.get("beats_per_bar") or 4)
        units_o = len(tr["anchors"]["a"]) - 1
        for j, t in enumerate(tr["anchors"]["t"]):
            grid.append([round(o_start + t, 3), j % bpb == 0, "both" if j <= units_o else "b"])
    else:
        if tr["style"] != "echo":            # A keeps playing (fading) through the overlap
            beats_a += ticks(a, tr["a_out_start"], tr["a_out_start"] + T_o, o_start)
        beats_b = ticks(b, tr["b_in_start"], tr["b_in_start"] + T, o_start) + beats_b
    return {"beats_a": beats_a, "beats_b": beats_b, "grid": grid}


def render_full(cache, order_tracks: list[dict], plan: dict, p: dict, out_path: str,
                meta_path: str, log=print) -> None:
    """Stream the whole mix into ffmpeg (MP3 + chapters) without holding it in memory."""
    trs = plan["transitions"]
    starts = plan["native_starts"]
    proc = subprocess.Popen(
        [FFMPEG, "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2",
         "-i", "pipe:0", "-i", meta_path, "-map_metadata", "1", "-map_chapters", "1",
         "-map", "0:a", "-codec:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "3", out_path],
        stdin=subprocess.PIPE,
    )
    ramp = np.linspace(0, 1, XF, dtype=np.float32)[:, None]
    carry = None

    def emit(chunk: np.ndarray, overlaps: bool) -> None:
        nonlocal carry
        chunk = limiter(chunk, p["ceiling_db"])
        if carry is not None and overlaps and len(chunk) >= XF:
            chunk = chunk.copy()
            chunk[:XF] = carry * (1 - ramp) + chunk[:XF] * ramp
        elif carry is not None:
            proc.stdin.write(carry.astype(np.float32).tobytes())
        if len(chunk) >= XF:
            proc.stdin.write(chunk[:-XF].astype(np.float32).tobytes())
            carry = chunk[-XF:]
        else:
            proc.stdin.write(chunk.astype(np.float32).tobytes())
            carry = None

    try:
        for i, t in enumerate(order_tracks):
            y = cache.get(t["path"])
            end = trs[i]["a_out_start"] if i < len(trs) else t["duration"]
            body = crop(y, _s(starts[i]), _s(max(end, starts[i] + 2 * XF / SR)))
            body *= track_gain(t, p)
            if plan.get("durationMode") == "total":
                # Excerpts may begin/end mid-waveform. Ten-millisecond edge ramps
                # avoid clicks without adding, dropping or retiming any samples.
                edge = min(_s(.01), len(body))
                if i == 0:
                    body[:edge] *= np.linspace(0, 1, edge, dtype=np.float32)[:, None]
                if i == len(order_tracks) - 1:
                    body[-edge:] *= np.linspace(1, 0, edge, dtype=np.float32)[:, None]
            emit(body, overlaps=i > 0)
            if i < len(trs):
                yb = cache.get(order_tracks[i + 1]["path"])
                emit(render_region(y, yb, t, order_tracks[i + 1], trs[i], p), overlaps=True)
            log(f"[{i + 1}/{len(order_tracks)}] {t['artist']} - {t['title']}")
        if carry is not None:
            proc.stdin.write(carry.astype(np.float32).tobytes())
    finally:
        proc.stdin.close()
        rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"ffmpeg exited {rc}")


def transition_envelope(cache, a: dict, b: dict, tr: dict, p: dict, span: float = 62.0,
                        bin_s: float = 0.05) -> dict:
    """Ingredients for the page's live preview while a slider is dragged: per-bin peak
    levels of A before its out point and B after its in point, split into bass and highs
    at the crossover (so a bass swap previews correctly), plus both tracks' beats."""
    ya, yb = cache.get(a["path"]), cache.get(b["path"])
    ga, gb = track_gain(a, p), track_gain(b, p)
    pre, post = float(p["preroll_s"]), float(p["postroll_s"])
    a_end = tr["a_out_start"] if tr["style"] == "echo" else tr["a_out_end"]
    a0 = max(0.0, a_end - span - pre - 1.0)
    a1 = min(a["duration"], a_end + 12.0)            # a little past the end for echo tails
    b0 = max(0.0, tr["b_in_start"] - 1.0)
    b1 = min(b["duration"], tr["b_in_start"] + span + post + 1.0)
    step = max(1, int(bin_s * SR))

    def env(y, t0, t1, g):
        seg = crop(y, _s(t0), _s(t1)) * g
        lo, hi = split_bands(seg, p["crossover_hz"])
        n = len(seg) // step
        def rms(x):   # loudness shares follow energy
            m = x.mean(axis=1)[: n * step].reshape(n, step)
            return [round(float(v), 5) for v in np.sqrt((m.astype(np.float64) ** 2).mean(axis=1))]

        def peak(x):  # bar heights follow peaks, exactly like the page's real waveform
            m = np.abs(x.mean(axis=1)[: n * step]).reshape(n, step)
            return [round(float(v), 4) for v in m.max(axis=1)]
        return {"t0": round(t0, 3), "lo": rms(lo), "hi": rms(hi),
                "pk": peak(seg), "plo": peak(lo), "phi": peak(hi)}

    def beats(t, t0, t1):
        downs = np.asarray(t.get("downbeats") or [])
        return [[round(x, 3), bool(len(downs)) and float(np.min(np.abs(downs - x))) < 0.03]
                for x in (t.get("beats") or []) if t0 <= x <= t1]

    return {"bin_s": step / SR,
            "a": {**env(ya, a0, a1, ga), "beats": beats(a, a0, a1)},
            "b": {**env(yb, b0, b1, gb), "beats": beats(b, b0, b1)},
            "spec": spec_summary(tr, p)}


def length_table_summary(segs: list[dict], p: dict) -> list[dict]:
    """length_table for the page: exact spec per segment; a stretch segment's spec is
    re-derived by the page as length = min(L, cap), reason with {L} filled in."""
    out = []
    for g in segs:
        sp = spec_summary(g["spec"], p)
        row = {"lo": round(g["lo"], 4), "hi": round(g["hi"], 4), "stretch": g["stretch"], "spec": sp}
        if g["stretch"]:
            row["cap"] = g["cap"]
            row["reason_tpl"] = sp["reason"].replace(f"used a {g['L_rep']:.0f} s fade", "used a {L} s fade")
            prev = out[-1] if out else None
            same = prev and prev["stretch"] and all(prev["spec"][k] == sp[k] for k in ("style", "a_end", "b_in")) \
                and prev["cap"] == row["cap"] and prev["reason_tpl"] == row["reason_tpl"]
            if same:
                prev["hi"] = row["hi"]
                continue
        out.append(row)
    return out


def spec_summary(tr: dict, p: dict) -> dict:
    """Everything the page needs to draw a join exactly as the renderer will play it:
    join type, true lengths (bars when beatmatched), stretch ratios, handover, and the
    locked beat grid of a beatmatched overlap."""
    T_o = tr.get("T_overlap", tr["T"])
    a_end = tr["a_out_start"] if tr["style"] == "echo" else tr["a_out_end"]
    bm = bool(tr.get("beatmatch"))
    grid = []
    if bm and tr.get("anchors"):
        units_o = len(tr["anchors"]["a"]) - 1
        bpb = int(tr.get("beats_per_bar") or max(1, round(units_o / max(1, tr.get("bars") or 1))))
        grid = [[round(t, 4), j % bpb == 0, "both" if j <= units_o else "b"]
                for j, t in enumerate(tr["anchors"]["t"])]
    # B's native time at each output anchor: through the blend and the tempo glide
    b_map = ([[round(t, 4), round(x, 4)] for t, x in zip(tr["anchors"]["t"], tr["anchors"]["b"])]
             if bm and tr.get("anchors") else [])
    return {"style": tr["style"], "a_end": a_end, "b_in": tr["b_in_start"], "b_map": b_map,
            # native seconds consumed per output second (time-stretch on beatmatched joins)
            "ra": ((tr["a_out_end"] - tr["a_out_start"]) / max(1e-6, T_o)) if bm else 1.0,
            "rb": ((tr["b_in_end"] - tr["b_in_start"]) / max(1e-6, tr["T"])) if bm else 1.0,
            "length": T_o, "glide": max(0.0, tr["T"] - T_o),
            "handover": tr.get("handover", 0.5), "swap_at": tr.get("swap_at", 0.5),
            "beatmatch": bm, "bars": tr.get("bars"), "grid": grid,
            "tempo_gap_pct": tr.get("stretch_pct"), "reason": tr.get("reason", ""),
            "beat_len": T_o / max(1, (tr.get("bars") or 1) * 4),
            "echo_fade": tr.get("echo_fade", 1.0),
            "preroll": float(p["preroll_s"]), "postroll": float(p["postroll_s"]),
            "fade_curve": p["fade_curve"], "echo_feedback": float(p["echo_feedback"]),
            "ceiling": float(10 ** (float(p["ceiling_db"]) / 20))}
