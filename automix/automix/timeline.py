"""Fixed-order mixes with explicit source coverage and section-selected excerpts.

This deliberately does not use energy-based ordering or the full-set planner's
intro/outro trimming. A full timeline includes [0, decoded duration] of every
source. Excerpts target source seconds per song, including their overlaps.
"""
from __future__ import annotations

import numpy as np

from .params import defaults
from .plan import beatable, camelot_distance, energy_scores, fitted_grid, tempo_match


def select_window(track: dict, seconds: float | None) -> dict:
    dur = float(track["duration"])
    if seconds is None or dur <= seconds:
        return {"start": 0.0, "end": dur, "reason": "complete source"}
    # Prefer a named musical hook, preserving enough lead-in to hear the phrase.
    priority = {"chorus": 5, "solo": 4, "inst": 3, "section": 3, "verse": 2, "bridge": 1}
    levels = track.get("second_db", [])
    candidates = []
    for seg in track.get("segments", []):
        if seg.get("label") not in priority:
            continue
        if float(seg["start"]) > dur - seconds:
            continue
        start = max(0.0, float(seg["start"]))
        loud = levels[int(start):int(min(dur, start + seconds))]
        level = float(np.mean(loud)) if loud else -25.0
        # Avoid a final chorus whose available tail is mostly the outro.
        score = priority[seg["label"]] + 0.03 * level - start / dur * 0.15
        distance = seg.get("nearestSectionDistance")
        if distance is not None:
            score += 0.15 / (1 + max(0, distance))
        score += .1 * seg.get("boundaryStrength", 0)
        label = "measured musical boundary" if seg["label"] == "section" else seg["label"] + " section"
        candidates.append((score, start, f"{label} at {seg['start']:.2f}s"))
    if candidates:
        _, start, reason = max(candidates)
    else:
        start = min(dur - seconds, dur * 0.25)
        reason = "central passage; no labelled musical section"
    grid = np.asarray(track.get("downbeats", []), float)
    if len(grid):
        near = grid[(grid >= max(0, start - 3)) & (grid <= min(dur - seconds, start + 3))]
        if len(near):
            start = float(near[np.argmin(abs(near - start))])
    end = start + seconds
    # Musical bar ends may vary by <= one bar / 3 seconds from the requested excerpt.
    if len(grid):
        near = grid[(grid >= end - 3) & (grid <= min(dur, end + 3))]
        if len(near):
            end = float(near[np.argmin(abs(near - end))])
    return {"start": start, "end": end, "reason": reason}


def _beat_join(a, b, wa, wb, p):
    if not (beatable(a, p) and beatable(b, p)):
        return None, "unreliable beat grid"
    k, pct = tempo_match(a, b, p)
    if pct > 8:
        return None, f"tempo difference {pct:.1f}% exceeds 8%"
    if camelot_distance(a["camelot"], b["camelot"]) > 2:
        return None, "key change: short native-tempo fade"
    units, glide = 16, 8
    period = 60 / a["bpm"]
    aa = fitted_grid(a, wa["end"] - units * period, units, 1)
    bb = fitted_grid(b, wb["start"], units + glide, k)
    if aa is None or bb is None:
        return None, "local edge beats do not fit a steady grid"
    if aa[0] < wa["start"] + 20 or bb[-1] > wb["end"] - 20:
        return None, "retain a substantial solo passage between blends"
    ia, ib = aa[1] - aa[0], bb[1] - bb[0]
    tt = [j * ia for j in range(units + 1)]
    for n in range(1, glide + 1):
        tt.append(tt[-1] + ia + (ib - ia) * (n - 0.5) / glide)
    wa["end"], wb["start"] = aa[-1], bb[0]
    return {"style": "bassswap", "beatmatch": True, "k": k, "bars": 4,
            "glide_bars": 2, "a_out_start": aa[0], "a_out_end": aa[-1],
            "b_in_start": bb[0], "b_in_end": bb[-1], "T": tt[-1],
            "T_overlap": units * ia, "anchors": {"a": aa, "b": bb, "t": tt},
            "swap_at": 0.5, "handover": 0.5, "stretch_pct": pct,
            "reason": "locally fitted beats; bass handover, then incoming tempo returns to native"}, None


