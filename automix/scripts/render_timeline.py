#!/usr/bin/env python3
"""Analyse a numbered handover and render a full timeline plus per-song excerpts."""
from __future__ import annotations

import argparse
import copy
import gc
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from automix.analyze import analyze_file, cache_path, refine, track_id
from automix.audio import AudioCache, _ffmeta_escape
from automix.medley.build import write_cue
from automix.render import render_full
from automix.timeline import assert_coverage, build_timeline


def save(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def log(message):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), message, flush=True)


def handover_rows(document):
    """Accept both numbered-handover schemas without rewriting private input."""
    rows = []
    for source in document["tracks"]:
        row = dict(source)
        names = {row[key] for key in ("handover_file", "file") if row.get(key)}
        if len(names) != 1:
            raise ValueError("Each track needs one unambiguous handover_file or file")
        name = names.pop()
        if not isinstance(name, str) or Path(name).name != name or name in (".", ".."):
            raise ValueError("Handover filenames must stay inside the tracks directory")
        row["handover_file"] = name
        rows.append(row)
    if [row["pos"] for row in rows] != list(range(1, len(rows) + 1)):
        raise ValueError("Handover positions must be consecutive in the given order")
    return rows


def validate_sources(tracks):
    """Refuse to render stale analysis after any source file changes."""
    for track in tracks:
        path = Path(track["path"])
        with path.open("rb") as fh:
            actual = hashlib.file_digest(fh, "sha256").hexdigest()
        if actual != track["sha256"]:
            raise RuntimeError(f"Source changed after analysis: {path.name}")


def validate_handover(tracks, rows, handover):
    if len(tracks) != len(rows):
        raise ValueError("Prepared snapshot and handover contain different track counts")
    for track, row in zip(tracks, rows):
        expected_path = (handover / "tracks" / row["handover_file"]).resolve()
        if (track["position"] != row["pos"] or track["file"] != row["handover_file"]
                or Path(track["path"]).resolve() != expected_path
                or track["title"] != row["title"] or track["artist"] != row["artist"]):
            raise ValueError("Prepared snapshot no longer matches handover order or filenames")
    validate_sources(tracks)


def valid_structure(path, source, digest):
    if not path.exists():
        return False
    stamp = path.with_suffix(".source.json")
    if stamp.exists():
        return json.loads(stamp.read_text()).get("sha256") == digest
    old = json.loads(path.read_text())
    try:
        return (os.path.samefile(old["path"], source)
                and path.stat().st_mtime_ns >= Path(source).stat().st_mtime_ns)
    except (KeyError, FileNotFoundError):
        return False


