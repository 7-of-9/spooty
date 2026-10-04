"""Selection, blocks and running order (DESIGN §6, AMENDMENTS 1) and the join relation (§7).

`select_and_order(tracks, feats, energy, cfg, seed)` returns the medley's track ids: every
eligible track (target_songs None = all; no artist cap), grouped into blocks house -> dnb ->
swing -> rock -> close (blocks with fewer than 3 tracks fold into close), ordered inside each block by
local search on the §6.3 cost with the head fixed to the previous block's tail, and the
dnb -> swing bridge pinned to a 2:1 pair when one exists. `plan_order` returns the same with
the details (eligibility, membership, bridges, costs) for reports and the page.

`relation(a, b, Fa, Fb, L, R)` decides lock / double / free for a join on window fits.
`feats` arguments accept a FeatStore, a {track id: Feats} dict or a callable(track) -> Feats.
"""

from __future__ import annotations

import math
import random

import numpy as np

from . import CFG
from .grid import fit_bars

LOCK_CLASSES = ("locked", "verify")
LOCK_BLOCKS = ("house", "dnb", "swing")
# Seeded tie-breaking noise on pair costs (not in Appendix A): lets `regenerate` (seed + 1) pick
# a different near-optimal order. 0.1 is 0.4 % of tempo difference on the 25x|ln| term.
ORDER_JITTER = 0.1


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------
def _getter(feats):
    if feats is None:
        return lambda t: None
    if callable(getattr(feats, "get", None)) and not isinstance(feats, dict):
        return lambda t: feats.get(t)                     # FeatStore.get(track dict)
    if isinstance(feats, dict):
        return lambda t: feats.get(t["id"] if isinstance(t, dict) else t)
    return feats


def camelot(a: dict | None, b: dict | None) -> int:
    from ..plan import camelot_distance
    return camelot_distance((a or {}).get("camelot", "?"), (b or {}).get("camelot", "?"))


def _artists(t: dict) -> set[str]:
    raw = (t.get("artist") or "").lower().replace(" & ", ",").replace(" feat. ", ",").replace(" x ", ",")
    return {x.strip() for x in raw.split(",") if x.strip()}


def e_star(x: float, c: dict = CFG) -> float:
    """The energy target e*(x) through the set (§6.3), piecewise linear."""
    pts = np.asarray(c["e_star"], float)
    return float(np.interp(x, pts[:, 0], pts[:, 1]))


def best_landing(F: dict) -> dict | None:
    return F["landings"][0] if F and F.get("landings") else None


def best_exit(F: dict) -> dict | None:
    ld = best_landing(F)
    return ld["exits"][0] if ld and ld["exits"] else None


_WIN: dict = {}


def _win(F: dict, j0: int, j1: int, c: dict) -> dict:
    key = (F["track"], F["sig"], F.get("stems"), j0, j1)
    if key not in _WIN:
        if len(_WIN) > 20000:
            _WIN.clear()
        _WIN[key] = fit_bars(F, j0, j1, c)
    return _WIN[key]


# ---------------------------------------------------------------------------------------------
# §7 relation
# ---------------------------------------------------------------------------------------------
def key_vec_cos(F_a: dict, F_b: dict, a_bars: tuple[int, int], b_bars: tuple[int, int],
                kc: tuple | None = None) -> float | None:
    """Chroma cosine between A's exit bars and B's lead bars. With the raw key chroma of both
    tracks (passed, or registered by the FeatStore that loaded them) it is the pitch-class
    profile correlation that tau_key is calibrated on; otherwise (fixture Feats) the cosine of
    the mean track-centred Feats bar chroma."""
    if kc is None:
        from .feats import key_chroma_of
        kc = (key_chroma_of(F_a), key_chroma_of(F_b))
    if kc[0] is not None and kc[1] is not None:
        from .feats import key_chroma_cos
        return key_chroma_cos(kc[0], kc[1], slice(*a_bars), slice(*b_bars))
    Ca, Cb = np.asarray(F_a["bars"]["chroma"], float), np.asarray(F_b["bars"]["chroma"], float)
    va, vb = Ca[slice(*a_bars)], Cb[slice(*b_bars)]
    if not len(va) or not len(vb):
        return None
    va, vb = va.mean(0), vb.mean(0)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    return float(va @ vb / (na * nb)) if na > 1e-9 and nb > 1e-9 else None


