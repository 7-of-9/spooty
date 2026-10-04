"""Tiny local HTTP server for the transition audition page (stdlib only)."""

from __future__ import annotations

import json
import os
import re
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from .medley_view import MedleyStore
from .session import Session

STATIC = os.path.join(os.path.dirname(__file__), "static")


def _shape(q: dict) -> dict:
    """Slider values the page is using for a candidate preview (?h=0.3&len=20)."""
    out = {}
    if (q.get("h") or [""])[0]:
        out["handover"] = float(q["h"][0])
    if (q.get("len") or [""])[0]:
        out["length_s"] = float(q["len"][0])
    return out


def serve(folder: str, data_dir: str, cache_dir: str, host: str, port: int) -> None:
    session = Session(folder, data_dir, cache_dir)
    medleys = MedleyStore(session.dir, data_dir, session.by_id)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # quieter console
            if not self.path.startswith("/api/state"):
                print("%s %s" % (self.command, self.path))

        def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, obj, code: int = 200) -> None:
            self._send(code, json.dumps(obj).encode(), "application/json")

        def _file(self, path: str, ctype: str) -> None:
            size = os.path.getsize(path)
            rng = self.headers.get("Range")
            with open(path, "rb") as fh:
                if rng and (m := re.match(r"bytes=(\d*)-(\d*)", rng)):
                    start = int(m.group(1) or 0)
                    end = int(m.group(2)) if m.group(2) else size - 1
                    fh.seek(start)
                    data = fh.read(end - start + 1)
                    self._send(206, data, ctype, {"Accept-Ranges": "bytes",
                                                  "Content-Range": f"bytes {start}-{end}/{size}"})
                else:
                    self._send(200, fh.read(), ctype, {"Accept-Ranges": "bytes"})

        def do_GET(self):
            url = urlparse(self.path)
            try:
                if url.path in ("/", "/index.html"):
                    with open(os.path.join(STATIC, "index.html"), "rb") as fh:
                        self._send(200, fh.read(), "text/html; charset=utf-8")
                elif url.path == "/api/state":
                    self._json(session.public_state())
                elif m := re.fullmatch(r"/api/transition/(\d+)/envelope", url.path):
                    self._json(session.transition_envelope(int(m.group(1))))
                elif m := re.fullmatch(r"/api/transition/(\d+)/markers", url.path):
                    _, markers = session.clip(int(m.group(1)))
                    self._json(markers)
                elif m := re.fullmatch(r"/api/transition/(\d+)\.wav", url.path):
                    wav, markers = session.clip(int(m.group(1)))
                    self._send(200, wav, "audio/wav", {"X-Markers": json.dumps(markers)})
                elif m := re.fullmatch(r"/api/track/(.+)/audio", url.path):
                    t = session.by_id.get(unquote(m.group(1)))
                    if not t:
                        return self._json({"error": "unknown track"}, 404)
                    self._file(t["path"], "audio/mpeg")
                elif url.path == "/api/candidates":
                    q = parse_qs(url.query)
                    slot = int((q.get("slot") or ["-1"])[0])
                    seen = [x for x in (q.get("seen") or [""])[0].split(",") if x]
                    limit = max(1, min(12, int((q.get("limit") or ["4"])[0])))
                    self._json(session.candidates(slot, seen, limit))
                elif m := re.fullmatch(r"/api/transition/(\d+)/spec", url.path):
                    self._json(session.join_spec(int(m.group(1)), _shape(parse_qs(url.query))))
                elif m := re.fullmatch(r"/api/transition/(\d+)/lengths", url.path):
                    self._json(session.join_lengths(int(m.group(1))))
                elif url.path == "/api/candidate/lengths":
                    q = parse_qs(url.query)
                    self._json(session.candidate_lengths(int((q.get("slot") or ["-1"])[0]), (q.get("id") or [""])[0]))
                elif url.path == "/api/candidate/spec":
                    q = parse_qs(url.query)
                    self._json(session.candidate_join_spec(int((q.get("slot") or ["-1"])[0]),
                                                           (q.get("id") or [""])[0], _shape(q)))
                elif url.path == "/api/candidate/envelope":
                    q = parse_qs(url.query)
                    self._json(session.candidate_envelope(int((q.get("slot") or ["-1"])[0]),
                                                          (q.get("id") or [""])[0], _shape(q)))
                elif url.path == "/api/candidate/markers":
                    # warm-up: render + cache the preview, return only the small markers JSON
                    q = parse_qs(url.query)
                    _, markers = session.candidate_clip(int((q.get("slot") or ["-1"])[0]),
                                                        (q.get("id") or [""])[0], _shape(q))
                    self._json(markers)
                elif url.path == "/api/candidate.wav":
                    q = parse_qs(url.query)
                    wav, markers = session.candidate_clip(int((q.get("slot") or ["-1"])[0]),
                                                          (q.get("id") or [""])[0], _shape(q))
                    self._send(200, wav, "audio/wav", {"X-Markers": json.dumps(markers)})
                elif url.path == "/api/render":
                    self._json(session.render_job)
                elif url.path == "/api/medleys":
                    self._json({"medleys": medleys.list(), "ratings": medleys.ratings()})
                elif m := re.fullmatch(r"/api/medley/(\d{8}-\d{6})", url.path):
                    self._json(medleys.view(m.group(1)))
                elif m := re.fullmatch(r"/api/medley/(\d{8}-\d{6})/peaks", url.path):
                    q = parse_qs(url.query)
                    self._json(medleys.peaks(m.group(1), float(q["t0"][0]), float(q["t1"][0]),
                                             int((q.get("n") or ["600"])[0])))
                elif m := re.fullmatch(r"/api/mix/(mix-[\d-]+\.mp3)", url.path):
                    path = os.path.join(session.mix_dir, m.group(1))
                    if not os.path.exists(path):
                        return self._json({"error": "not found"}, 404)
                    self._file(path, "audio/mpeg")
                else:
                    self._json({"error": "not found"}, 404)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except IndexError:
                self._json({"error": "no such transition or slot in the current set"}, 404)
            except FileNotFoundError:
                self._json({"error": "no such medley"}, 404)
            except (ValueError, KeyError, TypeError) as exc:
                self._json({"error": str(exc) or exc.__class__.__name__}, 400)
            except Exception as exc:
                traceback.print_exc()
                self._json({"error": str(exc)}, 500)

        def do_POST(self):
            url = urlparse(self.path)
            try:
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}")
                if url.path == "/api/state":
                    session.update(body)
                    self._json(session.public_state())
                elif url.path == "/api/render":
                    self._json(session.start_render_job())
                elif m := re.fullmatch(r"/api/medley/(\d{8}-\d{6})/rate", url.path):
                    medleys.rate(m.group(1), int(body["index"]), int(body["value"]))
                    self._json({"ratings": medleys.ratings()})
                else:
                    self._json({"error": "not found"}, 404)
            except (ValueError, KeyError, TypeError, IndexError, AttributeError) as exc:
                self._json({"error": str(exc) or exc.__class__.__name__}, 400)
            except Exception as exc:
                traceback.print_exc()
                self._json({"error": str(exc)}, 500)

    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"automix: {len(session.tracks)} tracks from {folder}")
    print(f"open http://{host}:{port}/")
    httpd.serve_forever()
