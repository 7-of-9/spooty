"""Read-only track loading for the medley CLI and prep (DESIGN §17.4).

`load_tracks(folder, data_dir)` returns the same track dicts `Session.__init__` builds (analysis
cache + all-in-one segments + rox timbre/bucket/arousal + mood-model energy/genre/CLAP vector),
without ever analysing, writing session state or touching the running server. Tracks whose
analysis is not cached yet are skipped (listed by `unanalysed`), since analysis needs Beat This.
"""

from __future__ import annotations

import json
import os
import types

from ..analyze import cache_path, list_tracks, refine


def attach_segments(tracks: list[dict], data_dir: str) -> None:
    """All-in-one section labels, with session.py's stale-cache guard (segments must tile the
    file's duration within 2.5 s)."""
    struct_dir = os.path.join(data_dir, "structure")
    for t in tracks:
        sp = os.path.join(struct_dir, os.path.splitext(os.path.basename(t["path"]))[0] + ".json")
        try:
            with open(sp) as fh:
                segs = json.load(fh).get("segments") or []
            if segs and abs(segs[-1]["end"] - t["duration"]) <= 2.5:
                t["segments"] = segs
        except (OSError, ValueError):
            pass


def unanalysed(folder: str, cache_dir: str) -> list[str]:
    return [p for p in list_tracks(folder) if not os.path.exists(cache_path(cache_dir, p))]


def load_tracks(folder: str, data_dir: str, cache_dir: str | None = None, metadata: bool = True) -> list[dict]:
    """Analysed tracks of `folder`, read-only. metadata=False skips the rox/mood lookups."""
    cache_dir = cache_dir or os.path.join(data_dir, "analysis")
    tracks = []
    for p in list_tracks(folder):
        cp = cache_path(cache_dir, p)
        try:
            with open(cp) as fh:
                tracks.append(refine(json.load(fh)))
        except (OSError, ValueError):
            continue
    if metadata and tracks:
        # the Session loaders only touch self.folder / self.tracks / self.mood_cal: reuse them
        # verbatim on a stand-in so bucket, arousal, energy and mood vectors match the server
        from ..session import Session
        stub = types.SimpleNamespace(folder=folder, tracks=tracks)
        Session._load_timbre(stub, data_dir)
        Session._load_mood_model(stub, data_dir)
    attach_segments(tracks, data_dir)
    return tracks
