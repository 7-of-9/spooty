"""A mix session for one folder: persisted params/overrides/order, plan and render caches."""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from collections import OrderedDict

from .analyze import analyze_folder
from .audio import AudioCache
from .params import SCHEMA, coerce, coerce_override, defaults
from .plan import build_plan, compute_order, energy_scores, pair_cost, plan_transition
from .render import render_clip, render_full


def _slug(folder: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(folder.rstrip("/"))) or "folder"
    return f"{base}-{hashlib.sha1(folder.encode()).hexdigest()[:8]}"


ARC_LABELS = {
    "energy": "energy arc: high → mid → chill",
    "genre": "genre waves: dance/party → rock → chill",
    "free": "best flow: free order, whatever mixes best",
}
DEFAULT_SETS = [("A", "A · Energy arc", "energy"), ("B", "B · Genre waves", "genre")]
REJECT_SCORE = 20      # a rejected join is recorded as this rating
APPROVE_SCORE = 80     # "approve" lifts a join to at least this rating
HISTORY_CAP = 40

_ROCK = ("rock", "metal", "grunge", "punk", "blues", "guitar", "indie", "alternative")
_DANCE = ("house", "techno", "trance", "edm", "dance", "electro", "pop", "drum", "dnb",
          "garage", "disco", "funk", "hip", "rap", "r&b")
_CHILL = ("ambient", "chill", "downtempo", "trip", "lounge", "psybient", "idm", "new age",
          "jazz", "bossa", "acoustic", "folk", "soul")


def genre_bucket(genre: str) -> str | None:
    g = (genre or "").lower()
    for words, name in ((_ROCK, "rock"), (_CHILL, "chill"), (_DANCE, "dance")):
        if any(w in g for w in words):
            return name
    return None