def relation(a: dict | None, b: dict | None, Fa: dict, Fb: dict, L: int | None = None, R: int | None = None,
             x_bar: int | None = None, j_bar: int | None = None, kc: tuple | None = None, c: dict = CFG) -> dict:
    """lock / double / free for the join A (exit bar X) -> B (landing bar j) (§7).

    a, b: track dicts (Camelot keys); Fa, Fb: their Feats. L = the form's entry bars E (default
    8, §7), R = ramp bars (default clamp(ceil(|stretch %|), 2, 6) from the track tempos).
    X defaults to A's best exit, j to B's best landing. The windows are A [X - (E + R + 2), X + 1]
    and B [j - E - 1, j + 8] bars; their fits give the tempos, classes and stretch. kc = the two
    tracks' raw key chroma (FeatStore.key_chroma) for the chroma term. Returns a Relation."""
    rc = c["relation"]
    E = rc["entry_bars"] if L is None else int(L)
    if j_bar is None:
        ld = best_landing(Fb)
        j_bar = ld["bar"] if ld else len(Fb["bars"]["t"]) // 2
    if x_bar is None:
        ex = best_exit(Fa)
        x_bar = ex["bar"] if ex else len(Fa["bars"]["t"]) - 1
    ratio0 = Fb["bpm"] / Fa["bpm"]
    if R is None:
        R = int(np.clip(math.ceil(abs(ratio0 - 1) * 100 / c["forms"]["ramp_bars_per_pct"] - 1e-9),
                        c["ramp_bars"][0], c["ramp_bars"][1]))
    aw = _win(Fa, x_bar - (E + R + rc["a_pad_bars"]), x_bar + rc["a_after_bars"], c)
    bw = _win(Fb, j_bar - E - rc["b_pre_bars"], j_bar + rc["b_after_bars"], c)
    bpm_a = 60 / aw["fit"]["period_s"] if aw["fit"] else Fa["bpm"]
    bpm_b = 60 / bw["fit"]["period_s"] if bw["fit"] else Fb["bpm"]
    ratio = bpm_b / bpm_a
    lock_tol, dbl_tol = c["lock_max_pct"] / 100, c["double_tol_pct"] / 100
    kind, a_ratio = "free", 1
    if abs(ratio - 1) <= lock_tol and aw["cls"] in LOCK_CLASSES and bw["cls"] in LOCK_CLASSES \
            and Fa["bpb"] == 4 and Fb["bpb"] == 4:
        kind = "lock"
    elif aw["cls"] == "locked" and bw["cls"] == "locked" and Fa["octave_ok"] and Fb["octave_ok"]:
        if abs(ratio / 0.5 - 1) <= dbl_tol:
            kind, a_ratio = "double", 2              # A is the fast track: 2 A beats per B beat
        elif abs(ratio / 2 - 1) <= dbl_tol:
            kind, a_ratio = "double", 0.5
    stretch = (ratio * a_ratio - 1) * 100 if kind != "free" else 0.0
    # chroma: A's last 4 body bars against B's lead bars (its landing bars when it has no lead)
    lb = next((ld["lead"]["bars"] for ld in Fb["landings"] if ld["bar"] == j_bar), 0)
    b_bars = (j_bar - lb, j_bar) if lb >= 2 else (j_bar, j_bar + 4)
    chroma = key_vec_cos(Fa, Fb, (max(0, x_bar - 4), x_bar), b_bars, kc)
    return {"kind": kind, "ratio": round(ratio, 5), "a_ratio": a_ratio, "stretch_pct": round(stretch, 3),
            "camelot": int(camelot(a, b)), "chroma": None if chroma is None else round(chroma, 3),
            "a_class": aw["cls"], "b_class": bw["cls"], "a_win": aw, "b_win": bw}


