"""Both handover schemas preserve explicit order without rewriting source files."""
import importlib.util
from pathlib import Path
import unittest
import tempfile

import numpy as np

from automix.render import render_full
from automix.timeline import build_timeline
from test_timeline import track


spec = importlib.util.spec_from_file_location(
    "render_timeline", Path(__file__).resolve().parents[1] / "scripts/render_timeline.py")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class HandoverSchemaTests(unittest.TestCase):
    def test_aliases_preserve_order_and_do_not_mutate_input(self):
        source = {"tracks": [
            {"pos": 1, "file": "01 - First.mp3"},
            {"pos": 2, "handover_file": "02 - Second.mp3"},
        ]}
        rows = renderer.handover_rows(source)
        self.assertEqual([row["handover_file"] for row in rows],
                         ["01 - First.mp3", "02 - Second.mp3"])
        self.assertNotIn("handover_file", source["tracks"][0])

    def test_ambiguous_and_external_filenames_are_rejected(self):
        for fields in ({"file": "../outside.mp3"}, {"file": "/outside.mp3"},
                       {"file": "one.mp3", "handover_file": "two.mp3"}, {}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                renderer.handover_rows({"tracks": [{"pos": 1, **fields}]})

    def test_missing_or_reordered_positions_are_not_implicitly_sorted(self):
        for positions in ([1, 3], [2, 1]):
            with self.assertRaisesRegex(ValueError, "consecutive"):
                renderer.handover_rows({"tracks": [
                    {"pos": pos, "file": f"{pos}.mp3"} for pos in positions]})

    @unittest.skipUnless(Path("/opt/homebrew/bin/ffmpeg").is_file(), "ffmpeg required")
    def test_exact_total_survives_actual_mp3_encoding_and_decoding(self):
        tracks = [dict(track(i, 20), path=str(i)) for i in (1, 2)]
        plan = build_timeline(tracks, total_seconds=10)
        time = np.arange(20 * 44100, dtype=np.float32) / 44100
        signals = {str(i): np.column_stack([.15 * np.sin(2 * np.pi * (220 * i) * time)] * 2)
                   for i in (1, 2)}
        cache = type("FixtureCache", (), {"get": lambda self, path: signals[path]})()
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "total.mp3"
            metadata = Path(temp) / "metadata.txt"
            with metadata.open("w") as fh:
                fh.write(";FFMETADATA1\ntitle=Fixture total\n")
                for i, row in enumerate(plan["order"]):
                    end = plan["order"][i + 1]["start"] if i + 1 < len(tracks) else 10
                    fh.write(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={int(row['start'] * 1000)}\n"
                             f"END={int(end * 1000)}\ntitle={row['artist']} - {row['title']}\n")
            selected = [dict(source, duration=row["sourceEnd"])
                        for source, row in zip(tracks, plan["order"])]
            render_full(cache, selected, plan, plan["params"], str(output), str(metadata), log=lambda _: None)
            verification = renderer.verify_encoded(output, plan)
        self.assertEqual(verification["decodedFrames"], 441000)
        self.assertEqual(verification["decodedSeconds"], 10)
        self.assertEqual(verification["chapters"], 2)
        self.assertEqual(verification["decode"], "clean")
        self.assertEqual(len(verification["joins"]), 1)


if __name__ == "__main__":
    unittest.main()
