"""Pure planning: energy score -> tiers -> running order -> per-join transition specs."""

from __future__ import annotations

import math

import numpy as np

from .params import BEAT_STYLES

ENERGY_FEATURES = {
    "w_lufs": "lufs",
    "w_danceability": "danceability",
    "w_onset": "onset_strength",
    "w_tempo": "tempo_folded",
    "w_brightness": "brightness",
    "w_bass": "bass_ratio",
    "w_dynamics": "dynamics_db",
}


def folded_bpm(bpm: float) -> float:
    if bpm <= 0:
        return 100.0
    while bpm < 85:
        bpm *= 2
    while bpm > 170:
        bpm /= 2
    return bpm


def camelot_distance(a: str, b: str) -> int:
    """0 = same key, 1 = adjacent/relative (harmonic), larger = clash. 6 when unknown."""
    if not a or not b or "?" in (a, b):
        return 6
    na, la, nb, lb = int(a[:-1]), a[-1], int(b[:-1]), b[-1]
    d = min(abs(na - nb), 12 - abs(na - nb))
    return d + (0 if la == lb else 1)


def energy_scores(tracks: list[dict], p: dict) -> dict[str, float]:
    if not tracks:
        return {}
    ids = [t["id"] for t in tracks]
    total = np.zeros(len(tracks))
    for wkey, feat in ENERGY_FEATURES.items():
        w = float(p.get(wkey, 0))
        if w == 0:
            continue
        if feat == "tempo_folded":
            x = np.array([folded_bpm(t["bpm"]) for t in tracks], dtype=float)
        else:
            x = np.array([t.get(feat, 0.0) for t in tracks], dtype=float)
        x = np.nan_to_num(x, nan=np.nanmedian(x) if np.isfinite(x).any() else 0.0)
        sd = x.std()
        z = (x - x.mean()) / sd if sd > 1e-9 else np.zeros_like(x)
        total += w * np.clip(z, -3, 3)
    lo, hi = total.min(), total.max()
    norm = (total - lo) / (hi - lo) if hi > lo else np.full_like(total, 0.5)
    out = {}
    for i, t, v in zip(ids, tracks, norm):
        if t.get("energy_model") is not None:      # evaluated perceived-energy model
            out[i] = float(t["energy_model"])
            continue
        ar = t.get("arousal")   # fallback: anchor-labelled kNN estimate
        out[i] = float(0.7 * ar + 0.3 * v) if ar is not None else float(v)
    return out


def beatable(t: dict, p: dict) -> bool:
    return (t["beat_regularity"] >= p["min_regularity"] and t["beat_coverage"] > 0.4
            and len(t["downbeats"]) >= 8 and t["bpm"] > 0)


def tempo_match(a: dict, b: dict, p: dict) -> tuple[float, float]:
    """Return (k, stretch_pct): B beats per A beat and the stretch needed to lock them."""
    ks = [1.0, 0.5, 2.0] if p["allow_half_double"] else [1.0]
    cands = []
    for k in ks:
        # B plays k beats per A beat: tempos lock when bpm_b == k * bpm_a
        r = b["bpm"] / (k * a["bpm"]) if a["bpm"] > 0 else float("inf")
        cands.append((k, abs(r - 1) * 100))
    best = min(cands, key=lambda c: c[1])
    if cands[0][1] <= best[1] + 0.5:
        best = cands[0]
    return best


def timbre_distance(a: dict, b: dict) -> float:
    """Mood distance: CLAP audio embeddings when both tracks have them (evaluated
    AUC 0.79 for same-genre pairs), else the old rox timbre vectors."""
    va, vb = a.get("mood_vec"), b.get("mood_vec")
    if va is None or vb is None:
        va, vb = a.get("timbre"), b.get("timbre")
    if va is None or vb is None:
        return -1.0           # unknown
    return float(1.0 - np.dot(va, vb))


