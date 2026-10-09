#!/usr/bin/env python3
"""Security and byte-serving acceptance checks for the private player."""
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location("private_player", Path(__file__).with_name("serve-private.py"))
player = importlib.util.module_from_spec(spec)
spec.loader.exec_module(player)


class PrivatePlayerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.build = self.root / "build"
        self.tracks = self.root / "tracks"
        self.build.mkdir()
        self.tracks.mkdir()
        self.rows = []
        self.order = []
        for index in range(1, 3):
            name = f"{index:02d} - selected.mp3"
            content = b"selected source " + str(index).encode()
            (self.tracks / name).write_bytes(content)
            self.rows.append({"pos": index, "file": name, "title": f"Song {index}", "artist": "Artist", "era": "Private notes"})
            self.order.append({"file": name, "artist": "Artist", "title": f"Song {index}", "sourceSha256": hashlib.sha256(content).hexdigest(), "sourceStart": 0, "sourceEnd": 60, "fullSourceDuration": 60})
        self.tracklist = self.root / "tracklist.json"
        self.tracklist.write_text(json.dumps({"name": "Selected private collection", "tracks": self.rows}))
        self.audio = bytes(range(256)) * 1024
        for label in player.LABELS:
            (self.build / (label + ".mp3")).write_bytes(self.audio)
            report = {"name": label, "plan": {"order": self.order, "transitions": [{"key": "a>b", "outputStart": 55, "style": "fade", "T": 5}]}, "chapters": [{"start": 0, "end": 55}, {"start": 55, "end": 115}], "verification": {"bytes": len(self.audio), "sha256": hashlib.sha256(self.audio).hexdigest(), "seconds": 115, "chapters": 2, "decode": "clean", "joins": [{"key": "a>b", "status": "warn", "warnings": ["Preserved warning"]}]}}
            (self.build / (label + ".json")).write_text(json.dumps(report))
            (self.build / (label + ".cue")).write_text('FILE "old.mp3" MP3\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n')
        self.output = self.root / "export"
        self.manifest, self.files = player.prepare(self.build, self.tracklist, self.output)
        self.server = player.make_server(self.manifest, self.files, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, method="GET", headers=None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        client.request(method, path, headers=headers or {})
        response = client.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        client.close()
        return result

    def test_full_audio_and_real_seek_ranges(self):
        status, headers, body = self.request("/files/90s.mp3?download=1")
        self.assertEqual(status, 200)
        self.assertEqual(body, self.audio)
        self.assertEqual(headers["Content-Type"], "audio/mpeg")
        self.assertIn("attachment", headers["Content-Disposition"])
        for requested, begin, end in [("bytes=0-4095", 0, 4095), ("bytes=12345-16440", 12345, 16440), ("bytes=-4096", len(self.audio)-4096, len(self.audio)-1)]:
            status, headers, body = self.request("/files/90s.mp3", headers={"Range": requested})
            self.assertEqual(status, 206)
            self.assertEqual(body, self.audio[begin:end+1])
            self.assertEqual(headers["Content-Range"], f"bytes {begin}-{end}/{len(self.audio)}")
            self.assertEqual(int(headers["Content-Length"]), len(body))

    def test_head_and_invalid_range(self):
        status, headers, body = self.request("/files/full.mp3", "HEAD", {"Range": "bytes=12-24"})
        self.assertEqual((status, body, headers["Content-Length"]), (206, b"", "13"))
        for value in ["bytes=9999999-", "bytes=2-1", "bytes=-0", "bytes=0-1,5-6", "bytes=-"]:
            self.assertEqual(self.request("/files/full.mp3", headers={"Range": value})[0], 416)
        self.assertEqual(self.request("/files/full.mp3", headers={"Range": "bytes=12-24", "If-Range": '"obsolete"'})[0], 200)

    def test_privacy_boundary(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        for headers in [{"Host": "attacker.example"}, {"Origin": "https://attacker.example"}, {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"}]:
            self.assertEqual(self.request("/manifest.json", headers=headers)[0], 403)
        for path in ["/files/../tracklist.json", "/files/%2e%2e%2ftracklist.json", "/files/%252e%252e%252ftracklist.json", "/files/", "/files/60s.mp3?path=/etc/passwd", "/tracklist.json", "/regeneration.json"]:
            self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request("/files/full.mp3", "POST")[0], 405)
        _, headers, _ = self.request("/")
        self.assertEqual(headers["Cache-Control"], "private, no-store")
        self.assertEqual(headers["Cross-Origin-Resource-Policy"], "same-origin")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])

    def test_manifest_actual_order_warnings_and_chapters(self):
        status, _, body = self.request("/manifest.json")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(len(data["sources"]), 2)
        self.assertEqual(len(data["mixes"]), 4)
        self.assertNotIn(str(self.root), body.decode())
        for mix in data["mixes"]:
            self.assertEqual([r["startSeconds"] for r in mix["order"]], [0, 55])
            self.assertEqual(mix["checks"]["warn"], 1)
            self.assertEqual(mix["transitions"][0]["warnings"], "Preserved warning")
            cue = self.request(mix["downloads"]["CUE"])[2].decode()
            self.assertTrue(cue.startswith(f'FILE "{mix["id"]}.mp3" MP3\n  TRACK'))

    def test_mutated_files_and_symlink_replacement_fail_closed(self):
        path = self.build / "full.mp3"
        path.unlink()
        path.symlink_to(self.build / "90s.mp3")
        self.assertEqual(self.request("/files/full.mp3")[0], 404)
        with self.assertRaises(ValueError):
            player.prepare(self.build, self.tracklist, self.output)
        audio = self.build / "60s.mp3"
        audio.write_bytes(b"changed")
        self.assertEqual(self.request("/files/60s.mp3")[0], 409)

    def test_source_or_order_mismatch_blocks_generation(self):
        source = self.tracks / self.rows[0]["file"]
        source.write_bytes(b"different recording")
        with self.assertRaisesRegex(ValueError, "source hash differs"):
            player.prepare(self.build, self.tracklist, self.output)


if __name__ == "__main__":
    unittest.main()
