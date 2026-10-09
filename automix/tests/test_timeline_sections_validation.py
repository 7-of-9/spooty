"""Independent signal and selection checks for generic timeline sections."""
import unittest
from unittest.mock import patch

import numpy as np

from automix.sections import METHOD, scan_sections, structural_boundaries
from automix.timeline import select_window


class TimelineSectionValidationTests(unittest.TestCase):
    def test_repeated_material_has_boundaries_at_actual_feature_changes(self):
        features = np.zeros((3, 180))
        features[:, :60] = np.array([1, 0, .3])[:, None]
        features[:, 60:120] = np.array([0, 1, .9])[:, None]
        features[:, 120:] = np.array([1, 0, .3])[:, None]
        boundaries = structural_boundaries(features, np.arange(181.0))
        interior = [at for at, _ in boundaries[1:-1]]
        self.assertEqual(len(interior), 2)
        for actual, expected in zip(interior, (60, 120)):
            self.assertAlmostEqual(actual, expected, delta=1)

    def test_stationary_features_do_not_invent_sections(self):
        boundaries = structural_boundaries(np.ones((25, 90)), np.arange(91.0))
        self.assertEqual(boundaries, [(0.0, 1.0), (90.0, 1.0)])

    def test_boundary_spacing_uses_seconds_with_irregular_beat_intervals(self):
        edges = np.r_[0, np.cumsum(np.tile([.4, 1.1, .8, 1.7], 30))]
        features = np.zeros((2, len(edges) - 1))
        features[0] = (np.arange(features.shape[1]) // 6) % 2
        features[1] = 1 - features[0]
        boundaries = structural_boundaries(features, edges, min_seconds=10)
        self.assertGreater(len(boundaries), 2)
        self.assertTrue(all(b[0] - a[0] >= 10 for a, b in zip(boundaries, boundaries[1:])))

    def test_generic_sections_drive_excerpt_choice_instead_of_center_fallback(self):
        track = {
            "duration": 240,
            "segments": [
                {"start": start, "end": start + 80, "label": "section"}
                for start in (0, 80, 160)
            ],
            "second_db": [-55] * 80 + [-12] * 80 + [-35] * 80,
            "downbeats": [],
        }
        selected = select_window(track, 60)
        self.assertEqual((selected["start"], selected["end"]), (80, 140))
        self.assertIn("measured musical boundary", selected["reason"])
        self.assertNotIn("chorus", selected["reason"])
        self.assertNotIn("central passage", selected["reason"])

    def test_actual_feature_extraction_keeps_labels_generic_and_covers_source(self):
        sr = 22050
        time = np.arange(16 * sr) / sr
        sections = [
            .2 * np.sin(2 * np.pi * 220 * time),
            .6 * np.sin(2 * np.pi * 880 * time),
            .2 * np.sin(2 * np.pi * 220 * time),
        ]
        mono = np.concatenate(sections).astype(np.float32)
        stereo = np.column_stack((mono, mono))
        track = {"path": "synthetic-feature-change.wav", "sha256": "fixture",
                 "duration": 48.0, "beat_regularity": 0, "downbeats": []}
        with patch("automix.sections.decode", return_value=stereo):
            result = scan_sections(track)
        self.assertEqual(result["method"], METHOD)
        self.assertEqual(result["grid"], "two-second audio windows")
        self.assertFalse(result["semanticLabels"])
        self.assertGreaterEqual(len(result["segments"]), 3)
        self.assertEqual(result["segments"][0]["start"], 0)
        self.assertEqual(result["segments"][-1]["end"], 48)
        for segment in result["segments"]:
            self.assertEqual(segment["label"], "section")
            self.assertEqual(segment["semanticLabel"], "unassigned")
        for left, right in zip(result["segments"], result["segments"][1:]):
            self.assertEqual(left["end"], right["start"])


if __name__ == "__main__":
    unittest.main()
