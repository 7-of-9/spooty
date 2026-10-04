"""Set-level planning (DESIGN §11.3, §8.1-8.3): per-join candidates (forms.enumerate_candidates,
memoised per pair), a deterministic beam across the set, lazy validation of the picks, and the
SessionPlanMedley that Session.plan() returns for a medley set.

build_medley_plan(tracks, order_ids, p, doc_medley, feats, stems, verify, memo) reads only
target_lufs from `p` (never overrides or crossfade parameters). `feats` is a FeatStore (get(track
dict)) or a {track id: Feats} dict; `stems` a StemStore (has(tid, path)) or None; `verify` a
VerifyStore (get / failed / bad_landings / version), a VerifyDoc dict or None; `memo` a dict the
session keeps, so an order edit recomputes only the joins it changes.
"""

from __future__ import annotations

import copy
import json
import math
import threading
from collections import OrderedDict
from dataclasses import dataclass, field

from . import CFG, COMPILER_VERSION, FEATS_VERSION, MEDLEY_VERSION
from . import schema as S
from .compile import transition_fields
from .forms import (FORMS, Cand, JoinCtx, PairCtx, _dL, beam_fields, body_peak, cell, enumerate_candidates,
                    excerpt_gain, exits_by_bar, local_score, lufs_window, measured_landing)

CAP_KEY = {"spin_slam": "spin", "tape_stop_slam": "tape_stop", "double_drop": "double_drop",
           "tease_drop": "tease", "vocal_reveal": "vocal_reveal", "stutter_stitch": "stutter"}


def _r(x: float, n: int = 6) -> float:
    return float(round(float(x), n))


# ---------------------------------------------------------------------------------------------
# inputs
# ---------------------------------------------------------------------------------------------
def feats_getter(feats):
    """t (track dict) -> Feats | None for a FeatStore, a {track id: Feats} dict or a callable."""
    if feats is None:
        return lambda t: None
    if isinstance(feats, dict):
        return lambda t: feats.get(t["id"])
    if callable(getattr(feats, "get", None)):
        def get(t):
            try:
                return feats.get(t)
            except (OSError, KeyError, ValueError):
                return None
        return get
    return feats


def has_stems(stems, t: dict, F: dict | None) -> bool:
    """AMENDMENTS 2: a track has stems when the StemStore has all four files."""
    if stems is None:
        return bool(F and F.get("stems"))
    try:
        return bool(stems.has(t["id"], t.get("path")))
    except (OSError, ValueError, TypeError, KeyError):
        return False


def stems_version(stems) -> str:
    try:
        return str(stems.version()) if stems is not None else ""
    except (OSError, ValueError):
        return ""


def verify_view(verify) -> tuple[dict, set, set, int]:
    """(entries getter source, failed hashes, bad landings {(tid, bar)}, version)."""
    if verify is None:
        return {}, set(), set(), 0
    if isinstance(verify, dict):
        doc = verify
    else:
        doc = getattr(verify, "doc", None) or {
            "entries": {}, "failed": list(getattr(verify, "failed", []) or []),
            "bad_landings": list(getattr(verify, "bad_landings", []) or []),
            "version": getattr(verify, "version", 0)}
    ver = doc.get("version", 0)
    ver = ver() if callable(ver) else ver
    bad = {(str(x[0]), int(x[1])) for x in doc.get("bad_landings", [])}
    return doc.get("entries", {}), set(doc.get("failed", [])), bad, int(ver or 0)


def track_blocks(tracks: list[dict], get, p: dict, c: dict) -> dict[str, str]:
    """track id -> block (§6.2), from order.blocks (E1) when importable, else the same rule here."""
    energy = {}
    try:
        from ..plan import energy_scores
        energy = energy_scores(tracks, p)
    except (ImportError, KeyError, ValueError, TypeError):
        energy = {}
    try:
        from .order import blocks
        mem = blocks(tracks, {t["id"]: get(t) for t in tracks}, energy, c)
        return {tid: blk for blk, ids in mem.items() for tid in ids}
    except ImportError:
        pass
    b = c["blocks"]
    out = {}
    for t in tracks:
        F = get(t)
        e = energy.get(t["id"])
        blk = "close"
        if F["grid_class"] != "free" and F["bpb"] == 4 and t.get("bucket") not in ("rock", "chill") and \
                not (e is not None and e < b["close_energy_max"]):
            for name in ("house", "dnb", "swing"):
                if b[name]["bpm"][0] <= F["bpm"] <= b[name]["bpm"][1]:
                    blk = name
                    break
        out[t["id"]] = blk
    return out


