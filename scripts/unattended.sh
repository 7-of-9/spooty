#!/bin/zsh
# Keep playlist scrape running until every Recents playlist has tracks.
# Does not restart Chrome CDP (that would prompt Allow).
set -u
ROOT=/Users/dom/src/spooty
OUT="$ROOT/PLAYLISTS_2026-09-08"
LOG="$OUT/unattended.log"
SCRAPE="$ROOT/scripts/dom-scrape-playlists.py"
mkdir -p "$OUT"
exec >>"$LOG" 2>&1
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] unattended watchdog start"

remaining() {
  python3 - <<'PY'
import json
from pathlib import Path
out = Path("/Users/dom/src/spooty/PLAYLISTS_2026-09-08")
index = json.loads((out / "index.json").read_text())
want = [it for it in index if it.get("kind") == "playlist" and it.get("uri")]
dest = out / "playlists"
left = 0
ok = 0
for it in want:
    name = it.get("name") or "playlist"
    import re
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_")[:60] or "playlist"
    fn = dest / f"{int(it.get('rank') or 0):04d}_{s}.json"
    n = 0
    if fn.exists():
        try:
            n = json.loads(fn.read_text()).get("trackCount") or 0
        except Exception:
            n = 0
    if n > 0:
        ok += 1
    else:
        left += 1
print(f"{ok} {left} {len(want)}")
PY
}

scrape_running() {
  pgrep -f "/Users/dom/src/spooty/scripts/dom-scrape-playlists.py" >/dev/null 2>&1
}

while true; do
  stats="$(remaining)"
  ok="${stats%% *}"
  rest="${stats#* }"
  left="${rest%% *}"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] watchdog ok=$ok left=$left scrape_running=$(scrape_running && echo yes || echo no)"
  if [[ "$left" == "0" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] complete"
    exit 0
  fi
  if curl -sf --max-time 3 http://127.0.0.1:17331/health >/dev/null; then
    :
  else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] CDP keepalive is down — cannot reconnect without Allow prompt"
  fi
  if scrape_running; then
    sleep 25
    continue
  fi
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting scrape"
  python3 "$SCRAPE" || echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] scrape exited $?"
  sleep 10
done
