"""Set ethos: what a slot in a set *should* sound like, and whether a track fits it.

Energies are on a calibrated 0..1 scale where one listener "level" (1 = ambient ..
5 = peak) is 0.25, so every threshold here is expressed in levels.

Tiers: 0 = fits the set's ethos at this slot, 1 = borderline, 2 = breaks it.
Rules that apply to every set (flow): no jump of 1.5+ levels from the outgoing track.
Energy arc: a monotone high→chill curve; no climbs of a level once it is descending.
Genre waves: dance → rock → chill; stay in the slot's wave (or the outgoing track's).
"""

from __future__ import annotations

import numpy as np
from itertools import groupby

from .plan import energy_scores, pair_cost

LEVEL = 0.25
WAVES = ("dance", "rock", "chill")


def level(e: float) -> float:
    return 1.0 + e / LEVEL


class Ethos:
    def __init__(self, session, doc: dict):
        self.s = session
        self.doc = doc
        self.arc = doc["arc"]
        self.by_id = session.by_id
        self.p = session._ctx(self.arc)
        self.energy = energy_scores(session.tracks, self.p)
        self.tpl = session.template(self.arc) if self.arc != "free" else []
        self.tpl_pos = {tid: i for i, tid in enumerate(self.tpl)}
        self.n_set = session._set_length(doc)
        self._curve = self._make_curve()

    # -- the shape of the set ---------------------------------------------------------------
    def _make_curve(self) -> np.ndarray | None:
        """Template energy by position, smoothed: monotone non-increasing for the energy
        arc (isotonic), a rolling median for genre waves."""
        if not self.tpl:
            return None
        e = np.array([self.energy[t] for t in self.tpl])
        if self.arc == "energy":
            from sklearn.isotonic import IsotonicRegression
            x = np.arange(len(e))
            return IsotonicRegression(increasing=False).fit(x, e).predict(x)
        k = 3
        return np.array([np.median(e[max(0, i - k): i + k + 1]) for i in range(len(e))])

    def rel(self, pos: int) -> float:
        return min(1.0, max(0.0, pos / max(1, self.n_set - 1)))

    def tpl_index(self, pos: int) -> int:
        return int(round(self.rel(pos) * (len(self.tpl) - 1))) if self.tpl else 0

    def curve(self, pos: int) -> float | None:
        return None if self._curve is None else float(self._curve[self.tpl_index(pos)])

    def wave(self, pos: int) -> str | None:
        if self.arc != "genre" or not self.tpl:
            return None
        return self.by_id[self.tpl[self.tpl_index(pos)]].get("bucket")

    def target(self, pos: int, a: str | None = None, disp: str | None = None,
               nxt: str | None = None) -> float | None:
        """Energy the slot should have: the arc's curve, anchored to the set's own
        neighbours (outgoing track, the track being replaced, the one after)."""
        e = self.energy
        neigh = []
        if disp:
            neigh.append(e[disp])
        if a and nxt:
            neigh.append((e[a] + e[nxt]) / 2)
        elif a and not disp:
            neigh.append(e[a])
        c = self.curve(pos)
        if self.arc == "energy":
            return float(np.median([c] + neigh)) if neigh else c
        if neigh:
            return float(np.mean(neigh))
        return c

    # -- judging a track at a slot --------------------------------------------------------------
    def tier(self, tid: str, pos: int, a: str | None = None, tgt: float | None = None,
             band_quota: set | None = None, waves: set | None = None,
             allow_climb: bool = False) -> int:
        e = self.energy
        t = 0
        if a is not None:
            jump = (e[tid] - e[a]) / LEVEL
            if abs(jump) >= 1.5:
                return 2
            if abs(jump) >= 1.0:
                t = 1
            if self.arc == "energy" and self.rel(pos) > 0.15 and jump >= 1.0 and not allow_climb:
                return 2
        if self.arc == "free":
            return t
        if self.arc == "genre":
            if waves is None:
                waves = {self.wave(pos)}
                if a is not None:
                    waves.add(self.by_id[a].get("bucket"))
            if self.by_id[tid].get("bucket") not in waves:
                return 2
        if band_quota is not None and self.band(tid) not in band_quota:
            return 2
        if tgt is not None:
            gap = abs(e[tid] - tgt) / LEVEL
            lim0, lim1 = (0.6, 1.1) if self.arc == "energy" else (0.75, 1.25)
            if gap > lim1:
                return 2
            if gap > lim0:
                t = max(t, 1)
        return t

    def arc_pen(self, tid: str, pos: int, tgt: float | None = None) -> float:
        if self.arc == "free":
            return 0.0
        tgt = self.curve(pos) if tgt is None else tgt
        gap = abs(self.energy[tid] - tgt) / LEVEL if tgt is not None else 0.0
        if self.arc == "genre":
            return (0.0 if self.by_id[tid].get("bucket") == self.wave(pos) else 5.0) + 0.6 * gap
        return 2.0 * gap

    def cost(self, x: str, y: str) -> float:
        # e_remaining_max = energy of y: the ethos tiers handle the arc, so the descending
        # bias inside pair_cost must not reward high energy everywhere
        e = self.energy
        return pair_cost(self.by_id[x], self.by_id[y], e[x], e[y], e[y], self.p)

    # -- build mode: don't strand tracks ------------------------------------------------------
    def band(self, tid: str):
        if self.arc == "genre":
            return self.by_id[tid].get("bucket")
        return int(round(level(self.energy[tid])))

    def slot_band(self, pos: int):
        if self.arc == "genre":
            return self.wave(pos)
        c = self.curve(pos)
        return None if c is None else int(round(level(c)))

    returning = False

    def build_quota(self, pos: int, unused: list[str], a: str | None = None,
                    placed: list[str] | None = None) -> tuple[set | None, set]:
        """For append steps in a build set. Returns (allowed bands or None, overdue ids).
        If the current band has at least as many unused tracks as slots left in it,
        only that band is allowed; tracks whose band has already passed are overdue."""
        if self.arc == "free" or not self.tpl:
            return None, set()
        if self.arc == "genre":   # finish each wave before starting the next: exactly 2 switches
            # the set has moved on from a wave only once a LATER wave is established
            # (a run of 3+ tracks); a one-off detour does not commit the whole build
            start = 0
            for w, g in groupby(self.band(x) for x in (placed or [])):
                if w in WAVES and len(list(g)) >= 3:
                    start = max(start, WAVES.index(w))
            self.returning = False
            for w in WAVES[start:]:          # never march back to a wave the set has left
                if any(self.band(u) == w for u in unused):
                    return {w}, set()
            for w in WAVES[:start]:          # only leftovers of earlier waves remain
                if any(self.band(u) == w for u in unused):
                    self.returning = True
                    return {w}, set()
            return None, set()
        sb = self.slot_band(pos)
        left = 0
        for q in range(pos, self.n_set):
            if self.slot_band(q) != sb:
                break
            left += 1
        in_band = [u for u in unused if self.band(u) == sb]
        if self.arc == "genre":
            order = {w: i for i, w in enumerate(WAVES)}
            overdue = {u for u in unused if order.get(self.band(u), 9) < order.get(sb, 9)}
        else:
            overdue = {u for u in unused if self.band(u) > (sb or 0)}
        allowed = {sb} if in_band and len(in_band) >= left else None
        if overdue and allowed is not None:
            allowed = allowed | {self.band(u) for u in overdue}
        return allowed, overdue

    # -- where a displaced track should go -----------------------------------------------------
    def place(self, order: list[str], tid: str, lo: int, orig: int | None = None) -> int:
        """Best index >= lo for tid: only where it fits the arc and its neighbours;
        failing that, where it jumps least from its new neighbours (near its old spot)."""
        best = None
        for k in range(max(0, lo), len(order) + 1):
            prev = order[k - 1] if k > 0 else None
            nxt = order[k] if k < len(order) else None
            tgt = self.target(k, prev, None, nxt)
            waves = ({self.by_id[x].get("bucket") for x in (prev, nxt) if x is not None}
                     if self.arc == "genre" else None)
            tr = self.tier(tid, k, prev, tgt, None, waves or None)
            if nxt is not None and abs(self.energy[tid] - self.energy[nxt]) / LEVEL >= 1.5:
                tr = 2
            d = self.arc_pen(tid, k, tgt)
            if prev is not None:
                d += self.cost(prev, tid)
            if nxt is not None:
                d += self.cost(tid, nxt) - (self.cost(prev, nxt) if prev is not None else 0.0)
            key = (tr, d)
            if best is None or key < best[0]:
                best = (key, k)
        if best is None:
            return len(order)
        if best[0][0] < 2:
            return best[1]
        e = self.energy
        home = len(order) if orig is None else orig
        fall = []
        for k in range(max(0, lo), len(order) + 1):
            prev = order[k - 1] if k > 0 else None
            nxt = order[k] if k < len(order) else None
            gaps = [abs(e[tid] - e[x]) for x in (prev, nxt) if x is not None]
            if prev is None or nxt is None:      # an end has one neighbour: let the arc stand in
                c = self.curve(k)
                gaps.append(abs(e[tid] - c) if c is not None else 0.5 * LEVEL)
            worst = max(gaps or [0.0])
            fall.append((round(worst / LEVEL * 4) / 4, abs(k - home), k))   # quarter-level bins
        return min(fall)[2] if fall else len(order)

    def new_join_worst(self, old: list[str], new: list[str]) -> float:
        """Largest level jump among joins that exist in `new` but not in `old`."""
        before = set(zip(old[:-1], old[1:]))
        e = self.energy
        jumps = [abs(e[x] - e[y]) / LEVEL for x, y in zip(new[:-1], new[1:]) if (x, y) not in before]
        return max(jumps) if jumps else 0.0