# ---------------------------------------------------------------------------------------------
# §6.1 eligibility, §6.2 blocks
# ---------------------------------------------------------------------------------------------
def eligibility(tracks: list[dict], feats, c: dict = CFG) -> tuple[list[dict], list[dict]]:
    """(eligible tracks, excluded [{track, reason, detail}]) per §6.1 (AMENDMENTS 1: no quota,
    no artist cap)."""
    get = _getter(feats)
    ok, out = [], []
    for t in tracks:
        F = get(t)
        if F is None:
            out.append({"track": t["id"], "reason": "needs_prep", "detail": "no medley features"})
        elif F["duration"] < c["min_duration_s"]:
            out.append({"track": t["id"], "reason": "too_short", "detail": f"{F['duration']:.0f} s < {c['min_duration_s']} s"})
        elif not F["landings"]:
            out.append({"track": t["id"], "reason": "no_excerpt", "detail": "no landing with a valid body length"})
        elif max(ld.get("h_base", ld["h"]) for ld in F["landings"]) < c["min_h"]:
            # fixer: the vocal-edge term ranks exits; a sung song is not less of a highlight
            out.append({"track": t["id"], "reason": "low_h",
                        "detail": f"best H {max(ld.get('h_base', ld['h']) for ld in F['landings']):.2f} < {c['min_h']}"})
        elif F["grid_class"] != "free" and not any(
                ld["onset_ok"] or ld.get("drop_ok") or (ld.get("onset_strength") or 0) >= c["highlight"]["eligible_onset_ratio"]
                for ld in F["landings"]):
            best = max((ld.get("onset_strength") or 0 for ld in F["landings"]), default=0)
            out.append({"track": t["id"], "reason": "no_landing",
                        "detail": f"no landing has a percussive onset on its fitted downbeat (best "
                                  f"{best:.2f} x median < {c['highlight']['eligible_onset_ratio']})"})
        else:
            ok.append(t)
    return ok, out


def _closer(bucket, energy: float | None, why: str, c: dict) -> tuple[str, str]:
    """rock or close for a track outside the lock blocks (fixer, review v1 musical #5: one close
    block of 55 tracks sorted by bpm alone swung between metal and ambient): the rock bucket goes
    to rock (a rock ballad under close_energy_max closes with the chill tracks: v2 put Just Look
    Up at 0.24 after Waterslides at 0.98), chill to close, anything else by energy (>=
    blocks.rock_energy_min: rock)."""
    if bucket == "rock":
        if energy is not None and energy < c["blocks"]["close_energy_max"]:
            return "close", f"{why}; rock at energy {energy:.2f}"
        return "rock", why
    if bucket != "chill" and energy is not None and energy >= c["blocks"]["rock_energy_min"]:
        return "rock", f"{why}; energy {energy:.2f}"
    return "close", why


def block_of(t: dict, F: dict, energy: float | None, c: dict = CFG) -> tuple[str, str]:
    """(block, why) for one eligible track (§6.2). Fixer: energy no longer sends a locked 4/4
    dance track out of its tempo block (It's Love, Bad Dreams landed in close at energy < 0.3);
    the close block is split into rock and close by genre bucket (_closer)."""
    b = c["blocks"]
    bucket = t.get("bucket")
    if F["grid_class"] == "free":
        return _closer(bucket, energy, "grid free", c)
    if F["bpb"] != 4:
        return _closer(bucket, energy, f"bpb {F['bpb']}", c)
    if bucket in ("rock", "chill"):
        return _closer(bucket, energy, f"bucket {bucket}", c)
    bpm = F["bpm"]
    for name in ("house", "dnb", "swing"):
        lo, hi = b[name]["bpm"]
        if lo <= bpm <= hi:
            return name, f"{bpm:.1f} bpm {F['grid_class']}"
    return _closer(bucket, energy, f"{bpm:.1f} bpm outside the house/dnb/swing ranges", c)


def blocks(tracks: list[dict], feats, energy: dict | None, c: dict = CFG) -> dict:
    """{block: [track ids]} for the given (eligible) tracks, with blocks of fewer than
    blocks.min_tracks folded into close. Membership reasons are in plan_order()."""
    return _membership(tracks, _getter(feats), energy or {}, c)[0]


