"""Highlights: landing candidates, lead types, exits and the highlight score (DESIGN §5; a port
of the hl3 prototype with every threshold read from CFG).

All functions take a Feats `F` (lists or numpy arrays); the `t` argument (the track dict) is
accepted for the contract signatures and is not needed. Bars are consensus bar indices; times
are native seconds on the window's fitted grid when that window is locked/verify (§4.2).

Public: landings(t, F) -> [Landing] (top 3, best h first), lead_type(F, j) -> Lead,
exits(t, F, j) -> [Exit] (best h first), H(t, F, j, n) -> float, s_out(t, F, X, next_lock, j)
-> float, novelty_sections(...) for tracks without all-in-one labels (§5.1 step 5).
"""

from __future__ import annotations

import numpy as np

from . import CFG
from .grid import bar_time, fit_bars

HL = CFG["highlight"]


def _r(x, n=3):
    return None if x is None else round(float(x), n)


class Ctx:
    """Per-track arrays derived once from a Feats."""

    def __init__(self, F: dict, c: dict = CFG):
        self.F, self.c = F, c
        bars = F["bars"]
        self.g = np.asarray(bars["t"], float)
        self.nb = len(self.g)
        self.bidx = np.asarray(bars["beat"], int)
        self.rel = np.asarray(bars["rel_db"], float)
        self.low = np.asarray(bars["low_db"], float)
        self.perc = np.asarray(bars["perc_db"], float)
        self.vox = np.asarray(bars["vox_db"], float)
        self.C = np.asarray(bars["chroma"], float).reshape(self.nb, 12)
        self.label = list(bars["label"])
        self.beat_vox = np.asarray(F["beats"]["vox_db"], float)
        vs = F["beats"].get("vox_stem_db")
        self.beat_vstem = np.asarray(vs, float) if (F.get("stems") and vs is not None) else None
        vg = bars.get("vox_run_s")
        self.vrun = np.asarray(vg, float) if (F.get("stems") and vg is not None) else None
        self.vocal_track = bool(F.get("vocal_track", True))
        self.nbeats = len(self.beat_vox)
        self.bpb = int(F["bpb"])
        self.bar_s = float(np.median(np.diff(self.g))) if self.nb > 1 else 2.0
        ph = F["phrase"]
        self.P, self.phase, self.conf = int(ph["P"]), int(ph["phase"]), float(ph["conf"])
        self.bounds = sorted({int(s["bar"]) for s in F["sections"]} | {self.nb})
        self.labelled = any(s["label"] != "unlabelled" for s in F["sections"])
        self.last_loud = int(F["last_loud_bar"])
        self.dur = float(F["duration"])
        on = F["onsets"]
        self.on_t, self.on_s = np.asarray(on["t"], float), np.asarray(on["strength"], float)
        self.med_down = float(on["median_down_strength"]) or 1.0
        self._rep: dict = {}
        self._win: dict = {}

    def win(self, j0: int, j1: int) -> dict:
        if (j0, j1) not in self._win:
            self._win[(j0, j1)] = fit_bars(self.F, j0, j1, self.c)
        return self._win[(j0, j1)]

    def b_win(self, j: int) -> dict:
        """B-side window [j - E - 1 bars, j + 8 bars] with E = 8 (§7)."""
        rc = self.c["relation"]
        return self.win(j - rc["entry_bars"] - rc["b_pre_bars"], j + rc["b_after_bars"])

    def a_win(self, X: int) -> dict:
        """A-side window [X - (E + R + 2) bars, X + 1 bar] with E = 8, R = 6 (the widest)."""
        rc = self.c["relation"]
        return self.win(X - (rc["entry_bars"] + rc["ramp_bars_max"] + rc["a_pad_bars"]), X + rc["a_after_bars"])

    def on_phrase(self, j: int) -> bool:
        return (j - self.phase) % self.P == 0

    def t_at(self, k: int) -> float:
        """Native seconds of bar k (the file end for k = nb)."""
        return float(self.g[k]) if k < self.nb else self.dur

    def span_s(self, a: int, b: int) -> float:
        """Real seconds from bar a to bar b (fixer, review v1 musical #6: n x the median bar
        misjudged tracks whose bar length changes, e.g. a halving at a tempo octave slip)."""
        return self.t_at(min(b, self.nb)) - self.t_at(max(0, a))

    def mean(self, x: np.ndarray, a: int, b: int, default: float = -120.0) -> float:
        a, b = max(0, a), min(self.nb, b)
        return float(x[a:b].mean()) if b > a else default

    def rep(self, j: int, L: int) -> float:
        """Best mean cosine between chroma bars j..j+L-1 and any non-overlapping window."""
        key = (j, L)
        if key not in self._rep:
            best = -1.0
            A = self.C[j:j + L]
            if len(A) == L:
                for k in range(0, self.nb - L + 1):
                    if abs(k - j) >= L:
                        best = max(best, float(np.mean(np.sum(A * self.C[k:k + L], 1))))
            self._rep[key] = best
        return self._rep[key]


