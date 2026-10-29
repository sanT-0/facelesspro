"""Provider-internal pauses: edge-tts's Tamil voice inserts 60-150 ms of silence
between words *inside* a run, which is what makes it sound word-by-word.

These tests pin the fix at the audio layer — which silences are touched, which
are not, and that the PCM outside a cut is untouched — so the stitcher can rely
on an exact list of removed intervals to move word timings.
"""

from __future__ import annotations

import itertools
import wave
from array import array
from pathlib import Path

import pytest

from app.audio import (
    PAUSE_KEEP_MS,
    PAUSE_MAX_MS,
    PAUSE_MIN_MS,
    SAMPLE_RATE,
    compress_pauses,
    detect_silence_intervals,
    read_wav,
    write_wav,
)

LEAD_MS = 150
BURST_MS = 300


def wav_path(tmp_path: Path, data: bytes) -> Path:
    path = tmp_path / "run.src"
    path.write_bytes(data)
    return path


def frames(path: Path) -> int:
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes()


def burst_span(index: int, pauses: tuple[int, ...]) -> tuple[int, int]:
    """`(start_ms, end_ms)` of burst `index` in a `gapped_wav` fixture."""
    start = LEAD_MS + index * BURST_MS + sum(pauses[:index])
    return start, start + BURST_MS


def test_internal_pause_is_found_and_the_edges_are_not(gapped_wav, tmp_path: Path) -> None:
    path = wav_path(tmp_path, gapped_wav(pauses_ms=(150,)))

    intervals = detect_silence_intervals(path)

    assert len(intervals) == 1
    start, end = intervals[0]
    # ffmpeg's silencedetect reports the window where RMS stays below the
    # threshold; a windowed burst ramps, so allow a few ms of slop either side.
    assert abs(start - 450) <= 8
    assert abs(end - 600) <= 8


def test_word_pause_is_shortened_to_the_documented_gap(gapped_wav, tmp_path: Path) -> None:
    path = wav_path(tmp_path, gapped_wav(pauses_ms=(150,)))
    before_frames = frames(path)

    cuts, after_frames = compress_pauses(path)

    assert len(cuts) == 1
    removed_ms = cuts[0].end_ms - cuts[0].start_ms
    assert removed_ms == 150 - 2 * PAUSE_KEEP_MS
    assert after_frames == before_frames - removed_ms * 48
    assert frames(path) == after_frames

    remaining = detect_silence_intervals(path, min_ms=30)
    assert len(remaining) == 1
    gap = remaining[0][1] - remaining[0][0]
    assert abs(gap - 2 * PAUSE_KEEP_MS) <= 10


def test_audio_outside_the_cut_is_unchanged(gapped_wav, tmp_path: Path) -> None:
    path = wav_path(tmp_path, gapped_wav(pauses_ms=(150,)))
    before = read_wav(path)

    cuts, _ = compress_pauses(path)
    after = read_wav(path)

    start = cuts[0].start_ms * 48
    end = cuts[0].end_ms * 48
    assert after[:start] == before[:start]
    assert after[start:] == before[end:]


def test_sentence_pause_is_left_alone(gapped_wav, tmp_path: Path) -> None:
    path = wav_path(tmp_path, gapped_wav(pauses_ms=(900,)))
    before = read_wav(path)

    cuts, after_frames = compress_pauses(path)

    assert cuts == []
    assert after_frames == len(before)
    assert read_wav(path) == before


def test_pause_shorter_than_the_floor_is_left_alone(gapped_wav, tmp_path: Path) -> None:
    path = wav_path(tmp_path, gapped_wav(pauses_ms=(PAUSE_MIN_MS - 20,)))

    cuts, _ = compress_pauses(path)

    assert cuts == []


def test_pause_longer_than_the_ceiling_is_left_alone(gapped_wav, tmp_path: Path) -> None:
    path = wav_path(tmp_path, gapped_wav(pauses_ms=(PAUSE_MAX_MS + 100,)))

    cuts, _ = compress_pauses(path)

    assert cuts == []


def test_every_pause_is_cut_with_its_own_interval(gapped_wav, tmp_path: Path) -> None:
    pauses = (150, 80, 200)
    data = gapped_wav(pauses_ms=pauses)
    path = wav_path(tmp_path, data)

    cuts, _ = compress_pauses(path)

    assert len(cuts) == 3
    assert [cut.end_ms - cut.start_ms for cut in cuts] == [
        pause - 2 * PAUSE_KEEP_MS for pause in pauses
    ]
    # Ascending and non-overlapping is what the word-shift arithmetic assumes.
    assert all(a.end_ms <= b.start_ms for a, b in itertools.pairwise(cuts))
    for cut in cuts:
        assert cut.start_ms >= 0


def test_a_silent_file_is_not_cut_to_nothing(tmp_path: Path) -> None:
    path = tmp_path / "silence.wav"
    write_wav(path, array("h", [0]) * (SAMPLE_RATE // 2))

    cuts, after_frames = compress_pauses(path)

    assert cuts == []
    assert after_frames == SAMPLE_RATE // 2


@pytest.mark.parametrize("keep_ms", [10, PAUSE_KEEP_MS, 40])
def test_keep_window_is_configurable(gapped_wav, tmp_path: Path, keep_ms: int) -> None:
    path = wav_path(tmp_path, gapped_wav(pauses_ms=(150,)))

    cuts, _ = compress_pauses(path, keep_ms=keep_ms)

    assert cuts[0].end_ms - cuts[0].start_ms == 150 - 2 * keep_ms
