#!/usr/bin/env python3
"""Create a bounded, portable DJ package from a verified Spooty playlist snapshot.

No browser access, uploads, media retagging, queue changes or source deletion.
Shared Spooty source resolution is required before packaging audio.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import tempfile
from datetime import datetime, timezone
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def read_json(path: Path) -> dict:
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if any(marker in text for marker in ("/Users/", "/private/", "ws://", "wss://", "Bearer ")):
        raise ValueError("Public export contains private path or session material")
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text)
    temporary.replace(path)


def public_filename(track: dict, spotify_id: str) -> str:
    prefix = f"{int(track['n']):03d} - "
    suffix = f" [sp-{spotify_id}].mp3"
    label = re.sub(r'[/\\?%*:|"<>\x00-\x1f]', "-", f"{track['artist']} - {track['name']}")
    while len((prefix + label + suffix).encode("utf-8")) > 245:
        label = label[:-1]
    return prefix + label.rstrip() + suffix


def probe(path: Path, executable: str) -> dict:
    command = [executable, "-v", "error", "-show_entries",
               "format=duration:format_tags:stream=codec_type,codec_name,sample_rate,channels,bit_rate",
               "-of", "json", str(path)]
    result = json.loads(subprocess.check_output(command, timeout=20))
    audio = [stream for stream in result.get("streams", []) if stream.get("codec_type") == "audio"]
    if len(audio) != 1 or audio[0].get("codec_name") != "mp3":
        raise ValueError("Expected one MP3 audio stream")
    duration = float(result["format"]["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Invalid MP3 duration")
    return {"duration": duration, "stream": audio[0],
            "tags": {key.lower(): value for key, value in result["format"].get("tags", {}).items()}}


def cached_analysis(path: Path, cache_dir: Path) -> dict:
    stat = path.stat()
    key = hashlib.sha1(f"1|{path}|{stat.st_size}|{int(stat.st_mtime)}".encode()).hexdigest()
    result = read_json(cache_dir / key[:2] / (key + ".json"))
    if result.get("path") != str(path) or result.get("file") != path.name:
        raise ValueError("Analysis source differs from selected MP3")
    # Same multi-beat refinement as automix.analyze.refine, with no new analysis.
    beats = result.get("beats", [])
    if len(beats) > 17:
        spans = [(beats[i + 16] - beats[i]) / 16 for i in range(len(beats) - 16)]
        median = statistics.median(spans)
        good = [span for span in spans if median > 0 and abs(span - median) / median < 0.05]
        if good:
            result["bpm"] = round(60 / statistics.mean(good), 2)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--folder", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--enriched", type=Path)
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("--ffprobe", default=shutil.which("ffprobe"))
    args = parser.parse_args()
    if not args.node or not args.ffprobe:
        parser.error("node and ffprobe are required")
    source = read_json(args.snapshot)
    playlist, input_tracks = source["playlist"], source["tracks"]
    if not playlist.get("membershipVerified") or len(input_tracks) != playlist["trackCount"]:
        raise ValueError("Complete, verified playlist membership is required")
    ids = [track["sourceKey"] for track in input_tracks]
    if len(ids) != len(set(ids)) or not input_tracks:
        raise ValueError("Expected a nonempty set of distinct source IDs")
    folder, output = args.folder.resolve(), args.out.resolve()
    if folder == output or folder in output.parents:
        raise ValueError("Export must be outside the source audio folder")
    metadata_dir = ROOT / "data/spotify-track-metadata"
    with tempfile.TemporaryDirectory(prefix="spooty-dj-verify-") as cache:
        proofs = json.loads(subprocess.check_output([
            args.node, str(ROOT / "scripts/dj-share/verify-local.mjs"),
            str(args.snapshot.resolve()), str(folder), str(metadata_dir), cache,
        ], cwd=ROOT, timeout=180))
    proof_by_id = {row["spotifyId"]: row for row in proofs}
    enriched = read_json(args.enriched).get("tracks", {}) if args.enriched else {}
    energy = read_json(ROOT / "data/automix/eval/energy-model.json").get("per_track", {})
    (output / "audio").mkdir(parents=True, exist_ok=True)
    tracks = []
    for index, track in enumerate(input_tracks, 1):
        spotify_id = track["sourceKey"].removeprefix("spotify:")
        if not re.fullmatch(r"[A-Za-z0-9]{22}", spotify_id):
            raise ValueError("Invalid Spotify source ID")
        source_filename = track["filename"]
        if Path(source_filename).name != source_filename:
            raise ValueError("Invalid source basename")
        path = folder / source_filename
        before = path.stat()
        proof = proof_by_id[spotify_id]
        if proof["filename"] != source_filename or proof["bytes"] != before.st_size:
            raise ValueError("Source changed after shared verification")
        analysis = cached_analysis(path, ROOT / "data/automix/analysis")
        measured = probe(path, args.ffprobe)
        meta = enriched.get(spotify_id)
        if meta is None:
            metadata_file = metadata_dir / f"{spotify_id}.json"
            meta = read_json(metadata_file) if metadata_file.exists() else {}
        if meta and meta.get("spotifyId") != spotify_id:
            raise ValueError("Metadata source ID mismatch")
        isrc = meta.get("isrc")
        if isrc and not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{3}[0-9]{7}", isrc):
            raise ValueError("Malformed recording identifier")
        checksum = sha256(path)
        filename = public_filename(track, spotify_id)
        relative = "audio/" + filename
        destination = output / relative
        if destination.exists():
            if not os.path.samefile(destination, path):
                raise ValueError("Refusing to replace an existing exported MP3")
        else:
            os.link(path, destination)
        after = path.stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError("Source changed during export")
        model = energy.get(source_filename, {})
        score = model.get("energy")
        tracks.append({
            "number": int(track["n"]), "title": track["name"], "artist": track["artist"],
            "album": meta.get("album") or measured["tags"].get("album"),
            "spotifyId": spotify_id, "spotifyUri": f"spotify:track:{spotify_id}",
            "spotifyUrl": f"https://open.spotify.com/track/{spotify_id}",
            "isrc": isrc, "isrcSource": "Spotify metadata" if isrc else None,
            "spotifyDurationSeconds": round(track["durationMs"] / 1000, 3),
            "durationSeconds": round(measured["duration"], 6),
            "bpm": analysis.get("bpm"),
            "key": " ".join(filter(None, [analysis.get("key"), analysis.get("scale")])),
            "camelot": analysis.get("camelot"),
            "keyConfidence": round(analysis["strength"], 4) if analysis.get("strength") is not None else None,
            "beatRegularity": analysis.get("beat_regularity"),
            "energy": round(float(score) * 100, 2) if score is not None else None,
            "genre": model.get("genre"),
            "audio": {"path": relative, "filename": filename,
                "sourceFilename": source_filename, "bytes": before.st_size,
                "sha256": checksum, "codec": "mp3",
                "sampleRate": int(measured["stream"]["sample_rate"]),
                "channels": int(measured["stream"]["channels"]),
                "bitrate": int(measured["stream"].get("bit_rate") or 0)},
            "verification": {"sourceResolution": "shared-local-media-index",
                "duration": proof["verification"], "recordingIdentity": "not acoustically verified"},
        })
        if index % 25 == 0:
            print(f"Verified and packaged {index}/{len(input_tracks)} tracks", flush=True)

    notes = [
        "Spotify ID and ISRC identify the intended catalog recording; SHA-256 identifies the exact supplied MP3 bytes.",
        "The supplied MP3s are local acquired copies. Source ID resolution and duration checks do not prove that a copy is the same recording as the Spotify entry. Audition the edit before performing.",
        "BPM, key, Camelot and genre are automated estimates. Energy is the cached perceived-energy model on a 0–100 scale, not an official Spotify feature.",
        "Audio is exported unchanged. The CSV maps each file to its identifiers; no new tags are written into the MP3s.",
    ]
    manifest = {
        "schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "playlist": {"name": playlist["name"], "spotifyId": playlist["id"],
            "spotifyUrl": playlist["spotifyUrl"], "syncedAt": playlist["syncedAt"],
            "trackCount": len(tracks), "membershipVerified": True},
        "summary": {"trackCount": len(tracks), "audioBytes": sum(t["audio"]["bytes"] for t in tracks),
            "durationSeconds": round(sum(t["durationSeconds"] for t in tracks), 3),
            "isrcCount": sum(t["isrc"] is not None for t in tracks),
            "analysisCount": sum(t["bpm"] is not None for t in tracks)},
        "downloads": {"csv": "tracks.csv", "json": "catalog.json", "m3u": "playlist-50.m3u8",
            "checksums": "SHA256SUMS.txt"},
        "notes": notes, "tracks": tracks,
    }
    write_json(output / "catalog.json", manifest)
    fields = ["number", "title", "artist", "album", "spotifyId", "spotifyUri", "spotifyUrl", "isrc",
              "durationSeconds", "spotifyDurationSeconds", "bpm", "key", "camelot", "energy", "genre",
              "filename", "relativePath", "sha256", "bytes"]
    with (output / "tracks.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for track in tracks:
            row = {key: track.get(key) for key in fields}
            row.update(filename=track["audio"]["filename"], relativePath=track["audio"]["path"],
                       sha256=track["audio"]["sha256"], bytes=track["audio"]["bytes"])
            # Spreadsheet formulas are not useful in song metadata.
            for key, value in row.items():
                if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
                    row[key] = "'" + value
            writer.writerow(row)
    m3u = ["#EXTM3U", f"#PLAYLIST:{playlist['name']}"]
    for track in tracks:
        m3u.extend([f"#EXTINF:{round(track['durationSeconds'])},{track['artist']} - {track['title']}",
                    track["audio"]["path"]])
    (output / "playlist-50.m3u8").write_text("\n".join(m3u) + "\n")
    (output / "README.txt").write_text(
        f"50 — DJ handoff\n{len(tracks)} tracks in the Spotify playlist order.\n\n"
        "Open playlist-50.m3u8 after extracting the whole ZIP. Audio is in audio/.\n"
        "Use tracks.csv for spreadsheet/DJ-library preparation, catalog.json for structured data.\n"
        "SHA256SUMS.txt records every audio file and handoff document.\n\n" + "\n\n".join(notes) + "\n")
    documents = ["catalog.json", "tracks.csv", "playlist-50.m3u8", "README.txt"]
    sums = [(t["audio"]["sha256"], t["audio"]["path"]) for t in tracks]
    sums += [(sha256(output / name), name) for name in documents]
    (output / "SHA256SUMS.txt").write_text("".join(f"{digest}  {name}\n" for digest, name in sums))
    archive_name = "playlist-50-dj-pack.zip"
    archive = output / archive_name
    temporary = output / (archive_name + ".part")
    members = [track["audio"]["path"] for track in tracks] + documents + ["SHA256SUMS.txt"]
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as package:
        for name in members:
            package.write(output / name, name)
    # Read every member to verify its CRC and compare SHA256 to the source manifest.
    with zipfile.ZipFile(temporary) as package:
        if package.namelist() != members or len(set(package.namelist())) != len(members):
            raise ValueError("Archive membership differs from the explicit export manifest")
        for digest, name in sums:
            actual = hashlib.sha256()
            with package.open(name) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    actual.update(chunk)
            if actual.hexdigest() != digest:
                raise ValueError("Archive SHA-256 mismatch")
        if package.read("SHA256SUMS.txt") != (output / "SHA256SUMS.txt").read_bytes():
            raise ValueError("Archive checksum document differs")
    temporary.replace(archive)
    manifest["archive"] = {"path": archive_name, "bytes": archive.stat().st_size,
        "sha256": sha256(archive), "members": len(members), "compression": "stored",
        "verified": "all member CRCs and SHA-256 hashes read back successfully"}
    write_json(output / "manifest.json", manifest)
    print(json.dumps({**manifest["summary"], "zipBytes": manifest["archive"]["bytes"],
        "zipMembers": len(members), "zipIntegrity": "passed"}))


if __name__ == "__main__":
    main()