def _membership(tracks, get, energy, c):
    mem = {k: [] for k in ("house", "dnb", "swing", "rock", "close")}
    why = {}
    for t in tracks:
        blk, w = block_of(t, get(t), energy.get(t["id"]), c)
        mem[blk].append(t["id"])
        why[t["id"]] = w
    for k in ("house", "dnb", "swing", "rock"):
        if 0 < len(mem[k]) < c["blocks"]["min_tracks"]:
            for tid in mem[k]:
                why[tid] += f"; {k} block has < {c['blocks']['min_tracks']} tracks, folded into close"
            mem["close"] += mem[k]
            mem[k] = []
    return mem, why


# ---------------------------------------------------------------------------------------------
# §6.3 order
# ---------------------------------------------------------------------------------------------
def _timbre_scale(tracks: list[dict]) -> float:
    """Median pairwise timbre distance of the folder (normalises the §6.3 timbre term to ~1)."""
    from ..plan import timbre_distance
    d = [timbre_distance(a, b) for i, a in enumerate(tracks) for b in tracks[i + 1:]]
    d = [x for x in d if x >= 0]
    return float(np.median(d)) if d else 1.0


def pair_cost(a: dict, b: dict, Fa: dict, Fb: dict, ea: float, eb: float, block: str, tscale: float,
              c: dict = CFG) -> tuple[float, dict]:
    """The position-independent part of c(a, b) (§6.3); the arc term |E_b - e*(x_b)| is added
    by the sequence cost. Timbre is the folder-normalised distance, capped at 2."""
    from ..plan import timbre_distance
    oc = c["order_cost"]
    ld = best_landing(Fb)
    harmonic = bool(ld and ld["lead"]["type"] in ("nobass-nodrums", "nobass-drums", "build"))
    td = timbre_distance(a, b)
    rel = relation(a, b, Fa, Fb, c=c) if block in LOCK_BLOCKS else None
    terms = {
        "tempo": oc["tempo"] * abs(math.log(Fb["bpm"] / Fa["bpm"])),
        "step": oc["step"] * max(0.0, abs(eb - ea) - oc["step_free"]),
        "key": oc["key"] * max(0, camelot(a, b) - 1) * harmonic,
        "timbre": oc["timbre"] * (min(2.0, td / tscale) if td >= 0 and tscale > 0 else 1.0),
        "artist": oc["same_artist"] * bool(_artists(a) & _artists(b)),
        "bucket": oc.get("bucket", 0.0) * bool(a.get("bucket") != b.get("bucket")),
        "non_lock": oc["non_lock"] * bool(rel is not None and rel["kind"] != "lock"),
        "house_down": oc["house_down"] * bool(block == "house" and Fb["bpm"] < Fa["bpm"] - oc["house_down_bpm"]),
    }
    return float(sum(terms.values())), terms


def _seq_cost(seq: list[int], P: np.ndarray, Hd: np.ndarray | None, Ar: np.ndarray, tail: int | None,
              Ex: np.ndarray | None = None) -> float:
    s = np.asarray(seq, int)
    tot = float(Ar[s, np.arange(len(s))].sum())
    if len(s) > 1:
        tot += float(P[s[:-1], s[1:]].sum())
    if Hd is not None and len(s):
        tot += float(Hd[s[0]])
    if tail is not None and len(s):
        tot += float(P[s[-1], tail])
    elif Ex is not None and len(s):
        tot += float(Ex[s[-1]])
    return tot


