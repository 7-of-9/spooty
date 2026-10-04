"""Read-only views of built medleys for the audition page.

A medley build (`automix medley build`) writes a report JSON and an MP3. The page auditions
the MP3 itself — what you hear is exactly the mix — so everything here is about describing
it: the songs and their excerpts, each join's form, events and checks, and loudness peaks
around a landing. Reports live in <session dir>/medleys/medley-<stamp>.json and their MP3s
in <session dir>/mixes/mix-<stamp>.mp3. Join ratings go to <data>/medley-ratings.json and
never touch the crossfade ratings.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time

import numpy as np

from .audio import FFMPEG, SR

_STAMP = re.compile(r"medley-(\d{8}-\d{6})\.json$")


class MedleyStore:
    def __init__(self, session_dir: str, data_dir: str, by_id: dict):
        self.dir = os.path.join(session_dir, "medleys")
        self.mix_dir = os.path.join(session_dir, "mixes")
        self.ratings_path = os.path.join(data_dir, "medley-ratings.json")
        self.by_id = by_id
        self.lock = threading.Lock()
        self._cache: dict[str, tuple[float, dict]] = {}
        os.makedirs(self.dir, exist_ok=True)

    # -- listing -----------------------------------------------------------------------------
    def list(self) -> list[dict]:
        out = []
        for f in sorted(os.listdir(self.dir)):                 # oldest first: builds are v1, v2, …
            m = _STAMP.fullmatch(f)
            if not m or not os.path.exists(self.mp3_path(m.group(1))):
                continue
            v = self.view(m.group(1))
            fam = re.sub(r" - \d+$", "", v["title"])             # "Claude_Best · Medley - 50" -> family
            out.append({"id": f"medley:{m.group(1)}", "stamp": m.group(1), "name": fam, "family": fam,
                        "version": 1 + sum(1 for o in out if o["family"] == fam),
                        "songs": v["stats"]["songs"], "total_s": v["stats"]["total_s"],
                        "created": v["created_ts"]})
        return out[::-1]

    def mp3_path(self, stamp: str) -> str:
        return os.path.join(self.mix_dir, f"mix-{stamp}.mp3")

    # -- one medley ---------------------------------------------------------------------------
    def view(self, stamp: str) -> dict:
        path = os.path.join(self.dir, f"medley-{stamp}.json")
        mtime = os.path.getmtime(path)
        with self.lock:
            hit = self._cache.get(stamp)
            if hit and hit[0] == mtime:
                return hit[1]
        with open(path) as fh:
            rep = json.load(fh)
        v = self._slim(stamp, rep)
        with self.lock:
            self._cache[stamp] = (mtime, v)
        return v

    def _slim(self, stamp: str, rep: dict) -> dict:
        plan = rep["plan"]
        order = plan["order"]
        timeline = rep.get("timeline") or []
        chapters = rep.get("chapters") or []
        joins_rep = {j["index"]: j for j in rep.get("joins") or []}
        songs = []
        for i, o in enumerate(order):
            prev = timeline[i - 1] if 0 < i <= len(timeline) else {}   # song i lands at the end of join i-1
            ch = chapters[i] if i < len(chapters) else {}
            t = self.by_id.get(o["id"], {})
            ex = o.get("excerpt") or {}
            songs.append({
                "id": o["id"], "title": o.get("title"), "artist": o.get("artist"),
                "bpm": o.get("bpm"), "camelot": o.get("camelot"),
                "energy": t.get("energy_model"), "bucket": t.get("bucket"),
                "excerpt": ex, "start": ch.get("start"), "end": ch.get("end"),
                "land_out": prev.get("land_out"),
            })
        joins = []
        for i, tr in enumerate(plan["transitions"]):
            jr = joins_rep.get(i, {})
            comp = tr.get("composition") or {}
            tl = timeline[i] if i < len(timeline) else {}      # join i is the tail of song i's entry
            checks = jr.get("checks") or {}
            attempts = jr.get("attempts") or [{}]
            chosen_hash = jr.get("hash") or comp.get("hash")
            last = next((a for a in attempts if a.get("hash") == chosen_hash), attempts[-1])
            r0 = tl.get("region_out") or 0.0
            joins.append({
                "index": i, "key": tr["key"], "a": tr["a"], "b": tr["b"],
                "form": tr.get("form"), "variant": tr.get("variant"), "tier": tr.get("tier"),
                "b_in": tr.get("b_in"), "relation": (comp.get("rel") or {}).get("kind"),
                "stretch_pct": tr.get("stretch_pct"), "key_distance": tr.get("key_distance"),
                "land_out": tl.get("land_out"), "region_out": tl.get("region_out"), "region_T": tl.get("T"),
                "bpb": comp.get("bpb"), "beat_s": _beat_s(comp),
                "events": comp.get("events") or [],
                # event times in MIX seconds (the report stores them from the region start)
                "events_mix": [[round(r0 + a, 3), round(r0 + b, 3), txt] for a, b, txt in (tr.get("events_s") or [])],
                "status": checks.get("status"), "fail": checks.get("fail") or [],
                "warn": last.get("warn") or [], "land_err_ms": checks.get("land_err_ms"),
                "flams": checks.get("flams"), "clicks": checks.get("clicks"),
                "tries": [{"form": h.get("form"), "variant": h.get("variant"), "fail": h.get("fail")} for h in checks.get("history") or []],
                "hash": jr.get("hash") or comp.get("hash"),
            })
        created = rep.get("created")
        created_ts = _ts(created) or os.path.getmtime(self.mp3_path(stamp))
        stats = dict(rep.get("stats") or {})
        stats.setdefault("songs", len(order))
        stats.setdefault("total_s", rep.get("seconds") or plan.get("total_seconds"))
        return {"id": f"medley:{stamp}", "stamp": stamp, "title": rep.get("title") or "Claude_Best · Medley",
                "created": created, "created_ts": created_ts, "mp3": f"/api/mix/mix-{stamp}.mp3",
                "stats": stats, "songs": songs, "joins": joins,
                "excluded": [{**e, "title": self.by_id.get(e.get("track"), {}).get("title")} for e in rep.get("excluded") or []],
                "verify_mix": {k: (rep.get("verify_mix") or {}).get(k) for k in ("status", "body_frac", "land_frac", "body_med_ms")}}

    # -- loudness around a moment ------------------------------------------------------------
    def peaks(self, stamp: str, t0: float, t1: float, n: int) -> dict:
        """RMS per bin over [t0, t1) of the mix, decoded straight from the MP3."""
        t0 = max(0.0, float(t0))
        dur = max(0.1, float(t1) - t0)
        n = max(10, min(4000, int(n)))
        cmd = [FFMPEG, "-v", "error", "-nostdin", "-ss", f"{t0:.3f}", "-t", f"{dur:.3f}",
               "-i", self.mp3_path(stamp), "-ac", "1", "-ar", "11025", "-f", "f32le", "-"]
        raw = subprocess.run(cmd, capture_output=True, check=True).stdout
        y = np.frombuffer(raw, dtype=np.float32)
        edges = np.linspace(0, len(y), n + 1).astype(int)
        rms = [float(np.sqrt(np.mean(y[a:b] ** 2))) if b > a else 0.0 for a, b in zip(edges[:-1], edges[1:])]
        return {"t0": t0, "t1": t0 + dur, "rms": [round(r, 4) for r in rms]}

    # -- ratings -----------------------------------------------------------------------------
    def ratings(self) -> dict:
        try:
            with open(self.ratings_path) as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {}

    def rate(self, stamp: str, index: int, value: int) -> dict:
        j = self.view(stamp)["joins"][int(index)]
        value = max(0, min(100, int(value)))
        with self.lock:
            r = self.ratings()
            # last vote wins, per pair + exact composition (a different move is a different join)
            r[f"{j['key']}|{j['hash']}"] = {"value": value, "form": j["form"], "variant": j["variant"],
                                            "stamp": stamp, "ts": time.time()}
            tmp = self.ratings_path + ".tmp"
            with open(tmp, "w") as fh:
                json.dump(r, fh, indent=1)
            os.replace(tmp, self.ratings_path)
        return r


def _beat_s(comp: dict) -> float | None:
    ref = comp.get("b_ref") or {}
    for k in ("period_s", "beat_s"):
        if isinstance(ref.get(k), (int, float)):
            return float(ref[k])
    return None


def _ts(s) -> float | None:
    if isinstance(s, (int, float)):
        return float(s)
    if isinstance(s, str):
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y%m%d-%H%M%S"):
            try:
                return time.mktime(time.strptime(s[:19] if "T" in s else s, fmt))
            except ValueError:
                pass
    return None
