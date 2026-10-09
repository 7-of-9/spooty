#!/usr/bin/env python3
"""Serve a verified fixed-order mix collection on this Mac only.

No upload support, directory listings or user-supplied filesystem paths over HTTP.
Run with --help for the required private build and handover locations.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import quote, unquote, urlsplit

HERE = Path(__file__).resolve().parent
LABELS = ("60s", "90s", "180s", "full")


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def checked_file(root, name):
    """Require one real regular child; reject symlink redirection."""
    if Path(name).name != name or name in ("", ".", ".."):
        raise ValueError("Expected an allowlisted basename")
    path = root / name
    if path.is_symlink() or not path.is_file() or path.resolve().parent != root:
        raise ValueError(f"Missing or redirected collection file: {name}")
    return path


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def write_csv(path, rows):
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]) if rows else [])
        writer.writeheader()
        writer.writerows(rows)


def prepare(build, tracklist, output):
    build, tracklist, output = build.resolve(), tracklist.resolve(), output.resolve()
    source_root = (tracklist.parent / "tracks").resolve()
    handover = json.loads(tracklist.read_text())
    selected = handover["tracks"]
    positions = list(range(1, len(selected) + 1))
    if not selected or [row["pos"] for row in selected] != positions:
        raise ValueError("Source order must have consecutive positions")
    output.mkdir(parents=True, exist_ok=True)
    files, sources, source_digests = {}, [], {}
    for row in selected:
        filename = row.get("file") or row.get("handover_file", "")
        path = checked_file(source_root, filename)
        digest = sha256(path)
        key = f"source-{row['pos']:02d}.mp3"
        files[key] = path
        source_digests[filename] = digest
        sources.append({"position": row["pos"], "artist": row["artist"], "title": row["title"],
                        "era": row.get("era", ""), "audio": "/files/" + key,
                        "bytes": path.stat().st_size, "sha256": digest})
    mixes = []
    for label in LABELS:
        report_path = checked_file(build, label + ".json")
        report = json.loads(report_path.read_text())
        audio = checked_file(build, label + ".mp3")
        cue = checked_file(build, label + ".cue")
        proof = report["verification"]
        if audio.stat().st_size != proof["bytes"] or sha256(audio) != proof["sha256"]:
            raise ValueError(f"Rendered audio differs from its verification: {label}")
        order = report["plan"]["order"]
        if len(order) != len(selected) or [row["file"] for row in order] != list(source_digests):
            raise ValueError(f"Rendered order differs from the selected handover: {label}")
        if any(row["sourceSha256"] != source_digests[row["file"]] for row in order):
            raise ValueError(f"Rendered source hash differs from the selected handover: {label}")
        chapters = report["chapters"]
        transitions = report["plan"]["transitions"]
        joins = proof["joins"]
        if len(chapters) != len(order) or len(transitions) != len(order) - 1 or len(joins) != len(transitions):
            raise ValueError(f"Incomplete chapter/transition verification: {label}")
        if proof.get("decode") != "clean" or proof.get("chapters") != len(order):
            raise ValueError(f"Rendered MP3 has not passed final file verification: {label}")
        join_by_key = {row["key"]: row for row in joins}
        if len(join_by_key) != len(joins) or any(t["key"] not in join_by_key for t in transitions):
            raise ValueError(f"Transition proof identity mismatch: {label}")
        order_rows = []
        for index, (row, chapter, source) in enumerate(zip(order, chapters, sources)):
            order_rows.append({"position": index + 1, "artist": row["artist"], "title": row["title"],
                               "era": source["era"], "startSeconds": chapter["start"],
                               "endSeconds": chapter["end"], "sourceStart": row["sourceStart"],
                               "sourceEnd": row["sourceEnd"], "fullSourceDuration": row["fullSourceDuration"],
                               "selectionReason": row.get("selectionReason", ""),
                               "bpm": row.get("bpm"), "key": row.get("key"), "camelot": row.get("camelot"),
                               "sourceSha256": row["sourceSha256"]})
        transition_rows = []
        for index, transition in enumerate(transitions):
            check = join_by_key[transition["key"]]
            transition_rows.append({"position": index + 1, "from": order[index]["title"],
                                    "to": order[index + 1]["title"], "startSeconds": transition["outputStart"],
                                    "style": transition["style"], "beatmatch": transition.get("beatmatch", False),
                                    "overlapSeconds": transition.get("T_overlap", transition.get("T")),
                                    "reason": transition.get("reason", ""), "checkStatus": check["status"],
                                    "warnings": "; ".join(check.get("warnings", [])),
                                    "decodedPeak": check.get("decodedPeak"),
                                    "continuity": json.dumps(check.get("continuity"), ensure_ascii=False),
                                    "renderedBeatAlignment": json.dumps(check.get("renderedBeatAlignment"), ensure_ascii=False)})
        details = {"name": report["name"], "verification": proof, "order": order_rows,
                   "transitions": transition_rows, "sourceWarnings": report.get("sourceWarnings", "")}
        write_json(output / (label + ".json"), details)
        write_csv(output / (label + "-order.csv"), order_rows)
        write_csv(output / (label + "-transitions.csv"), transition_rows)
        cue_text = cue.read_text()
        cue_text, replacements = re.subn(r'^FILE[ \t]+"[^"\n]+"[ \t]+\w+[ \t]*$', f'FILE "{label}.mp3" MP3', cue_text, count=1, flags=re.M)
        if replacements != 1:
            raise ValueError("Cannot validate CUE audio filename")
        (output / (label + ".cue")).write_text(cue_text)
        files[label + ".mp3"] = audio
        for suffix in (".json", "-order.csv", "-transitions.csv", ".cue"):
            files[label + suffix] = checked_file(output, label + suffix)
        statuses = {status: sum(j["status"] == status for j in joins) for status in ("pass", "warn", "fail")}
        mixes.append({"id": label, "name": report["name"], "seconds": proof["seconds"],
                      "bytes": proof["bytes"], "sha256": proof["sha256"], "trackCount": len(order),
                      "audio": "/files/" + label + ".mp3", "checks": statuses, "order": order_rows,
                      "transitions": transition_rows, "sourceWarnings": report.get("sourceWarnings", ""),
                      "verificationScope": proof.get("scope", ""),
                      "downloads": {"CUE": "/files/" + label + ".cue",
                                    "Order CSV": "/files/" + label + "-order.csv",
                                    "Transitions CSV": "/files/" + label + "-transitions.csv",
                                    "Report JSON": "/files/" + label + ".json"}})
    manifest = {"name": handover.get("name", "Private mixes"), "private": True,
                "updatedAt": datetime.now(timezone.utc).isoformat(), "sources": sources, "mixes": mixes}
    write_json(output / "manifest.json", manifest)
    return manifest, files


def byte_range(value, size):
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not size or not any(match.groups()):
        raise ValueError("Unsupported byte range")
    first, last = match.groups()
    if not first:
        if int(last) <= 0:
            raise ValueError("Empty suffix range")
        return max(0, size - int(last)), size - 1
    start, end = int(first), min(int(last), size - 1) if last else size - 1
    if start >= size or end < start:
        raise ValueError("Unsatisfiable byte range")
    return start, end


def make_server(manifest, files, port):
    payload = (json.dumps(manifest, ensure_ascii=False, allow_nan=False) + "\n").encode()
    # Immutable allowlist. Opening a file also checks that its original inode has
    # not been replaced after validation; O_NOFOLLOW rejects a swapped symlink.
    records = {name: (path, path.stat()) for name, path in files.items()}
    static = {"/": (HERE / "private-player.html").read_bytes(),
              "/app.js": (HERE / "private-player.js").read_bytes(),
              "/style.css": (HERE / "private-player.css").read_bytes(),
              "/manifest.json": payload}

    class Handler(BaseHTTPRequestHandler):
        server_version = "PrivateMixPlayer"

        def log_message(self, *_):
            pass

        def safe_request(self):
            allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            if host not in allowed or (origin and origin != "http://" + host):
                return False
            return self.headers.get("Sec-Fetch-Site") not in ("cross-site",)

        def respond(self, status, content_type, length, extra=()):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            for key, value in extra:
                self.send_header(key, value)
            self.end_headers()

        def error(self, code):
            self.respond(code, "text/plain; charset=utf-8", 0)

        def do_HEAD(self):
            self.send_content(head=True)

        def do_GET(self):
            self.send_content(head=False)

        def do_POST(self):
            self.error(405)

        def send_content(self, head):
            if not self.safe_request():
                self.error(403)
                return
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc or parsed.query not in ("", "download=1"):
                self.error(404)
                return
            path = unquote(parsed.path)
            if path in static:
                content_type = {"/": "text/html", "/app.js": "text/javascript", "/style.css": "text/css", "/manifest.json": "application/json"}[path]
                self.respond(200, content_type + "; charset=utf-8", len(static[path]))
                if not head:
                    self.wfile.write(static[path])
                return
            if not path.startswith("/files/") or path[7:] not in records:
                self.error(404)
                return
            key = path[7:]
            target, expected = records[key]
            try:
                fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
            except OSError:
                self.error(404)
                return
            with os.fdopen(fd, "rb") as stream:
                current = os.fstat(stream.fileno())
                identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
                if not stat.S_ISREG(current.st_mode) or identity(current) != identity(expected):
                    self.error(409)
                    return
                size, start, end, status = current.st_size, 0, current.st_size - 1, 200
                etag = f'"{current.st_ino:x}-{size:x}-{current.st_mtime_ns:x}"'
                headers = [("Accept-Ranges", "bytes"), ("ETag", etag)]
                requested = self.headers.get("Range")
                if requested and self.headers.get("If-Range", etag) == etag:
                    try:
                        start, end = byte_range(requested, size)
                    except ValueError:
                        self.respond(416, "text/plain", 0, [("Content-Range", f"bytes */{size}")])
                        return
                    status = 206
                    headers.append(("Content-Range", f"bytes {start}-{end}/{size}"))
                content_type = {".mp3": "audio/mpeg", ".cue": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".json": "application/json; charset=utf-8"}.get(target.suffix, "application/octet-stream")
                disposition = "attachment" if parsed.query == "download=1" else "inline"
                filename = key if key[0].isdigit() or key.startswith("full") else target.name
                headers.append(("Content-Disposition", disposition + "; filename*=UTF-8''" + quote(filename, safe="")))
                length = max(0, end - start + 1)
                self.respond(status, content_type, length, headers)
                if not head:
                    stream.seek(start)
                    try:
                        while length:
                            chunk = stream.read(min(length, 256 * 1024))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            length -= len(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        pass

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", type=Path, required=True)
    parser.add_argument("--tracklist", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--port", type=int, default=4301)
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    manifest, files = prepare(args.build, args.tracklist, args.out)
    if args.prepare_only:
        print(json.dumps({"mixes": len(manifest["mixes"]), "tracks": len(manifest["sources"]), "private": True}))
        return
    with make_server(manifest, files, args.port) as server:
        print(f"Private player ready at http://127.0.0.1:{args.port}/ ({len(manifest['mixes'])} verified mixes)", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