# ---------------------------------------------------------------------------------------------
# §5.1 landing candidates
# ---------------------------------------------------------------------------------------------
def refine_bar(cx: Ctx, j: int) -> int:
    """§5.1 step 2: a confident phrase grid wins (a loud bar just before it is a pickup, not the
    landing); otherwise the neighbour with the clearly biggest energy step."""
    c = cx.c
    lmin = c["land_min_rel_db"]
    if cx.conf >= HL["phrase_conf_min"]:
        for k in (j, j - 1, j + 1):
            if 1 <= k < cx.nb and cx.on_phrase(k) and cx.rel[k] >= lmin:
                return k
    # REVIEW-external-1 #1: score all three, keep j unless a neighbour beats sc[j] by
    # land_move_db (iterating j-1 first with no margin let a loud riser bar land B a bar early)
    def score(k: int) -> float | None:
        if k < 1 or k >= cx.nb or cx.rel[k] < lmin:
            return None
        return (cx.rel[k] - cx.rel[k - 1]) + HL["land_low_w"] * (cx.low[k] - cx.low[k - 1])

    sc = {k: v for k in (j - 1, j, j + 1) if (v := score(k)) is not None}
    if not sc:
        return j
    if j not in sc:                      # j itself is too quiet: the better eligible neighbour
        return max(sc, key=lambda k: (sc[k], -k))
    best = max((k for k in sc if k != j), key=lambda k: (sc[k], -k), default=None)
    return best if best is not None and sc[best] > sc[j] + HL["land_move_db"] else j


def candidates(cx: Ctx) -> dict[int, list[str]]:
    """{bar: reasons}: refined section starts plus refined arrivals (§5.1 steps 1-2)."""
    c = cx.c
    raw: dict[int, list[str]] = {}
    for s in cx.F["sections"]:
        if s["label"] in ("start", "end"):
            continue
        raw.setdefault(refine_bar(cx, int(s["bar"])), []).append(s["label"])
    for j in range(4, cx.nb - 2):
        cd = cx.rel[j:j + 2].mean() - cx.rel[j - 4:j].mean()
        cl = cx.low[j:j + 2].mean() - cx.low[j - 4:j].mean()
        if cd >= c["arrival_db"] or cl >= c["arrival_low_db"]:
            k = refine_bar(cx, j)
            if not any(abs(k - q) <= 1 for q in raw):
                raw.setdefault(k, []).append(f"arrival+{max(cd, 0):.0f}dB")
    return raw


def section_end(cx: Ctx, j: int) -> int:
    return next((b for b in cx.bounds if b > j), cx.nb)


def vetoed(cx: Ctx, j: int) -> bool:
    """§5.1 step 3: a breakdown (quiet or bass-less section) is never a landing."""
    je = section_end(cx, j)
    return cx.mean(cx.rel, j, je) <= cx.c["veto_rel_db"] or cx.mean(cx.low, j, je) <= cx.c["veto_low_db"]