def excluded_report(tracks: list[dict], order_ids: list[str], get, c: dict) -> list[dict]:
    """AMENDMENTS 1: every track of the folder that is not in the medley, with its reason."""
    rest = [t for t in tracks if t["id"] not in set(order_ids)]
    try:
        from .order import eligibility
        ok, out = eligibility(rest, {t["id"]: get(t) for t in rest}, c)
    except ImportError:
        ok, out = rest, []
    out = [dict(e) for e in out]
    out += [{"track": t["id"], "reason": "other", "detail": "eligible but not in this set's order"} for t in ok]
    return out


# ---------------------------------------------------------------------------------------------
# per-track facts the beam needs
# ---------------------------------------------------------------------------------------------
@dataclass
class TrackInfo:
    t: dict
    F: dict
    lands: dict[int, dict]                 # landing bar -> Landing (bad landings removed)

    def __post_init__(self):
        self._eh = {(j, int(e["bar"])): (e, float(e["h"])) for j, ld in self.lands.items() for e in ld["exits"]}
        self._need: dict[int, float] = {}

    def bar_s(self, j: int) -> float:
        """Seconds per bar of the excerpt landing at j (its window fit, else the track bpm)."""
        return self.F["bpb"] * 60.0 / excerpt_bpm(self.F, self.lands.get(j))

    def need(self, j: int, c: dict) -> float:
        """R9: the native solo must last max(min_solo_bars bars, min_solo_s)."""
        if j not in self._need:
            self._need[j] = max(c["min_solo_bars"] * self.bar_s(j), float(c["min_solo_s"]))
        return self._need[j]

    def exit_h(self, j: int, X: int) -> tuple[dict, float] | None:
        return self._eh.get((j, X))


def excerpt_bpm(F: dict, land: dict | None) -> float:
    w = (land or {}).get("win") or {}
    f = w.get("fit")
    return round(60.0 / f["period_s"], 3) if f and w.get("cls") != "free" else float(F["bpm"])


# ---------------------------------------------------------------------------------------------
# beam (§11.3)
# ---------------------------------------------------------------------------------------------
@dataclass
class _State:
    score: float
    cands: tuple
    j0: int | None
    counts: dict = field(default_factory=dict)
    caps: dict = field(default_factory=dict)
    tiers: dict = field(default_factory=dict)
    vac: int = 0                        # vacuum joins so far (fixer, musical #1)


def _cap_key(q: Cand) -> str | None:
    if S.WHEEL_TAG in q.variant:
        return "wheel"
    return CAP_KEY.get(q.form)