def prepare(handover, data, out, structure_method="novelty"):
    rows = handover_rows(json.loads((handover / "tracklist.json").read_text()))
    index = {}
    structure_index = {}
    for path in (data / "structure").glob("*.json"):
        try:
            doc = json.loads(path.read_text())
            st = Path(doc["path"]).stat()
            structure_index[(st.st_dev, st.st_ino)] = path
        except (KeyError, FileNotFoundError, json.JSONDecodeError):
            pass
    for path in (data / "analysis").glob("*/*.json"):
        try:
            t = json.loads(path.read_text())
            st = Path(t["path"]).stat()
            if path == Path(cache_path(str(data / "analysis"), t["path"])):
                index[(st.st_dev, st.st_ino)] = t
        except (KeyError, FileNotFoundError):
            pass
    tracks = []
    for row in rows:
        path = handover / "tracks" / row["handover_file"]
        if not path.is_file():
            raise FileNotFoundError(f"Position {row['pos']} is missing: {path.name}")
        cp = Path(cache_path(str(data / "analysis"), str(path)))
        st = path.stat()
        original = index.get((st.st_dev, st.st_ino))
        digest = hashlib.file_digest(path.open("rb"), "sha256").hexdigest()
        if cp.exists():
            t = json.loads(cp.read_text())
        elif original:
            t = copy.deepcopy(original)
        else:
            t = analyze_file(str(path))
        if t.get("sha256") and t["sha256"] != digest:
            t = analyze_file(str(path))
        t.update(path=str(path), file=path.name, id=track_id(str(path)),
                 artist=row["artist"], title=row["title"], position=row["pos"], era=row.get("era"),
                 spotify=row.get("spotify"),
                 sha256=digest)
        cp.parent.mkdir(exist_ok=True)
        save(cp, t)
        t = refine(t)
        tracks.append(t)
        save(out / "analysis.json", tracks)
        save(out / "progress.json", {"stage": "analysis", "done": len(tracks),
                                    "total": len(rows), "updated": time.time()})
        log(f"analysed {row['pos']:02}: {row['artist']} — {row['title']}; {t['bpm']} bpm")
        # Structure aliases are safe only for the exact same inode.
        dest = data / "structure" / (path.stem + ".json")
        source = structure_index.get((st.st_dev, st.st_ino))
        if not dest.exists() and source and valid_structure(source, path, digest):
            structure = json.loads(source.read_text())
            structure["path"] = str(path)
            save(dest, structure)
            save(dest.with_suffix(".source.json"), {"sha256": digest})
    # The two GPU model families run sequentially and release their allocations.
    import automix.analyze as analysis
    analysis._beat_model = None
    gc.collect()
    import torch
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    pending = []
    for track in tracks:
        dest = data / "structure" / (Path(track["file"]).stem + ".json")
        stamp = dest.with_suffix(".source.json")
        valid = valid_structure(dest, track["path"], track["sha256"])
        if valid:
            save(stamp, {"sha256": track["sha256"]})
        else:
            if dest.exists():
                dest.rename(dest.with_suffix(f".stale-{time.time_ns()}.json"))
            pending.append(track)
    # One persistent MLX process amortises model loading and compiled kernels.
    # Each track is still saved independently by allin1, so interrupted work resumes.
    if pending and structure_method == "novelty":
        from automix.sections import scan_sections
        for index, track in enumerate(pending):
            started = time.time()
            result = scan_sections(track)
            result["analysisSeconds"] = round(time.time() - started, 3)
            dest = data / "structure" / (Path(track["file"]).stem + ".json")
            save(dest, result)
            save(dest.with_suffix(".source.json"), {"sha256": track["sha256"]})
            track.update(segments=result["segments"], structureModel=result["method"])
            save(out / "analysis.json", tracks)
            save(out / "progress.json", {"stage": "structure", "done": len(tracks) - len(pending) + index + 1,
                                        "total": len(rows), "updated": time.time()})
            log(f"Sections {index + 1}/{len(pending)}: {len(result['segments'])}, "
                f"{result['analysisSeconds']:.1f}s; {track['file']}")
    elif pending:
        with (out / "structure.log").open("a") as fh:
            proc = subprocess.Popen([str(data / "venv-allin1/bin/allin1-mlx"),
                *[track["path"] for track in pending], "-o", str(data / "structure"),
                "--no-ensemble-parallel", "--no-multiprocess", "--mlx-compile",
                "--timings-path", str(out / "structure-timings.jsonl"),
                "--demix-dir", str(out / "demix"), "--spec-dir", str(out / "spec")],
                stdout=fh, stderr=subprocess.STDOUT)
            while proc.poll() is None:
                completed = 0
                for track in tracks:
                    dest = data / "structure" / (Path(track["file"]).stem + ".json")
                    if dest.exists():
                        try:
                            track.update(segments=json.loads(dest.read_text())["segments"],
                                         structureModel="allin1-mlx harmonix-all")
                            save(dest.with_suffix(".source.json"), {"sha256": track["sha256"]})
                            completed += 1
                        except json.JSONDecodeError:
                            pass
                save(out / "analysis.json", tracks)
                save(out / "progress.json", {"stage": "structure", "done": completed,
                                            "total": len(rows), "updated": time.time()})
                time.sleep(5)
            if proc.returncode:
                raise RuntimeError(f"allin1 exited {proc.returncode}; completed sections retained")
    for i, track in enumerate(tracks):
        dest = data / "structure" / (Path(track["file"]).stem + ".json")
        structure = json.loads(dest.read_text())
        track.update(segments=structure["segments"], structureModel=structure.get("method", "allin1-mlx harmonix-all"))
        save(out / "analysis.json", tracks)
        save(out / "progress.json", {"stage": "structure", "done": i + 1,
                                    "total": len(rows), "updated": time.time()})
        log(f"sections {i + 1}/{len(tracks)}: {len(track['segments'])} in {track['file']}")
    save(out / "progress.json", {"stage": "prepared", "done": len(tracks),
                                "total": len(rows), "updated": time.time()})
    return tracks


