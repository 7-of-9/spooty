"""Measure blend continuity from the final encoded MP3, one bounded join at a time."""
import argparse
import json
import statistics
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from automix.medley import verify as V

ap = argparse.ArgumentParser()
ap.add_argument("report")
ap.add_argument("mp3")
ap.add_argument("output")
a = ap.parse_args()
report = json.loads(Path(a.report).read_text())
rows = []
for i, (tl, tr) in enumerate(zip(report["timeline"], report["plan"]["transitions"])):
    t0 = max(0, tl["region_out"] - V.BLEND["ctx_s"])
    t1 = tl["land_out"] + V.BLEND["ctx_s"]
    raw = subprocess.check_output([
        "/opt/homebrew/bin/ffmpeg", "-v", "error", "-threads", "1", "-ss", str(t0),
        "-t", str(t1 - t0), "-i", a.mp3, "-ac", "1", "-ar", "22050", "-f", "f32le", "-",
    ])
    y = np.frombuffer(raw, dtype=np.float32)
    c = tr["composition"]
    beat = c["b_ref"].get("period_s") or 0.5
    m = V.blend_join(y, 22050, tl["region_out"] - t0, tl["land_out"] - t0, beat)
    rows.append({"join": i + 1, "key": tr["key"], "form": tr["form"], **m})
scores = [r["score"] for r in rows if r.get("score") is not None]
out = {
    "report": a.report, "mp3": a.mp3, "measured": len(scores),
    "median_continuity_score": statistics.median(scores),
    "below_60": sum(s < 60 for s in scores), "joins": rows,
    "scope": "Final encoded audio level and bass continuity. Harmonic overlap requires separate stems; listener quality remains subjective.",
}
Path(a.output).write_text(json.dumps(out, indent=2))
print(json.dumps({k: out[k] for k in ("measured", "median_continuity_score", "below_60")}))