def beam(infos: list[TrackInfo], cands_by_join: list[list[Cand]], c: dict = CFG) -> tuple[list[Cand], int | None, dict]:
    """Beam search across the set (§11.3). Returns (the chosen candidate per join, the first
    track's landing bar, diagnostics). Each step scores every (state, candidate) extension from
    the parent state, keeps the best beam_width (ties: parent rank, then the lower candidate id,
    so the result is deterministic) and only then builds their counters.
    Feasibility for track k (between joins k-1 and k): join k's X is an exit of join k-1's
    landing j, and a_out_start(k) - b_in_end(k-1) >= max(8 bars, 12 s) of track k. When no state
    survives a join the rule is relaxed for that join only (solo first, then the exit match) with
    a penalty, and the diagnostics say where.
    Fixer (review v1, musical #1-2): a candidate is scored with B's landing quality (its best H)
    as a look-ahead, taken back when track k's actual H(j, n) is added (without it the beam pruned
    on join scores alone and missed B's best landing on 46 of 79 tracks); a vacuum join after a
    vacuum join costs vacuum_b2b, and so does every vacuum join once the running vacuum share
    exceeds vacuum_cap (+ 2 joins of slack)."""
    P, w = c["penalties"], c["weights"]
    caps = c["caps"]
    width = int(c["beam_width"])
    n_j = len(cands_by_join)
    diag = {"relaxed": []}
    if n_j == 0:
        return [], None, diag
    t0 = infos[0]
    wh = w["h"]
    cap = float(c.get("vacuum_cap", 1.0))
    vw = int(c.get("creation", {}).get("variety_window", 4))
    spread = float(c.get("creation", {}).get("spread", 0.0))

    def hmax(ti: TrackInfo, j: int) -> float:
        ld = ti.lands.get(j)
        return float(ld["h"]) if ld else 0.0

    def first_track(q: Cand, level: int) -> tuple[float, int] | None:
        best = None
        for j, ld in t0.lands.items():
            eh = t0.exit_h(j, q.X)
            if eh is None:
                continue
            solo = q.fields["a_out_start"] - float(ld["t"])
            pen = 0.0
            if solo < t0.need(j, c) - 1e-6:
                if level < 1:
                    continue
                pen = 3.0 + 0.2 * (t0.need(j, c) - solo)
            v = wh * eh[1] - pen
            if best is None or v > best[0] + 1e-12 or (abs(v - best[0]) <= 1e-12 and j < best[1]):
                best = (v, j)
        return best

    def link(ti: TrackInfo, prev: Cand, q: Cand, level: int) -> float | None:
        """Track k between join k-1 (prev) and join k (q): H(j, n) minus relaxation penalties."""
        eh = ti.exit_h(prev.j, q.X)
        pen = 0.0
        if eh is None:
            if level < 2:
                return None
            ld = ti.lands.get(prev.j)
            if ld is None or q.X - prev.j < 4:
                return None
            eh, pen = ({"h": ld["h"]}, float(ld["h"]) - 1.0), 20.0
        solo = q.fields["a_out_start"] - prev.fields["b_in_end"]
        need = ti.need(prev.j, c)
        if solo < need - 1e-6:
            if level < 1:
                return None
            pen += 3.0 + 0.2 * (need - solo)
        return wh * eh[1] - pen - wh * hmax(ti, prev.j)       # the look-ahead is taken back

    states = [_State(0.0, (), None)]
    for i, cl in enumerate(cands_by_join):
        ti = infos[i]
        scored: list[tuple] = []
        for level in (0, 1, 2):
            for si, st in enumerate(states):
                prev = st.cands[-1] if st.cands else None
                recent = st.cands[-3:]
                sig_recent = any(x.tier == "signature" for x in recent)
                loud_recent = any(x.loud for x in recent)
                recent_forms = [x.form for x in st.cands[-(vw - 1):]] if vw > 1 else []
                for q in cl:
                    creation = q.form in S.CREATION_FORMS
                    if creation and q.form in recent_forms:
                        continue                          # variety: no creation form twice within vw joins
                    ck = _cap_key(q)
                    if ck and st.caps.get(ck, 0) >= caps.get(ck, 1 << 30):
                        continue
                    j0 = st.j0
                    if i == 0:
                        ft = first_track(q, level)
                        if ft is None:
                            continue
                        s, j0 = st.score + q.S + ft[0], ft[1]
                    else:
                        lk = link(ti, prev, q, level)
                        if lk is None:
                            continue
                        s = st.score + q.S + lk
                    if prev is not None and prev.form == q.form:
                        s -= P["same_form"]
                    if creation:                          # spread the creation forms over the set
                        s -= spread * st.counts.get(q.form, 0)
                    elif q.tier == "signature" and sig_recent:
                        s -= P["sig_within3"]
                    if q.loud and loud_recent:
                        s -= P["loud_within3"]
                    if prev is not None and prev.family == q.family:
                        s -= P["same_shape"]
                    if q.form not in st.counts:
                        s += P["first_use"]
                    if q.form == "cut_on_one":            # the universal fallback, not a variety pick
                        s -= P.get("fallback", 0.0)
                    s += wh * hmax(infos[i + 1], q.j)     # look-ahead: B's landing quality
                    if q.vacuum:
                        if prev is not None and prev.vacuum:
                            s -= P.get("vacuum_b2b", 0.0)
                        if st.vac + 1 > cap * (i + 1) + 2:
                            s -= P.get("vacuum_share", 0.0)
                    scored.append((-round(s, 9), si, q.id, s, q, j0))
            if scored:
                if level:
                    diag["relaxed"].append({"join": i, "level": level})
                break
        if not scored:
            raise ValueError(f"medley beam: no candidate fits join {i}")
        scored.sort(key=lambda x: x[:3])
        nxt = []
        for _, si, _, s, q, j0 in scored[:width]:
            st = states[si]
            counts = dict(st.counts)
            counts[q.form] = counts.get(q.form, 0) + 1
            cp = st.caps
            ck = _cap_key(q)
            if ck:
                cp = dict(cp)
                cp[ck] = cp.get(ck, 0) + 1
            tiers = dict(st.tiers)
            tiers[q.tier] = tiers.get(q.tier, 0) + 1
            nxt.append(_State(s, st.cands + (q,), j0, counts, cp, tiers, st.vac + int(q.vacuum)))
        states = nxt
    tgt = c["tier_targets"]
    final = []
    for rank, st in enumerate(states):         # the last track's H (its look-ahead) and the tier shares
        sc = st.score
        sc -= P["share"] * sum(abs(st.tiers.get(t, 0) / n_j - v) for t, v in tgt.items())
        final.append((-round(sc, 9), rank, sc, st))
    final.sort(key=lambda x: x[:2])
    best = final[0][3]
    diag["score"] = _r(final[0][2], 6)
    return list(best.cands), best.j0, diag