def build_timeline(tracks: list[dict], seconds: float | None = None) -> dict:
    if not tracks or len({t["id"] for t in tracks}) != len(tracks):
        raise ValueError("A timeline requires nonempty, unique track identities")
    positions = [t["position"] for t in tracks]
    if positions != list(range(1, len(tracks) + 1)):
        raise ValueError("Tracks must contain every consecutive position in the given order")
    if seconds is not None and seconds < 30:
        raise ValueError("Excerpt duration is source seconds per song, minimum 30")
    windows = [select_window(t, seconds) for t in tracks]
    p = defaults()
    p.update(target_lufs=-17.0, ceiling_db=-1.5, max_stretch_pct=8.0)
    transitions = []
    for i, (a, b) in enumerate(zip(tracks, tracks[1:])):
        wa, wb = windows[i:i + 2]
        spec, reason = (None, "full source edges preserved at native tempo")
        if seconds is not None:
            spec, reason = _beat_join(a, b, wa, wb, p)
        if spec is None:
            length = min(5.0, (wa["end"] - wa["start"]) / 5,
                         (wb["end"] - wb["start"]) / 5)
            spec = {"style": "fade", "beatmatch": False, "T": length,
                    "T_overlap": length, "a_out_start": wa["end"] - length,
                    "a_out_end": wa["end"], "b_in_start": wb["start"],
                    "b_in_end": wb["start"] + length, "handover": 0.5,
                    "reason": reason}
        spec.update(index=i, key=a["id"] + ">" + b["id"], a=a["id"], b=b["id"])
        transitions.append(spec)
    # Beat-fit adjustments at a later join must never consume an earlier blend.
    native = [windows[0]["start"]] + [tr["b_in_end"] for tr in transitions]
    energy = energy_scores(tracks, p)
    elapsed, chapter = 0.0, 0.0
    order = []
    for i, (t, w) in enumerate(zip(tracks, windows)):
        end = transitions[i]["a_out_start"] if i < len(transitions) else w["end"]
        if end <= native[i]:
            raise ValueError(f"Overlaps consume track {i + 1}; refusing to omit its body")
        row = {k: t[k] for k in ("id", "file", "artist", "title", "bpm", "camelot", "duration")}
        row.update(position=t["position"], start=chapter, key=t["key"] + " " + t["scale"],
                   energy=round(energy[t["id"]], 3), sourceStart=w["start"], sourceEnd=w["end"],
                   fullSourceDuration=t["duration"], selectionReason=w["reason"],
                   sourceSha256=t.get("sha256"), era=t.get("era"))
        order.append(row)
        elapsed += end - native[i]
        if i < len(transitions):
            transitions[i]["outputStart"] = elapsed
            chapter = elapsed
            elapsed += transitions[i]["T"]
    plan = {"order": order, "transitions": transitions, "native_starts": native,
            "total_seconds": elapsed, "params": p, "excerptTargetSeconds": seconds,
            "coveragePolicy": "all decoded source audio, overlapping edges" if seconds is None
            else "section-selected source seconds per song, overlaps included"}
    assert_coverage(plan, tracks)
    return plan


def assert_coverage(plan, tracks):
    """Prove the emitted native/transition intervals cover each selected source once."""
    if [t["id"] for t in tracks] != [t["id"] for t in plan["order"]]:
        raise ValueError("Timeline order changed")
    for i, (t, row) in enumerate(zip(tracks, plan["order"])):
        a, b = row["sourceStart"], row["sourceEnd"]
        if not 0 <= a < b <= t["duration"] + 1 / 44100:
            raise ValueError("Source window extends beyond decoded audio")
        if plan["excerptTargetSeconds"] is None and (a != 0 or b != t["duration"]):
            raise ValueError("Full mix trimmed source audio")
        intervals = []
        if i:
            previous = plan["transitions"][i - 1]
            intervals.append((previous["b_in_start"], previous["b_in_end"]))
        end = plan["transitions"][i]["a_out_start"] if i < len(tracks) - 1 else b
        intervals.append((plan["native_starts"][i], end))
        if i < len(tracks) - 1:
            tr = plan["transitions"][i]
            intervals.append((tr["a_out_start"], tr["a_out_end"]))
        edges = [a] + [v for interval in intervals for v in interval] + [b]
        if any(abs(edges[n] - edges[n + 1]) > 1 / 44100 for n in range(0, len(edges) - 1, 2)):
            raise ValueError("Source coverage gap or duplication")
        if any(hi <= lo for lo, hi in intervals):
            raise ValueError("Invalid source interval")
    return True