def join_profile(t: dict) -> tuple[float, float]:
    """(exit_rel_db, entry_rel_db): loudness of the track's last and first active
    ~10 s relative to its own LUFS — what actually meets the neighbour at a join."""
    if "_join_profile" in t:
        return t["_join_profile"]
    sec = t.get("second_db") or []
    lo, hi = active_seconds(t, 12.0)
    def rel(t0, t1):
        a, b = max(0, int(t0)), min(len(sec), int(t1))
        if b <= a:
            return -20.0
        return float(np.mean(sec[a:b])) - t["lufs"]
    prof = (rel(hi - 10, hi), rel(lo, lo + 10))
    t["_join_profile"] = prof
    return prof


def pair_cost(a: dict, b: dict, ea: float, eb: float, e_remaining_max: float, p: dict) -> float:
    kd = camelot_distance(a["camelot"], b["camelot"])
    key_cost = {0: 0.0, 1: 0.15, 2: 0.6}.get(kd, 1.0)
    pct = 0.0
    if beatable(a, p) and beatable(b, p):
        _, pct = tempo_match(a, b, p)
        tempo_cost = min(2.0, pct / max(p["max_stretch_pct"], 1.0))
    else:
        tempo_cost = 0.5
    if p.get("_free_arc"):                     # "best flow": no descending-energy bias
        energy_cost = abs(eb - ea)
    else:
        energy_cost = abs(eb - ea) + 1.5 * max(0.0, eb - ea) + 0.7 * (e_remaining_max - eb)
    td = timbre_distance(a, b)
    both_clap = a.get("mood_vec") is not None and b.get("mood_vec") is not None
    med = p.get("_mood_med", 0.012) if both_clap else 0.012
    veto_at = p.get("_mood_veto", 0.015) if both_clap else 0.015
    timbre_cost = 1.0 if td < 0 else min(2.0, td / med)   # 1.0 = typical adjacency
    exit_rel, _ = join_profile(a)
    _, entry_rel = join_profile(b)
    cliff = max(0.0, (exit_rel - entry_rel) - 4.0) / 6.0     # >4 dB drop starts to cost
    veto = 0.0
    rated = (p.get("_pair_ratings") or {}).get(a["id"] + ">" + b["id"])
    if rated is not None:                      # listener votes are weights, not shackles —
        w = p.get("rating_weight", 5.0)        # but a known-bad join repels harder than a
        x = (50 - rated) / 50.0                # known-good one attracts
        veto += x * w * (2.0 if x > 0 else 1.0)
    if td > veto_at:                           # rated 14-21/100: mood clashes are never OK
        veto += 6.0
    if beatable(a, p) and beatable(b, p) and pct > 20:
        veto += 4.0                            # rated 21: two grooves 30% apart
    if exit_rel - entry_rel > 8.0:
        veto += 3.0                            # rated 36: loud outro onto buried intro
    jump_levels = abs(eb - ea) / 0.25          # convex: jumps beyond one level hurt fast
    veto += 3.0 * max(0.0, jump_levels - 1.0) ** 2 + (6.0 if jump_levels >= 1.5 else 0.0)
    return (p["order_key_weight"] * key_cost + p["order_tempo_weight"] * tempo_cost
            + p["order_energy_weight"] * energy_cost * 3
            + p.get("order_timbre_weight", 1.5) * timbre_cost
            + p.get("order_join_weight", 1.2) * cliff + veto)


def assign_tiers(tracks: list[dict], energy: dict[str, float], p: dict) -> dict[str, str]:
    ranked = sorted(tracks, key=lambda t: -energy[t["id"]])
    n = len(ranked)
    n_high = round(n * p["tier_high_pct"] / 100)
    n_mid = min(n - n_high, round(n * p["tier_mid_pct"] / 100))
    tiers = {}
    for i, t in enumerate(ranked):
        tiers[t["id"]] = "high" if i < n_high else ("mid" if i < n_high + n_mid else "chill")
    return tiers


def _two_opt(seq: list[dict], head: dict | None, cost, passes: int = 6) -> list[dict]:
    """Reverse-segment improvement over one group's sequence (head = previous track).
    With no head, the opener is pinned — the set must start on its peak."""
    def edge(x, y):
        return cost(x, y) if x is not None else 0.0
    first = 0 if head is not None else 1
    improved = True
    while improved and passes > 0:
        improved = False
        passes -= 1
        for i in range(first, len(seq) - 1):
            for j in range(i + 1, len(seq)):
                left = seq[i - 1] if i > 0 else head
                before = edge(left, seq[i]) + (cost(seq[j], seq[j + 1]) if j + 1 < len(seq) else 0.0)
                after = edge(left, seq[j]) + (cost(seq[i], seq[j + 1]) if j + 1 < len(seq) else 0.0)
                if after + 1e-9 < before:
                    seq[i: j + 1] = reversed(seq[i: j + 1])
                    improved = True
    return seq


