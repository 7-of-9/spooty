#!/usr/bin/env python3
"""Version and render every saved set family, then build and publish a medley.

The existing local server owns session.json. This runner uses that server for
set mutations and renders, preserves old versions, and writes a resumable
manifest beside the output. Start it only while the local render queue is idle.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request


def atomic_json(path: Path, value) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("folder", type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--api", default="http://127.0.0.1:4300")
    ap.add_argument("--seed", type=int, default=27002)
    args = ap.parse_args()
    root = Path(__file__).resolve().parents[2]
    data = root / "data/automix"
    folder, out = args.folder.resolve(), args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    lock = (out / "runner.lock").open("a+")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    lock.seek(0)
    lock.truncate()
    lock.write(str(os.getpid()))
    lock.flush()
    manifest_path = out / "regeneration.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        "started": time.time(), "folder": str(folder), "sets": [], "status": "starting",
    }

    def save(**changes) -> None:
        manifest.update(changes, updated=time.time(), runner_pid=os.getpid())
        atomic_json(manifest_path, manifest)

    def log(message: str) -> None:
        print(time.strftime("%Y-%m-%d %H:%M:%S"), message, flush=True)

    def api(endpoint: str, body=None):
        payload = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(args.api + "/api/" + endpoint, data=payload,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as response:
            return json.load(response)

    def probe(path: Path, expected: int) -> dict:
        result = subprocess.run(["/opt/homebrew/bin/ffprobe", "-v", "error", "-show_format",
                                 "-show_streams", "-show_chapters", "-of", "json", str(path)],
                                check=True, capture_output=True, text=True)
        doc = json.loads(result.stdout)
        assert len(doc["chapters"]) == expected, (path, len(doc["chapters"]), expected)
        assert any(s.get("codec_name") == "mp3" for s in doc["streams"]), path
        assert float(doc["format"]["duration"]) > 0, path
        atomic_json(path.with_suffix(".ffprobe.json"), doc)
        return {"seconds": float(doc["format"]["duration"]), "bytes": path.stat().st_size,
                "chapters": len(doc["chapters"]), "sha256": hashlib.file_digest(path.open("rb"), "sha256").hexdigest()}

    def reuse_identical_render(row: dict, state: dict) -> bool:
        """Reuse only after a full, freshly reconstructed render-input equality proof."""
        proof_path = out / "render-input-equality.json"
        if not proof_path.exists():
            return False
        proof = json.loads(proof_path.read_text())
        signature = proof["hashes"].get(row["id"])
        previous = next((s for s in manifest["sets"] if s["status"] == "done"
                         and signature and proof["hashes"].get(s["id"]) == signature), None)
        if previous is None:
            return False
        from automix.session import Session
        import copy
        # Session construction is read-only for this already migrated session.
        snapshot = Session(str(folder), str(data), str(data / "analysis"), log=lambda _: None)
        plans = {}
        for item in manifest["sets"]:
            snapshot.state["active_set"] = item["id"]
            snapshot._plan = snapshot._plan_key = None
            plans[item["id"]] = copy.deepcopy(snapshot.plan())
        sources = []
        for track in snapshot.tracks:
            path = Path(track["path"])
            stat = path.stat()
            with path.open("rb") as fh:
                digest = hashlib.file_digest(fh, "sha256").hexdigest()
            sources.append({"id": track["id"], "path": str(path), "size": stat.st_size,
                            "mtime_ns": stat.st_mtime_ns, "sha256": digest})
        for item in (previous, row):
            plan = plans[item["id"]]
            doc = {"plan": plan, "params": snapshot.state["params"],
                   "overrides": snapshot.state["overrides"], "tracks": snapshot.order_tracks(plan),
                   "sources": sources}
            actual = hashlib.sha256(json.dumps(doc, sort_keys=True, default=str).encode()).hexdigest()
            if actual != signature:
                log(f"render inputs changed for {item['id']}; rendering normally")
                return False
        if (state["state"]["params"] != snapshot.state["params"]
                or state["state"]["overrides"] != snapshot.state["overrides"]):
            return False
        source = Path(previous["mp3"])
        with source.open("rb") as fh:
            assert hashlib.file_digest(fh, "sha256").hexdigest() == previous["media"]["sha256"]
        # The per-set plan remains separate; shared audio is explicit in the manifest.
        target = out / f"{row['id']}-full-mix.mp3"
        if not target.exists():
            os.link(source, target)
        assert os.path.samefile(source, target)
        cue = target.with_suffix(".cue")
        cue.write_text(Path(previous["cue"]).read_text().replace(source.name, target.name))
        report = target.with_suffix(".json")
        report.write_bytes(Path(previous["report"]).read_bytes())
        row.update(status="done", mp3=str(target), cue=str(cue), report=str(report),
                   media=previous["media"], finished=time.time(), reusedFrom=previous["id"],
                   renderInputSHA256=signature, equalityProof=str(proof_path))
        save()
        log(f"completed: {row['name']} v{row['version']}; exact audio reused from {previous['id']}")
        return True

    try:
        state = api("state")
        assert Path(state["folder"]).resolve() == folder
        track_ids = {t["id"] for t in state["all_tracks"]}
        assert len(track_ids) == len(state["all_tracks"])
        save(track_count=len(track_ids))
        if not manifest.get("families"):
            assert api("render")["status"] != "running", "An existing render is running"
            latest = {}
            for doc in state["sets"].values():
                family = doc.get("family") or doc["name"]
                if family not in latest or doc["version"] > latest[family]["version"]:
                    latest[family] = doc
            atomic_json(out / "state-before.json", state)
            save(families=[{"name": family, "arc": doc["arc"], "previous_id": doc["id"],
                            "previous_version": doc["version"]} for family, doc in latest.items()])

        # Creating versions from the complete folder admits newly added tracks;
        # the UI's regenerate operation intentionally preserves a set's subset.
        for family in manifest["families"]:
            if any(s["name"] == family["name"] for s in manifest["sets"]):
                continue
            save(status="creating", current=family["name"])
            start = {"free": "flow"}.get(family["arc"], family["arc"])
            state = api("state", {"new_set": {"name": family["name"], "start": start}})
            sid = state["active_set"]
            doc = state["sets"][sid]
            assert doc["version"] == family["previous_version"] + 1
            assert {t["id"] for t in state["plan"]["order"]} == track_ids
            plan_path = out / f"{sid}-plan.json"
            atomic_json(plan_path, state["plan"])
            manifest["sets"].append({"id": sid, "name": doc["name"], "version": doc["version"],
                                      "arc": doc["arc"], "tracks": len(track_ids),
                                      "plan": str(plan_path), "status": "planned"})
            save()
            log(f"created {doc['name']} v{doc['version']}: {len(track_ids)} songs")

        for row in manifest["sets"]:
            if row["status"] == "done":
                assert Path(row["mp3"]).is_file()
                continue
            job = api("render")
            state = api("state")
            if job["status"] == "running":
                assert state["active_set"] == row["id"], "Another set is rendering"
            elif row["status"] == "rendering" and job["status"] == "done" and state["active_set"] == row["id"]:
                pass
            else:
                state = api("state", {"active_set": row["id"]})
                assert {t["id"] for t in state["plan"]["order"]} == track_ids
                atomic_json(Path(row["plan"]), state["plan"])
                if reuse_identical_render(row, state):
                    continue
                row.update(status="rendering", started=time.time())
                save(status="rendering", current=f"{row['name']} v{row['version']}")
                job = api("render", {})
                log(f"render started: {row['name']} v{row['version']}")
            last_done = -1
            while job["status"] == "running":
                row["progress"] = {k: job[k] for k in ("done", "total", "last") if k in job}
                save()
                if job.get("done", 0) >= last_done + 10:
                    log(f"{row['name']}: {job.get('done', 0)}/{job.get('total', '?')} rendered")
                    last_done = job.get("done", 0)
                time.sleep(5)
                job = api("render")
            assert job["status"] == "done", job
            mp3 = Path(job["path"])
            row.update(mp3=str(mp3), cue=str(mp3.with_suffix(".cue")),
                       report=str(mp3.with_suffix(".json")), media=probe(mp3, len(track_ids)),
                       status="done", finished=time.time())
            save()
            log(f"completed: {row['name']} v{row['version']}, {row['media']['seconds']/60:.1f} min")

        medley = manifest.setdefault("medley", {})
        if medley.get("status") != "done":
            save(status="medley_prep", current="Claude_Best · Medley")
            cmd = [sys.executable, "-u", "-m", "automix.cli", "medley"]
            with (out / "medley-prep.log").open("a") as fh:
                subprocess.run(cmd + ["prep", str(folder)], cwd=root / "automix", stdout=fh,
                               stderr=subprocess.STDOUT, check=True)
            medley_dir = out / "medley"
            medley_dir.mkdir(exist_ok=True)
            save(status="medley_build")
            log("medley build started: full verification enabled")
            medley.update(status="building", started=time.time())
            save()
            with (out / "medley-build.log").open("a") as fh:
                subprocess.run(cmd + ["build", str(folder), "--out", str(medley_dir), "--seed", str(args.seed)],
                               cwd=root / "automix", stdout=fh, stderr=subprocess.STDOUT, check=True)
            reports = sorted(medley_dir.glob("medley-*.json"))
            assert reports, "No completed medley report"
            report_path = reports[-1]
            report = json.loads(report_path.read_text())
            assert {t["id"] for t in report["plan"]["order"]} == track_ids
            assert not report["excluded"] and not report["needs_prep"] and not report["limited"]
            mp3 = report_path.with_suffix(".mp3")
            media = probe(mp3, len(track_ids))
            # Publish the immutable new build to the existing local audition UI.
            from automix.session import _slug
            session_dir = data / "sessions" / _slug(str(folder))
            target_mp3 = session_dir / "mixes" / ("mix-" + report["created"] + ".mp3")
            if not target_mp3.exists():
                os.link(mp3, target_mp3)
            else:
                assert os.path.samefile(mp3, target_mp3)
            target_report = session_dir / "medleys" / report_path.name
            target_report.parent.mkdir(exist_ok=True)
            if target_report.exists():
                assert target_report.read_bytes() == report_path.read_bytes()
            else:
                shutil.copy2(report_path, target_report)
            listed = api("medleys")["medleys"]
            published = next(m for m in listed if m["stamp"] == report["created"])
            medley.update(status="done", finished=time.time(), id=published["id"],
                          version=published["version"], name=published["name"], tracks=len(track_ids),
                          mp3=str(mp3), report=str(report_path), cue=str(mp3.with_suffix(".cue")),
                          media=media, verification=report["stats"], verify_mix=report["verify_mix"])
            save()
            log(f"medley complete: v{published['version']}, {media['seconds']/60:.1f} min, "
                f"whole-mix check {report['verify_mix']['status']}")
        save(status="done", current=None, finished=time.time())
        log("all set families rendered and verified; prior versions retained")
    except BaseException as exc:
        save(status="error", error=f"{type(exc).__name__}: {exc}")
        raise


if __name__ == "__main__":
    main()
