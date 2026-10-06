#!/usr/bin/env python3
"""Read back public DJ downloads and verify bytes, filenames and seeking.

No credentials are accepted or sent. Downloads are hashed as streams and never
saved. Evidence is written after every completed file, including failures.
"""

import argparse
import concurrent.futures
import hashlib
import http.client
import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


USER_AGENT = "Mozilla/5.0 FiftyDJVerifier"
TRANSIENT = {408, 429, 500, 502, 503, 504}
READ_SIZE = 1024 * 1024
RANGE_SIZE = 4096


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(path.read_text())


def select_files(package, args):
    manifest = read_json(package / "manifest.json")
    files = []

    def add(kind, identity, path, key, size, digest, filename=None):
        local = (package / path).resolve()
        require(local.is_relative_to(package), "Package path escapes selected directory")
        require(local.is_file(), f"Local file missing: {path}")
        require(isinstance(size, int) and size > 0, f"Invalid expected size: {identity}")
        require(local.stat().st_size == size, f"Local size differs from manifest: {identity}")
        require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest),
                f"Invalid expected SHA-256: {identity}")
        files.append({"kind": kind, "id": identity, "path": path, "key": key,
                      "bytes": size, "sha256": digest, "filename": filename or local.name,
                      "contentType": "application/zip" if kind == "archive" else "audio/mpeg"})

    if args.tracks:
        for track in manifest["tracks"]:
            audio = track["audio"]
            add("track", track["spotifyId"], audio["path"], audio["path"],
                audio["bytes"], audio["sha256"], audio["filename"])
    if args.archive:
        archive = manifest.get("archive")
        require(isinstance(archive, dict), "Archive is not ready in the local manifest")
        path = archive["path"]
        key = path if path.startswith("exports/") else "exports/" + path
        add("archive", "playlist-50", path, key, archive["bytes"], archive["sha256"])
    if args.mix:
        mixes = {mix["id"]: mix for mix in read_json(package / "mixes.json")["mixes"]}
        for identity in dict.fromkeys(args.mix):
            require(identity in mixes, f"Unknown mix ID: {identity}")
            mix = mixes[identity]
            require(mix.get("status") == "ready", f"Mix is not ready: {identity}")
            add("mix", identity, mix["audioPath"], mix["audioPath"], mix["bytes"], mix["sha256"])
    require(files, "Select --tracks, --archive or --mix ID")
    require(len({f["key"] for f in files}) == len(files), "Duplicate public file keys")
    return files


def retry_request(url, consume, retries, extra_headers=None):
    attempts = []
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT, "Accept-Encoding": "identity",
                **(extra_headers or {}),
            })
            with urllib.request.urlopen(request, timeout=45) as response:
                result = consume(response)
            result["attempts"] = attempt + 1
            if attempts:
                result["transientErrors"] = attempts
            return result
        except urllib.error.HTTPError as error:
            if error.code not in TRANSIENT or attempt == retries:
                raise VerificationError(f"HTTP {error.code}") from None
            attempts.append(f"HTTP {error.code}")
            retry_after = error.headers.get("Retry-After", "")
            wait = min(10, int(retry_after)) if retry_after.isdigit() else min(5, 2 ** attempt)
        except (urllib.error.URLError, OSError, socket.timeout, http.client.HTTPException) as error:
            if attempt == retries:
                raise VerificationError(f"Network read failed: {type(error).__name__}") from None
            attempts.append(type(error).__name__)
            wait = min(5, 2 ** attempt)
        time.sleep(wait)
    raise VerificationError("Request attempts exhausted")


def validate_headers(response, item, expected_status, length, attachment=False):
    require(response.status == expected_status,
            f"Expected HTTP {expected_status}, received {response.status}")
    headers = response.headers
    require(headers.get_content_type() == item["contentType"],
            f"Unexpected Content-Type: {headers.get_content_type()}")
    require(headers.get("Content-Encoding", "identity").lower() == "identity",
            "Unexpected encoded response body")
    require(headers.get("Content-Length") == str(length), "Content-Length mismatch")
    require(headers.get("Accept-Ranges", "").lower() == "bytes", "Missing Accept-Ranges: bytes")
    advertised = headers.get("X-File-SHA256")
    require(advertised == item["sha256"], "Advertised SHA-256 mismatch or absent")
    if attachment:
        require(headers.get_content_disposition() == "attachment", "Download is not an attachment")
        require(headers.get_filename() == item["filename"], "Download filename mismatch")
    return {"contentType": headers.get_content_type(), "contentLength": length,
            "acceptRanges": headers.get("Accept-Ranges"), "etag": headers.get("ETag"),
            "filename": headers.get_filename() if attachment else None,
            "advertisedSha256": advertised}


