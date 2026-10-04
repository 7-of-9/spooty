"""Fixture helpers for the E2 tests (forms / compile / planner): real Feats, with the windows
forced locked where a test needs a lock / double relation, time-scaled copies for a 2:1 pair and
a beatless-lead copy for the preroll cell."""

import copy
import json
import os

import numpy as np

from automix.medley import forms as FM

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
_cache: dict = {}


def load(name: str) -> dict:
    if name not in _cache:
        with open(os.path.join(FIX, f"feats_{name}.json")) as fh:
            _cache[name] = json.load(fh)
    return copy.deepcopy(_cache[name])


def _lock_win(win: dict, period: float | None = None, t0: float | None = None) -> dict:
    w = copy.deepcopy(win)
    if w["fit"] is None:
        w["fit"] = {"period_s": period, "phase_s": 0.0, "rms_ms": 1.0, "max_ms": 3.0, "keep": 1.0, "n": 64,
                    "k0": 0, "k1": 64}
    if period:
        w["fit"]["period_s"] = period
    w["fit"].update(rms_ms=1.0, max_ms=3.0, keep=1.0)
    w["cls"] = "locked"
    return w


def locked_ctx(fa: dict, X: int, fb: dict, j: int, stems: bool = False, **kw) -> FM.JoinCtx:
    """A JoinCtx for A's exit X and B's landing j with both windows forced `locked` (their own
    fitted periods kept). For the §8.10 pair the periods and times are the design's."""
    ex = copy.deepcopy(FM.exits_by_bar(fa)[X][0])
    land = copy.deepcopy(next(ld for ld in fb["landings"] if ld["bar"] == j))
    pa = ex["win"]["fit"]["period_s"] if ex["win"]["fit"] else 60 / fa["bpm"]
    pb = land["win"]["fit"]["period_s"] if land["win"]["fit"] else 60 / fb["bpm"]
    if (X, j) == (40, 80) and fa["track"].endswith("7gDgphzQU0urJU3AtoLJup"):
        pa, pb = 0.472367, 0.476228                          # §8.10 a_ref / b_ref
        ex["t"], land["t"] = 76.14, 152.68
    ex["win"] = _lock_win(ex["win"], pa)
    land["win"] = _lock_win(land["win"], pb)
    ta = {"id": fa["track"], "camelot": "3A" if "7gDg" in fa["track"] else "5A", "title": "A"}
    tb = {"id": fb["track"], "camelot": "5A" if "15vN" in fb["track"] else "3A", "title": "B"}
    return FM.JoinCtx(ta, tb, fa, fb, ex, land, stems_a=stems, stems_b=stems, **kw)


def scaled(F: dict, k: float, locked: bool = False, track: str | None = None) -> dict:
    """F with every time multiplied by k (tempo / k): a synthetic slower (k > 1) version."""
    G = copy.deepcopy(F)
    G["track"] = track or F["track"] + f"-x{k:.3f}"
    G["duration"] = F["duration"] * k
    G["bpm"] = F["bpm"] / k
    G["bpm_bt"] = F["bpm_bt"] / k
    if G.get("bpm_a1"):
        G["bpm_a1"] = F["bpm_a1"] / k
    G["active"] = [x * k for x in F["active"]]
    for grp, keys in (("beats", ("t",)), ("bars", ("t",)), ("onsets", ("t",))):
        for key in keys:
            G[grp][key] = [x * k for x in F[grp][key]]
    for s in G["sections"]:
        s["start"], s["end"] = s["start"] * k, s["end"] * k
    if G["fit"]:
        G["fit"]["period_s"] *= k
        G["fit"]["phase_s"] *= k
    ms = np.asarray(F["kblocks"]["ms"])
    idx = np.clip((np.arange(int(len(ms) * k)) / k).astype(int), 0, len(ms) - 1)
    G["kblocks"]["ms"] = ms[idx].tolist()

    def win(w):
        w["t0"], w["t1"] = w["t0"] * k, w["t1"] * k
        if w["fit"]:
            w["fit"]["period_s"] *= k
            w["fit"]["phase_s"] *= k
        if locked:
            w.update(_lock_win(w))
        return w

    for ld in G["landings"]:
        ld["t"] *= k
        ld["lead"]["t"] *= k
        win(ld["win"])
        for e in ld["exits"]:
            e["t"] *= k
            e["dur_s"] *= k
            win(e["win"])
    if locked:
        G["grid_class"] = "locked"
    return G


def beatless(F: dict, j: int, bars: int) -> dict:
    """F whose landing j has a beatless nobass-nodrums lead of `bars` bars (a free preroll)."""
    G = copy.deepcopy(F)
    for b in range(j - bars, j):
        G["bars"]["perc_db"][b] = -12.0
        G["bars"]["low_db"][b] = -30.0
    ld = next(x for x in G["landings"] if x["bar"] == j)
    ld["lead"].update(type="nobass-nodrums", bars=bars, t=G["bars"]["t"][j - bars], pickup_beats=0)
    G["landings"] = [ld] + [x for x in G["landings"] if x["bar"] != j]
    return G