def _or_opt(seq: list, head, cost, passes: int = 4) -> list:
    """Relocate segments of 1-3 tracks to their best position (keeps the opener when
    there is no head). Complements 2-opt; together they approach the optimal order."""
    def edge(x, y):
        return cost(x, y) if x is not None and y is not None else 0.0
    first = 0 if head is not None else 1
    for _ in range(passes):
        improved = False
        for seg_len in (1, 2, 3):
            i = first
            while i + seg_len <= len(seq):
                seg = seq[i:i + seg_len]
                left = seq[i - 1] if i > 0 else head
                right = seq[i + seg_len] if i + seg_len < len(seq) else None
                removed_gain = edge(left, seg[0]) + edge(seg[-1], right) - edge(left, right)
                rest = seq[:i] + seq[i + seg_len:]
                best_k, best_delta = None, -1e-9
                for k in range(first, len(rest) + 1):
                    if k == i:
                        continue
                    l2 = rest[k - 1] if k > 0 else head
                    r2 = rest[k] if k < len(rest) else None
                    add = edge(l2, seg[0]) + edge(seg[-1], r2) - edge(l2, r2)
                    delta = add - removed_gain
                    if delta < best_delta:
                        best_k, best_delta = k, delta
                if best_k is not None:
                    seq[:] = rest[:best_k] + seg + rest[best_k:]
                    improved = True
                i += 1
        if not improved:
            break
    return seq


def compute_order(tracks: list[dict], p: dict, groups: list[list[dict]] | None = None,
                  head: dict | None = None) -> list[str]:
    """Running order ids: greedy within each group (default high→mid→chill tiers), then 2-opt.
    Saved pair ratings act as continuous weights inside pair_cost — cues, not chains."""
    if not tracks:
        return []
    energy = energy_scores(tracks, p)
    if groups is None:
        tiers = assign_tiers(tracks, energy, p)
        groups = [[t for t in tracks if tiers[t["id"]] == g] for g in ("high", "mid", "chill")]
    order: list[dict] = []
    prev = head                       # plan a continuation after an already-placed track
    if head is not None and head["id"] not in energy:
        energy = {**energy, **energy_scores([head] + list(tracks), p)}
    for pool0 in groups:
        pool = list(pool0)
        seq = []
        pr = prev
        while pool:
            emax = max(energy[t["id"]] for t in pool)
            if pr is None:
                nxt = max(pool, key=lambda t: energy[t["id"]])
            else:
                nxt = min(pool, key=lambda t: pair_cost(pr, t, energy[pr["id"]], energy[t["id"]], emax, p))
            seq.append(nxt)
            pool.remove(nxt)
            pr = nxt
        emax_t = max((energy[t["id"]] for t in seq), default=0.0)
        cf = lambda x, y: pair_cost(x, y, energy[x["id"]], energy[y["id"]], emax_t, p)
        seq = _two_opt(seq, prev, cf)
        seq = _or_opt(seq, prev, cf)
        seq = _two_opt(seq, prev, cf, passes=2)
        order.extend(seq)
        prev = order[-1] if order else None
    return [t["id"] for t in order]


# ---------------------------------------------------------------------------------------
# transition geometry
# ---------------------------------------------------------------------------------------

def _loud_ref(levels: list[float]) -> float:
    return float(np.percentile(levels, 90)) if levels else -20.0


def active_bars(t: dict, thr_db: float) -> tuple[int, int]:
    lv = t["bar_db"]
    if not lv:
        return 0, -1
    ref = _loud_ref(lv)
    idx = [i for i, v in enumerate(lv) if v >= ref - thr_db]
    return (idx[0], idx[-1]) if idx else (0, len(lv) - 1)


