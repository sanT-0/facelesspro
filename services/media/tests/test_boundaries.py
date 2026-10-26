from __future__ import annotations

import pytest

from app.boundaries import (
    BASE_GAP_MS,
    Boundary,
    classify_boundary,
    gap_ms_for,
)


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        ("hello", "world", "none"),
        ("hello,", "world", "comma"),
        ("hello", ", world", "comma"),
        ("hello;", "world", "clause"),
        ("hello:", "world", "clause"),
        ("hello —", "world", "clause"),
        ("hello.", "world", "sentence"),
        ("hello?", "world", "sentence"),
        ("hello!", "world", "sentence"),
        ("இருக்கு.", "அடுத்து", "sentence"),
        ("hello\n", "world", "paragraph"),
        ("hello", "\nworld", "paragraph"),
    ],
)
def test_classify(before: str, after: str, expected: Boundary) -> None:
    assert classify_boundary(before, after) == expected


def test_sentence_beats_comma_when_both_are_present() -> None:
    assert classify_boundary("done, really.", "next") == "sentence"


def test_every_boundary_has_a_documented_gap() -> None:
    assert BASE_GAP_MS == {
        "none": 0,
        "comma": 110,
        "clause": 180,
        "sentence": 300,
        "paragraph": 475,
    }
    assert list(BASE_GAP_MS.values()) == sorted(BASE_GAP_MS.values())


def test_gap_scales_with_speed() -> None:
    assert gap_ms_for("sentence") == 300
    assert gap_ms_for("sentence", speed=1.2) == 250
    assert gap_ms_for("comma", speed=0.8) == 138
    assert gap_ms_for("none", speed=2.0) == 0


def test_invalid_speed_is_rejected() -> None:
    with pytest.raises(ValueError):
        gap_ms_for("comma", speed=0)
    with pytest.raises(ValueError):
        gap_ms_for("comma", speed=-1.0)