# ---------------------------------------------------------------------------------------------
# the plan
# ---------------------------------------------------------------------------------------------
def pair_key(pc: PairCtx, stems_ver: str, idx: int = 0) -> str:
    rv = None
    if pc.ratings:
        rv = pc.ratings.get(f"{pc.a}>{pc.b}")
    phase = idx % len(pc.c["forms"]["echo_sets"])          # echo settings rotate with the join index
    return json.dumps(["medley-pair", MEDLEY_VERSION, FEATS_VERSION, pc.a, pc.b, pc.fa.get("sig"), pc.fb.get("sig"),
                       pc.stems_a, pc.stems_b, stems_ver if (pc.stems_a or pc.stems_b) else "", pc.block_a,
                       pc.block_b, pc.target_lufs, pc.ceiling_db, pc.seed, sorted(pc.bad_landings), rv,
                       sorted(pc.lands) if pc.lands is not None else None, phase], default=str)


def final_comp(q: Cand, i: int) -> dict:
    """The composition as it appears at join i: id j{i+1:02d}, hash recomputed."""
    comp = copy.deepcopy(q.comp)
    comp["id"] = f"j{i + 1:02d}"
    comp["hash"] = S.canonical_hash(comp)
    return comp


def _final_hash(q: Cand, i: int) -> str:
    memo = q.__dict__.setdefault("_fh", {})
    if i not in memo:
        memo[i] = S.canonical_hash({**q.comp, "id": f"j{i + 1:02d}"})
    return memo[i]


def _reason(q: Cand, comp: dict, lead_type: str) -> str:
    r = comp["rel"]
    if r["kind"] == "lock":
        rel = f"lock {float(r['ratio'] * 100 - 100):+.1f}%"
    elif r["kind"] == "double":
        rel = f"double {r['a_ratio']:g}:1"
    else:
        rel = "free"
    return f"{q.form} · lead {lead_type} {q.lead_bars} bars · {rel} · cam {r['camelot']}"


def final_ending(ti: TrackInfo, ex: dict, c: dict) -> tuple[float, float]:
    """(final_end, final_fade_s) of the last song (fixer, review v1 musical #6: the v1 set ended
    with a 2.3 s fade in the middle of a solo). The song's own end when it is within
    final_end_within_s of the exit; otherwise the first section boundary at least
    final_fade_min_s after the exit, faded over max(final_fade_min_s, final_fade_bars bars)."""
    L = c["loudness"]
    dur, x = float(ti.F["duration"]), float(ex["exit"]["t"])
    if dur - x <= L["final_end_within_s"]:
        return dur, 0.0
    fade = max(float(L["final_fade_min_s"]), L["final_fade_bars"] * ti.bar_s(ex["land"]["bar"]))
    bounds = sorted(float(sc["start"]) for sc in ti.F["sections"])
    end = next((b for b in bounds if b >= x + fade - 1e-6 and b <= x + L["final_end_within_s"]), None)
    end = x + fade if end is None else end
    return _r(min(end, dur), 3), _r(min(fade, end - x), 3)