def _local_search(seq: list[int], cost, max_passes: int = 40) -> list[int]:
    """2-opt reversals and or-opt relocations (segments of 1-3) on the full sequence cost:
    the moves of plan._two_opt/_or_opt, evaluated exactly because the arc term depends on
    position. First improvement per pass, deterministic."""
    best = cost(seq)
    n = len(seq)
    for _ in range(max_passes):
        improved = False
        for i in range(n - 1):
            for j in range(i + 1, n):
                cand = seq[:i] + seq[i:j + 1][::-1] + seq[j + 1:]
                cc = cost(cand)
                if cc < best - 1e-9:
                    seq, best, improved = cand, cc, True
        for L in (1, 2, 3):
            for i in range(n - L + 1):
                seg, rest = seq[i:i + L], seq[:i] + seq[i + L:]
                for k in range(len(rest) + 1):
                    if k == i:
                        continue
                    cand = rest[:k] + seg + rest[k:]
                    cc = cost(cand)
                    if cc < best - 1e-9:
                        seq, best, improved = cand, cc, True
                        break
        if not improved:
            break
    return seq


def _order_block(ids: list[str], by: dict, get, energy: dict, block: str, head: str | None, tail: str | None,
                 offset: int, total: int, tscale: float, rng: random.Random, jitter: float, c: dict,
                 nxt: tuple[str, list[str]] | None = None) -> tuple[list[str], dict]:
    """Order one block: head = previous block's tail (fixed, outside), tail = pinned last id,
    offset = set position of the block's first slot, jitter = seeded pair-cost noise, nxt = (the
    next block, its ids): without a pinned tail, the last track pays its cheapest join into the
    next block (fixer, review v1 musical #5: a block ordered blind to its successor ended on
    210 BPM metal before an ambient block)."""
    free = sorted(i for i in ids if i != tail)
    nodes = free + ([tail] if tail else [])
    ix = {tid: k for k, tid in enumerate(nodes)}
    n = len(nodes)
    P = np.zeros((n, n))
    terms = {}
    for a in nodes:
        for b in nodes:
            if a != b:
                v, tm = pair_cost(by[a], by[b], get(by[a]), get(by[b]), energy.get(a, 0.5), energy.get(b, 0.5),
                                  block, tscale, c)
                P[ix[a], ix[b]] = v + (rng.uniform(-jitter, jitter) if jitter else 0.0)
                terms[(a, b)] = tm
    Hd = None
    if head:
        Hd = np.zeros(n)
        for b in nodes:
            v, tm = pair_cost(by[head], by[b], get(by[head]), get(by[b]), energy.get(head, 0.5),
                              energy.get(b, 0.5), block, tscale, c)
            Hd[ix[b]] = v
            terms[(head, b)] = tm
    Ex = None
    if nxt and nxt[1] and not tail:
        Ex = np.zeros(n)
        for a in nodes:
            Ex[ix[a]] = min(pair_cost(by[a], by[b], get(by[a]), get(by[b]), energy.get(a, 0.5), energy.get(b, 0.5),
                                      nxt[0], tscale, c)[0] for b in nxt[1])
    m = len(free)
    Ar = np.zeros((n, max(m, 1)))
    for tid in nodes:
        for k in range(m):
            x = (offset + k) / max(total - 1, 1)
            Ar[ix[tid], k] = c["order_cost"]["arc"] * abs(energy.get(tid, 0.5) - e_star(x, c))
    t_ix = ix[tail] if tail else None
    if tail:                                            # the pinned tail sits at slot m
        x = (offset + m) / max(total - 1, 1)
        tail_arc = c["order_cost"]["arc"] * abs(energy.get(tail, 0.5) - e_star(x, c))
    else:
        tail_arc = 0.0

    def cost(seq):
        return _seq_cost(seq, P, Hd, Ar, t_ix, Ex)

    # greedy start from the head, then local search
    seq, left = [], [ix[i] for i in free]
    prev = None
    while left:
        def g(k):
            base = Ar[k, len(seq)] + (P[prev, k] if prev is not None else (Hd[k] if Hd is not None else 0.0))
            return (base, nodes[k])
        k = min(left, key=g)
        seq.append(k)
        left.remove(k)
        prev = k
    seq = _local_search(seq, cost)
    order = [nodes[k] for k in seq] + ([tail] if tail else [])
    return order, {"cost": round(cost(seq) + tail_arc, 3), "terms": terms}


