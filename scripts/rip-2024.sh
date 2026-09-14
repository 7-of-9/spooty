#!/bin/zsh
set -euo pipefail
ROOT=/Users/dom/src/spooty
OUT="$ROOT/2024"
JSON="$ROOT/PLAYLISTS_2026-09-08/playlists/0008_2024.json"
YTDLP="$ROOT/node_modules/ytdlp-nodejs/bin/yt-dlp_macos"
COOKIES="$ROOT/cookies.txt"
mkdir -p "$OUT"
export PATH="/Users/dom/.nvm/versions/node/v20.19.4/bin:$PATH"

python3 - <<'PY' "$JSON" "$OUT" "$YTDLP" "$COOKIES"
import json, os, subprocess, sys, time, re
from pathlib import Path
src, out, ytdlp, cookies = sys.argv[1:]
tracks = json.loads(Path(src).read_text())["tracks"]
outp = Path(out)
outp.mkdir(parents=True, exist_ok=True)

def safe(s):
    s = re.sub(r'[/\\?%*:|"<>]', '-', s or '')
    return s.strip() or 'unknown'

done = 0
fail = 0
for t in tracks:
    artist, name = t.get("artist") or "unknown", t.get("name") or "unknown"
    dest = outp / f"{safe(artist)} - {safe(name)}.mp3"
    if dest.exists() and dest.stat().st_size > 10000:
        print(f"skip {dest.name}", flush=True)
        done += 1
        continue
    q = f"{artist} {name}".replace('"', '').replace('&', 'and')
    print(f"rip {artist} - {name}", flush=True)
    cmd = [
        ytdlp,
        f"ytsearch1:{q}",
        "--cookies", cookies,
        "--js-runtime", "node",
        "-f", "ba/bestaudio/best",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--no-playlist",
        "--no-warnings",
        "-o", str(dest.with_suffix(".%(ext)s")),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if r.returncode != 0 or not dest.exists():
            print(f"FAIL {artist} - {name}: {(r.stderr or r.stdout)[-300:]}", flush=True)
            fail += 1
        else:
            done += 1
            print(f"ok {dest.name} ({dest.stat().st_size} bytes)", flush=True)
    except Exception as e:
        print(f"ERR {artist} - {name}: {e}", flush=True)
        fail += 1
    time.sleep(3)
print(f"done ok={done} fail={fail} total={len(tracks)}", flush=True)
PY
