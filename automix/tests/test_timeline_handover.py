"""Both handover schemas preserve explicit order without rewriting source files."""
import importlib.util
from pathlib import Path
import unittest


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


if __name__ == "__main__":
    unittest.main()