def _dnb_swing_bridge(mem: dict, by: dict, get, c: dict, energy: dict | None = None) -> tuple[str, str, float] | None:
    """The best 2:1 pair (last DnB track, first swing track) for the DOUBLE bridge (§6.2): every
    pair within the 6 % tolerance qualifies; the one with the lowest §6.3 tempo + energy-step cost
    wins (fixer, review v1 musical #5: the closest tempo alone bridged Blinding Lights at 0.76
    into Stonyridge Terrace at 0.21)."""
    tol = c["blocks"]["dnb_swing_double_pct"] / 100
    oc = c["order_cost"]
    en = energy or {}
    best, best_k = None, None
    for d in sorted(mem["dnb"]):
        Fd = get(by[d])
        for s in sorted(mem["swing"]):
            Fs = get(by[s])
            if Fd["grid_class"] != "locked" or Fs["grid_class"] != "locked" or not (Fd["octave_ok"] and Fs["octave_ok"]):
                continue
            dev = abs(Fd["bpm"] / (2 * Fs["bpm"]) - 1)
            if dev > tol:
                continue
            k = oc["tempo"] * abs(math.log(1 + dev)) + oc["step"] * max(
                0.0, abs(en.get(d, 0.5) - en.get(s, 0.5)) - oc["step_free"])
            if best is None or k < best_k - 1e-12:
                best, best_k = (d, s, dev), k
    return best


def plan_order(tracks: list[dict], feats, energy: dict | None = None, cfg: dict | None = None, seed: int = 0,
               block_order: list[str] | None = None) -> dict:
    """Eligibility, blocks, bridges and the order, with reasons (§6)."""
    c = cfg or CFG
    get = _getter(feats)
    if energy is None:
        from ..params import defaults
        from ..plan import energy_scores
        energy = energy_scores(tracks, defaults())
    eligible, excluded = eligibility(tracks, get, c)
    by = {t["id"]: t for t in tracks}
    mem, why = _membership(eligible, get, energy, c)
    border = [b for b in (block_order or c["blocks"]["order"]) if b in mem]
    border += [b for b in ("house", "dnb", "swing", "rock", "close") if b not in border]
    bridge = None
    if mem["dnb"] and mem["swing"] and border.index("swing") == border.index("dnb") + 1:
        bridge = _dnb_swing_bridge(mem, by, get, c, energy)
    tscale = _timbre_scale(eligible)
    rng, jitter = random.Random(seed), (ORDER_JITTER if seed else 0.0)
    total = len(eligible)
    order, info = [], {}
    head = None
    for bi, blk in enumerate(border):
        ids = mem[blk]
        if not ids:
            continue
        nb = next((b for b in border[bi + 1:] if mem[b]), None)
        nxt = (nb, mem[nb]) if nb and not (bridge and blk == "dnb") else None
        tail = bridge[0] if bridge and blk == "dnb" else None
        if bridge and blk == "swing":
            # the bridge's swing track is pinned first: order the rest behind it
            first = bridge[1]
            rest, inf = _order_block([i for i in ids if i != first], by, get, energy, blk, first, None,
                                     len(order) + 1, total, tscale, rng, jitter, c, nxt)
            seq = [first] + rest
        else:
            seq, inf = _order_block(ids, by, get, energy, blk, head, tail, len(order), total, tscale,
                                    rng, jitter, c, nxt)
        info[blk] = {"cost": inf["cost"]}
        order += seq
        head = seq[-1]
    return {"order": order, "blocks": {b: [i for i in order if i in set(mem[b])] for b in border if mem[b]},
            "block_order": [b for b in border if mem[b]], "why": why, "excluded": excluded,
            "bridge": {"dnb>swing": {"a": bridge[0], "b": bridge[1], "dev_pct": round(bridge[2] * 100, 2)}
                       if bridge else None},
            "costs": info, "energy": {i: round(float(energy.get(i, 0.5)), 3) for i in order}}


def select_and_order(tracks: list[dict], feats, energy: dict | None = None, cfg: dict | None = None,
                     seed: int = 0, block_order: list[str] | None = None) -> list[str]:
    """Track ids of the medley in running order (§6; every eligible track)."""
    return plan_order(tracks, feats, energy, cfg, seed, block_order)["order"]
