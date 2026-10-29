"""Stitch synthesised runs into one master track with an exact timeline.

The one rule that matters: `global = run.start_ms + word.local_ms`. Captions are
generated from that sum, so every millisecond removed by trimming — or by
compressing a provider-internal pause — has to be subtracted from the words, and
every sample inserted as a gap has to be visible in `run.start_ms`. The audio
and the timeline are built from the same frame counters, so they cannot drift.

Cross-fades are 5 ms and equal-power. They sit *inside* the pause, so they kill
the cut click without smearing the first or last consonant of a run.

Pause compression is not cosmetic: edge-tts's Tamil voice puts 60-150 ms of
silence between words *inside* a run, which is why the first listening gate
failed with "words are separated". It shortens those and leaves sentence pauses
alone; see `audio.compress_pauses` for the boundaries and the guard.
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
    PauseCut,
    compress_pauses,
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
    pause_cuts: list[PauseCut] = field(default_factory=list)

    @property
    def pause_removed_ms(self) -> int:
        return sum(cut.removed_ms for cut in self.pause_cuts)


@dataclass(slots=True)
class StitchResult:
    master_wav: Path
    master_mp3: Path
    runs: list[ProcessedRun]
    gaps_ms: list[int] = field(default_factory=list)
    total_duration_ms: int = 0
    master: MasterGain | None = None


def _compact(ms: int, cuts: list[PauseCut]) -> int:
    """Where `ms` lands once every cut starting before it has been removed.

    Monotonic in `ms`, and a time inside a cut collapses to the cut's start,
    which is exactly where that audio now sits.
    """
    shift = 0
    for cut in cuts:
        if ms <= cut.start_ms:
            break
        shift += min(ms, cut.end_ms) - cut.start_ms
    return ms - shift


def _shift_words(
    words: list[WordTiming],
    *,
    head_trim_ms: int,
    cuts: list[PauseCut],
    duration_ms: int,
) -> list[WordTiming]:
    """Rebase words onto the processed run: head trim first, then every pause cut."""
    adjusted: list[WordTiming] = []
    for word in words:
        start = _compact(word.start_ms - head_trim_ms, cuts)
        end = _compact(word.end_ms - head_trim_ms, cuts)
        start = min(max(start, 0), max(duration_ms - 1, 0))
        end = min(max(end, start + 1), duration_ms)
        adjusted.append(WordTiming(text=word.text, start_ms=start, end_ms=end))
    return adjusted


class Stitcher:
    def __init__(
        self,
        *,
        headroom_ms: int = HEADROOM_MS,
        fade_ms: int = FADE_MS,
        pause_compression: bool = True,
    ) -> None:
        self.headroom_ms = headroom_ms
        self.fade_ms = fade_ms
        self.pause_compression = pause_compression


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

        # The trim normalises first, so the pause cut edits audio that already
        # sits at the delivery level; removing silence moves neither LUFS nor
        # peak. The cuts are returned in pre-cut coordinates, which is what the
        # word arithmetic below needs.
        cuts: list[PauseCut] = []
        if self.pause_compression:
            cuts, frames = compress_pauses(path)

        duration_ms = frames_to_ms(frames)

        return ProcessedRun(
            index=index,
            path=path,
            duration_ms=duration_ms,
            head_trim_ms=head_keep,
            source_duration_ms=source_duration_ms,
            words=_shift_words(
                words,
                head_trim_ms=head_keep,
                cuts=cuts,
                duration_ms=duration_ms,
            ),
            pause_cuts=cuts,
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