# ---------------------------------------------------------------------------------------------
# §5.2 lead type and pickup
# ---------------------------------------------------------------------------------------------
def _lead(cx: Ctx, j: int) -> dict:
    c = cx.c
    lcap = max(1, min(c["lead_max_bars"], int(c["lead_max_s"] / cx.bar_s)))
    for pk in range(0, HL["fill_bars_max"] + 1):
        L = 0
        while L + pk < lcap and j - pk - L - 1 >= 0 and cx.low[j - pk - L - 1] <= HL["nobass_low_db"]:
            L += 1
        if L >= HL["nobass_min_bars"]:
            nod = sum(cx.perc[j - pk - i - 1] < HL["nodrums_perc_db"] for i in range(L))
            return {"type": "nobass-nodrums" if nod >= L / 2 else "nobass-drums", "bars": L + pk,
                    "fill_bars": pk}
    bm = cx.mean(cx.rel, j, j + 4)
    for L in HL["build_L"]:
        if L <= lcap and j - L >= 0 and bm - cx.rel[j - L:j].mean() >= c["build_db"]:
            return {"type": "build", "bars": L, "fill_bars": 0}
    lm = cx.mean(cx.low, j, j + 4)
    for L in HL["break_L"]:
        if j - L >= 0 and (bm - cx.rel[j - L:j].mean() >= c["break_db"] or
                           lm - cx.low[j - L:j].mean() >= c["break_low_db"]):
            return {"type": "break", "bars": L, "fill_bars": 0}
    return {"type": "none", "bars": 0, "fill_bars": 0}


def pickup(cx: Ctx, j: int) -> int:
    """R7 pickup beats p in {1, 2}: the last p beats before j carry a vocal/fill that is loud
    (landing-bar vox - 6 dB; vocal stem >= -24 dB rel with stems) and >= 6 dB above the p beats
    before them."""
    k = int(cx.bidx[j])
    best = 0
    for p in range(1, int(cx.c["pickup_max_beats"]) + 1):
        if k - 2 * p < 0:
            break
        if cx.beat_vstem is not None:
            last, before = cx.beat_vstem[k - p:k].mean(), cx.beat_vstem[k - 2 * p:k - p].mean()
            ok = last >= HL["pickup_stem_db"]
        else:
            last, before = cx.beat_vox[k - p:k].mean(), cx.beat_vox[k - 2 * p:k - p].mean()
            ok = last >= cx.vox[j] - cx.c["pickup_vox_db"]
        if ok and last >= before + cx.c["pickup_vox_db"]:
            best = p
    return best


def _lead_full(cx: Ctx, j: int) -> dict:
    ld = _lead(cx, j)
    ld["pickup_beats"] = pickup(cx, j)
    ld["t"] = _r(bar_time(cx.F, j - ld["bars"], cx.b_win(j)))
    return {"type": ld["type"], "bars": ld["bars"], "t": ld["t"], "pickup_beats": ld["pickup_beats"],
            "fill_bars": ld["fill_bars"]}


def lead_type(F: dict, j: int) -> dict:
    """Lead (§5.2) of a landing at bar j."""
    return _lead_full(Ctx(F), j)


# ---------------------------------------------------------------------------------------------
# §5.3 exits, §5.4 score
# ---------------------------------------------------------------------------------------------
def _prior(cx: Ctx, j: int) -> tuple[float, bool]:
    lab = cx.label[j]
    pr = HL["prior"]
    prior = pr.get(lab, 0.3) if cx.labelled else pr["unlabelled"]
    contrast = cx.mean(cx.rel, j, j + 2) - cx.mean(cx.rel, j - 4, j)
    lowjump = cx.mean(cx.low, j, j + 2) - cx.mean(cx.low, j - 4, j)
    drop = lab in ("inst", "solo", "chorus") and contrast >= HL["drop_contrast_db"] and lowjump >= HL["drop_low_db"]
    return (max(prior, HL["drop_prior"]) if drop else prior), drop


def _vocal_edge(cx: Ctx, X: int) -> bool:
    """The sung line runs through the exit. With stems (fixer, review v1 musical #4): a sung
    track whose vocal runs on >= vocal_gap_s past X's air point (bars.vox_run_s); an
    instrumental track (vocal stem mostly bleed) never has a vocal edge."""
    kx = int(cx.bidx[X]) if X < cx.nb else cx.nbeats
    if kx < 1:
        return False
    if cx.beat_vstem is not None:
        if not cx.vocal_track:
            return False
        if cx.vrun is not None and X < cx.nb:
            return bool(cx.vrun[X] >= HL["vocal_gap_s"])
        return bool(cx.beat_vstem[kx - 1] >= HL["vocal_edge_stem_db"])
    k2 = int(cx.bidx[max(0, X - 2)])
    return bool(cx.beat_vox[kx - 1] >= np.median(cx.beat_vox[k2:k2 + cx.bpb]) - HL["vocal_edge_vox_db"])


