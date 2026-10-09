#!/usr/bin/env python3
"""Export a fixed-order local handover and its finished mixes for the public DJ site.

Read only the named handover's MP3s and fingerprinted analysis. Never include
private source paths, era notes or the handover itself in a public document.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import zipfile


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


common = module("dj_common", "export.py")
mix_common = module("dj_mix_common", "export-mixes.py")
SLUG = "life-timeline"
PUBLIC_NAME = "Life timeline 1976–2026"


def now():
    return datetime.now(timezone.utc).isoformat()


def write_public(path, value):
    # Only explicit fields reach this function; this is an additional final guard.
    text = json.dumps(value, ensure_ascii=False, allow_nan=False)
    if any(marker in text for marker in ("beast:", "D:\\", "__DATA FOUND__", "source_mp3", "handover_file")):
        raise ValueError("Private handover provenance reached public export")
    common.write_json(path, value)


def source_path(folder, row):
    filename = row["handover_file"].removesuffix(" (to add)")
    if Path(filename).name != filename or not filename.lower().endswith(".mp3"):
        raise ValueError("Invalid handover MP3 basename")
    path = folder / filename
    if not path.is_file() or not path.resolve().is_relative_to(folder):
        raise ValueError(f"Missing selected audio at position {row['pos']}")
    return path


def track_export(args):
    handover = common.read_json(args.tracklist)
    rows = handover["tracks"]
    if not rows or [row["pos"] for row in rows] != list(range(1, len(rows) + 1)):
        raise ValueError("Handover must contain one track at every consecutive position")
    folder, output = args.folder.resolve(), args.out.resolve()
    if folder == output or folder in output.parents:
        raise ValueError("Public package must be outside its source folder")
    (output / "audio" / SLUG).mkdir(parents=True, exist_ok=True)
    audit_path = args.source_audit or args.tracklist.parent / "source-audit-20261009.json"
    audit = common.read_json(audit_path) if audit_path.exists() else {}
    audit_by_position = {item["position"]: item for item in audit.get("tracks", [])}
    tracks = []
    for row in rows:
        path = source_path(folder, row)
        before = path.stat()
        measured = common.probe(path, args.ffprobe)
        try:
            analysis = common.cached_analysis(path, args.analysis_cache)
        except FileNotFoundError:
            if not args.allow_partial_analysis:
                raise
            analysis = {}
        digest = common.sha256(path)
        evidence = audit_by_position.get(row["pos"])
        if evidence and (evidence.get("sha256") != digest or not evidence.get("stable")):
            raise ValueError("Selected source differs from the stable audit")
        match = re.fullmatch(r"https://open\.spotify\.com/track/([A-Za-z0-9]{22})(?:\?.*)?", row.get("spotify") or "")
        spotify_id = match[1] if match else None
        identity_notes = []
        if row["pos"] == 36:
            spotify_id = None
            identity_notes.append("Original album tags identify the second Appassionata movement and credit Jenő Jandó. The supplied catalog link identified a different movement and performer, so it is omitted. Performer is not acoustically verified.")
        elif row["pos"] == 49 and spotify_id != "5Ohj4ZURZCKP5RNqBE4Hoh":
            spotify_id = None
            identity_notes.append("The handover catalog link and the source file identifier disagree. The disputed Spotify ID is omitted; use the exact audio hash.")
        if row["pos"] in (15, 18, 19):
            identity_notes.append("This original MP3 has recoverable frame decoding warnings. The source bytes are preserved unchanged; audition before performing.")
        meta_file = common.ROOT / "data/spotify-track-metadata" / f"{spotify_id}.json"
        meta = common.read_json(meta_file) if spotify_id and meta_file.exists() else {}
        if meta and meta.get("spotifyId") != spotify_id:
            raise ValueError("Cached Spotify metadata identity mismatch")
        isrc = meta.get("isrc")
        if isrc and not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{3}[0-9]{7}", isrc):
            raise ValueError("Invalid cached ISRC")
        label = re.sub(r'[/\\?%*:|"<>\x00-\x1f]', "-", f"{row['artist']} - {row['title']}")
        prefix, suffix = f"{row['pos']:03d} - ", f" [{digest[:12]}].mp3"
        while len((prefix + label + suffix).encode("utf-8")) > 245:
            label = label[:-1]
        filename = prefix + label.rstrip() + suffix
        relative = f"audio/{SLUG}/{filename}"
        destination = output / relative
        if destination.exists():
            if not os.path.samefile(path, destination):
                raise ValueError("Refusing to replace an existing different source export")
        else:
            os.link(path, destination)
        after = path.stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError("Source changed during export")
        tracks.append({
            "number": row["pos"], "title": measured["tags"].get("title") or row["title"],
            "artist": (measured["tags"].get("artist") or row["artist"]) if row["pos"] in (15, 41, 49) else row["artist"],
            "sourceId": "local:" + digest, "album": meta.get("album") or measured["tags"].get("album"),
            "spotifyId": spotify_id, "spotifyUri": f"spotify:track:{spotify_id}" if spotify_id else None,
            "spotifyUrl": f"https://open.spotify.com/track/{spotify_id}" if spotify_id else None,
            "isrc": isrc, "isrcSource": "Spotify metadata" if isrc else None,
            "durationSeconds": round(measured["duration"], 6), "bpm": analysis.get("bpm"),
            "key": " ".join(filter(None, [analysis.get("key"), analysis.get("scale")])),
            "camelot": analysis.get("camelot"), "beatRegularity": analysis.get("beat_regularity"),
            "energy": None, "genre": None,
            "audio": {"path": relative, "filename": filename, "sourceFilename": path.name,
                "bytes": before.st_size, "sha256": digest, "codec": "mp3",
                "sampleRate": int(measured["stream"]["sample_rate"]),
                "channels": int(measured["stream"]["channels"]),
                "bitrate": int(measured["stream"].get("bit_rate") or 0)},
            "verification": {"sourceResolution": "explicit fixed-order handover",
                "duration": "actual MP3 stream probed", "analysis": "available" if analysis else "pending",
                "recordingIdentity": "not acoustically verified", "notes": identity_notes},
        })
    if len({t["sourceId"] for t in tracks}) != len(tracks):
        raise ValueError("The fixed order contains duplicate source audio")
    notes = [
        "All tracks follow the supplied chronological running order. No automatic energy sorting is applied.",
        "SHA-256 identifies the exact supplied audio bytes. Spotify IDs and ISRCs, where known, identify the intended catalog recording; acoustic identity has not been certified.",
        "BPM, key and Camelot are automated estimates. Audio is exported unchanged, without retagging.",
    ]
    manifest = {"schemaVersion": 1, "generatedAt": now(),
        "playlist": {"id": SLUG, "name": PUBLIC_NAME, "spotifyId": None, "spotifyUrl": None,
            "trackCount": len(tracks), "membershipVerified": True, "order": "fixed chronological"},
        "summary": {"trackCount": len(tracks), "audioBytes": sum(t["audio"]["bytes"] for t in tracks),
            "durationSeconds": round(sum(t["durationSeconds"] for t in tracks), 3),
            "isrcCount": sum(bool(t["isrc"]) for t in tracks),
            "analysisCount": sum(t["bpm"] is not None for t in tracks)},
        "downloads": {"csv": "tracks.csv", "json": "catalog.json", "m3u": "life-timeline.m3u8",
            "checksums": "SHA256SUMS.txt"}, "notes": notes, "tracks": tracks}
    write_public(output / "catalog.json", manifest)
    csv_rows = []
    for track in tracks:
        csv_rows.append({**{key: value for key, value in track.items() if key not in ("audio", "verification")},
            "filename": track["audio"]["filename"], "relativePath": track["audio"]["path"],
            "sha256": track["audio"]["sha256"], "bytes": track["audio"]["bytes"]})
    mix_common.write_csv(output / "tracks.csv", list(csv_rows[0]), csv_rows)
    m3u = ["#EXTM3U", "#PLAYLIST:" + PUBLIC_NAME]
    for track in tracks:
        m3u.extend([f"#EXTINF:{round(track['durationSeconds'])},{track['artist']} - {track['title']}", track["audio"]["path"]])
    (output / "life-timeline.m3u8").write_text("\n".join(m3u) + "\n")
    (output / "README.txt").write_text(PUBLIC_NAME + f"\n{len(tracks)} tracks in fixed order.\n\n"
        "Extract the entire ZIP before opening life-timeline.m3u8. Use tracks.csv for the running order and identifiers.\n\n"
        + "\n\n".join(notes) + "\n")
    documents = ["catalog.json", "tracks.csv", "life-timeline.m3u8", "README.txt"]
    checksums = [(t["audio"]["sha256"], t["audio"]["path"]) for t in tracks]
    checksums += [(common.sha256(output / name), name) for name in documents]
    (output / "SHA256SUMS.txt").write_text("".join(f"{digest}  {name}\n" for digest, name in checksums))
    archive_name = "life-timeline-dj-pack.zip"
    temporary = output / (archive_name + ".part")
    members = [t["audio"]["path"] for t in tracks] + documents + ["SHA256SUMS.txt"]
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as package:
        for name in members:
            package.write(output / name, name)
    with zipfile.ZipFile(temporary) as package:
        if package.namelist() != members or len(set(members)) != len(members):
            raise ValueError("ZIP membership differs from the fixed manifest")
        for digest, name in checksums:
            with package.open(name) as stream:
                observed = hashlib.sha256()
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    observed.update(chunk)
                if observed.hexdigest() != digest:
                    raise ValueError("ZIP member differs from original bytes")
        if package.read("SHA256SUMS.txt") != (output / "SHA256SUMS.txt").read_bytes():
            raise ValueError("ZIP checksum file differs")
    archive = output / archive_name
    temporary.replace(archive)
    manifest["archive"] = {"path": archive_name, "publicPath": f"exports/{SLUG}/{archive_name}",
        "bytes": archive.stat().st_size, "sha256": common.sha256(archive), "members": len(members),
        "compression": "stored", "verified": "all member CRCs and SHA-256 hashes read back successfully"}
    write_public(output / "manifest.json", manifest)
    hosted = {**manifest, "downloads": {key: f"exports/{SLUG}/{value}" for key, value in manifest["downloads"].items()},
        "archive": {**manifest["archive"], "path": manifest["archive"]["publicPath"]}}
    write_public(output / "hosted-manifest.json", hosted)
    tasks = [{"path": str(output / track["audio"]["path"]), "key": track["audio"]["path"]}
             for track in tracks]
    tasks += [{"path": str(output / name), "key": f"exports/{SLUG}/{name}"}
              for name in documents + ["SHA256SUMS.txt", archive_name]]
    # This private operator task list contains paths, never credentials; it is not uploaded.
    (output / "source-upload-tasks.json").write_text(json.dumps(tasks, indent=2) + "\n")
    print(json.dumps({**manifest["summary"], "zipBytes": archive.stat().st_size, "zipIntegrity": "passed"}))


def mix_export(args):
    output = args.out.resolve()
    manifest = common.read_json(output / "manifest.json")
    build = common.read_json(args.build)
    by_file = {track["audio"]["sourceFilename"]: track for track in manifest["tracks"]}
    analysis_path = args.build.parent / "analysis.json"
    analysis = common.read_json(analysis_path) if analysis_path.exists() else []
    source_analysis = []
    if len(analysis) == len(by_file) and all(track.get("segments") for track in analysis):
        for scanned in analysis:
            source = by_file.get(scanned["file"])
            if source is None or source["audio"]["sha256"] != scanned["sha256"]:
                raise ValueError("Section analysis differs from the selected source audio")
            sections = [{key: segment[key] for key in ("start", "end", "label", "confidence", "boundaryStrength")
                         if key in segment} for segment in scanned["segments"]]
            source_analysis.append({"position": source["number"], "sourceId": source["sourceId"],
                "artist": source["artist"], "title": source["title"],
                "decodedDurationSeconds": scanned["duration"], "method": scanned["structureModel"],
                "sections": sections})
        source_analysis.sort(key=lambda row: row["position"])
        if [row["position"] for row in source_analysis] != list(range(1, len(by_file) + 1)):
            raise ValueError("Section analysis does not cover the fixed order exactly once")
    analysis_by_id = {row["sourceId"]: row for row in source_analysis}
    mixes, proofs = [], []
    destination = output / "mixes"
    destination.mkdir(parents=True, exist_ok=True)
    for saved in build["sets"]:
        if saved["status"] != "done":
            raise ValueError("Only completed builds may enter the public timeline catalog")
        plan = common.read_json(Path(saved["plan"]))
        report = common.read_json(Path(saved["report"]))
        verified = report.get("verification", {})
        checks = verified.get("joins", [])
        if len(checks) != len(plan["transitions"]) or verified.get("decode") != "clean":
            raise ValueError("Final clean decode and every encoded overlap check are required")
        if saved.get("quality") and (saved["quality"].get("overlapWarnings") != sum(c["status"] == "warn" for c in checks)
                or saved["quality"].get("overlapPasses") != sum(c["status"] == "pass" for c in checks)):
            raise ValueError("Build summary and final overlap proof are not yet consistent")
        slug = saved.get("publicId") or saved["id"]
        if not re.fullmatch(r"(?:life-)?timeline-[a-z0-9-]+", slug):
            raise ValueError("Mix ID must use the reserved timeline namespace")
        order, source_ids = [], {}
        for index, row in enumerate(plan["order"]):
            track = by_file.get(row["file"])
            if track is None or track["number"] != index + 1:
                raise ValueError("Rendered order differs from the fixed chronological order")
            if row.get("sourceSha256") != track["audio"]["sha256"]:
                raise ValueError("Rendered source hash differs from the exported source audio")
            # Legacy MP3 headers can estimate a different duration from decoded PCM.
            # Source selection uses the renderer's decoded duration, bound to this hash.
            if not 0 <= row["sourceStart"] < row["sourceEnd"] <= row["fullSourceDuration"] + 1 / 44100:
                raise ValueError("Selected source interval exceeds decoded audio")
            if saved.get("kind") == "full" and (row["sourceStart"] != 0 or row["sourceEnd"] != row["fullSourceDuration"]):
                raise ValueError("Full timeline must retain every decoded source from start to end")
            source_ids[row["id"]] = track["sourceId"]
            outgoing = plan["transitions"][index] if index < len(plan["transitions"]) else None
            description = (f"{outgoing['style'].replace('_', ' ')} · {outgoing['T']:.1f}s"
                + (" · beat matched" if outgoing.get("beatmatch") else "") if outgoing else "End of set")
            entry = {"position": index + 1, "title": track["title"], "artist": track["artist"],
                "sourceId": track["sourceId"], "spotifyId": track["spotifyId"], "isrc": track["isrc"],
                "playlistNumber": track["number"], "startSeconds": round(row["start"], 6),
                "transition": description, "bpm": row.get("bpm"), "key": row.get("key"),
                "camelot": row.get("camelot"),
                "energy": round(row["energy"] * 100, 2) if row.get("energy") is not None else None}
            for field in ("sourceStart", "sourceEnd", "fullSourceDuration", "selectedSection", "sectionLabel", "selectionReason", "coverageFraction"):
                if field in row:
                    entry[field] = row[field]
            if track["sourceId"] in analysis_by_id:
                entry["analysisMethod"] = analysis_by_id[track["sourceId"]]["method"]
            order.append(entry)
        if len(order) != manifest["playlist"]["trackCount"] or len(source_ids) != len(order):
            raise ValueError("Mix must contain every source exactly once")
        transitions = []
        for index, row in enumerate(plan["transitions"]):
            if row["a"] != plan["order"][index]["id"] or row["b"] != plan["order"][index + 1]["id"]:
                raise ValueError("Transition endpoints differ from the fixed running order")
            entry = {"number": index + 1, "fromSourceId": source_ids[row["a"]], "toSourceId": source_ids[row["b"]],
                "style": row["style"], "beatMatched": row.get("beatmatch", False),
                "durationSeconds": round(row["T"], 6), "startSeconds": order[index + 1]["startSeconds"]}
            for field in ("reason", "a_out_start", "a_out_end", "b_in_start", "b_in_end", "stretch_pct", "key_distance", "k"):
                if field in row:
                    entry[field] = row[field]
            if len(checks) == len(plan["transitions"]):
                check = checks[index]
                if check["join"] != index + 1:
                    raise ValueError("Encoded overlap proof order differs from the transitions")
                entry.update(checkStatus=check["status"], warnings="; ".join(check.get("warnings", [])),
                             decodedPeak=check.get("decodedPeak"), continuityScore=check.get("continuity", {}).get("score"))
                beat_check = check.get("renderedBeatAlignment")
                if beat_check:
                    entry.update(beatCheckStatus=beat_check["status"],
                        beatFractionWithinTolerance=beat_check["fractionWithinTolerance"],
                        beatToleranceSeconds=beat_check["toleranceSeconds"],
                        beatRequiredFraction=beat_check["requiredFraction"])
            transitions.append(entry)
        if len(transitions) != len(order) - 1:
            raise ValueError("A transition must join every consecutive track")
        media = saved["media"]
        if verified.get("sha256") != media["sha256"] or verified.get("bytes") != media["bytes"]:
            raise ValueError("Quality checks refer to different encoded audio")
        audio_name = slug + ".mp3"
        size, digest = mix_common.link_audio(saved["mp3"], destination / audio_name, media["sha256"], media["bytes"])
        if media["chapters"] != len(order):
            raise ValueError("Finished mix chapter count differs from the fixed order")
        cue = Path(saved["cue"]).read_text()
        cue, changes = re.subn(r'^FILE ".*" MP3$', f'FILE "{audio_name}" MP3', cue, flags=re.MULTILINE)
        if changes != 1 or any(marker in cue for marker in ("/Users/", "/private/", "Bearer ", "beast:", "D:\\")):
            raise ValueError("Invalid public CUE mapping")
        # Keep proven chapter timings, but make labels agree with the supplied editions.
        cue_lines, cue_tracks, current = [], [], None
        for line in cue.splitlines():
            match = re.fullmatch(r"\s+TRACK (\d+) AUDIO", line)
            if match:
                current = int(match[1]) - 1
                cue_tracks.append(current + 1)
                if not 0 <= current < len(order):
                    raise ValueError("CUE track exceeds the published order")
            elif current is not None and line.strip().startswith(("TITLE ", "PERFORMER ")):
                field = "title" if line.strip().startswith("TITLE ") else "artist"
                value = order[current][field].replace('"', "'").replace("\n", " ")
                line = f'    {"TITLE" if field == "title" else "PERFORMER"} "{value}"'
            cue_lines.append(line)
        if cue_tracks != list(range(1, len(order) + 1)):
            raise ValueError("CUE must contain every chapter in the published order")
        cue = "\n".join(cue_lines) + "\n"
        (destination / (slug + ".cue")).write_text(cue)
        mix = {"id": slug, "name": saved["name"], "version": saved["version"],
            "kind": saved.get("kind", "full" if "full" in slug else "medley"),
            "status": "ready", "statusLabel": "Ready", "trackCount": len(order),
            "durationSeconds": media["seconds"], "bytes": size, "sha256": digest,
            "audioPath": "mixes/" + audio_name, "cuePath": f"mixes/{slug}.cue",
            "detailsPath": f"mixes/{slug}.json", "orderCsvPath": f"mixes/{slug}-order.csv",
            "transitionsCsvPath": f"mixes/{slug}-transitions.csv", "order": order,
            "verificationNote": saved.get("verificationNote") or
                f"Final MP3 hash and size verified; {len(order)} chapters in the supplied order. Musical transitions have not been certified by listening."}
        if "excerptTargetSeconds" in saved:
            mix["excerptTargetSeconds"] = saved["excerptTargetSeconds"]
            mix["durationLabel"] = (f"About {saved['excerptTargetSeconds']} seconds per track"
                if saved["excerptTargetSeconds"] is not None else "Complete source tracks")
        if saved.get("quality"):
            mix["quality"] = {key: saved["quality"].get(key) for key in
                ("sourceCoverage", "order", "decode", "overlapWarnings", "overlapPasses",
                 "listeningApproved", "wholeMixBeatAlignment")}
        details = {**mix, "transitions": transitions, "notes": [
            "Source selection times refer to the original audio; startSeconds is the chapter entry in this mix.",
            "All selections preserve the supplied chronological order. Automated beat and section estimates need auditioning."]}
        details["coveragePolicy"] = plan.get("coveragePolicy")
        if source_analysis:
            counts = {}
            for scanned in source_analysis:
                counts[scanned["method"]] = counts.get(scanned["method"], 0) + 1
            details["analysisSummary"] = {"tracks": len(source_analysis), "methods": counts,
                "sections": sum(len(scanned["sections"]) for scanned in source_analysis),
                "note": "Generic novelty sections mark changes in sound; they do not claim verse or chorus labels."}
            details["sourceAnalysis"] = source_analysis
        details["verification"] = {"decode": verified.get("decode"), "scope": verified.get("scope"),
            "chapters": verified.get("chapters"), "overlapPassCount": sum(c["status"] == "pass" for c in checks),
            "overlapWarningCount": sum(c["status"] == "warn" for c in checks),
            "overlapChecks": [{"join": c["join"], "style": c["style"], "status": c["status"],
                "warnings": c.get("warnings", []), "decodedPeak": c.get("decodedPeak"),
                "renderedBeatAlignment": {key: c["renderedBeatAlignment"].get(key) for key in
                    ("status", "expectedInteriorBeats", "detectedBeats", "fractionWithinTolerance",
                     "toleranceSeconds", "requiredFraction", "errorsSeconds", "scope")}
                    if c.get("renderedBeatAlignment") else None,
                "continuity": {key: c.get("continuity", {}).get(key) for key in
                    ("score", "dip", "holes", "jump", "clash", "overlap_s", "mix_s")}} for c in checks]}
        for field in ("verifierRevision", "checkedAt", "chapterTitlesAndTimes", "stereoPeakScan", "sourceHashBinding"):
            if field in verified:
                details["verification"][field] = verified[field]
        write_public(destination / (slug + ".json"), details)
        mix_common.write_csv(destination / (slug + "-order.csv"), list(order[0]), order)
        fields = list(dict.fromkeys(key for row in transitions for key in row))
        mix_common.write_csv(destination / (slug + "-transitions.csv"), fields, transitions)
        mixes.append(mix)
        proofs.append({"id": slug, "sha256": digest, "bytes": size, "sources": len(order),
            "transitions": len(transitions), "sourceHashMapping": "passed", "chronologicalOrder": "passed",
            "CUEChapters": len(order), "publicPrivacyScan": "passed", "quality": mix.get("quality"),
            "verifierRevision": verified.get("verifierRevision"), "checkedAt": verified.get("checkedAt"),
            "analysisTracks": len(source_analysis)})
    write_public(output / "mixes.json", {"updatedAt": now(), "mixes": mixes})
    write_public(output / "mix-export-verification.json", {"verifiedAt": now(), "mixes": proofs})
    tasks = [{"path": str(output / mix[key]), "key": mix[key]}
             for mix in mixes for key in ("audioPath", "cuePath", "detailsPath", "orderCsvPath", "transitionsCsvPath")]
    (output / "mix-upload-tasks.json").write_text(json.dumps(tasks, indent=2) + "\n")
    print(json.dumps({"mixes": len(mixes), "ready": len(mixes), "audioBytes": sum(m["bytes"] for m in mixes)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tracklist", type=Path)
    parser.add_argument("--folder", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--analysis-cache", type=Path, default=common.ROOT / "data/automix/analysis")
    parser.add_argument("--source-audit", type=Path, help="Private stable source audit; only explicit public warnings are exported")
    parser.add_argument("--allow-partial-analysis", action="store_true",
                        help="Export verified source audio while uncached analysis is still running")
    parser.add_argument("--ffprobe", default=shutil.which("ffprobe"))
    parser.add_argument("--build", type=Path, help="Export completed mixes after the source package is ready")
    args = parser.parse_args()
    if args.build:
        mix_export(args)
    elif args.tracklist and args.folder and args.ffprobe:
        track_export(args)
    else:
        parser.error("Provide --tracklist and --folder for sources, or --build for finished mixes")


if __name__ == "__main__":
    main()
