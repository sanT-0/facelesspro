from __future__ import annotations

import wave
from array import array
from pathlib import Path

import pytest

from app.audio import (
    SAMPLE_RATE,
    TARGET_LUFS,
    TRUE_PEAK_DBTP,
    AudioError,
    detect_silence,
    fade_edges,
    frames_to_ms,
    master_program,
    ms_to_frames,
    probe_duration_ms,
    read_wav,
    trim_and_normalise,
    wav_frames,
    write_wav,
)

TONE_MS = 900
LEAD_MS = 150
TAIL_MS = 150


@pytest.fixture
def tone_file(tmp_path: Path, tone_wav) -> Path:
    path = tmp_path / "tone.wav"
    path.write_bytes(tone_wav(TONE_MS))
    return path


def test_probe_and_detect_silence(tone_file: Path) -> None:
    assert probe_duration_ms(tone_file) == TONE_MS
    lead, tail = detect_silence(tone_file)
    assert abs(lead - LEAD_MS) <= 25
    assert abs(tail - TAIL_MS) <= 25


def test_trim_keeps_headroom_and_is_sample_exact(tone_file: Path, tmp_path: Path) -> None:
    out = tmp_path / "trimmed.wav"
    head_keep = 130
    frames = trim_and_normalise(
        tone_file,
        out,
        start_ms=head_keep,
        end_ms=TONE_MS - 130,
    )

    assert frames == wav_frames(out)
    assert frames_to_ms(frames) == TONE_MS - 260
    with wave.open(str(out), "rb") as handle:
        assert handle.getframerate() == SAMPLE_RATE
        assert handle.getnchannels() == 1
        assert handle.getsampwidth() == 2


def test_normalised_output_lands_near_the_target_loudness(
    tone_file: Path, tmp_path: Path, loudness
) -> None:
    out = tmp_path / "loud.wav"
    trim_and_normalise(tone_file, out, start_ms=130, end_ms=TONE_MS - 130)

    lufs, dbtp = loudness(out)
    assert abs(lufs + 16.0) < 1.5
    assert dbtp <= -1.0


def test_master_stage_keeps_every_frame(tmp_path: Path, peaky_wav) -> None:
    path = tmp_path / "program.wav"
    path.write_bytes(peaky_wav())
    frames = wav_frames(path)

    gain = master_program(path)

    # `alimiter=...:latency=true` is the only limiter allowed here: it
    # compensates its own lookahead, so the timeline that was computed from
    # these frames stays true.
    assert wav_frames(path) == frames
    assert gain.limited is True
    assert gain.gain_db > 1.0


def test_master_stage_does_not_move_the_signal(
    tmp_path: Path, tone_wav
) -> None:
    """The limiter's lookahead is compensated, not just hidden by equal lengths.

    `alimiter` alone shifts audio by `attack` (239 samples at 5 ms / 48 kHz). If
    `latency=true` ever stops compensating — a different ffmpeg build, a changed
    default — every caption would sit 5 ms early while the frame count still
    matched. This pins the position, not the length.
    """
    path = tmp_path / "program.wav"
    path.write_bytes(tone_wav(1200, sample_rate=SAMPLE_RATE))

    samples = read_wav(path)
    for index, value in enumerate(samples):
        samples[index] = int(value * 0.25)  # quiet programme: gain must go up
    marker = 24_000
    samples[marker] = 30_000  # full-scale enough that gain alone would break the ceiling
    write_wav(path, samples)

    frames = wav_frames(path)
    gain = master_program(path)

    assert gain.limited is True
    assert wav_frames(path) == frames
    after = read_wav(path)
    peak = max(range(len(after)), key=lambda index: abs(after[index]))
    assert peak == marker


def test_master_stage_lands_inside_the_delivery_window(
    tmp_path: Path, peaky_wav, loudness
) -> None:
    path = tmp_path / "program.wav"
    path.write_bytes(peaky_wav())

    master_program(path)

    lufs, dbtp = loudness(path)
    assert abs(lufs - TARGET_LUFS) <= 1.0
    assert dbtp <= TRUE_PEAK_DBTP


def test_master_stage_does_not_limit_when_gain_alone_is_enough(
    tmp_path: Path, tone_wav, loudness
) -> None:
    path = tmp_path / "program.wav"
    path.write_bytes(tone_wav(1200, sample_rate=48_000))

    gain = master_program(path)

    lufs, dbtp = loudness(path)
    assert gain.limited is False
    assert abs(lufs - TARGET_LUFS) <= 0.5
    assert dbtp <= TRUE_PEAK_DBTP


def test_master_stage_is_a_no_op_when_already_on_target(
    tmp_path: Path, tone_wav, loudness
) -> None:
    path = tmp_path / "program.wav"
    path.write_bytes(tone_wav(1200, sample_rate=48_000))
    lufs, dbtp = loudness(path)
    before = path.read_bytes()

    gain = master_program(path, target_lufs=lufs, true_peak=dbtp)

    assert gain.gain_db == pytest.approx(0.0, abs=0.05)
    assert gain.limited is False
    assert path.read_bytes() == before


def test_fully_silent_audio_is_not_trimmed_to_nothing(tmp_path: Path) -> None:
    silent = tmp_path / "silence.wav"
    with wave.open(str(silent), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24_000)
        handle.writeframes(array("h", [0]) * 24_000)

    assert detect_silence(silent) == (0, 0)
    out = tmp_path / "out.wav"
    frames = trim_and_normalise(silent, out, start_ms=0, end_ms=1000)
    assert frames_to_ms(frames) == 1000


def test_empty_trim_window_is_rejected(tone_file: Path, tmp_path: Path) -> None:
    with pytest.raises(AudioError):
        trim_and_normalise(tone_file, tmp_path / "x.wav", start_ms=500, end_ms=500)


def test_missing_file_is_an_audio_error(tmp_path: Path) -> None:
    with pytest.raises(AudioError):
        probe_duration_ms(tmp_path / "nope.wav")


def test_fade_edges_is_symmetric_and_keeps_the_middle() -> None:
    samples = array("h", [10_000] * 12)
    fade_edges(samples, 4)
    assert samples[0] < samples[1] < samples[2] < samples[3]
    assert samples[4] == 10_000
    assert samples[5] == 10_000
    assert samples[11] < samples[10] < samples[9] < samples[8]


def test_fade_shorter_than_the_run_is_clamped() -> None:
    samples = array("h", [5_000, 5_000, 5_000])
    fade_edges(samples, 100)
    assert all(-32_768 <= sample <= 32_767 for sample in samples)


def test_ms_and_frames_round_trip_at_48k() -> None:
    assert SAMPLE_RATE == 48_000
    assert ms_to_frames(1) == 48
    assert frames_to_ms(48) == 1
    assert frames_to_ms(ms_to_frames(640)) == 640
