"""Coverage and manual-order regressions for the chronological handover path."""
import copy
import unittest

from automix.timeline import assert_coverage, build_timeline, select_window


def track(n, duration=240, bpm=120, key="8A"):
    beat = 60 / bpm
    return {"id": f"song:{n}", "position": n, "file": f"{n:02}.mp3", "artist": "Artist",
            "title": str(n), "duration": duration, "bpm": bpm, "camelot": key,
            "key": "A", "scale": "minor", "beats_per_bar": 4,
            "beat_regularity": 1, "beat_coverage": .98,
            "beats": [i * beat for i in range(int(duration / beat))],
            "downbeats": [i * beat * 4 for i in range(int(duration / beat / 4))],
            "second_db": [-12] * int(duration), "lufs": -14,
            "segments": [{"start": 0, "end": 20, "label": "intro"},
                         {"start": 20, "end": 65, "label": "verse"},
                         {"start": 65, "end": 110, "label": "chorus"},
                         {"start": 210, "end": duration, "label": "outro"}]}


class TimelineTests(unittest.TestCase):
    def test_full_keeps_intro_outro_and_original_order(self):
        tracks = [track(1), track(2, 300, 95), track(3, 180)]
        plan = build_timeline(tracks)
        self.assertEqual([r["id"] for r in plan["order"]], ["song:1", "song:2", "song:3"])
        self.assertEqual([r["sourceStart"] for r in plan["order"]], [0, 0, 0])
        self.assertEqual([r["sourceEnd"] for r in plan["order"]], [240, 300, 180])
        self.assertEqual(plan["total_seconds"], 710)
        self.assertTrue(assert_coverage(plan, tracks))

    def test_missing_or_reordered_position_is_rejected(self):
        for tracks in ([track(1), track(3)], [track(2), track(1)]):
            with self.assertRaisesRegex(ValueError, "given order"):
                build_timeline(tracks)

    def test_silent_source_trimming_or_coverage_gap_is_rejected(self):
        tracks = [track(1), track(2)]
        plan = build_timeline(tracks)
        trimmed = copy.deepcopy(plan)
        trimmed["order"][0]["sourceStart"] = 1
        with self.assertRaisesRegex(ValueError, "trimmed"):
            assert_coverage(trimmed, tracks)
        broken = copy.deepcopy(plan)
        broken["native_starts"][1] += .1
        with self.assertRaisesRegex(ValueError, "gap"):
            assert_coverage(broken, tracks)

    def test_excerpts_pick_named_sections_and_include_each_song(self):
        tracks = [track(1), track(2, bpm=122), track(3, bpm=73, key="2B")]
        for seconds in (60, 90, 180):
            plan = build_timeline(tracks, seconds)
            self.assertEqual(len(plan["order"]), 3)
            self.assertTrue(assert_coverage(plan, tracks))
            for row in plan["order"]:
                self.assertAlmostEqual(row["sourceEnd"] - row["sourceStart"], seconds, delta=3.1)
                self.assertIn("chorus" if seconds < 180 else "verse", row["selectionReason"])
            self.assertTrue(plan["transitions"][0]["beatmatch"])
            self.assertFalse(plan["transitions"][1]["beatmatch"])

    def test_short_source_is_kept_in_full(self):
        row = select_window(track(1, 42), 60)
        self.assertEqual((row["start"], row["end"]), (0, 42))

    def test_total_duration_keeps_every_source_at_native_speed(self):
        tracks = [track(i, bpm=95 + i) for i in range(1, 56)]
        for target in (180, 240):
            plan = build_timeline(tracks, total_seconds=target)
            self.assertEqual(plan["total_seconds"], target)
            self.assertEqual(plan["targetFrames"], target * 44100)
            self.assertEqual(len(plan["order"]), 55)
            self.assertEqual(len(plan["transitions"]), 54)
            self.assertTrue(assert_coverage(plan, tracks))
            for row in plan["order"]:
                self.assertGreater(row["sourceEnd"] - row["sourceStart"], 5)
                self.assertLess(row["sourceEnd"] - row["sourceStart"], 7)
            for tr in plan["transitions"]:
                self.assertFalse(tr["beatmatch"])
                self.assertEqual(tr["T"], 2)
                self.assertAlmostEqual(tr["a_out_end"] - tr["a_out_start"], 2)
                self.assertAlmostEqual(tr["b_in_end"] - tr["b_in_start"], 2)
            broken = copy.deepcopy(plan)
            broken["targetFrames"] += 1
            with self.assertRaisesRegex(ValueError, "samples"):
                assert_coverage(broken, tracks)

    def test_total_duration_rejects_omitted_solo_passages_and_mixed_semantics(self):
        tracks = [track(i) for i in range(1, 56)]
        with self.assertRaisesRegex(ValueError, "audible solo"):
            build_timeline(tracks, total_seconds=120)
        with self.assertRaisesRegex(ValueError, "not both"):
            build_timeline(tracks, 60, total_seconds=240)
        with self.assertRaisesRegex(ValueError, "finite"):
            build_timeline(tracks, total_seconds=float("nan"))


if __name__ == "__main__":
    unittest.main()