class Session:
    def __init__(self, folder: str, data_dir: str, cache_dir: str, log=print):
        self.folder = folder
        self.data_dir = data_dir
        self.global_ratings_path = os.path.join(data_dir, "pair-ratings.json")
        try:
            with open(self.global_ratings_path) as fh:
                self.global_ratings = {k: int(v) for k, v in json.load(fh).items()}
        except Exception:
            self.global_ratings = {}
        self.dir = os.path.join(data_dir, "sessions", _slug(folder))
        self.mix_dir = os.path.join(self.dir, "mixes")
        os.makedirs(self.mix_dir, exist_ok=True)
        self.state_path = os.path.join(self.dir, "session.json")
        self.lock = threading.RLock()
        self.audio = AudioCache(size=10)
        self.clips: OrderedDict[str, tuple[bytes, dict]] = OrderedDict()
        self.tracks = analyze_folder(folder, cache_dir, log=log)
        self._load_timbre(data_dir)
        self._load_mood_model(data_dir)
        struct_dir = os.path.join(data_dir, "structure")
        for t in self.tracks:   # section labels from the all-in-one cache, when present
            sp = os.path.join(struct_dir, os.path.splitext(os.path.basename(t["path"]))[0] + ".json")
            try:
                if os.path.exists(sp):
                    with open(sp) as fh:
                        segs = json.load(fh).get("segments") or []
                    # stale-cache guard: segments must tile THIS file's duration
                    # (a replaced/re-downloaded edit has a different length)
                    if segs and abs(segs[-1]["end"] - t["duration"]) <= 2.5:
                        t["segments"] = segs
            except Exception:
                pass
        self.by_id = {t["id"]: t for t in self.tracks}
        self.state = {"params": defaults(), "overrides": {}, "sets": {}, "active_set": "A",
                      "ratings": {}}
        self._tpl_cache: dict = {}
        self._ratings_ver = 0
        saved = {}
        if os.path.exists(self.state_path):
            with open(self.state_path) as fh:
                saved = json.load(fh)
            self.state.update(saved)
            self.state["params"] = coerce(saved.get("params"))
            self.state["overrides"] = {k: coerce_override(v)
                                       for k, v in (saved.get("overrides") or {}).items()}
            self.state["overrides"] = {k: v for k, v in self.state["overrides"].items() if v}
        self._plan = None
        self._plan_key = None
        self.render_job: dict = {"status": "idle"}
        self._migrate_sets(saved)

    # -- saved, editable sets --------------------------------------------------------------
    def _migrate_sets(self, saved: dict) -> None:
        """Older sessions had computed A/B/C orders + a manual override; turn those into
        saved sets once. Afterwards orders only change when the listener edits them."""
        sets = self.state.get("sets") or {}
        changed = False
        excluded = set(saved.get("excluded") or [])
        keep = [t for t in self.tracks if t["id"] not in excluded]
        first_time = "sets" not in saved or not sets
        if first_time:      # deleted default sets stay deleted on later starts
            for sid, name, arc in DEFAULT_SETS:
                if sid not in sets:
                    sets[sid] = self._new_set_doc(sid, name, arc, "seed", self.arc_order(arc, tracks=keep))
                    changed = True
        manual = saved.get("manual_order")
        if manual and "M" not in sets and first_time:
            order = [i for i in manual if i in self.by_id and i not in excluded]
            sets["M"] = self._new_set_doc("M", "Manual edits (migrated)", "energy", "seed", order)
            changed = True
        for doc in sets.values():   # sets from before versioning: each is v1 of its own family
            if "family" not in doc:
                doc["family"], doc["version"] = doc["name"], 1
                changed = True
        for doc in sets.values():   # tracks deleted from the folder drop out of every set
            clean = [i for i in doc.get("order", []) if i in self.by_id]
            if clean != doc.get("order"):
                doc["order"] = clean
                changed = True
        self.state["sets"] = sets
        old_active = saved.get("active_set") or self.state.get("active_set")
        active = {"C": "B", "custom": "M" if "M" in sets else "A"}.get(old_active, old_active)
        if active not in sets:
            active = "A"
        if saved.get("active_set") == "B" and "sets" not in saved:
            active = "A"            # old B was the mood variant of the energy arc
        if active != self.state.get("active_set"):
            changed = True
        self.state["active_set"] = active
        for legacy in ("manual_order", "excluded"):
            if legacy in self.state:
                self.state.pop(legacy)
                changed = True
        if changed:
            self.save()

    @staticmethod
    def _new_set_doc(sid: str, name: str, arc: str, start: str, order: list[str],
                     version: int = 1) -> dict:
        # a set is one VERSION of a named family: generating it again adds a version, and the
        # older ones stay playable ("Claude_Best v3", "v2", …)
        return {"id": sid, "name": name, "family": name, "version": version, "arc": arc,
                "start": start, "order": list(order), "history": [], "created": time.time(), "edits": 0}

    def _next_version(self, family: str) -> int:
        return 1 + max([int(d.get("version") or 1) for d in self.state["sets"].values()
                        if (d.get("family") or d["name"]) == family] or [0])

    def _new_sid(self) -> str:
        n = 1
        while f"S{n}" in self.state["sets"]:
            n += 1
        return f"S{n}"

    def active(self) -> dict:
        return self.state["sets"][self.state["active_set"]]

    def _ctx(self, arc: str) -> dict:
        p = {**self.state["params"], "_pair_ratings": self.pair_ratings()}
        if getattr(self, "mood_cal", None):
            p["_mood_med"], p["_mood_veto"] = self.mood_cal["med"], self.mood_cal["veto"]
        if arc == "free":
            p["_free_arc"] = True
        return p

    def arc_order(self, arc: str, tracks: list[dict] | None = None) -> list[str]:
        """A fresh running order for an arc, using saved ratings as weights."""
        tracks = self.tracks if tracks is None else tracks
        p = self._ctx(arc)
        if arc == "genre":
            groups = [[t for t in tracks if t.get("bucket") == g] for g in ("dance", "rock", "chill")]
            groups[2] = groups[2] + [t for t in tracks if t.get("bucket") not in ("dance", "rock", "chill")]
            return compute_order(tracks, p, groups=[g for g in groups if g])
        if arc == "free":
            return compute_order(tracks, p, groups=[list(tracks)])
        e = energy_scores(tracks, p)
        bands = [[t for t in tracks if round(1 + e[t["id"]] / 0.25) == lv] for lv in (5, 4, 3, 2, 1)]
        bands[-1] += [t for t in tracks if round(1 + e[t["id"]] / 0.25) not in (1, 2, 3, 4, 5)]
        return compute_order(tracks, p, groups=[b for b in bands if b])

    def template(self, arc: str) -> list[str]:
        """The arc's ideal order over ALL tracks. A slot's target is read at the same
        RELATIVE position (slot / set length), so short or trimmed sets still get the
        whole arc, compressed. Candidate scoring keeps edits true to the arc."""
        order_params = {k: v for k, v in self.state["params"].items()
                        if k.startswith(("order_", "w_", "tier_", "rating_", "max_stretch", "min_reg",
                                         "allow_half"))}
        key = (arc, json.dumps(order_params, sort_keys=True), self._ratings_ver)
        if key not in self._tpl_cache:
            if len(self._tpl_cache) > 8:
                self._tpl_cache.clear()
            self._tpl_cache[key] = self.arc_order(arc)
        return self._tpl_cache[key]

    def _set_length(self, doc: dict) -> int:
        """How long this set is meant to be: build sets aim to use every track."""
        if doc.get("start") == "build":
            return len(self.tracks)
        return max(1, len(doc["order"]))

    def _edit(self, doc: dict, new_order: list[str], note: str) -> None:
        doc["history"] = (doc.get("history") or [])[-(HISTORY_CAP - 1):] + [
            {"order": list(doc["order"]), "note": note, "ts": time.time()}]
        doc["order"] = list(new_order)
        doc["edits"] = int(doc.get("edits", 0)) + 1

    def ethos(self, doc: dict | None = None):
        from .ethos import Ethos
        return Ethos(self, doc or self.active())

    def unplaced(self, doc: dict | None = None) -> list[str]:
        doc = doc or self.active()
        placed = set(doc["order"])
        return [t["id"] for t in self.tracks if t["id"] not in placed]

    # -- the candidate picker -------------------------------------------------------------
    def candidates(self, slot: int, seen: list[str] | None = None, limit: int = 4) -> dict:
        """Ranked tracks to follow order[slot]. Modes: 'open' (empty set, choose an opener),
        'append' (after the last placed track), 'replace' (alternatives to the current next
        track). Tracks that fit the set's ethos always rank above ones that don't, and
        tracks that break it are only offered once nothing better is left."""
        with self.lock:
            doc = self.active()
            order = list(doc["order"])
            seen_set = set(seen or [])
            eth = self.ethos(doc)
            energy = eth.energy
            unused = self.unplaced(doc)
            build = doc.get("start") == "build"
            rejected = None
            if not order:
                mode, a_id = "open", None
                pool = unused
            elif slot < 0:
                raise ValueError("slot must be >= 0 once the set has tracks")
            elif slot >= len(order) - 1:
                mode, a_id = "append", order[-1]
                slot = len(order) - 1
                pool = list(unused)
            else:
                mode, a_id, rejected = "replace", order[slot], order[slot + 1]
                # seed sets: tracks the listener removed stay out; build sets: unused are fair game
                pool = (list(unused) if build else []) + order[slot + 2:]
            pos = 0 if mode == "open" else slot + 1
            nxt = order[slot + 2] if mode == "replace" and slot + 2 < len(order) else None
            tgt = eth.target(pos, a_id, rejected, nxt) if mode != "open" else eth.curve(0)
            quota, overdue = (eth.build_quota(pos, unused, a_id, order) if mode == "append" and build
                              else (None, set()))
            plan_rank: dict[str, int] = {}
            if eth.arc == "genre" and mode == "append" and build and quota:
                # look ahead: plan the rest of the current wave from here, suggest its start
                wave_pool = [self.by_id[u] for u in unused if eth.band(u) in quota]
                if wave_pool:
                    ahead = compute_order(wave_pool, {**eth.p, "_free_arc": True}, groups=[wave_pool],
                                          head=self.by_id[a_id])
                    plan_rank = {tid: i for i, tid in enumerate(ahead)}
                    tgt = energy[ahead[0]]
            slot_waves = None
            if eth.arc == "genre" and mode == "replace":
                # the slot belongs to the waves of its own neighbours, not a template position
                slot_waves = {self.by_id[a_id].get("bucket"), self.by_id[rejected].get("bucket")}
            elif eth.arc == "genre" and quota:
                slot_waves = set(quota)
            elif eth.arc == "genre" and mode == "append" and a_id:
                # seed genre set grown at its end: continue this wave or start the next one
                from .ethos import WAVES
                w = self.by_id[a_id].get("bucket")
                slot_waves = {w} | ({WAVES[WAVES.index(w) + 1]} if w in WAVES[:-1] else set())

            def rank(cands):
                out = []
                for c in cands:
                    if c in seen_set or c == a_id or c == rejected:
                        continue
                    if mode == "open":
                        tr = 0 if eth.arc == "free" or eth.tier(c, 0, None, tgt) == 0 else 1
                        score = float(eth.tpl_pos.get(c, 0)) if eth.tpl else -energy[c]
                    else:
                        tr = eth.tier(c, pos, a_id, tgt, quota, slot_waves)
                        if c in overdue:   # relax band/target (and let it climb back while it
                            # is still within a level) but never allow a 1.5-level jump
                            tr = min(tr, eth.tier(c, pos, a_id, None, None, slot_waves, allow_climb=True))
                        if eth.returning and eth.arc == "genre":
                            tr = max(tr, 1)          # going back to an unfinished wave
                        if (plan_rank.get(c) == 0 and tr == 1 and not eth.returning
                                and abs(energy[c] - energy[a_id]) < 1.5 * 0.25):
                            tr = 0                   # the look-ahead plan's next step
                        score = eth.cost(a_id, c) + 2.0 * eth.arc_pen(c, pos, tgt)
                        if c in overdue:
                            score -= 4.0             # overdue: play it while it is still reachable
                        if c in plan_rank:
                            score -= (6.0 if plan_rank[c] == 0 else 2.0 if plan_rank[c] < 3 else 0.0)
                        if c in order:      # moving it up leaves a new join behind
                            j = order.index(c)
                            x = order[j - 1] if j > 0 else None
                            y = order[j + 1] if j + 1 < len(order) else None
                            if x is not None and y is not None and x != a_id:
                                score += 0.5 * (eth.cost(x, y) - eth.cost(x, c) - eth.cost(c, y))
                                if abs(energy[x] - energy[y]) >= 1.5 * 0.25:
                                    score += 3.0    # would leave a cliff behind
                    # when nothing fits, the build's current band/wave still comes first
                    off = 0 if quota is None or eth.band(c) in quota else 1
                    dmg = round(abs(energy[c] - energy[a_id]) / 0.25, 1) if (a_id and tr == 2) else 0.0
                    out.append((tr, off, dmg, score, c))
                return [(tr, score, c) for tr, off, dmg, score, c in sorted(out)]

            def simulate(scored_list):
                """Re-judge the leading replace candidates by the joins the pick would
                really create: at the slot, where the track came from, and where the
                displaced track lands."""
                out = []
                for tr, score, c in scored_list:
                    new = [x for x in order if x != c]
                    new.insert(new.index(a_id) + 1, c)
                    new.remove(rejected)
                    new.insert(eth.place(new, rejected, new.index(c) + 1, order.index(rejected)), rejected)
                    worst = max(eth.new_join_worst(order, new), abs(energy[c] - energy[a_id]) / 0.25)
                    if worst >= 1.5:
                        tr = 2
                    elif worst >= 1.0:
                        tr = max(tr, 1)
                    out.append((tr, round(worst, 1) if tr == 2 else 0.0, score, c))
                return [(tr, score, c) for tr, _, score, c in sorted(out)]

            # never a track that already plays earlier in the set: picking it would pull it out
            # of the part you have heard (a loop back / a silent unlink of approved joins)
            scored = rank(pool)
            if mode == "replace":
                scored = simulate(scored)
            good = [x for x in scored if x[0] < 2]
            shown = good[:limit] if good else scored[:limit]
            remaining = (len(good) - len(shown)) if good else (len(scored) - len(shown))
            ratings = self.pair_ratings()
            out = []
            a_start = 0.0
            if mode != "open":
                plan = self.plan()
                idx = [o["id"] for o in plan["order"]].index(a_id)
                a_start = plan["native_starts"][idx] + 1.0 if idx > 0 else 0.0
            for tr, score, c in shown:
                t = self.by_id[c]
                src = "unused" if c not in order else f"from #{order.index(c) + 1}" + (
                    " (earlier)" if order.index(c) < slot else "")
                item = {"id": c, "artist": t["artist"], "title": t["title"], "bpm": t["bpm"],
                        "camelot": t["camelot"], "energy": round(energy[c], 3),
                        "level": round(1 + energy[c] / 0.25, 1),
                        "bucket": t.get("bucket"), "score": round(score, 2),
                        "fit": ("fits the set", "borderline", "breaks the set")[tr], "source": src}
                if mode == "replace" and c in order:
                    # say what the pick really does to the rest of the set (same moves as apply_pick)
                    new = [x for x in order if x != c]
                    new.insert(new.index(a_id) + 1, c)
                    new.remove(rejected)
                    new.insert(eth.place(new, rejected, new.index(c) + 1, order.index(rejected)), rejected)
                    before = set(zip(order[:-1], order[1:]))
                    joins = [(x, y) for x, y in zip(new[:-1], new[1:])
                             if (x, y) not in before and (x, y) != (a_id, c)]
                    item["moves"] = {
                        "from": order.index(c) + 1,
                        "displaced": self.by_id[rejected]["title"],
                        "displaced_to": new.index(rejected) + 1,
                        "new_joins": [{"a": self.by_id[x]["title"], "b": self.by_id[y]["title"],
                                       "rating": ratings.get(f"{x}>{y}")} for x, y in joins],
                    }
                if mode != "open":
                    key = f"{a_id}>{c}"
                    item["rating"] = ratings.get(key)
                    ov = self.state["overrides"].get(key, {})
                    spec = plan_transition(self.by_id[a_id], t, self.state["params"], ov, a_start)
                    item.update({"style": spec["style"], "beatmatch": spec.get("beatmatch", False),
                                 "blend": round(spec.get("T_overlap", spec["T"]), 1),
                                 "stretch_pct": spec.get("stretch_pct"),
                                 "key_distance": spec.get("key_distance"),
                                 "reason": spec.get("reason", "")})
                out.append(item)
            return {"mode": mode, "slot": slot, "a": a_id, "rejected": rejected,
                    "target": ({"energy": round(tgt, 3), "level": round(1 + tgt / 0.25, 1),
                                "bucket": eth.wave(pos) or (self.by_id[a_id].get("bucket") if a_id else None)}
                               if tgt is not None and eth.arc != "free" else None),
                    "remaining": max(0, remaining), "candidates": out,
                    "set": doc["id"], "arc": doc["arc"]}

    def transition_envelope(self, i: int) -> dict:
        from .render import transition_envelope
        plan = self.plan()
        if not 0 <= i < len(plan["transitions"]):
            raise IndexError(i)
        ot = self.order_tracks(plan)
        return transition_envelope(self.audio, ot[i], ot[i + 1], plan["transitions"][i], self.state["params"])

    def join_spec(self, i: int, shape: dict | None = None) -> dict:
        """The exact plan of join i if the sliders were `shape` — for the live preview."""
        from .render import spec_summary
        plan = self.plan()
        if not 0 <= i < len(plan["transitions"]):
            raise IndexError(i)
        ot = self.order_tracks(plan)
        a, b = ot[i], ot[i + 1]
        tr0 = plan["transitions"][i]
        min_out = plan["native_starts"][i] + 1.0 if i > 0 else 0.0
        ov = dict(tr0.get("override") or {})
        ov.update(coerce_override(shape or {}))
        return spec_summary(plan_transition(a, b, self.state["params"], ov, min_out), self.state["params"])

    def join_lengths(self, i: int) -> list[dict]:
        """Every plan the length slider can give join i (see plan.length_table)."""
        from .plan import length_table
        from .render import length_table_summary
        plan = self.plan()
        if not 0 <= i < len(plan["transitions"]):
            raise IndexError(i)
        ot = self.order_tracks(plan)
        tr0 = plan["transitions"][i]
        min_out = plan["native_starts"][i] + 1.0 if i > 0 else 0.0
        p = self.state["params"]
        return length_table_summary(length_table(ot[i], ot[i + 1], p, dict(tr0.get("override") or {}), min_out), p)

    def candidate_lengths(self, slot: int, cid: str) -> list[dict]:
        from .plan import length_table
        from .render import length_table_summary
        a, b, start, spec = self._candidate_spec(slot, cid)
        min_out = start + 1.0 if slot > 0 else 0.0
        p = self.state["params"]
        return length_table_summary(length_table(a, b, p, spec["override"], min_out), p)

    def candidate_join_spec(self, slot: int, cid: str, shape: dict | None = None) -> dict:
        from .render import spec_summary
        _, _, _, spec = self._candidate_spec(slot, cid, shape)
        return spec_summary(spec, self.state["params"])

    def _candidate_spec(self, slot: int, cid: str, shape: dict | None = None):
        """Plan order[slot] -> cid as it would be if picked. `shape` = the sliders the
        listener is using right now ({handover, length_s}); they win over saved values."""
        plan = self.plan()
        ids = [o["id"] for o in plan["order"]]
        if cid not in self.by_id:
            raise ValueError("unknown track")
        if not 0 <= slot < len(ids):
            raise IndexError(slot)
        a, b = self.by_id[ids[slot]], self.by_id[cid]
        start = plan["native_starts"][slot]
        min_out = start + 1.0 if slot > 0 else 0.0
        key_s = f"{a['id']}>{b['id']}"
        ov = dict(self.state["overrides"].get(key_s, {}))
        ov.update(coerce_override(shape or {}))
        spec = plan_transition(a, b, self.state["params"], ov, min_out)
        spec.update({"index": 0, "key": key_s, "a": a["id"], "b": b["id"], "override": ov})
        return a, b, start, spec

    def candidate_envelope(self, slot: int, cid: str, shape: dict | None = None) -> dict:
        from .render import transition_envelope
        a, b, _, spec = self._candidate_spec(slot, cid, shape)
        return transition_envelope(self.audio, a, b, spec, self.state["params"])

    def candidate_clip(self, slot: int, cid: str, shape: dict | None = None) -> tuple[bytes, dict]:
        """Preview of order[slot] -> cid exactly as it would sound if picked."""
        a, b, start, spec = self._candidate_spec(slot, cid, shape)
        p = self.state["params"]
        mini = {"transitions": [spec], "native_starts": [start, spec["b_in_end"]]}
        render_keys = ["fade_curve", "crossover_hz", "echo_feedback", "target_lufs", "ceiling_db",
                       "preroll_s", "postroll_s"]
        ck = hashlib.sha1(json.dumps(["cand", spec, start, {k: p[k] for k in render_keys}],
                                     sort_keys=True, default=str).encode()).hexdigest()
        with self.lock:
            if ck in self.clips:
                self.clips.move_to_end(ck)
                return self.clips[ck]
        t0 = time.time()
        wav, markers = render_clip(self.audio, [a, b], mini, 0, p)
        markers["render_seconds"] = round(time.time() - t0, 2)
        with self.lock:
            self.clips[ck] = (wav, markers)
            while len(self.clips) > 60:
                self.clips.popitem(last=False)
        return wav, markers

    def _log_pick(self, **event) -> None:
        event.update(ts=time.time(), folder=os.path.basename(self.folder),
                     set=self.state["active_set"])
        with open(os.path.join(self.data_dir, "picks-log.jsonl"), "a") as fh:
            fh.write(json.dumps(event) + chr(10))

    def apply_pick(self, slot: int, cid: str, shown: list[str], expect: dict | None = None) -> None:
        """Place cid after order[slot]. `expect` = what the picker was showing
        ({set, mode, a, rejected}); if the set moved on since, refuse rather than guess."""
        doc = self.active()
        order = list(doc["order"])
        if cid not in self.by_id:
            raise ValueError("unknown track")
        if not order:
            mode, a_id, rejected = "open", None, None
        elif slot < 0:
            raise ValueError("slot must be >= 0 once the set has tracks")
        elif slot >= len(order) - 1:
            mode, a_id, rejected = "append", order[-1], None
        else:
            mode, a_id, rejected = "replace", order[slot], order[slot + 1]
        if expect is not None:
            stale = (expect.get("set") not in (None, doc["id"]) or expect.get("mode") not in (None, mode)
                     or ("a" in expect and expect.get("a") != a_id)
                     or ("rejected" in expect and expect.get("rejected") != rejected))
            if stale:
                raise ValueError("the set changed since these candidates were shown — reopen the picker")
        if cid == a_id:
            raise ValueError("a track cannot follow itself")
        eth = self.ethos(doc)
        if mode == "open":
            new = [cid]
        elif mode == "append":
            if cid in order:
                raise ValueError("track already placed")
            new = order + [cid]
        else:
            new = [x for x in order if x != cid]
            new.insert(new.index(a_id) + 1, cid)
            if rejected != cid:     # the displaced track goes to its cheapest later spot
                new.remove(rejected)
                k = eth.place(new, rejected, new.index(cid) + 1, slot + 1)
                new.insert(k, rejected)
        self._edit(doc, new, f"{mode} after #{slot + 1}: {self.by_id[cid]['title']}" if a_id
                   else f"opener: {self.by_id[cid]['title']}")
        self._log_pick(mode=mode, slot=slot, a=a_id, rejected=rejected, chosen=cid,
                       shown=list(shown or []))

    # -- state -----------------------------------------------------------------------------

    def _load_timbre(self, data_dir: str) -> None:
        """rox timbre embeddings (read-only) + anchor-label kNN 'arousal' per track."""
        import numpy as np
        try:
            import sqlite3
            db = sqlite3.connect("file:" + os.path.expanduser(
                "~/Library/Application Support/rox/library.db") + "?mode=ro", uri=True)
            rows = db.execute(
                "select t.path, t.genre, e.vec from tracks t join embeddings e on e.track_id=t.id "
                "where e.model='dsp-timbre-1'")
            emb, genres = {}, {}
            base_dir = os.path.realpath(self.folder)
            for path, genre, vec in rows:
                if os.path.realpath(os.path.dirname(path)) == base_dir:
                    v = np.frombuffer(vec, dtype=np.float32).astype(np.float64)
                    n = float(np.linalg.norm(v))
                    if n > 0:
                        emb[os.path.basename(path)] = v / n
                    genres[os.path.basename(path)] = genre
            db.close()
        except Exception:
            emb, genres = {}, {}
        for t in self.tracks:
            base = os.path.basename(t["path"])
            v = emb.get(base)
            if v is not None:
                t["timbre"] = v
            t["rox_genre"] = genres.get(base, "")
            t["bucket"] = genre_bucket(t["rox_genre"])
        try:
            with open(os.path.join(data_dir, "genre-anchors.json")) as fh:
                ganchors = {k: v for k, v in json.load(fh).items()
                            if v in ("dance", "rock", "chill")}
        except Exception:
            ganchors = {}
        for t in self.tracks:   # explicit anchors override empty/vague tags
            for sub, bucket in ganchors.items():
                if sub.lower() in t["file"].lower():
                    t["bucket"] = bucket
                    t["bucket_src"] = "anchor"
                    break
        anchors_path = os.path.join(data_dir, "energy-anchors.json")
        anchors = {}
        try:
            with open(anchors_path) as fh:
                anchors = {k: v for k, v in json.load(fh).items()
                           if isinstance(v, (int, float))}
        except Exception:
            pass
        labeled = []
        for t in self.tracks:
            for sub, val in anchors.items():
                if sub.lower() in t["file"].lower():
                    t["arousal"] = float(val)
                    if t.get("timbre") is not None:
                        labeled.append((t["timbre"], float(val)))
                    break
        if len(labeled) >= 5:
            tau = 0.006
            for t in self.tracks:
                if "arousal" in t or t.get("timbre") is None:
                    continue
                w = [(float(np.exp(-(1.0 - float(np.dot(t["timbre"], v))) / tau)), lab)
                     for v, lab in labeled]
                tot = sum(x for x, _ in w)
                if tot > 1e-12:
                    t["arousal"] = sum(x * lab for x, lab in w) / tot
        labeled_g = [(t["timbre"], t["bucket"]) for t in self.tracks
                     if t.get("bucket") and t.get("timbre") is not None]
        for t in self.tracks:   # genre for untagged tracks: nearest labelled neighbours
            if t.get("bucket") or t.get("timbre") is None:
                continue
            if labeled_g:
                sims = sorted(((float(np.dot(t["timbre"], v)), g) for v, g in labeled_g),
                              reverse=True)[:5]
                score = {}
                for sim, g in sims:
                    score[g] = score.get(g, 0.0) + sim
                t["bucket"] = max(score, key=score.get)
            else:
                t["bucket"] = "chill" if t.get("arousal", 0.5) < 0.35 else "dance"
        for t in self.tracks:
            t.setdefault("bucket", "chill")

    def _load_mood_model(self, data_dir: str) -> None:
        """Perceived energy + genre wave + mood embedding from the evaluated model
        (eval/energy-model.json: CLAP energy + Essentia 'calm' + tempo, LOO rho 0.81),
        CLAP audio embeddings for mood similarity, and curated labels where present."""
        import numpy as np
        try:
            with open(os.path.join(data_dir, "eval", "energy-model.json")) as fh:
                per = json.load(fh).get("per_track", {})
        except Exception:
            per = {}
        try:
            with open(os.path.join(data_dir, "eval", "energy-truth.json")) as fh:
                truth = json.load(fh).get("labels", {})
        except Exception:
            truth = {}
        clap_dir = os.path.join(data_dir, "clap")
        vecs = []

        def label_for(t):
            for sub, lab in truth.items():
                if sub.lower() in t["file"].lower():
                    return lab
            return None

        # calibrate model energy onto the listener's 1..5 level scale (isotonic on the
        # curated labels), then let curated labels win with a small model nudge
        xs, ys = [], []
        for t in self.tracks:
            m, lab = per.get(t["file"]), label_for(t)
            if m and lab and lab.get("energy"):
                xs.append(float(m["energy"]))
                ys.append(float(lab["energy"]))
        iso = None
        if len(xs) >= 8:
            from sklearn.isotonic import IsotonicRegression
            iso = IsotonicRegression(y_min=1, y_max=5, out_of_bounds="clip").fit(xs, ys)
        all_e = [float(m["energy"]) for m in per.values() if "energy" in m]
        mu = float(np.mean(all_e)) if all_e else 0.5
        sd = float(np.std(all_e)) or 1.0 if all_e else 1.0
        for t in self.tracks:
            m, lab = per.get(t["file"]), label_for(t)
            if m:
                raw = float(m["energy"])
                lvl_model = (float(iso.predict([raw])[0]) if iso is not None else 1 + 4 * raw)
                lvl_model += float(np.clip(0.15 * (raw - mu) / sd, -0.3, 0.3))   # tie-break
                if lab and lab.get("energy"):
                    le = float(lab["energy"])
                    lvl = le + 0.25 * float(np.clip(lvl_model - le, -1, 1))
                else:
                    lvl = lvl_model
                t["energy_level"] = round(lvl, 3)
                t["energy_model"] = (min(5.0, max(1.0, lvl)) - 1) / 4
                if m.get("genre") in ("dance", "rock", "chill") and t.get("bucket_src") != "anchor":
                    t["bucket"] = m["genre"]
            if lab and lab.get("genre") in ("dance", "rock", "chill"):   # curated labels win
                t["bucket"] = lab["genre"]
            try:
                with open(os.path.join(clap_dir, os.path.splitext(t["file"])[0] + ".json")) as fh:
                    emb = json.load(fh).get("embedding")
                if emb:
                    v = np.asarray(emb, dtype=np.float64)
                    t["mood_vec"] = v / (np.linalg.norm(v) or 1.0)
                    vecs.append(t["mood_vec"])
            except Exception:
                pass
        self.mood_cal = None
        if len(vecs) >= 5:     # calibrate "typical" and "clash" mood distances for this folder
            M = np.vstack(vecs)
            d = 1.0 - M @ M.T
            iu = np.triu_indices(len(vecs), 1)
            self.mood_cal = {"med": float(np.median(d[iu])), "veto": float(np.percentile(d[iu], 90))}

    # -- state -----------------------------------------------------------------------------
    def save(self) -> None:
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.state, fh, indent=1)
        os.replace(tmp, self.state_path)

    def update(self, body: dict) -> None:
        with self.lock:
            if "params" in body:
                merged = {**self.state["params"], **(body["params"] or {})}
                self.state["params"] = coerce(merged)
            if body.get("reset_params"):
                self.state["params"] = defaults()
            if "override" in body:
                key, ov = body["override"]["key"], coerce_override(body["override"].get("values"))
                if ov:
                    self.state["overrides"][key] = ov
                else:
                    self.state["overrides"].pop(key, None)
            if body.get("reset_overrides"):
                self.state["overrides"] = {}
            self._set_ops(body)
            if isinstance(body.get("rating"), dict):
                r = body["rating"]
                set_id = r.get("set") or self.rating_set()
                key = str(r.get("key") or "")
                if self._valid_pair(key):
                    if r.get("value") is None:
                        self._persist_rating(set_id, key, None)
                    else:
                        try:
                            self._persist_rating(set_id, key, max(0, min(100, int(r["value"]))))
                        except (TypeError, ValueError):
                            pass
            self.save()

    def _valid_pair(self, key: str) -> bool:
        a, sep, b = key.partition(">")
        return bool(sep) and a in self.by_id and b in self.by_id and a != b

    def _set_ops(self, body: dict) -> None:
        """Set management + order edits. Every order change is undoable and persisted."""
        sets = self.state["sets"]
        if "active_set" in body and body["active_set"] in sets:
            self.state["active_set"] = body["active_set"]
        if "new_set" in body:
            spec = body["new_set"] or {}
            start = spec.get("start") if spec.get("start") in ("energy", "genre", "flow", "build") else "energy"
            arc = {"flow": "free"}.get(start, start)
            if start == "build":
                arc = spec.get("arc") if spec.get("arc") in ARC_LABELS else "energy"
            sid = self._new_sid()
            name = str(spec.get("name") or "").strip()[:60] or f"Set {len(sets) + 1}"
            given = [i for i in dict.fromkeys(spec.get("order") or []) if i in self.by_id]
            if given and start != "build":            # a running order worked out elsewhere
                order = given
            else:
                order = [] if start == "build" else self.arc_order(arc)
            # same name as an existing set = the next version of it (the older ones are kept)
            sets[sid] = self._new_set_doc(sid, name, arc, "build" if start == "build" else "seed", order,
                                          version=self._next_version(name))
            self.state["active_set"] = sid
        if "delete_set" in body:
            sid = body["delete_set"]
            if sid in sets and len(sets) > 1:
                sets.pop(sid)
                if self.state["active_set"] == sid:
                    self.state["active_set"] = next(iter(sets))
        if "rename_set" in body:
            r = body["rename_set"] or {}
            if r.get("id") in sets and str(r.get("name") or "").strip():
                new = str(r["name"]).strip()[:60]         # renames the whole family, every version
                fam = sets[r["id"]].get("family") or sets[r["id"]]["name"]
                for d in sets.values():
                    if (d.get("family") or d["name"]) == fam:
                        d["name"] = d["family"] = new
        doc = self.active()
        order = list(doc["order"])
        if body.get("regenerate") and order:
            # a regenerated order is a NEW version of the set; the one you edited stays as it was
            placed = [self.by_id[i] for i in order]
            fresh = self.arc_order(doc["arc"], tracks=placed)
            if fresh != order:
                fam = doc.get("family") or doc["name"]
                sid = self._new_sid()
                sets[sid] = self._new_set_doc(sid, fam, doc["arc"], doc.get("start", "seed"), fresh,
                                              version=self._next_version(fam))
                self.state["active_set"] = sid
                doc = sets[sid]
                order = list(doc["order"])
        if body.get("undo") and doc.get("history"):
            prev = doc["history"].pop()
            doc["order"] = [i for i in prev["order"] if i in self.by_id]
            doc["edits"] = int(doc.get("edits", 0)) + 1
        if "move" in body:
            m = body["move"] or {}
            i = int(m.get("index", -1))
            j = i - 1 if m.get("dir") == "up" else i + 1
            if 0 <= i < len(order) and 0 <= j < len(order):
                order[i], order[j] = order[j], order[i]
                self._edit(doc, order, f"move {self.by_id[order[j]]['title']}")
        if "remove" in body:
            tid = (body["remove"] or {}).get("id")
            if tid in order:
                self._edit(doc, [x for x in order if x != tid], f"remove {self.by_id[tid]['title']}")
        if "insert_best" in body:
            tid = (body["insert_best"] or {}).get("id")
            if tid in self.by_id and tid not in order:
                k = self.ethos(doc).place(order, tid, 0)
                order.insert(k, tid)
                self._edit(doc, order, f"insert {self.by_id[tid]['title']}")
        if "pick" in body:
            pk = body["pick"] or {}
            expect = {k: pk[k] for k in ("set", "mode", "a", "rejected") if k in pk}
            self.apply_pick(int(pk.get("slot", -1)), str(pk.get("id")), pk.get("shown") or [],
                            expect or None)
        if "passed" in body:
            ps = body["passed"] or {}
            self._log_pick(mode="passed", slot=ps.get("slot"), a=ps.get("a"),
                           rejected=ps.get("rejected"), chosen=None, shown=ps.get("shown") or [])
        for op, fixed in (("reject", REJECT_SCORE), ("approve", APPROVE_SCORE)):
            if op in body:
                key = str(((body[op] or {}) if isinstance(body[op], dict) else {}).get("key") or "")
                if self._valid_pair(key):
                    value = fixed if op == "reject" else max(fixed, self.pair_ratings().get(key, 0))
                    self._persist_rating(self.state["active_set"], key, value)
                    self._log_pick(mode=op, key=key, value=value)

    # -- planning --------------------------------------------------------------------------
    def plan(self) -> dict:
        with self.lock:
            order = self.active()["order"]
            key = json.dumps([order, self.state["params"], self.state["overrides"]], sort_keys=True)
            if self._plan_key != key:
                self._plan = build_plan(self.tracks, self.state["params"], order,
                                        set(), self.state["overrides"])
                self._plan_key = key
            return self._plan

    def order_tracks(self, plan: dict) -> list[dict]:
        return [self.by_id[o["id"]] for o in plan["order"]]

    def clip(self, i: int) -> tuple[bytes, dict]:
        plan = self.plan()
        if not 0 <= i < len(plan["transitions"]):
            raise IndexError(i)
        p = self.state["params"]
        tr = plan["transitions"][i]
        nxt = plan["transitions"][i + 1]["a_out_start"] if i + 1 < len(plan["transitions"]) else None
        render_keys = ["fade_curve", "crossover_hz", "echo_feedback", "target_lufs", "ceiling_db",
                       "preroll_s", "postroll_s"]
        key = hashlib.sha1(json.dumps(
            [tr, plan["native_starts"][i], nxt, {k: p[k] for k in render_keys}],
            sort_keys=True, default=str).encode()).hexdigest()
        with self.lock:
            if key in self.clips:
                self.clips.move_to_end(key)
                return self.clips[key]
        t0 = time.time()
        wav, markers = render_clip(self.audio, self.order_tracks(plan), plan, i, p)
        markers["render_seconds"] = round(time.time() - t0, 2)
        with self.lock:
            self.clips[key] = (wav, markers)
            while len(self.clips) > 40:
                self.clips.popitem(last=False)
        return wav, markers

    # -- full render -----------------------------------------------------------------------
    def render_full(self, log=print) -> str:
        plan = self.plan()
        tracks = self.order_tracks(plan)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        out = os.path.join(self.mix_dir, f"mix-{stamp}.mp3")
        meta = os.path.join(self.mix_dir, f"mix-{stamp}.ffmeta")
        chapters = []
        for i, o in enumerate(plan["order"]):
            end = plan["order"][i + 1]["start"] if i + 1 < len(plan["order"]) else plan["total_seconds"]
            chapters.append({"start": o["start"], "end": end, "title": f"{o['artist']} - {o['title']}"})
        with open(meta, "w") as fh:
            fh.write(";FFMETADATA1\n")
            fh.write(f"title=Automix - {os.path.basename(self.folder)}\n")
            for ch in chapters:
                title = re.sub(r"([=;#\\\n])", r"\\\1", ch["title"])
                fh.write(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={int(ch['start'] * 1000)}\n"
                         f"END={int(ch['end'] * 1000)}\ntitle={title}\n")
        with open(out.replace(".mp3", ".json"), "w") as fh:
            json.dump({"folder": self.folder, "params": self.state["params"],
                       "overrides": self.state["overrides"], "chapters": chapters,
                       "transitions": [{k: v for k, v in t.items() if k != "anchors"}
                                       for t in plan["transitions"]]}, fh, indent=1)
        with open(out.replace(".mp3", ".cue"), "w") as fh:
            fh.write(f'TITLE "Automix - {os.path.basename(self.folder)}"\n'
                     f'FILE "{os.path.basename(out)}" MP3\n')
            for n, ch in enumerate(chapters, 1):
                mm, ss = divmod(ch["start"], 60)
                ff = int((ss - int(ss)) * 75)
                artist, _, title = ch["title"].partition(" - ")
                fh.write(f"  TRACK {n:02d} AUDIO\n    PERFORMER \"{artist}\"\n    TITLE \"{title}\"\n"
                         f"    INDEX 01 {int(mm):02d}:{int(ss):02d}:{ff:02d}\n")
        render_full(self.audio, tracks, plan, self.state["params"], out, meta, log=log)
        os.remove(meta)
        return out

    def start_render_job(self) -> dict:
        with self.lock:
            if self.render_job.get("status") == "running":
                return self.render_job
            n = len(self.plan()["order"])
            self.render_job = {"status": "running", "done": 0, "total": n, "started": time.time()}

        def log(msg: str) -> None:
            with self.lock:
                self.render_job["done"] += 1
                self.render_job["last"] = msg

        def run() -> None:
            try:
                path = self.render_full(log=log)
                with self.lock:
                    self.render_job.update(status="done", path=path, finished=time.time())
            except Exception as exc:  # surfaced to the page
                with self.lock:
                    self.render_job.update(status="error", error=str(exc))

        threading.Thread(target=run, daemon=True).start()
        return self.render_job

    def pair_ratings(self) -> dict[str, int]:
        """One score per song pair, across all sets and sessions. Last vote wins."""
        return dict(self.global_ratings)

    def _persist_rating(self, set_id: str, key: str, value: int | None) -> None:
        """Every vote lands in the permanent store (last-wins) + an append-only log."""
        try:                           # another automix process may share this store
            with open(self.global_ratings_path) as fh:
                disk = {k: int(v) for k, v in json.load(fh).items()}
            disk.update({k: v for k, v in self.global_ratings.items() if k not in disk})
            self.global_ratings = disk
        except Exception:
            pass
        if value is None:
            self.global_ratings.pop(key, None)
        else:
            self.global_ratings[key] = int(value)
        self._ratings_ver += 1
        tmp = self.global_ratings_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.global_ratings, fh, indent=1, sort_keys=True)
        os.replace(tmp, self.global_ratings_path)
        with open(os.path.join(self.data_dir, "ratings-log.jsonl"), "a") as fh:
            fh.write(json.dumps({"ts": time.time(), "folder": os.path.basename(self.folder),
                                 "set": set_id, "key": key, "value": value}) + chr(10))

    def rating_set(self) -> str:
        return self.state.get("active_set") or "A"

    def public_state(self) -> dict:
        with self.lock:
            return json.loads(json.dumps(self._public_state_unlocked(), default=str))

    def _public_state_unlocked(self) -> dict:
        plan = self.plan()
        trs = [{k: v for k, v in t.items() if k != "anchors"} for t in plan["transitions"]]
        doc = self.active()
        sets = {sid: {"id": sid, "name": d["name"], "arc": d["arc"], "start": d.get("start", "seed"),
                      "arc_label": ARC_LABELS.get(d["arc"], d["arc"]), "placed": len(d["order"]),
                      "edits": d.get("edits", 0), "can_undo": bool(d.get("history")),
                      # when this order was generated, and when it last changed (for "gen'd 3 h ago")
                      "created": d.get("created"), "family": d.get("family") or d["name"],
                      "version": int(d.get("version") or 1),
                      "updated": max([d.get("created") or 0] + [h.get("ts") or 0 for h in d.get("history") or []])}
                for sid, d in self.state["sets"].items()}
        state = {k: v for k, v in self.state.items() if k not in ("sets", "ratings")}
        by = self.by_id
        return {"folder": self.folder, "schema": SCHEMA, "state": state,
                "pair_ratings": self.pair_ratings(),
                "plan": {**plan, "transitions": trs}, "render": self.render_job,
                "sets": sets, "active_set": self.rating_set(),
                "unplaced": [{"id": i, "artist": by[i]["artist"], "title": by[i]["title"],
                              "bucket": by[i].get("bucket")} for i in self.unplaced(doc)],
                "last_edit": (doc["history"][-1]["note"] if doc.get("history") else None),
                "buckets": {t["id"]: t.get("bucket") for t in self.tracks},
                "all_tracks": [{"id": t["id"], "artist": t["artist"], "title": t["title"]}
                               for t in self.tracks]}