def exit_terms(cx: Ctx, j: int, X: int) -> dict:
    """natural / dip / tail48 / in_fade_or_lull / vocal_at_edge and the body level for X."""
    c = cx.c
    level = cx.mean(cx.rel, j, X)
    nxt = cx.rel[X:X + 4]
    natural = bool(len(nxt) and nxt.mean() <= level - c["natural_exit_db"])
    dip = bool(X >= 1 and cx.rel[X - 1] <= level - c["dip_db"])
    t0, t1 = HL["tail_bars"]
    tail48 = bool(X + t0 <= cx.nb and np.all(np.abs(cx.rel[X:X + t0] - level) <= HL["tail_db"]))
    lull = float(np.mean(cx.rel[j:X] < -5)) if X > j else 0.0
    fade = X >= cx.last_loud - 1
    verse = sum(1 for k in range(j, min(X, cx.nb)) if cx.label[k] in HL["verse_labels"])
    sec_end = bool(X in cx.bounds and 1 <= X <= cx.nb and cx.label[X - 1] in HL["highlight_labels"])
    return {"level": level, "natural": natural, "dip": dip, "tail48": tail48, "lull": lull, "fade": fade,
            "in_fade_or_lull": bool(fade or lull > 0), "vocal_at_edge": _vocal_edge(cx, X),
            "verse_bars": int(verse), "section_end": sec_end}


def _s_out(e: dict, next_lock: bool) -> float:
    so = HL["s_out"]
    return (so["natural"] * e["natural"] + so["dip"] * e["dip"] + so["tail48"] * e["tail48"] * bool(next_lock)
            + so["in_fade_or_lull"] * e["in_fade_or_lull"] + so["vocal_at_edge"] * e["vocal_at_edge"])


def exit_ok(cx: Ctx, j: int, n: int, lead_bars: int) -> bool:
    """§5.3 body-length rule for X = j + n. X must lie on the phrase grid or a section
    boundary; when the phrase grid is unreliable (conf < phrase_conf_min, where §5.4 already
    counts every landing as on-grid) the landing itself anchors it: n a multiple of P."""
    c = cx.c
    X = j + n
    if X > cx.nb or not (c["body_s"][0] <= cx.span_s(j, X) <= c["body_s"][1]):
        return False
    if cx.span_s(j - lead_bars, X) > c["lead_body_max_s"]:
        return False
    on_grid = cx.on_phrase(X) or (cx.conf < HL["phrase_conf_min"] and n % cx.P == 0)
    return (X in cx.bounds or on_grid) and X < cx.last_loud


def _h(cx: Ctx, j: int, n: int, lead: dict, e: dict, prior: float) -> float:
    hh = HL["h"]
    X = j + n
    contrast = cx.mean(cx.rel, j, j + 2) - cx.mean(cx.rel, j - 4, j)
    on_grid = cx.conf < HL["phrase_conf_min"] or cx.on_phrase(j)
    early = cx.g[j] < HL["early_s"] or cx.g[j] < HL["early_frac"] * cx.dur
    dur_s = cx.span_s(j - lead["bars"], X)
    return float(prior + hh["level"] * e["level"] + hh["contrast"] * min(contrast, hh["contrast_cap"])
                 + hh["rep"] * max(cx.rep(j, min(hh["rep_bars"], n)), 0) + hh["lead_q"] * HL["lead_q"][lead["type"]]
                 + hh["exit"] * (e["natural"] or e["tail48"]) + hh["on_grid"] * on_grid + hh["lull"] * e["lull"]
                 + hh["ends_in_fade"] * (X >= cx.last_loud - 1) + hh["early"] * early
                 + hh["dur"] * abs(dur_s - hh["dur_target_s"])
                 # fixer (review v1 musical #4, #7)
                 + hh["vocal_edge"] * e["vocal_at_edge"] + hh["verse_bar"] * e["verse_bars"]
                 + hh["section_end"] * e["section_end"])