def verify_encoded(path, plan):
    """Decode the actual MP3, then measure every encoded overlap independently."""
    import numpy as np
    from scipy.signal import resample_poly
    from automix.medley.verify import blend_join
    doc = json.loads(subprocess.check_output([
        "/opt/homebrew/bin/ffprobe", "-v", "error", "-show_format", "-show_chapters",
        "-show_streams", "-of", "json", str(path)]))
    if len(doc["chapters"]) != len(plan["order"]):
        raise RuntimeError("Encoded chapter count does not match the complete order")
    for i, (chapter, row) in enumerate(zip(doc["chapters"], plan["order"])):
        end = plan["order"][i + 1]["start"] if i + 1 < len(plan["order"]) else plan["total_seconds"]
        if (chapter.get("tags", {}).get("title") != row["artist"] + " - " + row["title"]
                or abs(float(chapter["start_time"]) - row["start"]) > .0011
                or abs(float(chapter["end_time"]) - end) > .0011):
            raise RuntimeError(f"Encoded chapter {i + 1} differs from the planned title or timing")
    actual = float(doc["format"]["duration"])
    if abs(actual - plan["total_seconds"]) > 0.2:
        raise RuntimeError(f"Duration mismatch: rendered {actual}, planned {plan['total_seconds']}")
    dec = subprocess.run(["/opt/homebrew/bin/ffmpeg", "-v", "error", "-nostdin", "-i", str(path),
                          "-map", "0:a:0", "-f", "null", "-"], capture_output=True, text=True)
    if dec.returncode or dec.stderr.strip():
        raise RuntimeError(f"Encoded MP3 decode failed: {dec.stderr[:1000]}")
    checks = []
    for tr in plan["transitions"]:
        begin = max(0, tr["outputStart"] - 3)
        end = tr["outputStart"] + tr["T"] + 3
        raw = subprocess.check_output([
            "/opt/homebrew/bin/ffmpeg", "-v", "error", "-nostdin", "-ss", str(begin),
            "-i", str(path), "-t", str(end - begin), "-ac", "2", "-ar", "44100",
            "-f", "f32le", "-"], stderr=subprocess.PIPE)
        y = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
        metrics = blend_join(resample_poly(y.mean(axis=1), 1, 2), 22050, tr["outputStart"] - begin,
                             tr["outputStart"] + tr["T_overlap"] - begin, 0.5)
        warnings = []
        if metrics.get("score") is None:
            warnings.append("Encoded overlap continuity could not be measured")
        if metrics.get("score") is not None and metrics["score"] < 60:
            warnings.append("Encoded overlap continuity score below 60; listen to this join")
        peak = float(np.max(abs(y))) if len(y) else 0
        if peak >= 1:
            warnings.append("Decoded encoded overlap reaches or exceeds full scale")
        beat_check = None
        if tr.get("beatmatch"):
            from automix.analyze import _beats
            mono44 = y.mean(axis=1)
            detected, _ = _beats(mono44.astype(np.float32))
            expected = np.asarray(tr["anchors"]["t"][1:len(tr["anchors"]["a"]) - 1])
            expected += tr["outputStart"] - begin
            errors = [float(np.min(abs(detected - at))) for at in expected] if len(detected) else []
            fraction = float(np.mean(np.asarray(errors) <= .060)) if errors else 0.0
            beat_check = {"status": "pass" if fraction >= .9 else "warn",
                          "expectedInteriorBeats": len(expected), "detectedBeats": len(detected),
                          "fractionWithinTolerance": fraction, "toleranceSeconds": .060,
                          "requiredFraction": .9, "errorsSeconds": errors,
                          "scope": "Beat This detection on final encoded overlap; not a whole-mix grid check"}
            if beat_check["status"] != "pass":
                warnings.append("Detected encoded overlap beats do not meet 90% within60ms of the fitted grid")
        checks.append({"join": tr["index"] + 1, "key": tr["key"], "style": tr["style"],
                       "status": "warn" if warnings else "pass", "warnings": warnings,
                       "decodedPeak": peak, "continuity": metrics,
                       "renderedBeatAlignment": beat_check})
    return {"seconds": actual, "bytes": path.stat().st_size,
            "verifierRevision": "timeline-encoded-v3", "checkedAt": time.time(),
            "chapterTitlesAndTimes": "verified", "stereoPeakScan": "every overlap at44100Hz",
            "sha256": hashlib.file_digest(path.open("rb"), "sha256").hexdigest(),
            "chapters": len(doc["chapters"]), "decode": "clean", "joins": checks,
            "scope": "Full MP3 decode, duration, chapter/order/source coverage, and encoded overlap continuity. "
                     "Beatmatched overlaps also have independent Beat This detection on encoded audio. "
                     "No listening acceptance or whole-mix beat-alignment pass is claimed."}