def _excerpt(ti: TrackInfo, j: int, X: int, lead: dict, block: str, c: dict, target: float,
             ex_rec: dict | None, ceiling: float = -1.0) -> dict:
    F = ti.F
    ld = ti.lands[j]
    e = ex_rec or {"bar": X, "t": float(F["bars"]["t"][min(X, len(F["bars"]["t"]) - 1)]), "kind": "end",
                   "s_out": 0.0, "vocal_at_edge": False, "h": ld["h"]}
    body = lufs_window(F["kblocks"], lead["t"], float(e["t"]))
    arc = float(c["arc_off_lu"].get(block, 0))
    labels = sorted({str(x) for x in list(F["bars"]["label"])[j: max(j + 1, X)]})
    return {
        "track": F["track"] if not ti.t.get("id") else ti.t["id"], "block": block, "bpb": int(F["bpb"]),
        "grid_class": ld["win"]["cls"], "bpm": float(excerpt_bpm(F, ld)),
        "lead": {"type": lead["type"], "bars": int(lead["bars"]), "t": _r(lead["t"]),
                 "pickup_beats": int(lead.get("pickup_beats", 0))},
        "land": {"bar": int(j), "t": float(ld["t"]), "label": str(ld["label"]), "why": str(ld["why"]),
                 "rel_db": float(ld["rel_db"])},
        "exit": {"bar": int(X), "t": float(e["t"]), "kind": e["kind"], "s_out": float(e["s_out"]),
                 "vocal_clear": (not bool(e.get("vocal_at_edge"))) if F.get("stems") else None},
        "body_bars": int(X - j), "body_lufs": _r(body, 2), "arc_off_lu": arc,
        "gain_db": _r(excerpt_gain(body, arc, target, c, body_peak(F, lead["t"], float(e["t"])), ceiling), 2),
        "h": float(e.get("h", ld["h"])),
        "labels": labels,
    }


def _row(t: dict, ex: dict, start: float) -> dict:
    """build_plan's summary row (the fields this track dict has) + the excerpt brief."""
    row = {"id": t["id"], "artist": str(t.get("artist") or ""), "title": str(t.get("title") or ""),
           "file": str(t.get("file") or ""), "bpm": float(t.get("bpm") or ex["bpm"]),
           "duration": float(t.get("duration") or 0.0), "start": _r(start, 3)}
    for k, src in (("camelot", "camelot"), ("regularity", "beat_regularity")):
        if isinstance(t.get(src), (str, int, float)) and not isinstance(t.get(src), bool):
            row[k] = t[src]
    if t.get("key") and t.get("scale"):
        row["key"] = f"{t['key']} {t['scale']}"
    for k in ("lufs", "danceability"):
        v = t.get(k)
        if isinstance(v, (int, float)) and math.isfinite(v):
            row[k] = round(float(v), 2)
    row["excerpt"] = {"lead_t": ex["lead"]["t"], "land_t": ex["land"]["t"], "exit_t": ex["exit"]["t"],
                      "lead_type": ex["lead"]["type"], "labels": ex["labels"]}
    return row