def active_seconds(t: dict, thr_db: float) -> tuple[float, float]:
    lv = t["second_db"]
    if not lv:
        return 0.0, t["duration"]
    ref = _loud_ref(lv)
    idx = [i for i, v in enumerate(lv) if v >= ref - thr_db]
    if not idx:
        return 0.0, t["duration"]
    return float(idx[0]), float(min(t["duration"], idx[-1] + 1))


def first_sound(t: dict) -> float:
    for i, v in enumerate(t["second_db"]):
        if v > -50:
            return float(max(0, i - 0.0))
    return 0.0


def bar_time(t: dict, i: float) -> float:
    """Time of (possibly fractional) bar index i; extrapolates past the grid."""
    db = t["downbeats"]
    n = len(db)
    if n == 0:
        return 0.0
    if n == 1:
        return db[0]
    lo = int(math.floor(i))
    frac = i - lo
    if lo < 0:
        return db[0] + i * (db[1] - db[0])
    if lo >= n - 1:
        last = db[-1] - db[-2]
        return db[-1] + (i - (n - 1)) * last
    return db[lo] + frac * (db[lo + 1] - db[lo])


def seconds_per_bar(t: dict) -> float:
    if t["bpm"] > 0:
        return 60.0 / t["bpm"] * t.get("beats_per_bar", 4)
    return 2.0


def fitted_grid(t: dict, t0: float, n: int, step_beats: float) -> list[float] | None:
    """n+1 anchors on a constant-tempo beat grid fitted to the detected beats around
    [t0, t0 + n*step_beats beats] — the assumption DJ beatgrids (Mixxx, rekordbox)
    make. Phase comes from the fit, so frame jitter and odd missed beats vanish.
    None when the region's beats do not fit a steady grid well enough to beatmatch.
    """
    guess = 60.0 / t["bpm"] if t["bpm"] > 0 else 0.5
    span = n * step_beats * guess
    bts = np.asarray(t["beats"], dtype=float)
    win = bts[(bts >= t0 - 4 * guess) & (bts <= t0 + span + 4 * guess)]
    need = n * step_beats * 0.7
    if len(win) < max(8, need):
        return None
    idx = np.round((win - win[0]) / guess)
    keep = np.ones(len(win), dtype=bool)
    a, b = win[0], guess
    for _ in range(3):
        if keep.sum() < max(8, need):
            return None
        b, a = np.polyfit(idx[keep], win[keep], 1)
        keep = np.abs(a + b * idx - win) <= 0.06
    resid = a + b * idx[keep] - win[keep]
    if b <= 0 or np.sqrt(np.mean(resid ** 2)) > 0.030 or keep.mean() < 0.7:
        return None
    g0 = a + b * round((t0 - a) / b)          # grid point nearest the requested start
    out = [g0 + j * step_beats * b for j in range(n + 1)]
    if out[0] < 0 or out[-1] > t["duration"] or out[-1] > bts[-1] + 4 * b:
        return None
    return out


def _bar_near(t: dict, time: float) -> int | None:
    db = t["downbeats"]
    if not db:
        return None
    return int(min(range(len(db)), key=lambda j: abs(db[j] - time)))


def structural_exit(a: dict, p: dict) -> tuple[int, str] | None:
    """Mix-out bar from section labels: at the outro when it is a loud, beat-covered
    DJ-style outro (the blend may live inside it), else where the outro begins."""
    segs = a.get("segments")
    if not p.get("use_structure", True) or not segs or not a["downbeats"]:
        return None
    outs = [seg for seg in segs if seg["label"] == "outro"]
    if not outs:
        return None
    o_start, o_end = outs[-1]["start"], outs[-1]["end"]
    for seg in reversed(outs[:-1]):        # merge back-to-back outro segments
        if abs(seg["end"] - o_start) < 1.0:
            o_start = seg["start"]
        else:
            break
    if o_start < 30.0:                     # a labeled outro this early is not trustworthy
        return None
    spb = seconds_per_bar(a)
    i0 = _bar_near(a, o_start)
    i1 = _bar_near(a, o_end)
    if i0 is None or i1 is None or abs(bar_time(a, i0) - o_start) > 2 * spb:
        return None                        # outro lies off the downbeat grid (beatless coda?)
    lv = a["bar_db"]
    ref = _loud_ref(lv)
    seg_lv = lv[i0: max(i0 + 1, i1)]
    loud = bool(seg_lv) and sum(seg_lv) / len(seg_lv) >= ref - p["outro_db"]
    grid_ok = bool(a["beats"]) and o_end <= a["beats"][-1] + 2.0
    if loud and grid_ok and abs(bar_time(a, i1) - o_end) <= 2 * spb:
        return i1, "outro (mixable)"
    return i0, "outro start"


