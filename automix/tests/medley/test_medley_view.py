"""The audition page describes the selected candidate, not the last one tried."""

from automix.medley_view import MedleyStore


def test_view_uses_selected_attempt_warnings(tmp_path, plan):
    store = MedleyStore(str(tmp_path / "session"), str(tmp_path), {})
    report = {
        "created": "20261003-093000", "plan": plan,
        "joins": [{"index": 0, "hash": "chosen", "checks": {"status": "warn"},
                   "attempts": [{"hash": "chosen", "warn": ["V8"]},
                                {"hash": "rejected", "warn": ["V3", "V12"]}]}],
    }
    view = store._slim("20261003-093000", report)
    assert view["joins"][0]["warn"] == ["V8"]


def test_view_retains_legacy_attempts_without_hashes(tmp_path, plan):
    store = MedleyStore(str(tmp_path / "session"), str(tmp_path), {})
    report = {"created": "20261003-093000", "plan": plan,
              "joins": [{"index": 0, "attempts": [{"warn": ["V8"]}]}]}
    assert store._slim("20261003-093000", report)["joins"][0]["warn"] == ["V8"]