def build_medley_plan(tracks: list[dict], order_ids: list[str], p: dict, doc_medley: dict | None, feats,
                      stems=None, verify=None, memo: dict | None = None, *, ratings: dict | None = None,
                      cfg: dict | None = None, diag_out: dict | None = None) -> dict:
    """The SessionPlanMedley (§8.1) for the ordered tracks; valid under schema.validate_plan.
    `ratings` is pair-ratings.json content (read only, §11.2 Rt); `diag_out` receives the beam's
    diagnostics (relaxed joins, per-join picks)."""
    c = cfg or CFG
    doc = doc_medley or {}
    memo = memo if memo is not None else {}
    get = feats_getter(feats)
    by_id = {t["id"]: t for t in tracks}
    entries, failed, bad, _ = verify_view(verify)
    needs_prep, excluded = [], []
    infos: list[TrackInfo] = []
    for tid in order_ids:
        t = by_id.get(tid)
        if t is None:
            excluded.append({"track": tid, "reason": "other", "detail": "not in this folder"})
            continue
        F = get(t)
        if F is None:
            needs_prep.append(tid)
            excluded.append({"track": tid, "reason": "needs_prep", "detail": "no medley features"})
            continue
        # §5.1(6), fixer (review v1 musical #2): the onset gate is V1's own test (v1_ok), so
        # drops whose onset flux is weak after the riser pass (Dreaming 2:32.68, Forever, 10-35,
        # Body Motion...; the old 0.8 x median rule dropped 16 top landings) while a landing that
        # V1 would reject is used only when the track has no other (free tracks and windows keep
        # theirs: bin -0.2)
        lands = {int(ld["bar"]): measured_landing(ld, c, F) for ld in F["landings"]
                 if (tid, int(ld["bar"])) not in bad and ld["exits"]}
        onset = {j: ld for j, ld in lands.items()
                 if ld.get("v1_ok", True) or F["grid_class"] == "free" or (ld.get("win") or {}).get("cls") == "free"}
        lands = onset or lands
        if not lands:
            excluded.append({"track": tid, "reason": "no_landing",
                             "detail": "every landing is marked bad or has no exit"})
            continue
        infos.append(TrackInfo(t, F, lands))
    excluded += excluded_report(tracks, list(order_ids), get, c)
    seed = int(doc.get("seed", 0))
    target = float(p.get("target_lufs", -11.0))
    ceiling = float(p.get("ceiling_db", -1.0))
    F_of = {ti.t["id"]: ti.F for ti in infos}
    blocks = track_blocks([ti.t for ti in infos], lambda t: F_of[t["id"]], p, c) if infos else {}
    sv = stems_version(stems)
    stems_of = {ti.t["id"]: has_stems(stems, ti.t, ti.F) for ti in infos}

    # candidates per join (memoised per pair); drop failed hashes and bad landings
    cands_by_join: list[list[Cand]] = []
    ctxs: list[PairCtx] = []
    for i in range(len(infos) - 1):
        A, B = infos[i], infos[i + 1]
        pc = PairCtx(A.t, B.t, A.F, B.F, stems_a=stems_of[A.t["id"]], stems_b=stems_of[B.t["id"]],
                     block_a=blocks.get(A.t["id"], "close"), block_b=blocks.get(B.t["id"], "close"),
                     target_lufs=target, ceiling_db=ceiling, seed=seed, ratings=ratings,
                     bad_landings=frozenset(x for x in bad if x[0] == B.t["id"]), c=c,
                     lands=frozenset(B.lands))
        key = pair_key(pc, sv, i)
        if key not in memo:
            memo[key] = enumerate_candidates(pc, i)
        cl = [q for q in memo[key] if q.valid is not False and q.j in B.lands]
        if failed:     # §11.4; a join whose every candidate failed keeps them (§16.2: shown as fail)
            cl = [q for q in cl if _final_hash(q, i) not in failed] or cl
        cands_by_join.append(cl)
        ctxs.append(pc)

    # beam, then validate the picks; an invalid pick leaves its list and the beam re-runs
    diag = {}
    chosen, j0 = [], None
    for _ in range(max(1, len(cands_by_join) * 2 + 2)):
        chosen, j0, diag = beam(infos, cands_by_join, c)
        bad_pick = [(i, q) for i, q in enumerate(chosen) if not q.check(infos[i].F, infos[i + 1].F)]
        if not bad_pick:
            break
        for i, q in bad_pick:
            cands_by_join[i] = [x for x in cands_by_join[i] if x is not q]
            if not cands_by_join[i]:
                raise ValueError(f"medley plan: no valid composition for join {i} "
                                 f"({infos[i].t['id']} > {infos[i + 1].t['id']})")

    # excerpts
    n = len(infos)
    excerpts = []
    for k, ti in enumerate(infos):
        if n == 1:
            j = max(ti.lands, key=lambda b: (ti.lands[b]["h"], -b))
            X = int(ti.lands[j]["exits"][0]["bar"])
        elif k == 0:
            j, X = j0, chosen[0].X
        elif k < n - 1:
            j, X = chosen[k - 1].j, chosen[k].X
        else:
            j = chosen[-1].j
            X = int(ti.lands[j]["exits"][0]["bar"])
        ld = ti.lands[j]
        if k == 0:
            lead = dict(ld["lead"])
        else:
            q = chosen[k - 1]
            lead = {"type": ld["lead"]["type"], "bars": q.lead_bars, "t": q.fields["b_in_start"],
                    "pickup_beats": ld["lead"].get("pickup_beats", 0)}
        eh = ti.exit_h(j, X)
        excerpts.append(_excerpt(ti, j, X, lead, blocks.get(ti.t["id"], "close"), c, target, eh[0] if eh else None,
                                 ceiling))

    # transitions
    transitions = []
    for i, q in enumerate(chosen):
        A, B = infos[i], infos[i + 1]
        memo_q = q.__dict__.setdefault("_final", {})            # memoised with the candidate
        if i not in memo_q:
            c0 = final_comp(q, i)
            memo_q[i] = (c0, transition_fields(c0, A.F, B.F))
        comp, f = copy.deepcopy(memo_q[i][0]), memo_q[i][1]
        checks = entries.get(comp["hash"])
        if checks is not None:
            comp["checks"] = copy.deepcopy(checks)
        warped = any(cl["src"] == "a" and cl["warp"] == "r2" for cl in comp["clips"])
        rel = comp["rel"]
        a, b = A.t["id"], B.t["id"]
        transitions.append({
            "index": i, "key": f"{a}>{b}", "a": a, "b": b, "style": "medley",
            "beatmatch": rel["kind"] in ("lock", "double"),
            "a_out_start": f["a_out_start"], "a_out_end": f["a_out_end"], "b_in_start": f["b_in_start"],
            "b_in_end": f["b_in_end"], "T": f["T"], "T_overlap": f["T_overlap"], "bars": f["bars"],
            "reason": _reason(q, comp, B.lands[q.j]["lead"]["type"]), "key_distance": int(rel["camelot"]),
            "stretch_pct": float(rel["stretch_pct"]) if warped else None, "k": 1.0, "requested": "medley",
            "override": {}, "form": comp["form"], "variant": comp["variant"], "tier": comp["tier"],
            "b_in": comp["b_in"], "land_s": f["land_s"], "exit_s": f["exit_s"], "b_enter_s": f["b_enter_s"],
            "grid": copy.deepcopy(f["grid"]), "events_s": copy.deepcopy(f["events_s"]),
            "checks_summary": S.checks_summary(checks) if checks is not None else None,
            "composition": comp,
        })

    # timeline (output seconds): solo, region, solo, ... (§8.1)
    native_starts = [float(excerpts[0]["lead"]["t"])] if n else []
    native_starts += [tr["b_in_end"] for tr in transitions]
    starts, t_out = [], 0.0
    for i in range(n):
        if i == 0:
            starts.append(0.0)
        if i < len(transitions):
            tr = transitions[i]
            region = t_out + max(0.0, tr["a_out_start"] - native_starts[i])
            starts.append(region + tr["b_enter_s"])
            t_out = region + tr["T"]
    final_end, final_fade, first_fade = 0.0, 0.0, 0.0
    if n:
        last, lt = excerpts[-1], infos[-1]
        final_end, final_fade = final_ending(lt, last, c)
        t_out += max(0.0, final_end - native_starts[-1])
        e0, f0 = excerpts[0], infos[0]
        lb = e0["land"]["bar"] - e0["lead"]["bars"]
        rel0 = float(f0.F["bars"]["rel_db"][max(0, lb)])
        if rel0 > c["loudness"]["first_fade_rel_db"]:
            first_fade = _r(c["loudness"]["first_fade_bars"] * f0.bar_s(e0["land"]["bar"]), 3)
    order = [_row(ti.t, ex, starts[k]) for k, (ti, ex) in enumerate(zip(infos, excerpts))]
    tiers = {t: 0 for t in S.TIERS}
    st = {"pass": 0, "warn": 0, "fail": 0, None: 0}
    for tr in transitions:
        tiers[tr["tier"]] += 1
        st[(tr["checks_summary"] or {}).get("status")] += 1
    plan = {
        "kind": "medley", "order": order, "transitions": transitions, "total_seconds": _r(t_out, 3),
        "native_starts": native_starts, "first_fade_s": first_fade, "final_end": final_end,
        "final_fade_s": final_fade,
        "medley": {
            "schema": S.SCHEMA_ID, "medley_version": MEDLEY_VERSION, "compiler": COMPILER_VERSION, "seed": seed,
            "target_s": float(doc.get("target_s", c["target_s"])), "excerpts": excerpts, "motif": None,
            "needs_prep": needs_prep, "excluded": excluded,
            "stats": {"songs": n, "total_s": _r(t_out, 3), "tiers": tiers, "verified": st["pass"],
                      "warned": st["warn"], "failed": st["fail"], "unverified": st[None]},
        },
    }
    _register(plan, ctxs, chosen, infos, c)
    if diag_out is not None:                          # beam diagnostics for the CLI report
        diag_out.update(diag, joins=[{"form": q.form, "variant": q.variant, "X": q.X, "j": q.j, "S": q.S,
                                      "alternatives": len(cl)} for q, cl in zip(chosen, cands_by_join)])
    return plan