def _exits(cx: Ctx, j: int, lead: dict, prior: float) -> list[dict]:
    out = []
    for n in cx.c["body_bars_allowed"]:
        if not exit_ok(cx, j, n, lead["bars"]):
            continue
        X = j + n
        e = exit_terms(cx, j, X)
        awin = cx.a_win(X)
        out.append({"n": n, "bar": X, "t": _r(bar_time(cx.F, X, awin)),
                    "kind": "natural" if e["natural"] else "dip" if e["dip"] else "tail" if e["tail48"] else "end",
                    "s_out": _r(_s_out(e, False), 3), "tail48": e["tail48"], "natural": e["natural"], "dip": e["dip"],
                    "in_fade_or_lull": e["in_fade_or_lull"], "vocal_at_edge": e["vocal_at_edge"],
                    "verse_bars": e["verse_bars"], "section_end": e["section_end"],
                    "level_db": _r(e["level"], 2), "dur_s": _r(cx.span_s(j - lead["bars"], X), 2),
                    "h": _r(_h(cx, j, n, lead, e, prior), 4), "win": awin})
    out.sort(key=lambda e: (-e["h"], e["n"]))
    return out


def exits(t: dict | None, F: dict, j: int) -> list[dict]:
    """Every valid exit of a landing at bar j (§5.3), best h first."""
    cx = Ctx(F)
    return _exits(cx, j, _lead_full(cx, j), _prior(cx, j)[0])


def H(t: dict | None, F: dict, j: int, n: int) -> float:
    """H(j, n) (§5.4). Also defined for n that the exit rule rejects (callers check exit_ok)."""
    cx = Ctx(F)
    lead = _lead_full(cx, j)
    return _h(cx, j, n, lead, exit_terms(cx, j, j + n), _prior(cx, j)[0])


def s_out(t: dict | None, F: dict, X: int, next_lock: bool = False, j: int | None = None) -> float:
    """S_out(X) (§5.3). The body level is measured from the landing j (default: 16 bars back)."""
    cx = Ctx(F)
    return _s_out(exit_terms(cx, max(0, X - 16) if j is None else j, X), next_lock)


def landing_onset(cx: Ctx, tj: float) -> tuple[bool, float | None, float | None]:
    """§5.1 step 6: the strongest onset within +-land_onset_ms of the fitted downbeat and its
    strength relative to median_down_strength."""
    k = np.where(np.abs(cx.on_t - tj) <= HL["land_onset_ms"] / 1000)[0]
    if not len(k):
        return False, None, None
    b = k[np.argmax(cx.on_s[k])]
    ratio = float(cx.on_s[b] / cx.med_down)
    return ratio >= HL["land_onset_ratio"], float((cx.on_t[b] - tj) * 1000), ratio


def vocal_entry(cx: Ctx, j: int) -> bool:
    """The vocal enters within 1 beat of bar j: the loudest of beats k, k+1 (k = j's downbeat)
    is >= arrival_vocal_db above the two beats before and audible (vocal stem >= pickup_stem_db;
    without stems the vox proxy >= the landing bar's vox - pickup_vox_db)."""
    k = int(cx.bidx[j])
    if k < 2 or k + 2 > cx.nbeats:
        return False
    if cx.beat_vstem is not None:
        if not cx.vocal_track:
            return False
        x, floor = cx.beat_vstem, HL["pickup_stem_db"]
    else:
        x, floor = cx.beat_vox, cx.vox[j] - cx.c["pickup_vox_db"]
    now, before = float(x[k:k + 2].max()), float(x[k - 2:k].mean())
    return bool(now >= floor and now >= before + HL["arrival_vocal_db"])


