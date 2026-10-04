"""Regenerate the Phase-0 medley fixtures (run from automix/):

    uv run python tests/medley/fixtures/make_fixtures.py [--feats] [--comp]

--feats  feats_*.json for three real tracks (Dance No More, Dreaming, Bluebird). Beats, downbeats,
         sections and bpm come straight from the analysis cache (Beat This) and the all-in-one
         structure cache; per-bar/per-beat levels, onsets and K-weighted blocks are measured from
         the decoded MP3 on the CPU (one track at a time, a few seconds each). Landings/exits are a
         compact port of the hl3 prototype with the §5 formulas. This is a *realistic reference*,
         not E1's implementation: E1's FeatStore/highlights supersede it but must emit the same shape.
--comp   comp_drop_swap.json (§8.10 verbatim, real track ids, real hash), program_drop_swap.json
         (a hand compile of it, §12) and plan_drop_swap.json (a 2-song SessionPlanMedley).
With no flag both run. Nothing outside tests/medley/fixtures is written.
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..", "..")))

from automix.medley import CFG, FEATS_VERSION, MEDLEY_VERSION, COMPILER_VERSION  # noqa: E402
from automix.medley import schema as S  # noqa: E402

FOLDER = "/Users/dom/Desktop/mp3_downloads/50"
DATA = "/Users/dom/src/spooty/data/automix"
SR = 44100
TRACKS = {  # fixture name -> spotify id
    "dance_no_more": "7gDgphzQU0urJU3AtoLJup",
    "dreaming": "15vNoLXoliW2XdTUDlNlWk",
    "bluebird": "7e8WWf2iBY4sPJDYAeGgW0",
}
H = CFG["highlight"]


def r(x, n=3):
    return None if x is None else round(float(x), n)


def g6(x):
    return float(f"{float(x):.6g}")


# ------------------------------------------------------------------------------------------ feats
def load_track(sid: str) -> tuple[dict, dict | None]:
    from automix.analyze import cache_path, list_tracks, refine
    path = next(p for p in list_tracks(FOLDER) if f"[sp-{sid}]" in p)
    t = refine(json.load(open(cache_path(os.path.join(DATA, "analysis"), path))))
    sp = os.path.join(DATA, "structure", os.path.splitext(os.path.basename(path))[0] + ".json")
    s = json.load(open(sp)) if os.path.exists(sp) else None
    if s and not (s.get("segments") and abs(s["segments"][-1]["end"] - t["duration"]) <= 2.5):
        s = None                                     # stale structure (same guard as session.py)
    return t, s


def consensus(t: dict, s: dict | None) -> tuple[np.ndarray, np.ndarray, str, int, bool]:
    """Beats + in-bar positions: all-in-one beats snapped to the nearest Beat This beat within
    grid_snap_s (§4.1); Beat This alone without structure."""
    bt_b, bt_d = np.asarray(t["beats"]), np.asarray(t["downbeats"])
    if s and len(s.get("beats", [])) > 16:
        b = np.asarray(s["beats"], float)
        pos = np.asarray(s["beat_positions"], int) - 1
        j = np.clip(np.searchsorted(bt_b, b), 1, len(bt_b) - 1)
        near = np.where(np.abs(bt_b[j - 1] - b) < np.abs(bt_b[j] - b), bt_b[j - 1], bt_b[j])
        b = np.where(np.abs(near - b) <= CFG["grid_snap_s"], near, b)
        bpb_a1 = int(np.bincount(pos[np.r_[pos[1:] == 0, False]] + 1).argmax())
        return b, pos, "a1", bpb_a1, bpb_a1 == int(t["beats_per_bar"])
    pos = np.zeros(len(bt_b), int)
    k = -1
    for i, x in enumerate(bt_b):
        if np.min(np.abs(bt_d - x)) < 0.03:
            k = 0
        else:
            k += 1
        pos[i] = max(k, 0)
    return bt_b, pos, "bt", int(t["beats_per_bar"]), True


def onset_flux(mono: np.ndarray) -> tuple[np.ndarray, float]:
    """Percussive spectral flux at hop 64 (HPSS on a coarse STFT, then a fine log-magnitude flux)."""
    import librosa
    perc = librosa.effects.percussive(mono, margin=1.0)
    hop, n_fft, chunk = CFG["analysis"]["onset_hop"], CFG["analysis"]["onset_n_fft"], 20 * SR
    flux = []
    prev = None
    for s0 in range(0, len(perc), chunk):
        x = perc[max(0, s0 - n_fft): s0 + chunk + n_fft]
        S_ = np.log1p(100 * np.abs(librosa.stft(x, n_fft=n_fft, hop_length=hop, center=True)))
        off = (s0 - max(0, s0 - n_fft)) // hop
        S_ = S_[:, off: off + chunk // hop]
        d = np.diff(S_, axis=1, prepend=S_[:, :1] if prev is None else prev)
        flux.append(np.maximum(d, 0).sum(axis=0))
        prev = S_[:, -1:]
    return np.concatenate(flux)[: len(perc) // hop + 1], hop / SR


# The centred 1024-point flux rises as the window's leading edge meets an attack, so its steepest
# point precedes the attack; measured on synth.py kicks: -10.5 ms (+-1.1 ms). Corrected here.
ONSET_LAG_S = 0.0105


def pick_onsets(flux: np.ndarray, dt: float) -> tuple[np.ndarray, np.ndarray]:
    """Clear peaks (>= median + 3 MAD over 1 s), timed at the steepest point of the rising edge."""
    from scipy.ndimage import maximum_filter1d, median_filter
    w = int(round(CFG["analysis"]["onset_mad_win_s"] / dt)) | 1
    med = median_filter(flux, size=w, mode="nearest")
    mad = median_filter(np.abs(flux - med), size=w, mode="nearest")
    thr = med + CFG["analysis"]["onset_mad_k"] * 1.4826 * mad + 1e-9
    peak = (flux >= maximum_filter1d(flux, size=int(0.03 / dt) | 1)) & (flux > thr)
    idx = np.where(peak)[0]
    d = np.diff(flux, prepend=flux[0])
    t, s = [], []
    for i in idx:
        lo = max(1, i - int(0.02 / dt))
        k = lo + int(np.argmax(d[lo: i + 1]))
        t.append(round((k - 0.5) * dt + ONSET_LAG_S, 3))
        s.append(float(flux[i]))
    return np.asarray(t), np.asarray(s)


def kblocks(y: np.ndarray) -> list[float]:
    import pyloudnorm
    meter = pyloudnorm.Meter(SR)
    x = y.astype(np.float64).copy()
    for f in meter._filters.values():               # BS.1770 K-weighting (pre-filter + RLB)
        for ch in range(x.shape[1]):
            x[:, ch] = f.apply_filter(x[:, ch])
    p = (x ** 2).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    blk, hop = int(CFG["analysis"]["kblock_s"] * SR), int(CFG["analysis"]["kblock_hop_s"] * SR)
    starts = np.arange(0, len(p) - blk + 1, hop)
    return [g6(v) for v in (c[starts + blk] - c[starts]) / blk]


def lufs_window(kb: list[float], t0: float, t1: float) -> float:
    """BS.1770 integrated loudness of the blocks fully inside [t0, t1] (E1 owns the real one)."""
    ms = np.asarray(kb)
    i0 = int(np.ceil(t0 / 0.1 - 1e-9))
    i1 = int(np.floor((t1 - 0.4) / 0.1 + 1e-9))
    z = ms[i0: i1 + 1]
    lk = -0.691 + 10 * np.log10(np.maximum(z, 1e-12))
    z = z[lk > -70]
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return float(-0.691 + 10 * np.log10(z.mean()))


def fit_grid(bt: np.ndarray, w: np.ndarray, t0: float, t1: float) -> dict | None:
    """Weighted LSQ beat time vs beat index, dropping > 40 ms outliers over 3 passes (§4.2)."""
    k = np.where((bt >= t0 - 1e-6) & (bt <= t1 + 1e-6))[0]
    if len(k) < CFG["relation"]["min_fit_beats"]:
        return None
    keep = np.ones(len(k), bool)
    for _ in range(CFG["analysis"]["fit_iters"]):
        A = np.vstack([np.ones(keep.sum()), k[keep]]).T
        sw = np.sqrt(w[k][keep])
        coef, *_ = np.linalg.lstsq(A * sw[:, None], bt[k][keep] * sw, rcond=None)
        res = bt[k] - (coef[0] + coef[1] * k)
        new = np.abs(res) <= CFG["analysis"]["fit_outlier_ms"] / 1000
        if (new == keep).all():
            break
        keep = new
        if keep.sum() < CFG["relation"]["min_fit_beats"]:
            return None
    res = res[keep] * 1000
    return {"period_s": round(float(coef[1]), 7), "phase_s": round(float(coef[0]), 6),
            "rms_ms": r(np.sqrt(np.mean(res ** 2)), 3), "max_ms": r(np.max(np.abs(res)), 3),
            "keep": r(keep.mean(), 4), "n": int(keep.sum()), "k0": int(k[0]), "k1": int(k[-1])}


def classify(fit: dict | None, meter_ok: bool, octave_ok: bool, bpb: int) -> str:
    if fit is None or not meter_ok or not octave_ok or bpb != 4:
        return "free"
    if fit["rms_ms"] <= CFG["locked_rms_ms"] and fit["max_ms"] <= CFG["locked_max_ms"] and \
            fit["keep"] >= CFG["keep_locked"]:
        return "locked"
    if fit["rms_ms"] <= CFG["verify_rms_ms"] and fit["keep"] >= CFG["keep_verify"]:
        return "verify"
    return "free"


def build_feats(name: str, sid: str) -> dict:
    import librosa
    from automix.audio import decode
    t, s = load_track(sid)
    path = t["path"]
    y = decode(path)
    mono = y.mean(axis=1).astype(np.float32)
    dur = len(y) / SR
    beats, pos, src, bpb, meter_ok = consensus(t, s)

    # onsets and beat refinement (§4.1)
    flux, dt = onset_flux(mono)
    on_t, on_s = pick_onsets(flux, dt)
    win = CFG["refine_win_s"]
    refined = np.zeros(len(beats), int)
    bt = beats.copy()
    for i, b in enumerate(beats):
        sel = np.where(np.abs(on_t - b) <= win)[0]
        if len(sel):
            k = sel[np.argmax(on_s[sel])]
            bt[i], refined[i] = on_t[k], 1
    order = np.argsort(bt, kind="stable")
    bt, refined, pos = bt[order], refined[order], pos[order]
    keep = np.r_[True, np.diff(bt) > 0.05]          # a refined beat must not collide with its neighbour
    bt, refined, pos = bt[keep], refined[keep], pos[keep]
    bar_beat = np.where(pos == 0)[0]
    g = bt[bar_beat]
    nb = len(g)

    # per-bar / per-beat levels (§4.3) from one HPSS pass
    n_fft, hop = 4096, 1024
    Sx = np.abs(librosa.stft(mono, n_fft=n_fft, hop_length=hop))
    Hh, Pp = librosa.decompose.hpss(Sx, margin=1.0)
    fr = librosa.fft_frequencies(sr=SR, n_fft=n_fft)
    ft = librosa.frames_to_time(np.arange(Sx.shape[1]), sr=SR, hop_length=hop)
    pw = Sx ** 2
    tot, low = pw.sum(0), pw[fr < CFG["analysis"]["low_hz"]].sum(0)
    vb = (fr > CFG["analysis"]["vox_hz"][0]) & (fr < CFG["analysis"]["vox_hz"][1])
    vox = (Hh ** 2)[vb].sum(0)
    perc, harm = (Pp ** 2).sum(0), (Hh ** 2).sum(0)
    chroma = librosa.feature.chroma_stft(S=Hh ** 2, sr=SR, n_fft=n_fft)
    floor = CFG["analysis"]["db_floor"]

    def seg_mean(x, a, b):
        m = (ft >= a) & (ft < b)
        return x[..., m].mean(-1) if m.sum() else (x[..., [min(np.searchsorted(ft, a), len(ft) - 1)]].mean(-1))

    def db(v):
        return np.maximum(10 * np.log10(np.maximum(v, 1e-30)), floor)

    edges = list(g) + [dur]
    B_tot = np.array([seg_mean(tot, a, b) for a, b in zip(edges[:-1], edges[1:])])
    B_low = np.array([seg_mean(low, a, b) for a, b in zip(edges[:-1], edges[1:])])
    B_vox = np.array([seg_mean(vox, a, b) for a, b in zip(edges[:-1], edges[1:])])
    B_pr = np.array([seg_mean(perc, a, b) / max(seg_mean(harm, a, b), 1e-30) for a, b in zip(edges[:-1], edges[1:])])
    C = np.array([seg_mean(chroma, a, b) for a, b in zip(edges[:-1], edges[1:])])
    rel = db(B_tot) - np.percentile(db(B_tot), 90)
    lrel = db(B_low) - np.percentile(db(B_low), 90)
    vref = np.percentile(db(B_vox), 90)
    vrel = db(B_vox) - vref
    prel = db(B_pr)
    C = C - C[rel > np.percentile(rel, CFG["analysis"]["chroma_floor_pct"])].mean(0)
    C = C / (np.linalg.norm(C, axis=1, keepdims=True) + 1e-9)
    bedges = list(bt) + [dur]
    beat_vox = np.array([db(seg_mean(vox, a, b)) - vref for a, b in zip(bedges[:-1], bedges[1:])])

    # sections, labels, phrase grid
    segs = [x for x in (s["segments"] if s else []) if x["label"] not in ("start", "end")]
    sections = [{"start": r(x["start"]), "end": r(x["end"]), "label": x["label"],
                 "bar": int(np.argmin(np.abs(g - x["start"])))} for x in segs]
    label = ["unlabelled"] * nb
    for x in segs:
        for i in range(nb):
            if x["start"] - 0.1 <= g[i] < x["end"] - 0.1:
                label[i] = x["label"]
    bar_s = float(np.median(np.diff(g)))
    P = 1
    while P * bar_s < CFG["phrase_min_s"]:
        P *= 2
    votes = np.zeros(P)
    for x in sections:
        if x["bar"] > 0:
            votes[x["bar"] % P] += 1
    phase = int(np.argmax(votes))
    conf = float(votes[phase] / max(1, votes.sum()))
    loud = np.where(rel > CFG["analysis"]["last_loud_db"])[0]
    last_loud = int(loud[-1])
    active = (float(g[loud[0]]), float(edges[last_loud + 1]))

    # fits and classes (§4.2)
    w = np.where(refined == 1, CFG["analysis"]["fit_w_refined"], CFG["analysis"]["fit_w_unrefined"])
    bpm_a1 = float(s["bpm"]) if s else None
    octave_ok = bpm_a1 is None or abs(np.log(t["bpm"] / bpm_a1)) < CFG["analysis"]["octave_tol_ln"]
    fit = fit_grid(bt, w, *active)
    cls = classify(fit, meter_ok, octave_ok, bpb)

    def winfit(j0: int, j1: int) -> dict:
        t0, t1 = float(g[max(0, j0)]), float(edges[min(nb, j1)])
        f = fit_grid(bt, w, t0, t1)
        return {"t0": r(t0), "t1": r(t1), "fit": f, "cls": classify(f, meter_ok, octave_ok, bpb)}

    def bar_time(j: int, wf: dict) -> float:
        if j >= nb:
            return dur
        f = wf["fit"]
        return float(f["phase_s"] + bar_beat[j] * f["period_s"]) if wf["cls"] != "free" and f else float(g[j])

    # onsets summary
    body = [i for i in range(nb) if g[i] >= active[0] and g[i] < active[1]]
    ds = []
    for i in body:
        k = np.where(np.abs(on_t - g[i]) <= win)[0]
        if len(k):
            ds.append(on_s[k].max())
    med_down = float(np.median(ds)) if ds else 1.0

    # landings (§5): candidates, refinement, veto, drop promotion, leads, exits, H
    bounds = sorted({x["bar"] for x in sections} | {nb})

    def refine_j(j: int) -> int:
        if conf >= H["phrase_conf_min"]:
            for k in (j, j - 1, j + 1):
                if 1 <= k < nb and (k - phase) % P == 0 and rel[k] >= CFG["land_min_rel_db"]:
                    return k
        # REVIEW-external-1 #1 (as highlights.refine_bar): keep j unless a neighbour beats it by
        # land_move_db (the fixture JSON was generated before this fix and is not regenerated)
        sc = {k: (rel[k] - rel[k - 1]) + H["land_low_w"] * (lrel[k] - lrel[k - 1])
              for k in (j - 1, j, j + 1) if 1 <= k < nb and rel[k] >= CFG["land_min_rel_db"]}
        if not sc:
            return j
        if j not in sc:
            return max(sc, key=lambda k: (sc[k], -k))
        best = max((k for k in sc if k != j), key=lambda k: (sc[k], -k), default=None)
        return best if best is not None and sc[best] > sc[j] + H["land_move_db"] else j

    raw: dict[int, list[str]] = {}
    for x in sections:
        raw.setdefault(refine_j(x["bar"]), []).append(x["label"])
    for j in range(4, nb - 2):
        cd = rel[j:j + 2].mean() - rel[j - 4:j].mean()
        cl = lrel[j:j + 2].mean() - lrel[j - 4:j].mean()
        if cd >= CFG["arrival_db"] or cl >= CFG["arrival_low_db"]:
            k = refine_j(j)
            if not any(abs(k - q) <= 1 for q in raw):
                raw.setdefault(k, []).append(f"arrival+{cd:.0f}dB")

    def section_end(j: int) -> int:
        return next((b for b in bounds if b > j), nb)

    def rep(j: int, L: int) -> float:
        best = -1.0
        for k in range(0, nb - L):
            if abs(k - j) >= L:
                best = max(best, float(np.mean(np.sum(C[j:j + L] * C[k:k + L], 1))))
        return best

    def lead(j: int) -> dict:
        lcap = min(CFG["lead_max_bars"], int(CFG["lead_max_s"] / bar_s))
        for pk in range(0, H["fill_bars_max"] + 1):
            L = 0
            while L + pk < lcap and j - pk - L - 1 >= 0 and lrel[j - pk - L - 1] <= H["nobass_low_db"]:
                L += 1
            if L >= H["nobass_min_bars"]:
                nod = sum(prel[j - pk - i - 1] < H["nodrums_perc_db"] for i in range(L))
                return {"type": "nobass-nodrums" if nod >= L / 2 else "nobass-drums", "bars": L + pk,
                        "fill_bars": pk}
        bm = rel[j:j + 4].mean()
        for L in H["build_L"]:
            if j - L >= 0 and bm - rel[j - L:j].mean() >= CFG["build_db"]:
                return {"type": "build", "bars": L, "fill_bars": 0}
        for L in H["break_L"]:
            if j - L >= 0 and (bm - rel[j - L:j].mean() >= CFG["break_db"] or
                               lrel[j:j + 4].mean() - lrel[j - L:j].mean() >= CFG["break_low_db"]):
                return {"type": "break", "bars": L, "fill_bars": 0}
        return {"type": "none", "bars": 0, "fill_bars": 0}

    def pickup(j: int) -> int:
        k = int(bar_beat[j])
        best = 0
        for p in (1, 2):
            if k - 2 * p < 0:
                break
            last, before = beat_vox[k - p:k].mean(), beat_vox[k - 2 * p:k - p].mean()
            if last >= vrel[j] - CFG["pickup_vox_db"] and last >= before + CFG["pickup_vox_db"]:
                best = p
        return best

    lands = []
    for j, why in raw.items():
        if j < 1 or j >= nb - 8:
            continue
        je = section_end(j)
        if rel[j:je].mean() <= CFG["veto_rel_db"] or lrel[j:je].mean() <= CFG["veto_low_db"]:
            continue                                     # a breakdown, never a landing (§5.1 veto)
        lab = label[j]
        prior = H["prior"].get(lab, 0.3) if segs else H["prior"]["unlabelled"]
        contrast = float(rel[j:j + 2].mean() - rel[max(0, j - 4):j].mean())
        lowjump = float(lrel[j:j + 2].mean() - lrel[max(0, j - 4):j].mean())
        if lab in ("inst", "solo", "chorus") and contrast >= H["drop_contrast_db"] and lowjump >= H["drop_low_db"]:
            prior = max(prior, H["drop_prior"])
            why = why + ["drop"]
        ld = lead(j)
        ld["pickup_beats"] = pickup(j)
        bwin = winfit(j - CFG["relation"]["entry_bars"] - 1, j + CFG["relation"]["b_after_bars"])
        tj = bar_time(j, bwin)
        k = np.where(np.abs(on_t - tj) <= H["land_onset_ms"] / 1000)[0]
        o_err = float((on_t[k[np.argmax(on_s[k])]] - tj) * 1000) if len(k) else None
        o_str = float(on_s[k].max() / med_down) if len(k) else None
        onset_ok = bool(o_str is not None and o_str >= H["land_onset_ratio"])
        ld["t"] = r(bar_time(j - ld["bars"], bwin))
        lq = H["lead_q"][ld["type"]]
        on_grid = conf < H["phrase_conf_min"] or (j - phase) % P == 0
        early = g[j] < H["early_s"] or g[j] < H["early_frac"] * dur
        exits = []
        for n in CFG["body_bars_allowed"]:
            X = j + n
            if X > nb or not (CFG["body_s"][0] <= n * bar_s <= CFG["body_s"][1]):
                continue
            if (ld["bars"] + n) * bar_s > CFG["lead_body_max_s"]:
                continue
            if not (X in bounds or (X - phase) % P == 0) or X >= last_loud:
                continue
            level = float(rel[j:X].mean())
            nxt = rel[X:X + 4]
            natural = bool(len(nxt) and nxt.mean() <= level - CFG["natural_exit_db"])
            dip = bool(rel[X - 1] <= level - CFG["dip_db"])
            tail48 = bool(X + 4 <= nb and np.all(np.abs(rel[X:X + 4] - level) <= H["tail_db"]))
            lull = float(np.mean(rel[j:X] < -5))
            fade = X >= last_loud - 1
            kx = int(bar_beat[X]) if X < nb else len(bt)
            k2 = int(bar_beat[X - 2])
            vedge = bool(beat_vox[kx - 1] >= np.median(beat_vox[k2:k2 + bpb]) - H["vocal_edge_vox_db"])
            so = H["s_out"]
            s_out = so["natural"] * natural + so["dip"] * dip + so["in_fade_or_lull"] * (fade or lull > 0) \
                + so["vocal_at_edge"] * vedge
            dur_s = (ld["bars"] + n) * bar_s
            hh = H["h"]
            h = (prior + hh["level"] * level + hh["contrast"] * min(contrast, hh["contrast_cap"])
                 + hh["rep"] * max(rep(j, min(hh["rep_bars"], n)), 0) + hh["lead_q"] * lq
                 + hh["exit"] * (natural or tail48) + hh["on_grid"] * on_grid + hh["lull"] * lull
                 + hh["ends_in_fade"] * fade + hh["early"] * early + hh["dur"] * abs(dur_s - hh["dur_target_s"]))
            awin = winfit(X - 16, X + 1)
            exits.append({"n": n, "bar": X, "t": r(bar_time(X, awin)),
                          "kind": "natural" if natural else "dip" if dip else "tail" if tail48 else "end",
                          "s_out": r(s_out, 3), "tail48": tail48, "natural": natural, "dip": dip,
                          "in_fade_or_lull": bool(fade or lull > 0), "vocal_at_edge": vedge,
                          "level_db": r(level, 2), "dur_s": r(dur_s, 2), "h": r(h, 4), "win": awin})
        if not exits:
            continue
        exits.sort(key=lambda e: -e["h"])
        lands.append({"bar": j, "t": r(tj), "label": lab, "why": "+".join(why), "rel_db": r(rel[j], 2),
                      "prior": r(prior, 3), "contrast_db": r(contrast, 2), "low_jump_db": r(lowjump, 2),
                      "onset_ok": onset_ok, "onset_err_ms": r(o_err, 1), "onset_strength": r(o_str, 3),
                      "lead": {"type": ld["type"], "bars": ld["bars"], "t": ld["t"],
                               "pickup_beats": ld["pickup_beats"], "fill_bars": ld["fill_bars"]},
                      "exits": exits, "h": exits[0]["h"], "win": bwin})
    lands.sort(key=lambda d: (-d["h"], d["bar"]))
    st = os.stat(path)
    F = {
        "version": FEATS_VERSION, "track": t["id"], "file": os.path.basename(path),
        "sig": f"{st.st_size}:{int(st.st_mtime)}:{t['version']}", "duration": r(dur, 3), "bpb": bpb,
        "bpm": r(60 / fit["period_s"], 3) if fit else float(t["bpm"]), "bpm_bt": float(t["bpm"]),
        "bpm_a1": bpm_a1, "meter_ok": bool(meter_ok), "octave_ok": bool(octave_ok), "grid_src": src,
        "grid_class": cls, "fit": fit, "active": [r(active[0]), r(active[1])],
        "beats": {"t": [r(x) for x in bt], "refined": refined.tolist(), "pos": pos.tolist(),
                  "vox_db": [r(x, 2) for x in beat_vox]},
        "bars": {"t": [r(x) for x in g], "beat": bar_beat.tolist(), "rel_db": [r(x, 2) for x in rel],
                 "low_db": [r(x, 2) for x in lrel], "perc_db": [r(x, 2) for x in prel],
                 "vox_db": [r(x, 2) for x in vrel], "chroma": [[r(v, 4) for v in row] for row in C],
                 "label": label},
        "sections": sections, "phrase": {"P": P, "phase": phase, "conf": r(conf, 3)},
        "last_loud_bar": last_loud,
        "onsets": {"t": on_t.tolist(), "strength": [g6(v) for v in on_s], "median_down_strength": g6(med_down)},
        "kblocks": {"block_s": CFG["analysis"]["kblock_s"], "hop_s": CFG["analysis"]["kblock_hop_s"],
                    "ms": kblocks(y)},
        "stems": False, "landings": lands[: H["top_landings"]],
    }
    import pyloudnorm
    ref = pyloudnorm.Meter(SR).integrated_loudness(y.astype(np.float64))
    mine = lufs_window(F["kblocks"]["ms"], 0.0, dur)
    print(f"  {name}: {len(bt)} beats ({refined.mean():.0%} refined), {nb} bars, class {cls} "
          f"(rms {fit and fit['rms_ms']} ms), P={P} phase={phase} conf={conf:.2f}, {len(on_t)} onsets, "
          f"LUFS kblocks {mine:.3f} vs pyloudnorm {ref:.3f}")
    for ld in F["landings"]:
        e = ld["exits"][0]
        print(f"    land bar {ld['bar']} {ld['t']:.2f}s {ld['label']} ({ld['why']}) lead {ld['lead']['type']} "
              f"{ld['lead']['bars']} pickup {ld['lead']['pickup_beats']} onset_ok {ld['onset_ok']} | "
              f"best exit n={e['n']} {e['t']:.2f}s {e['kind']} h={e['h']:.2f}")
    return F


def make_feats() -> None:
    for name, sid in TRACKS.items():
        F = build_feats(name, sid)
        iss = S.validate_feats(F)
        assert not iss, iss[:5]
        with open(os.path.join(HERE, f"feats_{name}.json"), "w") as fh:
            fh.write(S.to_json(F))


# ------------------------------------------------------------------ composition, program, plan
COMP_810 = {  # DESIGN.md §8.10 verbatim, except the real track ids and the real hash
    "id": "j01", "a": "spotify:" + TRACKS["dance_no_more"], "b": "spotify:" + TRACKS["dreaming"],
    "form": "drop_swap", "variant": "L4.pulse-offbeat", "tier": "smooth", "loud": False, "b_in": "swap",
    "rel": {"kind": "lock", "ratio": 0.99189, "a_ratio": 1, "stretch_pct": -0.81, "camelot": 2,
            "chroma": 0.22, "a_class": "locked", "b_class": "locked"},
    "bpb": 4,
    "a_ref": {"exit_bar": 40, "exit_t": 76.14, "period_s": 0.472367},
    "b_ref": {"land_bar": 80, "land_t": 152.68, "period_s": 0.476228},
    "clock": [{"m0": -28, "m1": -24, "kind": "a_fit", "bpm0": 127.02, "bpm1": 127.02},
              {"m0": -24, "m1": -16, "kind": "ramp", "bpm0": 127.02, "bpm1": 125.99},
              {"m0": -16, "m1": 4, "kind": "b_fit", "bpm0": 125.99, "bpm1": 125.99}],
    "span": {"from": -28, "to": 4},
    "clips": [{"id": "A", "src": "a", "stem": "mix", "at": -28, "len": 28, "u0": -28, "ratio": 1,
               "warp": "r2", "gain_db": 0},
              {"id": "B", "src": "b", "stem": "mix", "at": -16, "len": 20, "u0": -16, "ratio": 1,
               "warp": "native", "gain_db": 0}],
    "moves": [{"type": "eq", "clip": "B", "band": "low", "at": -16, "len": 0, "to_db": None, "curve": "hold"},
              {"type": "fade", "clip": "B", "at": -16, "len": 15, "from_db": -12, "to_db": 0, "shape": "pulse",
               "pattern": "offbeat", "floor_db": -12},
              {"type": "eq", "clip": "A", "band": "mid_high", "at": -16, "len": 15, "to_db": -8, "curve": "lin"},
              {"type": "eq", "clip": "A", "band": "low", "at": -0.5, "len": 0, "to_db": None, "curve": "hold"},
              {"type": "fade", "clip": "A", "at": -1, "len": 1, "from_db": 0, "to_db": None, "shape": "cos"},
              {"type": "swap", "at": 0, "out": ["A"], "in": ["B"], "band": "low", "ms": 4}],
    "events": [[-16, 0, "Dreaming breakdown in, pulsed on the offbeat"], [-16, 0, "A mids/highs -8 dB (3A vs 5A)"],
               [-0.5, 0, "air: A bass out"], [0, 0, "land: Dreaming drop 2:32.68"]],
    "fallback": ["phrase_trade", "roll_slam", "cut_on_one"], "hash": "",
}


def compile_drop_swap(comp: dict, fa: dict, fb: dict) -> S.Program:
    """Hand compile of the §8.10 composition into a §12 Program (what E2's compile_join must
    produce for it, up to knot placement details)."""
    xf = int(0.015 * SR)
    xf_s = xf / SR
    clock, span = comp["clock"], comp["span"]

    def tm(m):
        return float(S.clock_seconds(clock, [m])[0])

    T, t_land = tm(span["to"]), tm(0)
    cm, ct = S.tabulate_clock(clock, span)
    pa, ea = comp["a_ref"]["period_s"], comp["a_ref"]["exit_t"]
    pb, lb = comp["b_ref"]["period_s"], comp["b_ref"]["land_t"]
    pad = CFG["compile"]["reach_pad_s"]
    # A: r2 onto the master clock; anchors = A's fitted beats u = -29..1 (reach +-1 beat)
    us = np.arange(-29, 2)
    src = [ea + u * pa for u in us]
    dst = [pad + tm(u) - tm(-29) for u in us]
    s0a, s1a = src[0] - pad, src[-1] + pad
    w_len = dst[-1] + pad * (60 / 125.99) / pa
    A = S.ClipProgram(
        id="A", src="a", stems="mix",
        source={"kind": "r2", "s0": r(s0a, 6), "s1": r(s1a, 6),
                "src_anchors": [r(s0a, 6)] + [r(x, 6) for x in src] + [r(s1a, 6)],
                "dst_anchors": [0.0] + [r(x, 6) for x in dst] + [r(w_len, 6)], "w_len": r(w_len, 6)},
        pos=[{"t0": r(-xf_s, 6), "t1": r(t_land, 6), "kind": "copy", "w0": r(pad - tm(-29) - xf_s, 6)}],
        gain_db=[[r(tm(-1), 6), 0.0, "cos"], [r(t_land, 6), None, "hold"]], hp_hz=None, lp_hz=None,
        eq_db={"low": [[r(tm(-0.5), 6), 0.0, "hold"], [r(tm(-0.5), 6), None, "hold"]],
               "mid": [[r(tm(-16), 6), 0.0, "lin"], [r(tm(-1), 6), -8.0, "hold"]],
               "high": [[r(tm(-16), 6), 0.0, "lin"], [r(tm(-1), 6), -8.0, "hold"]]},
        trim_db=0.0, track_gain_from="a")
    # B: native from its first audible point; pulsed eqpow fade -12 -> 0 over [-16, -1)
    b_in_start = lb + (-16) * pb
    t_b = tm(-16)
    pre = CFG["splice_pre_ms"] / 1000
    s0b, s1b = b_in_start - pb - pad, b_in_start + (T + xf_s - t_b) + pb + pad
    pat = CFG["forms"]["pulse_patterns"]["offbeat"]
    ramp = CFG["pulse_ramp_ms"] / 2000
    knots = []
    prev = None
    for k in range(15 * 4 + 1):
        m = -16 + k / 4
        G = float(S.ramp_db(-12, 0, np.array([min(1.0, (m + 16) / 15)]), "eqpow")[0])
        v = G + (0.0 if k < 60 and pat[k % 16] == "x" else -12.0) if k < 60 else 0.0
        tk = tm(m)
        if prev is None:
            knots.append([r(tk, 6), r(v, 3), "lin"])
        elif abs(v - prev) > 1e-9:
            knots.append([r(tk - ramp, 6), r(prev, 3), "lin"])
            knots.append([r(tk + ramp, 6), r(v, 3), "lin"])
        prev = v
    knots[-1][2] = "hold"
    B = S.ClipProgram(
        id="B", src="b", stems="mix", source={"kind": "native", "s0": r(s0b, 6), "s1": r(s1b, 6)},
        pos=[{"t0": r(t_b - pre, 6), "t1": r(T + xf_s, 6), "kind": "copy", "w0": r(b_in_start - pre - s0b, 6)}],
        gain_db=knots, hp_hz=None, lp_hz=None,
        eq_db={"low": [[r(t_b, 6), None, "hold"], [r(t_land - 0.004, 6), None, "lin"], [r(t_land, 6), 0.0, "hold"]],
               "mid": [], "high": []},
        trim_db=0.0, track_gain_from="b")

    def near(F, s, ms):
        o = np.asarray(F["onsets"]["t"])
        k = np.where(np.abs(o - s) <= ms / 1000)[0]
        return float(o[k[np.argmin(np.abs(o[k] - s))]]) if len(k) else None

    ob = near(fb, b_in_start, CFG["compile"]["splice_onset_ms"])
    ol = near(fb, lb, CFG["compile"]["splice_onset_ms"])
    oa = near(fa, ea - 0.5 * pa, CFG["compile"]["splice_low_onset_ms"])
    splices = [
        S.Splice(t=r((t_b + ob - b_in_start if ob else t_b) - pre, 6), clip="B", kind="edge_in",
                 onset=r(t_b + ob - b_in_start, 6) if ob else None, xf_ms=CFG["splice_xf_ms"], search_ms=0.0),
        S.Splice(t=r(tm(-0.5) + (oa - (ea - 0.5 * pa)) - pre if oa else tm(-0.5), 6), clip="A", kind="eq",
                 onset=r(tm(-0.5) + oa - (ea - 0.5 * pa), 6) if oa else None,
                 xf_ms=CFG["splice_xf_ms"] if oa else CFG["splice_xf_low_ms"], search_ms=0.0),
        S.Splice(t=r(t_land - 0.004, 6), clip="B", kind="swap", onset=r(t_land + (ol - lb), 6) if ol else None,
                 xf_ms=4.0, search_ms=0.0),
    ]
    grid = [[r(tm(m), 6), m % 4 == 0, "both" if -16 <= m < 0 else "a" if m < -16 else "b"]
            for m in range(span["from"], span["to"] + 1)]
    events = [[r(tm(a), 6), r(tm(b), 6), lab] for a, b, lab in comp["events"]]

    def audible_onsets(F, clip, s_lo, s_hi, to_t):
        o, st_ = np.asarray(F["onsets"]["t"]), np.asarray(F["onsets"]["strength"])
        sel = (o >= s_lo) & (o < s_hi)
        ts = np.array([to_t(x) for x in o[sel]])
        g = S.eval_knots(clip.gain_db, ts, "db") if len(ts) else np.array([])
        return [[r(t, 6), g6(s)] for t, s, gg in zip(ts, st_[sel], g) if gg >= -20]

    expect = {
        "land_t": r(t_land, 6), "vacuums": [], "layered": [[r(t_b, 6), r(t_land, 6)]],
        "tonal": [[r(t_b, 6), r(t_land, 6)]], "ramps": [[r(tm(-24), 6), r(tm(-16), 6)]],
        "step_planned_lu": None, "silences": [], "gestures": [], "seams": [],
        "onsets": {"A": audible_onsets(fa, A, ea - 28 * pa, ea, lambda s: tm((s - ea) / pa)),
                   "B": audible_onsets(fb, B, b_in_start, b_in_start + T - t_b, lambda s: t_b + s - b_in_start)},
    }
    return S.Program(version=COMPILER_VERSION, sr=SR, xf=xf, T=r(T, 6), t_land=r(t_land, 6),
                     clock_m=[r(x, 6) for x in cm], clock_t=[r(x, 6) for x in ct], clips=[A, B],
                     echoes=[], splices=splices, grid=grid, events=events, expect=expect)


def make_plan(comp: dict, prog: S.Program, fa: dict, fb: dict) -> dict:
    """A two-song SessionPlanMedley around j01, built from the feats fixtures and the program."""
    from automix.params import defaults
    p = defaults()

    def tm(m):
        return float(S.clock_seconds(comp["clock"], [m])[0])

    pa, pb = comp["a_ref"]["period_s"], comp["b_ref"]["period_s"]
    a_out_start = comp["a_ref"]["exit_t"] + comp["span"]["from"] * pa
    b_in_start = comp["b_ref"]["land_t"] - 16 * pb
    b_in_end = b_in_start + (tm(comp["span"]["to"]) - tm(-16))
    la = next(ld for ld in fa["landings"] if ld["bar"] < comp["a_ref"]["exit_bar"])
    lb = next(ld for ld in fb["landings"] if abs(ld["bar"] - comp["b_ref"]["land_bar"]) <= 1)
    eb = lb["exits"][0]
    ex = []
    for F, ld, lead, land, exit_ in (
            (fa, la, la["lead"], {"bar": la["bar"], "t": la["t"]},
             {"bar": comp["a_ref"]["exit_bar"], "t": comp["a_ref"]["exit_t"], "kind": "natural", "s_out": 0.4}),
            (fb, lb, {**lb["lead"], "type": "nobass-nodrums", "bars": 4, "t": r(b_in_start)},
             {"bar": comp["b_ref"]["land_bar"], "t": comp["b_ref"]["land_t"]},
             {"bar": eb["bar"], "t": eb["t"], "kind": eb["kind"], "s_out": eb["s_out"]})):
        lufs = lufs_window(F["kblocks"]["ms"], lead["t"], exit_["t"])
        gain = float(np.clip(p["target_lufs"] + 0 - lufs, -CFG["excerpt_gain_clamp_db"], CFG["excerpt_gain_clamp_db"]))
        labels = sorted({F["bars"]["label"][i] for i in range(land["bar"], exit_["bar"])})
        ex.append({"track": F["track"], "block": "house", "bpb": F["bpb"], "grid_class": F["grid_class"],
                   "bpm": F["bpm"],
                   "lead": {"type": lead["type"], "bars": lead["bars"], "t": lead["t"],
                            "pickup_beats": lead["pickup_beats"]},
                   "land": {"bar": land["bar"], "t": land["t"], "label": F["bars"]["label"][land["bar"]],
                            "why": ld["why"], "rel_db": F["bars"]["rel_db"][land["bar"]]},
                   "exit": {**exit_, "vocal_clear": None}, "body_bars": exit_["bar"] - land["bar"],
                   "body_lufs": r(lufs, 2), "arc_off_lu": 0, "gain_db": r(gain, 2),
                   "h": ld["h"], "labels": labels})
    tr = {"index": 0, "key": f"{comp['a']}>{comp['b']}", "a": comp["a"], "b": comp["b"], "style": "medley",
          "beatmatch": True, "a_out_start": r(a_out_start, 6), "a_out_end": comp["a_ref"]["exit_t"],
          "b_in_start": r(b_in_start, 6), "b_in_end": r(b_in_end, 6), "T": prog.T, "T_overlap": prog.t_land,
          "bars": (comp["span"]["to"] - comp["span"]["from"]) / comp["bpb"],
          "reason": "drop_swap · lead nobass-nodrums 4 bars · lock -0.8% · cam 2", "key_distance": 2,
          "stretch_pct": -0.81, "k": 1.0, "requested": "medley", "override": {},
          "form": comp["form"], "variant": comp["variant"], "tier": comp["tier"], "b_in": comp["b_in"],
          "land_s": comp["b_ref"]["land_t"], "exit_s": comp["a_ref"]["exit_t"], "b_enter_s": r(tm(-16), 6),
          "grid": prog.grid, "events_s": prog.events, "checks_summary": None, "composition": comp}
    first = ex[0]["lead"]["t"]
    dur_b = fb["duration"]
    final_end = dur_b if dur_b - eb["t"] <= CFG["loudness"]["final_end_within_s"] else eb["t"]
    total = (a_out_start - first) + prog.T + (final_end - b_in_end)
    ta, tb = load_track(TRACKS["dance_no_more"])[0], load_track(TRACKS["dreaming"])[0]

    def row(t, e, start):
        return {"id": t["id"], "artist": t["artist"], "title": t["title"], "file": t["file"], "bpm": t["bpm"],
                "camelot": t["camelot"], "key": f"{t['key']} {t['scale']}", "regularity": t["beat_regularity"],
                "lufs": round(t["lufs"], 1), "duration": t["duration"], "start": r(start, 3),
                "excerpt": {"lead_t": e["lead"]["t"], "land_t": e["land"]["t"], "exit_t": e["exit"]["t"],
                            "lead_type": e["lead"]["type"], "labels": e["labels"]}}

    bar_a = 4 * fa["fit"]["period_s"]
    return {
        "kind": "medley", "order": [row(ta, ex[0], 0.0), row(tb, ex[1], (a_out_start - first) + tr["b_enter_s"])],
        "transitions": [tr], "total_seconds": r(total, 3), "native_starts": [first, tr["b_in_end"]],
        "first_fade_s": r(bar_a, 3) if fa["bars"]["rel_db"][la["bar"] - la["lead"]["bars"]] > -6 else 0,
        "final_end": final_end, "final_fade_s": 0 if final_end >= dur_b else r(8 * pb, 3),
        "medley": {"schema": S.SCHEMA_ID, "medley_version": MEDLEY_VERSION, "compiler": COMPILER_VERSION,
                   "seed": 12345, "target_s": CFG["target_s"], "excerpts": ex, "motif": None, "needs_prep": [],
                   "excluded": [], "stats": {"songs": 2, "total_s": r(total, 3),
                                             "tiers": {"smooth": 1, "noticeable": 0, "signature": 0},
                                             "verified": 0, "warned": 0, "failed": 0, "unverified": 1}},
    }


def roll_slam_comp(fa: dict, fb: dict) -> dict:
    """A free-relation roll_slam (§10.9): Dreaming's exit (bar 96) -> Bluebird's inst drop
    (bar 48). A native on its own fitted clock, roll + HP rise from -8, vacuum [-1/2, 0), tempo
    step at m = 0, B slams native. Exercises rules 6/7 (gestures, the step)."""
    la = next(ld for ld in fa["landings"] if ld["bar"] == 80)
    ea = next(e for e in la["exits"] if e["bar"] == 96)
    lb = next(ld for ld in fb["landings"] if ld["bar"] == 48)
    pa, pb = ea["win"]["fit"]["period_s"], lb["win"]["fit"]["period_s"]
    comp = {
        "id": "j02", "a": fa["track"], "b": fb["track"], "form": "roll_slam", "variant": "roll",
        "tier": "noticeable", "loud": True, "b_in": "slam",
        "rel": {"kind": "free", "ratio": r((60 / pb) / (60 / pa), 5), "a_ratio": 1, "stretch_pct": 0.0,
                "camelot": 2, "chroma": None, "a_class": ea["win"]["cls"], "b_class": lb["win"]["cls"]},
        "bpb": fb["bpb"],
        "a_ref": {"exit_bar": ea["bar"], "exit_t": ea["t"], "period_s": pa},
        "b_ref": {"land_bar": lb["bar"], "land_t": lb["t"], "period_s": pb},
        "clock": [{"m0": -12, "m1": 0, "kind": "a_fit", "bpm0": 60 / pa, "bpm1": 60 / pa},
                  {"m0": 0, "m1": 4, "kind": "b_fit", "bpm0": 60 / pb, "bpm1": 60 / pb}],
        "span": {"from": -12, "to": 4},
        "clips": [{"id": "A", "src": "a", "stem": "mix", "at": -12, "len": 12, "u0": -12, "ratio": 1,
                   "warp": "native", "gain_db": 0},
                  {"id": "B", "src": "b", "stem": "mix", "at": 0, "len": 4, "u0": 0, "ratio": 1,
                   "warp": "native", "gain_db": 0}],
        "moves": [{"type": "filter", "clip": "A", "kind": "hp", "at": -8, "len": 7.5, "hz": [40, 1000],
                   "curve": "exp"},
                  {"type": "roll", "clip": "A", "at": -8, "sizes": CFG["roll_sizes"], "slip": False,
                   "taper_db": -3},
                  {"type": "vacuum", "at": -0.5, "len": 0.5}],
        "events": [[-8, -0.5, "roll 2 / 1 / 1/2 / 1/4 with the HP rising"], [-0.5, 0, "vacuum"],
                   [0, 0, "land: Bluebird inst drop 1:06.62"]],
        "fallback": ["echo_slam", "cut_on_one"], "hash": "",
    }
    comp["hash"] = S.canonical_hash(comp)
    return comp


def make_comp() -> None:
    fa = json.load(open(os.path.join(HERE, "feats_dance_no_more.json")))
    fb = json.load(open(os.path.join(HERE, "feats_dreaming.json")))
    comp = dict(COMP_810)
    comp["hash"] = S.canonical_hash(comp)
    S.ensure_valid(S.validate_composition(comp, fa, fb), "composition")
    with open(os.path.join(HERE, "comp_drop_swap.json"), "w") as fh:
        fh.write(S.to_json(comp, indent=1))
    prog = compile_drop_swap(comp, fa, fb)
    S.ensure_valid(S.validate_program(prog), "program")
    with open(os.path.join(HERE, "program_drop_swap.json"), "w") as fh:
        fh.write(S.to_json(prog))
    fc = json.load(open(os.path.join(HERE, "feats_bluebird.json")))
    roll = roll_slam_comp(fb, fc)
    S.ensure_valid(S.validate_composition(roll, fb, fc), "roll_slam composition")
    with open(os.path.join(HERE, "comp_roll_slam.json"), "w") as fh:
        fh.write(S.to_json(roll, indent=1))
    plan = make_plan(comp, prog, fa, fb)
    S.ensure_valid(S.validate_plan(plan, feats={fa["track"]: fa, fb["track"]: fb}), "plan")
    with open(os.path.join(HERE, "plan_drop_swap.json"), "w") as fh:
        fh.write(S.to_json(plan))
    print("comp hash", comp["hash"], "T", prog.T, "t_land", prog.t_land,
          "onsets A/B", len(prog.expect["onsets"]["A"]), len(prog.expect["onsets"]["B"]))


if __name__ == "__main__":
    args = set(sys.argv[1:]) or {"--feats", "--comp"}
    if "--feats" in args:
        make_feats()
    if "--comp" in args:
        make_comp()