# ---------------------------------------------------------------------------------------------
# the verification ladder's hooks (§16.2 rungs 2-3): other compositions for a planned join
# ---------------------------------------------------------------------------------------------
_PLANS: "OrderedDict[int, tuple]" = OrderedDict()     # id(plan) -> (plan, pair ctxs, chosen, infos, cfg)
_PLANS_LOCK = threading.Lock()


def _register(plan: dict, ctxs: list, chosen: list, infos: list, c: dict) -> None:
    with _PLANS_LOCK:
        _PLANS[id(plan)] = (plan, ctxs, chosen, infos, c)
        _PLANS.move_to_end(id(plan))
        while len(_PLANS) > 16:
            _PLANS.popitem(last=False)


def _lookup(plan: dict, i: int):
    with _PLANS_LOCK:
        hit = _PLANS.get(id(plan))
    if hit is None or hit[0] is not plan or not 0 <= i < len(hit[1]):
        return None
    return hit


def _join_options(plan: dict, i: int, forms: list[str] | None, variants: list[str] | None = None) -> list[dict]:
    """Every buildable composition for join i's planned excerpts (A's exit X, B's landing j), all
    variants, valid (§8.9), keeping the neighbours' native solos (R9), best local score first."""
    hit = _lookup(plan, i)
    if hit is None:
        return []
    _, ctxs, chosen, infos, c = hit
    pc, q0 = ctxs[i], chosen[i]
    xs = exits_by_bar(pc.fa)
    land = next((ld for ld in pc.fb["landings"] if int(ld["bar"]) == q0.j), None)
    if q0.X not in xs or land is None:
        return []
    ex, ld_a = xs[q0.X]
    ctx = JoinCtx(pc.ta, pc.tb, pc.fa, pc.fb, ex, land, idx=i, stems_a=pc.stems_a, stems_b=pc.stems_b,
                  block_a=pc.block_a, block_b=pc.block_b, dL=_dL(pc, ex, ld_a, land), ratings=pc.ratings, c=c)
    trs = plan["transitions"]
    lo = trs[i - 1]["b_in_end"] + infos[i].need(chosen[i - 1].j, c) if i > 0 else -math.inf
    hi = trs[i + 1]["a_out_start"] - infos[i + 1].need(q0.j, c) if i + 1 < len(trs) else math.inf
    names = forms if forms is not None else [f for f in cell(ctx) if f in FORMS]
    if forms is None and c.get("creation", {}).get("enabled", False):
        names = list(S.CREATION_FORMS) + names            # rung 2: other creation forms before slams
    out = []
    for name in names:
        form = FORMS.get(name)
        if form is None or (forms is None and not form.allowed(ctx)) or \
                (form.needs_stems and not (ctx.stems_a and ctx.stems_b)):
            continue
        for v in (variants if variants is not None else form.variant_set(ctx)):
            comp = form.build(ctx, v)
            if comp is None:
                continue
            f = beam_fields(ctx, comp)
            if f is None or f["a_out_start"] < lo - 1e-6 or f["b_in_end"] > hi + 1e-6:
                continue
            if name in S.CREATION_FORMS:
                from .creation import creation_score
                sc = creation_score(ctx, comp)
            else:
                sc = local_score(ctx, comp)
            if sc is None:
                continue
            comp["score"] = {"local": sc[0], "terms": sc[1]}
            comp["id"] = f"j{i + 1:02d}"
            comp["hash"] = S.canonical_hash(comp)
            if not S.validate_composition(comp, pc.fa, pc.fb):
                out.append(comp)
    out.sort(key=lambda d: (-d["score"]["local"], d["form"], d["variant"]))
    return out