def quality(media, seconds):
    warn = sum(row["status"] == "warn" for row in media["joins"])
    beats = [row["renderedBeatAlignment"] for row in media["joins"] if row.get("renderedBeatAlignment")]
    return {"sourceCoverage": "complete" if seconds is None else "selected sections",
            "order": "verified", "decode": "clean", "overlapWarnings": warn,
            "overlapPasses": len(media["joins"]) - warn,
            "beatmatchedOverlapPasses": sum(row["status"] == "pass" for row in beats),
            "beatmatchedOverlapWarnings": sum(row["status"] != "pass" for row in beats),
            "listeningApproved": False, "wholeMixBeatAlignment": "not measured"}


def write_timeline_cue(path, mp3, name, chapters):
    """CUE quoted strings cannot contain unescaped literal double quotes."""
    clean = lambda value: value.replace('"', "'").replace("\n", " ").replace("\r", " ")
    write_cue(str(path), str(mp3), clean(name),
              [dict(chapter, title=clean(chapter["title"])) for chapter in chapters])


def render(tracks, out, seconds, playlist_name="Life timeline 1976–2026", version=1):
    validate_sources(tracks)
    label = "full" if seconds is None else f"{seconds:g}s"
    plan = build_timeline(tracks, seconds)
    name = playlist_name + " · " + ("Full tracks" if seconds is None else f"{seconds:g}s per song")
    path = out / f"{label}.mp3"
    work = out / f"{label}.partial.mp3"
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite rendered audio: {path}")
    if work.exists():
        work.rename(out / f"{label}.failed-{time.time_ns()}.mp3")
    save(out / f"{label}-plan.json", plan)
    chapters = [{"start": row["start"],
                 "end": plan["order"][i + 1]["start"] if i + 1 < len(tracks) else plan["total_seconds"],
                 "title": row["artist"] + " - " + row["title"]}
                for i, row in enumerate(plan["order"])]
    meta = out / f"{label}.ffmeta"
    with meta.open("w") as fh:
        fh.write(f";FFMETADATA1\ntitle={_ffmeta_escape(name)}\n")
        for ch in chapters:
            fh.write(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={int(ch['start'] * 1000)}\n"
                     f"END={int(ch['end'] * 1000)}\ntitle={_ffmeta_escape(ch['title'])}\n")
    # Existing streaming renderer uses duration only for the last body's endpoint.
    selected = [dict(track, duration=row["sourceEnd"]) for track, row in zip(tracks, plan["order"])]
    cache = AudioCache(size=2)
    render_full(cache, selected, plan, plan["params"], str(work), str(meta), log=log)
    cache.items.clear()
    meta.unlink()
    media = verify_encoded(work, plan)
    validate_sources(tracks)
    work.replace(path)
    write_timeline_cue(path.with_suffix(".cue"), path, name, chapters)
    source_warnings = []
    audits = sorted(Path(tracks[0]["path"]).parent.parent.glob("source-audit*.json"),
                    key=lambda candidate: candidate.stat().st_mtime)
    if audits:
        hashes = {track["sha256"] for track in tracks}
        for row in json.loads(audits[-1].read_text()).get("tracks", []):
            if row.get("sha256") in hashes and row.get("decodeError", "").strip():
                source_warnings.append({"position": row["position"],
                    "note": "Original source decodes with recoverable MP3 frame warnings; file preserved unchanged"})
    report = {"created": time.strftime("%Y%m%d-%H%M%S"), "name": name, "plan": plan,
              "chapters": chapters, "verification": media,
              "sourceWarnings": source_warnings, "sourceAuditAvailable": bool(audits)}
    save(path.with_suffix(".json"), report)
    warn = sum(row["status"] == "warn" for row in media["joins"])
    return {"id": "timeline-" + label, "name": name, "version": version, "status": "done",
            "kind": "full" if seconds is None else "medley", "excerptTargetSeconds": seconds,
            "tracks": len(tracks), "plan": str(out / f"{label}-plan.json"),
            "mp3": str(path), "cue": str(path.with_suffix(".cue")),
            "report": str(path.with_suffix(".json")), "media": {k: media[k] for k in
                ("seconds", "bytes", "sha256", "chapters", "decode")},
            "quality": quality(media, seconds),
            "verificationNote": f"All {len(tracks)} chapters in fixed order; encoded MP3 decodes cleanly. "
                                f"{warn} overlap continuity warnings. Not listening-approved."}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("handover", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--data", type=Path, default=Path(__file__).resolve().parents[2] / "data/automix")
    ap.add_argument("--prepare-only", action="store_true")
    ap.add_argument("--prepared", action="store_true", help="Use the completed analysis.json snapshot")
    ap.add_argument("--verify-only", action="store_true", help="Recheck completed encoded mixes without rendering")
    ap.add_argument("--durations", default="full,60,90,180", help="Comma-separated source seconds per song")
    ap.add_argument("--name", help="Mix collection title; defaults to the handover name")
    ap.add_argument("--version", type=int, default=1, help="Version recorded in the mix manifest")
    ap.add_argument("--structure-method", choices=("novelty", "allin1"), default="novelty",
                    help="Reuse exact cached sections; analyse uncached audio with this method")
    args = ap.parse_args()
    handover, data, out = args.handover.resolve(), args.data.resolve(), args.out.resolve()
    document = json.loads((handover / "tracklist.json").read_text())
    manifest_path = out / "regeneration.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    playlist_name = (args.name or (manifest or {}).get("name") or document.get("name")
                     or "Life timeline 1976–2026")
    if args.version < 1:
        ap.error("--version must be positive")
    out.mkdir(parents=True, exist_ok=True)
    tracks = json.loads((out / "analysis.json").read_text()) if args.prepared else prepare(handover, data, out, args.structure_method)
    expected = handover_rows(document)
    validate_handover(tracks, expected, handover)
    if any(not track.get("segments") for track in tracks):
        raise ValueError("Every handover track needs base and structure analysis before rendering")
    if args.prepare_only:
        return
    manifest = manifest or {
        "name": playlist_name, "version": args.version, "started": time.time(), "track_count": len(tracks), "sets": []}
    if manifest.get("version", 1) != args.version or manifest["name"] != playlist_name:
        raise ValueError("Build title or version changed; use a new output directory")
    if args.verify_only:
        for row in manifest["sets"]:
            if row["status"] != "done":
                continue
            plan = json.loads(Path(row["plan"]).read_text())
            assert_coverage(plan, tracks)
            if any(item.get("sourceSha256") != source["sha256"] for item, source in zip(plan["order"], tracks)):
                raise RuntimeError("Rendered source fingerprints differ from the verified current sources")
            validate_sources(tracks)
            result = verify_encoded(Path(row["mp3"]), plan)
            if result["sha256"] != row["media"]["sha256"]:
                raise RuntimeError("Encoded output changed since publication")
            report = json.loads(Path(row["report"]).read_text())
            if report["plan"] != plan:
                raise RuntimeError("Plan/report disagreement")
            report["verification"] = result
            save(Path(row["report"]), report)
            row["quality"] = quality(result, row["excerptTargetSeconds"])
            row["verificationNote"] = (f"All {len(tracks)} chapters in fixed order; encoded MP3 decodes cleanly. "
                                       f"{row['quality']['overlapWarnings']} overlap warnings. Not listening-approved.")
            validate_sources(tracks)
            save(manifest_path, manifest)
            log(f"Verified {row['id']} with {result['verifierRevision']}")
        return
    for duration in args.durations.split(","):
        seconds = None if duration == "full" else float(duration)
        key = "timeline-" + ("full" if seconds is None else f"{seconds:g}s")
        finished = next((row for row in manifest["sets"] if row["id"] == key and row["status"] == "done"), None)
        if finished:
            old_plan = json.loads(Path(finished["plan"]).read_text())
            current_plan = build_timeline(tracks, seconds)
            if old_plan != current_plan:
                raise RuntimeError(f"Completed {key} inputs changed; use a new output directory")
            with Path(finished["mp3"]).open("rb") as fh:
                if hashlib.file_digest(fh, "sha256").hexdigest() != finished["media"]["sha256"]:
                    raise RuntimeError(f"Completed {key} output changed")
            for field in ("cue", "report"):
                if not Path(finished[field]).is_file():
                    raise RuntimeError(f"Completed {key} is missing its {field}")
            continue
        manifest.update(status="rendering", current=key, updated=time.time())
        save(manifest_path, manifest)
        result = render(tracks, out, seconds, playlist_name, args.version)
        manifest["sets"].append(result)
        manifest.update(updated=time.time())
        save(manifest_path, manifest)
        log(f"Completed {key}: {result['media']['seconds'] / 60:.1f} minutes")
    manifest.update(status="done", current=None, updated=time.time(), finished=time.time())
    save(manifest_path, manifest)


if __name__ == "__main__":
    main()