def verify_file(origin, package, item, retries):
    started = time.monotonic()
    result = {**item, "startedAt": now(), "status": "running"}
    url = origin + "/media/" + urllib.parse.quote(item["key"], safe="")

    def consume_full(response):
        headers = validate_headers(response, item, 200, item["bytes"], attachment=True)
        digest = hashlib.sha256()
        count = 0
        while True:
            chunk = response.read(READ_SIZE)
            if not chunk:
                break
            count += len(chunk)
            require(count <= item["bytes"], "Download exceeded expected size")
            digest.update(chunk)
        require(count == item["bytes"], f"Truncated body: {count} bytes")
        observed = digest.hexdigest()
        require(observed == item["sha256"], "Downloaded SHA-256 mismatch")
        return {"status": "passed", "bytesRead": count, "sha256": observed, "headers": headers}

    try:
        result["download"] = retry_request(url + "?download=1", consume_full, retries)
        result["ranges"] = []
        length = min(RANGE_SIZE, item["bytes"])
        samples = [("beginning", 0), ("middle", max(0, (item["bytes"] - length) // 2)),
                   ("end", item["bytes"] - length)]
        with (package / item["path"]).open("rb") as local:
            for label, offset in samples:
                local.seek(offset)
                expected = local.read(length)
                end = offset + length - 1
                content_range = f"bytes {offset}-{end}/{item['bytes']}"

                def consume_range(response):
                    headers = validate_headers(response, item, 206, length)
                    require(response.headers.get("Content-Range") == content_range,
                            "Content-Range mismatch")
                    body = response.read(length + 1)
                    require(body == expected, f"{label} range bytes differ from local file")
                    return {"position": label, "status": "passed", "offset": offset,
                            "length": len(body), "contentRange": content_range,
                            "sha256": hashlib.sha256(body).hexdigest(), "headers": headers}

                result["ranges"].append(retry_request(
                    url, consume_range, retries, {"Range": f"bytes={offset}-{end}"}))
        result["status"] = "passed"
    except Exception as error:
        result["status"] = "failed"
        result["error"] = str(error) if isinstance(error, VerificationError) else type(error).__name__
    result["finishedAt"] = now()
    result["elapsedSeconds"] = round(time.monotonic() - started, 3)
    return result


def save_evidence(path, evidence):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--tracks", action="store_true")
    parser.add_argument("--archive", action="store_true")
    parser.add_argument("--mix", action="append", default=[], metavar="ID")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--concurrency", type=int, choices=(1, 2), default=2)
    parser.add_argument("--retries", type=int, choices=range(4), default=2)
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.origin)
    require(parsed.scheme == "https" and parsed.netloc and not parsed.username
            and not parsed.password and parsed.path in ("", "/")
            and not parsed.query and not parsed.fragment, "Expected a public HTTPS origin without credentials")
    origin = args.origin.rstrip("/")
    package = args.package.resolve()
    items = select_files(package, args)
    started = time.monotonic()
    evidence = {"schemaVersion": 1, "origin": origin, "startedAt": now(),
                "selection": {"tracks": args.tracks, "archive": args.archive, "mixes": args.mix},
                "concurrency": args.concurrency, "maxRetries": args.retries,
                "expectedFiles": len(items), "expectedBytes": sum(i["bytes"] for i in items),
                "verification": "Full streamed SHA-256 readback plus beginning/middle/end byte comparisons",
                "status": "running", "files": []}
    save_evidence(args.out, evidence)
    print(json.dumps({"status": "started", "files": len(items), "bytes": evidence["expectedBytes"]}), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(verify_file, origin, package, item, args.retries): item for item in items}
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            evidence["files"].append(result)
            evidence["passed"] = sum(row["status"] == "passed" for row in evidence["files"])
            evidence["failed"] = len(evidence["files"]) - evidence["passed"]
            save_evidence(args.out, evidence)
            print(json.dumps({"status": result["status"], "id": result["id"],
                              "complete": len(evidence["files"]), "total": len(items),
                              **({"error": result["error"]} if "error" in result else {})}), flush=True)
    evidence["files"].sort(key=lambda row: (row["kind"], row["key"]))
    evidence["status"] = "passed" if evidence["failed"] == 0 else "failed"
    evidence["finishedAt"] = now()
    evidence["elapsedSeconds"] = round(time.monotonic() - started, 3)
    evidence["verifiedDownloadBytes"] = sum(row.get("download", {}).get("bytesRead", 0) for row in evidence["files"])
    save_evidence(args.out, evidence)
    print(json.dumps({key: evidence[key] for key in ("status", "passed", "failed", "elapsedSeconds", "verifiedDownloadBytes")}), flush=True)
    return 0 if evidence["status"] == "passed" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except VerificationError as error:
        raise SystemExit(str(error))