def entry_bar_candidates(b: dict, p: dict, ov: dict) -> list[float]:
    """Places B could enter, earliest first: first loud bar, then section starts
    (verse/chorus/solo/inst) from the structure labels, within the first 40%."""
    fb0, _ = active_bars(b, p["intro_db"])
    cands = [max(0.0, fb0 + ov.get("b_shift", 0))]
    spb = seconds_per_bar(b)
    for seg in (b.get("segments") or []):
        if seg["label"] in ("verse", "chorus", "solo", "inst") and seg["start"] < b["duration"] * 0.4:
            i = _bar_near(b, seg["start"])
            if i is not None and abs(bar_time(b, i) - seg["start"]) <= 2 * spb:
                cands.append(max(0.0, i + ov.get("b_shift", 0)))
    out: list[float] = []
    for c in sorted(cands):
        if not out or c - out[-1] >= 2:
            out.append(c)
    return out[:5]


def plan_beat_transition(a, b, p, ov, k, bars, min_out_start, fb):
    """Beatmatched overlap anchored on every beat; None when the geometry does not fit."""
    thr_out = p["outro_db"]
    fa, la = active_bars(a, thr_out)
    la = min(la, len(a["bar_db"]) - 1 - int(p.get("end_margin_bars", 8)))
    end = la + 1
    while end > fa + 1 and bar_time(a, end) > a["duration"] - 10.0:
        end -= 1   # absolute floor: never exit within 10 s of the file end
    sx = structural_exit(a, p)
    struct_bound = sx is not None and fa + 4 < sx[0] <= end
    if struct_bound:
        end = sx[0]
    if a["beats"]:   # mix out no later than where the beat grid ends (beatless loud outros)
        while end > fa + 1 and bar_time(a, end) > a["beats"][-1] + 0.5:
            end -= 1
            struct_bound = False
    s = end - bars
    phrase = int(p["phrase"])
    if phrase and not struct_bound:        # a structural anchor IS the phrase boundary
        s = fa + max(0, (s - fa) // phrase) * phrase
    s += ov.get("a_shift", 0)
    s = min(s, len(a["downbeats"]) - 1 - bars)
    if s < 0:
        return None
    bpb_a = a.get("beats_per_bar") or 4
    units = bars * bpb_a
    la_t = fitted_grid(a, bar_time(a, s), units, 1.0)
    if la_t is None or la_t[0] < min_out_start:
        return None
    if abs(la_t[-1] - bar_time(a, s + bars)) > 2 * (la_t[1] - la_t[0]):
        return None   # fitted grid disagrees with the bar grid here — not a steady region
    # Overlap runs at A's tempo (B held to it, DJ-style); afterwards B glides back
    # to its own tempo over the glide zone, alone, like releasing the pitch fader.
    g_units = int(p.get("glide_bars", 8)) * bpb_a
    lb_t = None
    for g in (g_units, g_units // 2, g_units // 4, 0):
        lb_t = fitted_grid(b, bar_time(b, fb), units + g, k)
        if lb_t is not None:
            g_units = g
            break
    if lb_t is None:
        return None
    ia = la_t[1] - la_t[0]           # fitted grids are constant-spacing
    ib = lb_t[1] - lb_t[0]
    t = [j * ia for j in range(units + 1)]
    for m in range(1, g_units + 1):
        t.append(t[-1] + ia + (ib - ia) * (m - 0.5) / g_units)
    return {
        "beatmatch": True, "k": k, "bars": bars, "glide_bars": round(g_units / bpb_a, 2),
        "a_out_start": la_t[0], "a_out_end": la_t[-1],
        "b_in_start": lb_t[0], "b_in_end": lb_t[-1],
        "T": t[-1], "T_overlap": units * ia,
        "anchors": {"a": la_t, "b": lb_t, "t": t},
        "a_bar": s, "b_bar": fb, "exit_anchor": (sx[1] if struct_bound else "loudness"),
    }


def length_table(a, b, p, ov, min_out_start, lo: float = 2.0, hi: float = 60.0) -> list[dict]:
    """Every plan the blend-length slider can produce for this join, as segments of L,
    each found by asking plan_transition itself (so the page can preview any length
    instantly and exactly). A beatmatch only changes at whole-bar boundaries and where
    its bars stop covering 80% of the asked length; a fade/echo is the same plan with
    T = min(L, cap). Segments: {lo, hi, spec, stretch, cap, L_rep}."""
    base = {k: v for k, v in ov.items() if k not in ("length_s", "bars", "fade_seconds")}
    at = lambda L: plan_transition(a, b, p, {**base, "length_s": L}, min_out_start)
    spb = seconds_per_bar(a)
    edges = [lo]
    if spb > 0:
        k = 2
        while (k + 0.5) * spb < hi:
            if (k + 0.5) * spb > lo:
                edges.append((k + 0.5) * spb)
            k += 1
    edges.append(hi)
    caps = {}

    def cap(style):
        if style not in caps:
            caps[style] = plan_simple_transition(a, b, p, {**base, "length_s": 1e6}, style,
                                                 min_out_start)["T"]
        return caps[style]

    def seg(l0, l1, tr, L):
        stretch = not tr.get("beatmatch") and tr["style"] in ("fade", "echo")
        return {"lo": l0, "hi": l1, "spec": tr, "stretch": stretch,
                "cap": cap(tr["style"]) if stretch else None, "L_rep": L}

    segs = []
    for e0, e1 in zip(edges[:-1], edges[1:]):
        L = e0 + 1e-4
        tr = at(L)
        if tr.get("beatmatch"):
            cut = tr.get("T_overlap", tr["T"]) / 0.8      # beyond this, the asked length wins
            if cut >= e1:
                segs.append(seg(e0, e1, tr, L))
                continue
            segs.append(seg(e0, cut, tr, L))
            e0, L = cut, cut + 1e-4
            tr = at(L)
        segs.append(seg(e0, e1, tr, L))
    return segs


def plan_simple_transition(a, b, p, ov, style, min_out_start):
    """fade / echo / cut: no time-stretching."""
    spb_a = seconds_per_bar(a)
    use_grid_a = beatable(a, p)
    use_grid_b = beatable(b, p)
    margin = int(p.get("end_margin_bars", 8))
    sx = structural_exit(a, p)
    if use_grid_a:
        _, la = active_bars(a, p["outro_db"])
        la = min(la, len(a["bar_db"]) - 1 - margin)
        fa_s, _ = active_bars(a, p["outro_db"])
        if sx is not None and sx[0] - 1 > fa_s:
            la = min(la, sx[0] - 1)   # cut as the outro begins
        out_t = bar_time(a, la + 1 + ov.get("a_shift", 0))
    else:
        _, out_t = active_seconds(a, p["outro_db"])
        out_t += ov.get("a_shift", 0) * spb_a
    out_t = min(out_t, a["duration"] - max(10.0, margin * spb_a))
    thr_b = min(p["intro_db"], 12.0)   # without a blend, B must arrive with real energy
    if use_grid_b:
        best = None
        for fb_c in entry_bar_candidates(b, p, ov):
            t0 = bar_time(b, fb_c)
            sec = b.get("second_db") or []
            a0, a1 = int(t0), min(len(sec), int(t0) + 10)
            lvl = (sum(sec[a0:a1]) / max(1, a1 - a0) - b["lufs"]) if a1 > a0 else -20.0
            if best is None or lvl > best[1] + 1.0:
                best = (fb_c, lvl)
            if lvl > -6.0:
                best = (fb_c, lvl)
                break
        in_t = bar_time(b, best[0] if best else 0.0)
    else:
        in_t = max(first_sound(b), active_seconds(b, thr_b)[0])
        in_t = max(0.0, in_t + ov.get("b_shift", 0) * seconds_per_bar(b))
    if style == "fade":
        T = float(ov.get("length_s", ov.get("fade_seconds", p["fade_seconds"])))
        T = min(T, max(0.5, out_t - min_out_start - 0.5), b["duration"] - in_t - 1)
        a0 = out_t - T
        return {"beatmatch": False, "a_out_start": a0, "a_out_end": out_t,
                "b_in_start": in_t, "b_in_end": in_t + T, "T": T}
    if style == "echo":
        T = float(ov.get("length_s", p["echo_seconds"]))
        T = min(T, b["duration"] - in_t - 1)
        beat = 60.0 / a["bpm"] if a["bpm"] > 0 and use_grid_a else 0.5
        return {"beatmatch": False, "a_out_start": out_t, "a_out_end": out_t,
                "b_in_start": in_t, "b_in_end": in_t + T, "T": T,
                "echo_delay": beat * float(p["echo_beats"]),
                "echo_fade": min(2.5, max(0.8, 2 * beat))}
    T = 0.03
    return {"beatmatch": False, "a_out_start": out_t, "a_out_end": out_t + T,
            "b_in_start": in_t, "b_in_end": in_t + T, "T": T}


def plan_transition(a, b, p, ov, min_out_start):
    kd = camelot_distance(a["camelot"], b["camelot"])
    both = beatable(a, p) and beatable(b, p)
    k, pct = tempo_match(a, b, p) if both else (1.0, float("inf"))
    tempo_ok = both and pct <= p["max_stretch_pct"]
    wanted = ov.get("style") or p["style"]
    fallback = p["auto_clash_style"] if both else p["auto_fallback_style"]
    reasons = []
    if wanted == "auto":
        style = p["auto_beat_style"] if tempo_ok else fallback
        if not both:
            reasons.append("no reliable beat grid")
        elif not tempo_ok:
            reasons.append(f"tempo gap {pct:.1f}% > {p['max_stretch_pct']:g}%")
    else:
        style = wanted
        if style in BEAT_STYLES and not tempo_ok:
            reasons.append("cannot beatmatch: " + ("beat grid unreliable" if not both
                                                  else f"tempo gap {pct:.1f}%"))
            style = fallback
    spec = None
    if style in BEAT_STYLES:
        bars_req = int(ov.get("bars", p["bars"]))
        spb_bar = seconds_per_bar(a)
        if "length_s" in ov:                   # listener set the length: nearest whole bars
            bars_req = max(2, int(round(float(ov["length_s"]) / spb_bar)))
        elif "bars" not in ov:                 # aim for the rated sweet spot in SECONDS
            target = float(p.get("target_blend_s", 28))
            best = min((4, 8, 16, 32), key=lambda n: abs(n * spb_bar - target))
            if best * spb_bar < 15 and best < 32:
                best *= 2
            if best * spb_bar > 38 and best > 4:
                best //= 2
            bars_req = min(bars_req, best) if p["bars"] <= best else best
        floor_bars = next((n for n in (4, 8, 16, 32) if n * spb_bar >= 15), 32)
        min_bars = min(bars_req, max(int(p.get("min_overlap_bars", 8)), floor_bars))
        if "length_s" in ov:
            min_bars = max(1, bars_req // 4)   # honour a short length the listener asked for
        cands = entry_bar_candidates(b, p, ov)
        bars = bars_req
        want_len = ov.get("length_s")
        if want_len:
            # the listener asked for a length: the longest beatmatch that fits, bar by bar
            for bars in range(bars_req, max(1, min_bars) - 1, -1):
                for fb in cands:
                    spec = plan_beat_transition(a, b, p, ov, k, bars, min_out_start, fb)
                    if spec is not None:
                        break
                if spec is not None:
                    break
            if spec is not None and spec.get("T_overlap", spec["T"]) < 0.8 * float(want_len):
                # the beat grid can't carry that length here: honour the length with a fade
                reasons.append(f"beat grid only fits {spec.get('T_overlap', spec['T']):.1f} s here — "
                               f"used a {float(want_len):.0f} s fade")
                spec, style, bars = None, "fade", bars_req
        while not want_len and bars >= min_bars and spec is None:
            for fb in cands:      # a later, groovier entry beats a shorter blend
                spec = plan_beat_transition(a, b, p, ov, k, bars, min_out_start, fb)
                if spec is not None:
                    break
            if spec is None:
                bars //= 2
        if spec is None and style in BEAT_STYLES:
            reasons.append(f"no room for a {min_bars}+ bar blend at the join")
            style = fallback
        elif bars != bars_req:
            reasons.append(f"overlap shortened to {bars} bars")
        if spec is not None and spec.get("glide_bars", 0) < int(p["glide_bars"]):
            reasons.append(f"tempo glide shortened to {spec['glide_bars']:g} bars")
    if spec is None:
        exit_rel, _ = join_profile(a)
        _, entry_rel = join_profile(b)
        if style in ("echo", "cut") and exit_rel - entry_rel > 8.0:
            style = "fade"
            reasons.append("energy cliff at the join — long fade instead")
        spec = plan_simple_transition(a, b, p, ov, style, min_out_start)
        if spec["a_out_start"] < min_out_start:
            # previous transition already consumed this track; cut straight across
            spec = plan_simple_transition(a, b, p, ov, "cut", min_out_start)
            spec["a_out_start"] = min_out_start
            spec["a_out_end"] = min_out_start + spec["T"]
            style = "cut"
            reasons.append("track fully used by previous overlap")
    spec.update({
        "style": style, "requested": wanted, "reason": "; ".join(reasons),
        "key_distance": kd, "stretch_pct": None if not both else round(pct, 2),
        "k": spec.get("k", k if both else 1.0),
        "swap_at": float(ov.get("bass_swap_at", ov.get("handover", p["bass_swap_at"]))),
        "handover": float(ov.get("handover", 0.5)),
    })
    return spec


def build_plan(tracks: list[dict], p: dict, manual_order: list[str] | None,
               excluded: set[str], overrides: dict[str, dict]) -> dict:
    tracks = [t for t in tracks if t["id"] not in excluded]
    energy = energy_scores(tracks, p)
    tiers = assign_tiers(tracks, energy, p)
    if manual_order is not None:               # an explicit set order is used exactly
        known = {t["id"] for t in tracks}
        seen: set[str] = set()
        order_ids = []
        for i in manual_order:
            if i in known and i not in seen:
                order_ids.append(i)
                seen.add(i)
    else:
        order_ids = compute_order(tracks, p)
    by_id = {t["id"]: t for t in tracks}
    order = [by_id[i] for i in order_ids]

    transitions = []
    min_out = 0.0
    starts = [first_sound(order[0])] if order else []
    for i in range(len(order) - 1):
        a, b = order[i], order[i + 1]
        key = f"{a['id']}>{b['id']}"
        ov = overrides.get(key, {})
        spec = plan_transition(a, b, p, ov, min_out)
        spec.update({"index": i, "key": key, "a": a["id"], "b": b["id"], "override": ov})
        transitions.append(spec)
        min_out = spec["b_in_end"] + 1.0
        starts.append(spec["b_in_end"])

    # timeline (output seconds) for chapters and total length
    t_out = 0.0
    next_start = 0.0
    timeline = []
    for i, tr in enumerate(order):
        timeline.append({"id": tr["id"], "start": next_start})
        start_native = starts[i]
        end_native = transitions[i]["a_out_start"] if i < len(transitions) else tr["duration"]
        t_out += max(0.0, end_native - start_native)
        if i < len(transitions):
            next_start = t_out           # the incoming track's chapter starts where it enters
            t_out += transitions[i]["T"]
    summary = [{
        "id": t["id"], "artist": t["artist"], "title": t["title"], "file": t["file"],
        "bpm": t["bpm"], "camelot": t["camelot"], "key": f"{t['key']} {t['scale']}",
        "energy": round(energy[t["id"]], 3), "tier": tiers[t["id"]],
        "regularity": t["beat_regularity"], "lufs": round(t["lufs"], 1),
        "danceability": round(t["danceability"], 2), "duration": t["duration"],
        "start": timeline[i]["start"],
    } for i, t in enumerate(order)]
    return {"order": summary, "transitions": transitions, "total_seconds": t_out,
            "native_starts": starts}