def landings(t: dict | None, F: dict, top: int | None = None, c: dict = CFG) -> list[dict]:
    """The top landings of a track (§5.1 step 7), each with its lead and every valid exit."""
    cx = Ctx(F, c)
    top = HL["top_landings"] if top is None else top
    out = []
    for j, why in candidates(cx).items():
        if j < 1 or j >= cx.nb - min(c["body_bars_allowed"]) or vetoed(cx, j):
            continue
        prior, drop = _prior(cx, j)
        lead = _lead_full(cx, j)
        ex = _exits(cx, j, lead, prior)
        if not ex:
            continue
        bwin = cx.b_win(j)
        tj = bar_time(F, j, bwin)
        ok, err, strength = landing_onset(cx, tj)
        contrast = cx.mean(cx.rel, j, j + 2) - cx.mean(cx.rel, j - 4, j)
        lowjump = cx.mean(cx.low, j, j + 2) - cx.mean(cx.low, j - 4, j)
        # fixer (review v1 musical #2): a drop's downbeat onset is on time but weak after its
        # riser (Dreaming 2:32.68: 0.65 x the median, the bass stem -66 -> -17 dB on the beat)
        drop_ok = bool(not ok and err is not None and (strength or 0) >= HL["drop_onset_ratio"]
                       and (contrast >= HL["drop_contrast_db"] or lowjump >= HL["drop_low_db"]))
        # fixer (musical #3): what a slam can land on: a lead (build, break, bass-less bars) ends
        # in it, or it steps up, or the vocal enters at a section start
        arrival = bool(lead["type"] != "none" or contrast >= HL["arrival_contrast_db"]
                       or lowjump >= HL["drop_low_db"] or (j in cx.bounds and vocal_entry(cx, j)))
        hh = HL["h"]                      # eligibility: H without the fixer's exit-ranking terms
        h_base = max(e["h"] - hh["vocal_edge"] * e["vocal_at_edge"] - hh["verse_bar"] * e["verse_bars"]
                     - hh["section_end"] * e["section_end"] for e in ex)
        out.append({"bar": int(j), "t": _r(tj), "label": cx.label[j], "why": "+".join(why + (["drop"] if drop else [])),
                    "rel_db": _r(cx.rel[j], 2), "prior": _r(prior, 3), "contrast_db": _r(contrast, 2),
                    "low_jump_db": _r(lowjump, 2), "onset_ok": bool(ok), "onset_err_ms": _r(err, 1),
                    "onset_strength": _r(strength, 3), "drop_ok": drop_ok, "arrival": arrival,
                    "lead": lead, "exits": ex, "h": ex[0]["h"], "h_base": _r(h_base, 4), "win": bwin})
    out.sort(key=lambda d: (-d["h"], d["bar"]))
    keep = out[:top]
    # fixer (review v1 musical #2-3): a slam needs an arrival and V1 an onset; when none of the
    # top landings has one, the best landing that has joins them (sorted: their h is lower)
    extra = int(HL.get("arrival_extra", 0))
    for need in (lambda d: d["arrival"], lambda d: d["onset_ok"] or d["drop_ok"]):
        if extra > 0 and not any(need(d) for d in keep):
            add = next((d for d in out[top:] if need(d) and d not in keep), None)
            if add is not None:
                keep.append(add)
                extra -= 1
    keep.sort(key=lambda d: (-d["h"], d["bar"]))
    return keep


# ---------------------------------------------------------------------------------------------
# §5.1 step 5: boundaries for tracks without all-in-one labels
# ---------------------------------------------------------------------------------------------
def novelty_sections(g: np.ndarray, duration: float, rel, low, perc, vox, chroma,
                     kernel_bars: int | None = None) -> list[dict]:
    """Sections from a checkerboard novelty kernel on the per-bar vector [rel, low, perc, vox,
    chroma] (z-scored), peaks >= 4 bars apart, snapped to bars. Labels are "unlabelled"."""
    g = np.asarray(g, float)
    nb = len(g)
    K = int(kernel_bars or CFG["analysis"]["novelty_kernel_bars"])
    h = K // 2
    X = np.column_stack([rel, low, perc, vox, np.asarray(chroma, float).reshape(nb, 12)]).astype(float)
    X = (X - X.mean(0)) / (X.std(0) + 1e-9)
    X /= np.linalg.norm(X, axis=1, keepdims=True) + 1e-9
    S = X @ X.T
    u = np.arange(-h, h) + 0.5
    kern = np.outer(np.sign(u), np.sign(u)) * np.exp(-0.5 * (np.add.outer(u, u) / (0.5 * h)) ** 2 / 2)
    pad = np.pad(S, h, mode="edge")
    nov = np.array([float(np.sum(kern * pad[i:i + K, i:i + K])) for i in range(nb)])
    thr = nov.mean() + 0.5 * nov.std()
    peaks = [i for i in range(1, nb) if nov[i] >= thr and nov[i] == nov[max(0, i - 2): i + 3].max()]
    bounds = [0]
    for p in peaks:
        if p - bounds[-1] >= 4:
            bounds.append(p)
    edges = bounds + [nb]
    return [{"start": _r(g[a]), "end": _r(g[b]) if b < nb else _r(duration), "label": "unlabelled", "bar": int(a)}
            for a, b in zip(edges[:-1], edges[1:])]
