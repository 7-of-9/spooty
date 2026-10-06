#!/usr/bin/env python3
"""Export only finished audio plus current running orders from a regeneration run."""
from __future__ import annotations
import argparse
import csv
import importlib.util
import json
import os
from pathlib import Path
import re
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("dj_export", Path(__file__).with_name("export.py"))
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)


def write_csv(path, fields, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for source in rows:
            row = {key: value for key, value in source.items() if key in fields}
            for key, value in row.items():
                if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
                    row[key] = "'" + value
            writer.writerow(row)


def link_audio(source, destination, expected_hash=None, expected_bytes=None):
    source = Path(source)
    if not source.is_file() or source.suffix.lower() != ".mp3":
        raise ValueError("Finished MP3 is unavailable")
    size = source.stat().st_size
    if expected_bytes is not None and size != expected_bytes:
        raise ValueError("Rendered MP3 size differs from final media proof")
    digest = common.sha256(source)
    if expected_hash is not None and digest != expected_hash:
        raise ValueError("Rendered MP3 hash differs from final media proof")
    if destination.exists():
        if not os.path.samefile(source, destination):
            raise ValueError("Refusing to replace different exported mix audio")
    else:
        os.link(source, destination)
    return size, digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regeneration", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    root = args.out.resolve()
    manifest = common.read_json(root / "manifest.json")
    regeneration = common.read_json(args.regeneration)
    by_id = {"spotify:" + track["spotifyId"]: track for track in manifest["tracks"]}
    by_file = {track["audio"]["sourceFilename"]: track for track in manifest["tracks"]}
    destination = root / "mixes"
    destination.mkdir(parents=True, exist_ok=True)
    mixes = []
    medley = regeneration.get("medley") or {}
    saved_mixes = [dict(saved, kind="full") for saved in regeneration.get("sets", [])]
    if medley.get("status") == "done":
        saved_mixes.append(dict(medley, kind="medley"))
    for saved in saved_mixes:
        is_medley = saved["kind"] == "medley"
        report = common.read_json(Path(saved["report"])) if is_medley else None
        plan = report["plan"] if is_medley else common.read_json(Path(saved["plan"]))
        slug = f"medley-v{saved['version']}" if is_medley else f"{saved['id'].lower()}-v{saved['version']}"
        source_ids = {}
        order = []
        for index, row in enumerate(plan["order"]):
            track = by_id.get(row["id"]) or by_file.get(row.get("file"))
            if track is None:
                raise ValueError("Planned track is absent from current public catalog")
            source_ids[row["id"]] = track["spotifyId"]
            outgoing = plan["transitions"][index] if index < len(plan["transitions"]) else None
            style = (outgoing.get("form") or outgoing["style"]).replace("_", " ") if outgoing else None
            description = (f"{style} · {outgoing['T']:.1f}s"
                           + (" · beat matched" if outgoing.get("beatmatch") else "")
                           if outgoing else "End of set")
            order.append({"position": index + 1, "title": track["title"], "artist": track["artist"],
                "spotifyId": track["spotifyId"], "isrc": track["isrc"],
                "playlistNumber": track["number"], "startSeconds": round(row["start"], 6),
                "transition": description, "bpm": row.get("bpm"), "key": row.get("key"),
                "camelot": row.get("camelot"),
                "energy": round(row["energy"] * 100, 2) if "energy" in row else track.get("energy")})
        if len(order) != manifest["playlist"]["trackCount"] or len({t["spotifyId"] for t in order}) != len(order):
            raise ValueError("Mix must contain every catalog song exactly once")
        transitions = []
        for index, row in enumerate(plan["transitions"]):
            transition = {"number": index + 1, "fromSpotifyId": source_ids[row["a"]],
                "toSpotifyId": source_ids[row["b"]], "style": row["style"],
                "beatMatched": row.get("beatmatch", False), "durationSeconds": round(row["T"], 6),
                "startSeconds": order[index + 1]["startSeconds"],
                "outgoingStartSeconds": row.get("a_out_start"), "outgoingEndSeconds": row.get("a_out_end"),
                "incomingStartSeconds": row.get("b_in_start"), "incomingEndSeconds": row.get("b_in_end"),
                "stretchPercent": row.get("stretch_pct"), "keyDistance": row.get("key_distance"),
                "reason": row.get("reason"), "tempoRatio": row.get("k"), "swapAt": row.get("swap_at")}
            if is_medley:
                join = report["joins"][index]
                timing = report["timeline"][index]
                chosen = next((attempt for attempt in join.get("attempts", [])
                               if attempt.get("hash") == join.get("hash")), {})
                transition.update(form=row.get("form"), variant=row.get("variant"), tier=row.get("tier"),
                    startSeconds=round(timing["region_out"], 6),
                    incomingEntrySeconds=order[index + 1]["startSeconds"],
                    landingSeconds=round(timing["land_out"], 6),
                    sourceLandingSeconds=row.get("land_s"), sourceExitSeconds=row.get("exit_s"),
                    events=[{"fromSeconds": event[0], "toSeconds": event[1], "description": event[2]}
                            for event in row.get("events_s", [])],
                    verification={"status": join.get("checks", {}).get("status"),
                        "warnings": chosen.get("warn", []), "failures": chosen.get("fail", []),
                        "notes": chosen.get("notes", []), "blendScore": join.get("blend", {}).get("score")})
            transitions.append(transition)
        status = "ready" if saved["status"] == "done" else "rendering"
        row = {"id": slug, "name": saved["name"], "version": saved["version"], "kind": saved["kind"],
            "status": status, "statusLabel": "Ready" if status == "ready" else "Rendering",
            "trackCount": len(order), "durationSeconds": round(plan["total_seconds"], 6),
            "bytes": None, "audioPath": None, "cuePath": None,
            "detailsPath": f"mixes/{slug}.json", "orderCsvPath": f"mixes/{slug}-order.csv",
            "transitionsCsvPath": f"mixes/{slug}-transitions.csv",
            "verificationNote": "Order and transition plan exported. Final audio pending.", "order": order}
        if status == "ready":
            media = saved["media"]
            audio_name = f"{slug}.mp3"
            row["bytes"], row["sha256"] = link_audio(saved["mp3"], destination / audio_name,
                media["sha256"], media["bytes"])
            row["audioPath"] = f"mixes/{audio_name}"
            row["durationSeconds"] = media["seconds"]
            row["cuePath"] = f"mixes/{slug}.cue"
            cue = Path(saved["cue"]).read_text()
            cue, replacements = re.subn(r'^FILE ".*" MP3$', f'FILE "{audio_name}" MP3', cue, flags=re.MULTILINE)
            if replacements != 1 or any(value in cue for value in ("/Users/", "/private/", "Bearer ")):
                raise ValueError("CUE has invalid audio mapping or private path")
            (destination / f"{slug}.cue").write_text(cue)
            row["verificationNote"] = (f"Final MP3 hash and size verified; {media['chapters']} chapters. "
                "Transition descriptions are the render plan; full-set acoustic beat alignment has not been certified.")
            if saved.get("reusedFrom"):
                row["verificationNote"] += " Identical order and rendering settings share the same audio as A · Energy arc."
            if is_medley:
                stats, alignment = report["stats"], report["verify_mix"]
                outcome = str(alignment.get("status", "unverified")).upper()
                row["verificationNote"] = (f"Final MP3 hash and size verified; {media['chapters']} chapters. "
                    f"Transitions: {stats.get('verified', 0)} passed, {stats.get('warned', 0)} warnings, "
                    f"{stats.get('failed', 0)} failed. Full-mix beat alignment: {outcome}.")
                row["statusLabel"] = "Ready · alignment warning" if outcome != "PASS" else "Ready"
        details = {key: value for key, value in row.items() if key != "detailsPath"}
        details["transitions"] = transitions
        if is_medley:
            details["transitionStatistics"] = {key: report["stats"].get(key)
                for key in ("songs", "total_s", "tiers", "verified", "warned", "failed", "unverified")}
            details["fullMixAlignment"] = {key: report["verify_mix"].get(key)
                for key in ("status", "body_frac", "body_n", "body_med_ms", "body_beat_frac", "land_frac", "land_n")}
        details["notes"] = ["Order startSeconds is the track's entry time in the rendered mix; transition startSeconds is the full transition region's start.",
            "Outgoing/incoming times in transition rows refer to the original MP3s.",
            "Medley event times are offsets from the transition region's start; landingSeconds is the landing time in the rendered mix.",
            "BPM, key and energy are automated estimates. Audition transitions before performing."]
        common.write_json(destination / f"{slug}.json", details)
        write_csv(destination / f"{slug}-order.csv", list(order[0]), order)
        transition_fields = [key for key, value in transitions[0].items() if not isinstance(value, (list, dict))]
        write_csv(destination / f"{slug}-transitions.csv", transition_fields, transitions)
        mixes.append(row)

    # Never label the previous 99-song v6 output as the regenerated 100-song medley.
    if medley.get("status") != "done":
        mixes.append({"id": "medley-v7", "name": "Claude_Best · Medley", "version": 7,
        "kind": "medley", "status": "rendering", "statusLabel": "Rendering",
        "trackCount": manifest["playlist"]["trackCount"], "durationSeconds": None,
        "bytes": None, "audioPath": None, "cuePath": None, "detailsPath": None,
        "verificationNote": "New 100-song medley in preparation. Its final beat-alignment report will be published with the audio.",
            "order": []})
    common.write_json(root / "mixes.json", {"updatedAt": datetime.now(timezone.utc).isoformat(), "mixes": mixes})
    print(json.dumps({"mixes": len(mixes), "ready": sum(m["status"] == "ready" for m in mixes),
        "readyAudioBytes": sum(m.get("bytes") or 0 for m in mixes)}))


if __name__ == "__main__":
    main()