def join_alternatives(plan: dict, i: int) -> list[dict]:
    """§16.2 rung 2: the other candidates with the same (j_B, X_A) as join i, in local-score
    order (every variant of every allowed form, not only the enumerated two). [] for a plan this
    process did not build."""
    h = plan["transitions"][i]["composition"]["hash"] if i < len(plan.get("transitions", [])) else None
    return [d for d in _join_options(plan, i, None) if d["hash"] != h]


def join_options(plan: dict, i: int) -> list[dict]:
    """medley v6 candidate search: every buildable composition for join i's planned excerpts
    (all forms and length variants), best local score first."""
    return _join_options(plan, i, None)


def join_variant(plan: dict, i: int, form: str, variant: str) -> dict | None:
    """One named variant of `form` for join i's excerpts (e.g. a creation's pitched "c0p")."""
    opts = _join_options(plan, i, [form], [variant])
    return opts[0] if opts else None


def fallback_join(plan: dict, i: int, form: str) -> dict | None:
    """§16.2 rungs 3-4: `form` (echo_slam, roll_slam, cut_on_one, ...) for join i's excerpts, even
    outside the B-in table's cell; the best valid variant, or None."""
    opts = _join_options(plan, i, [form])
    return opts[0] if opts else None


__all__ = ["build_medley_plan", "join_alternatives", "fallback_join", "join_options", "join_variant", "beam", "TrackInfo", "feats_getter", "has_stems", "verify_view",
           "track_blocks", "excluded_report", "final_comp", "excerpt_bpm"]
