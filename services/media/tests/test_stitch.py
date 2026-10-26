from __future__ import annotations

import wave
from pathlib import Path

import pytest

from app.audio import SAMPLE_RATE, TARGET_LUFS, TRUE_PEAK_DBTP, AudioError, read_wav
from app.models import WordTiming
from app.stitch import Stitcher

RUN_MS = 900
TRIMMED_MS = RUN_MS - 260
LEAD_MS = 150


def words_for(count: int) -> list[WordTiming]:
    return [
        WordTiming(
            text=f"w{index}",
            start_ms=LEAD_MS + index * 300,
            end_ms=LEAD_MS + index * 300 + 250,
        )
        for index in range(count)
    ]


def test_single_run_is_trimmed_and_words_are_rebased(tmp_path: Path, tone_wav) -> None:
    stitcher = Stitcher()
    run = stitcher.process(
        tone_wav(RUN_MS), index=0, out_dir=tmp_path, words=words_for(2)
    )

    assert run.duration_ms == TRIMMED_MS
    assert run.head_trim_ms == 130
    assert run.source_duration_ms == RUN_MS
    assert [word.start_ms for word in run.words] == [20, 320]
    assert run.words[0].end_ms == 270


def test_stitch_offsets_are_exact(tmp_path: Path, tone_wav) -> None:
    stitcher = Stitcher()
    first = stitcher.process(
        tone_wav(RUN_MS), index=0, out_dir=tmp_path, words=words_for(2)
    )
    second = stitcher.process(
        tone_wav(RUN_MS), index=1, out_dir=tmp_path, words=words_for(2)
    )

    result = stitcher.assemble([first, second], [0, 110], out_dir=tmp_path)

    assert first.start_ms == 0
    assert second.start_ms == TRIMMED_MS + 110
    assert result.total_duration_ms == TRIMMED_MS + 110 + TRIMMED_MS
    assert result.master_wav.is_file()
    assert result.master_mp3.is_file()


def test_master_length_matches_the_timeline_exactly(
    tmp_path: Path, tone_wav
) -> None:
    stitcher = Stitcher()
    runs = [
        stitcher.process(
            tone_wav(RUN_MS), index=index, out_dir=tmp_path, words=words_for(1)
        )
        for index in range(3)
    ]
    result = stitcher.assemble(runs, [0, 300, 0], out_dir=tmp_path)

    with wave.open(str(result.master_wav), "rb") as handle:
        frames = handle.getnframes()
        assert handle.getframerate() == SAMPLE_RATE
        assert handle.getnchannels() == 1

    assert round(frames * 1000 / SAMPLE_RATE) == result.total_duration_ms
    assert frames == 48 * result.total_duration_ms


def test_words_cannot_escape_their_run(tmp_path: Path, tone_wav) -> None:
    words = [
        WordTiming(text="before", start_ms=0, end_ms=20),
        WordTiming(text="inside", start_ms=200, end_ms=420),
        WordTiming(text="after", start_ms=RUN_MS - 30, end_ms=RUN_MS + 500),
    ]
    run = Stitcher().process(
        tone_wav(RUN_MS), index=0, out_dir=tmp_path, words=words
    )

    assert run.words[0].start_ms == 0
    assert run.words[0].end_ms == 1
    for word in run.words:
        assert 0 <= word.start_ms < run.duration_ms
        assert word.start_ms < word.end_ms <= run.duration_ms


def test_runs_and_gaps_must_align(tmp_path: Path, tone_wav) -> None:
    run = Stitcher().process(
        tone_wav(RUN_MS), index=0, out_dir=tmp_path, words=words_for(1)
    )
    with pytest.raises(AudioError):
        Stitcher().assemble([run], [0, 110], out_dir=tmp_path)


def test_empty_audio_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(AudioError):
        Stitcher().process(b"", index=0, out_dir=tmp_path, words=[])


def test_master_audio_is_not_clipped(tmp_path: Path, tone_wav) -> None:
    stitcher = Stitcher()
    runs = [
        stitcher.process(
            tone_wav(RUN_MS), index=index, out_dir=tmp_path, words=words_for(1)
        )
        for index in range(2)
    ]
    result = stitcher.assemble(runs, [0, 0], out_dir=tmp_path)

    samples = read_wav(result.master_wav)
    assert max(samples) < 32_767
    assert min(samples) > -32_768


def test_join_has_no_click(tmp_path: Path, tone_wav) -> None:
    stitcher = Stitcher()
    runs = [
        stitcher.process(
            tone_wav(RUN_MS), index=index, out_dir=tmp_path, words=words_for(1)
        )
        for index in range(2)
    ]
    result = stitcher.assemble(runs, [0, 0], out_dir=tmp_path)
    samples = read_wav(result.master_wav)

    join = runs[1].start_ms * 48
    seam = abs(samples[join] - samples[join - 1])

    # Without the 5 ms fade a 320 Hz tone cut mid-cycle jumps by thousands.
    assert seam <= 200


def test_assembled_master_is_in_the_delivery_window(
    tmp_path: Path, tone_wav, loudness
) -> None:
    stitcher = Stitcher()
    runs = [
        stitcher.process(
            tone_wav(RUN_MS), index=index, out_dir=tmp_path, words=words_for(1)
        )
        for index in range(2)
    ]

    result = stitcher.assemble(runs, [0, 110], out_dir=tmp_path)

    assert result.master is not None
    lufs, dbtp = loudness(result.master_wav)
    assert abs(lufs - TARGET_LUFS) <= 1.0
    assert dbtp <= TRUE_PEAK_DBTP

