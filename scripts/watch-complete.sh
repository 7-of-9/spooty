#!/bin/zsh
# Monitor for unattended scrape. Stdout is ONLY DONE / FAILED.
OUT=/Users/dom/src/spooty/PLAYLISTS_2026-09-08
while true; do
  stats=$(python3 - <<'PY'
import json
from pathlib import Path
out = Path("/Users/dom/src/spooty/PLAYLISTS_2026-09-08")
index = json.loads((out / "index.json").read_text())
want = [it for it in index if it.get("kind") == "playlist" and it.get("uri")]
dest = out / "playlists"
left = 0
for it in want:
    import re
    name = it.get("name") or "playlist"
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_")[:60] or "playlist"
    fn = dest / f"{int(it.get('rank') or 0):04d}_{s}.json"
    n = 0
    if fn.exists():
        try:
            n = json.loads(fn.read_text()).get("trackCount") or 0
        except Exception:
            n = 0
    if n == 0:
        left += 1
print(left)
PY
)
  if [[ "$stats" == "0" ]]; then
    echo DONE
    exit 0
  fi
  if ! curl -sf --max-time 3 http://127.0.0.1:17331/health >/dev/null; then
    echo FAILED
    exit 1
  fi
  if ! pgrep -f "/Users/dom/src/spooty/scripts/dom-scrape-playlists.py" >/dev/null \
     && ! pgrep -f "/Users/dom/src/spooty/scripts/unattended.sh" >/dev/null; then
    echo FAILED
    exit 1
  fi
  sleep 60
done
