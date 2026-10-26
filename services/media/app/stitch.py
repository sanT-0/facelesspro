"""Stitch synthesised runs into one master track with an exact timeline.

The one rule that matters: `global = run.start_ms + word.local_ms`. Captions are
generated from that sum, so every millisecond removed by trimming has to be
subtracted from the words, and every sample inserted as a gap has to be visible
in `run.start_ms`. The audio and the timeline are built from the same frame
counters, so they cannot drift.

Cross-fades are 5 ms and equal-power. They sit *inside* the pause, so they kill
the cut click without smearing the first or last consonant of a run.
"""

from __future__ import annotations

from array import array
from dataclasses import dataclass, field
from pathlib import Path

from .audio import (
    FADE_MS,
    HEADROOM_MS,
    AudioError,
    MasterGain,
    detect_silence,
    encode_mp3,
    fade_edges,
    frames_to_ms,
    master_program,
    ms_to_frames,
    probe_duration_ms,
    read_wav,
    trim_and_normalise,
    write_wav,
)
from .models import WordTiming


@dataclass(slots=True)
class ProcessedRun:
    index: int
    path: Path
    duration_ms: int
    head_trim_ms: int
    source_duration_ms: int
    words: list[WordTiming]
    start_ms: int = 0


@dataclass(slots=True)
class StitchResult:
    master_wav: Path
    master_mp3: Path
    runs: list[ProcessedRun]
    gaps_ms: list[int] = field(default_factory=list)
    total_duration_ms: int = 0
    master: MasterGain | None = None


def _clamp_words(
    words: list[WordTiming], *, offset_ms: int, duration_ms: int
) -> list[WordTiming]:
    """Shift words by the trimmed head and keep them inside the run."""
    adjusted: list[WordTiming] = []
    for word in words:
        start = min(max(word.start_ms + offset_ms, 0), max(duration_ms - 1, 0))
        end = min(max(word.end_ms + offset_ms, start + 1), duration_ms)
        adjusted.append(WordTiming(text=word.text, start_ms=start, end_ms=end))
    return adjusted


class Stitcher:
    def __init__(self, *, headroom_ms: int = HEADROOM_MS, fade_ms: int = FADE_MS) -> None:
        self.headroom_ms = headroom_ms
        self.fade_ms = fade_ms

    def process(
        self,
        audio: bytes,
        *,
        index: int,
        out_dir: Path,
        words: list[WordTiming],
    ) -> ProcessedRun:
        if not audio:
            raise AudioError(f"run {index} has no audio")

        source = out_dir / f"run-{index}.src"
        source.write_bytes(audio)

        source_duration_ms = probe_duration_ms(source)
        lead_ms, tail_ms = detect_silence(source)

        head_keep = max(0, lead_ms - self.headroom_ms)
        tail_keep = max(0, tail_ms - self.headroom_ms)
        end_ms = max(head_keep + 1, source_duration_ms - tail_keep)

        path = out_dir / f"run-{index}.wav"
        frames = trim_and_normalise(
            source,
            path,
            start_ms=head_keep,
            end_ms=end_ms,
        )
        duration_ms = frames_to_ms(frames)

        return ProcessedRun(
            index=index,
            path=path,
            duration_ms=duration_ms,
            head_trim_ms=head_keep,
            source_duration_ms=source_duration_ms,
            words=_clamp_words(
                words, offset_ms=-head_keep, duration_ms=duration_ms
            ),
        )

    def assemble(
        self,
        runs: list[ProcessedRun],
        gaps_ms: list[int],
        *,
        out_dir: Path,
    ) -> StitchResult:
        if len(gaps_ms) != len(runs):
            raise AudioError("gaps_ms must align with runs")
        if not runs:
            raise AudioError("nothing to stitch")

        master: array = array("h")
        fade_frames = ms_to_frames(self.fade_ms)

        for index, run in enumerate(runs):
            gap_frames = ms_to_frames(gaps_ms[index])
            if gap_frames:
                master.extend(array("h", bytes(gap_frames * 2)))
            run.start_ms = frames_to_ms(len(master))

            samples = read_wav(run.path)
            fade_edges(samples, fade_frames)
            master.extend(samples)

        master_wav = out_dir / "master.wav"
        master_mp3 = out_dir / "master.mp3"
        write_wav(master_wav, master)
        # The program stage rewrites master.wav in place, frame for frame: the
        # per-run starts below were computed from this exact sample count, so a
        # single added or removed frame would desync every caption.
        master_gain = master_program(master_wav)
        encode_mp3(master_wav, master_mp3)

        return StitchResult(
            master_wav=master_wav,
            master_mp3=master_mp3,
            runs=runs,
            gaps_ms=gaps_ms,
            total_duration_ms=frames_to_ms(len(master)),
            master=master_gain,
        )
