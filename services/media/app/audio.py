"""Thin, auditable wrappers around ffmpeg/ffprobe.

Everything here is deterministic and offline. The only intelligence is:
trim silence to the documented threshold, normalise each run to a fixed
loudness, and hand back sample-exact PCM so the timeline and the audio agree.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 48_000
CHANNELS = 1
SAMPLE_WIDTH = 2

TRIM_THRESHOLD_DB = -45
HEADROOM_MS = 20
FADE_MS = 5

TARGET_LUFS = -16.0
TRUE_PEAK_DBTP = -1.5

# A sample-domain ceiling of exactly `TRUE_PEAK_DBTP` still leaves inter-sample
# peaks a few hundredths of a dB above the target, so the limiter aims this much
# lower. Measured on the listening-gate clips: -1.5 dBFS ceiling → -1.45 dBTP,
# -1.6 dBFS ceiling → -1.52 dBTP.
LIMITER_MARGIN_DB = 0.1
LIMITER_ATTACK_MS = 5.0
LIMITER_RELEASE_MS = 50.0

# Provider-internal pauses. edge-tts's Tamil voice leaves 60-150 ms of silence
# between words inside one run; at ~117 wpm that reads as word-by-word delivery
# (measured on the listening-gate clip: 14 pauses in 10.3 s, 2.6 s in total).
# Cutting those to 2 x 25 ms is the fix; `keep_ms` is the guard that stops the
# splice from touching a consonant onset.
PAUSE_THRESHOLD_DB = -35
PAUSE_MIN_MS = 60
PAUSE_MAX_MS = 250
PAUSE_KEEP_MS = 25
# A silence this close to a file edge belongs to the leading/trailing trim.
EDGE_WINDOW_MS = 20

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

_SILENCE_START = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_SILENCE_END = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


class AudioError(RuntimeError):
    """ffmpeg could not produce the audio we need."""


def _run(args: list[str], *, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise AudioError(f"ffmpeg timed out after {timeout}s: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip().splitlines()
        tail = " | ".join(detail[-3:]) if detail else "no stderr"
        raise AudioError(f"{args[0]} failed: {tail}") from exc


def _stderr(args: list[str], *, timeout: int = 180) -> str:
    """Run a filter-only ffmpeg pass (no output file) and return its log."""
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise AudioError(f"ffmpeg timed out after {timeout}s: {args[0]}") from exc
    if result.returncode != 0:
        tail = (result.stderr or "").strip().splitlines()[-3:]
        raise AudioError(
            f"{args[0]} failed: {' | '.join(tail) if tail else 'no stderr'}"
        )
    return result.stderr


def probe_duration_ms(path: Path) -> int:
    result = _run(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ]
    )
    try:
        duration_s = float(json.loads(result.stdout)["format"]["duration"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AudioError(f"no duration for {path.name}") from exc
    return round(duration_s * 1000)


def detect_silence(path: Path, *, threshold_db: int = TRIM_THRESHOLD_DB) -> tuple[int, int]:
    """Return `(lead_ms, tail_ms)` silence at the edges of the file."""
    duration_ms = probe_duration_ms(path)
    if duration_ms <= 0:
        return 0, 0

    log = _stderr(
        [
            FFMPEG,
            "-hide_banner",
            "-nostdin",
            "-v",
            "info",
            "-i",
            str(path),
            "-af",
            f"silencedetect=noise={threshold_db}dB:d=0.05",
            "-f",
            "null",
            "-",
        ]
    )
    starts = [float(value) * 1000 for value in _SILENCE_START.findall(log)]
    ends = [float(value) * 1000 for value in _SILENCE_END.findall(log)]
    if not starts:
        return 0, 0

    # A file that is silent end to end is not "all silence to trim": keeping it
    # avoids zero-length audio, which downstream stages cannot render.
    if len(starts) == 1 and ends and ends[0] >= duration_ms - 20:
        return 0, 0

    lead = round(ends[0]) if starts[0] <= 1 and ends else 0
    # Trailing silence is the final interval when it reaches the end of the
    # file; a silence in the middle of a run must not be mistaken for it.
    trailing = len(ends) < len(starts) or (
        bool(ends) and ends[-1] >= duration_ms - 20
    )
    tail = round(duration_ms - starts[-1]) if trailing and starts[-1] > 1 else 0

    lead = max(0, min(lead, duration_ms))
    tail = max(0, min(tail, duration_ms - lead))
    return lead, tail


@dataclass(frozen=True, slots=True)
class PauseCut:
    """A slice removed from *inside* a run, in milliseconds of the cut file."""

    start_ms: int
    end_ms: int

    @property
    def removed_ms(self) -> int:
        return self.end_ms - self.start_ms


def detect_silence_intervals(
    path: Path,
    *,
    threshold_db: float = PAUSE_THRESHOLD_DB,
    min_ms: int = PAUSE_MIN_MS,
) -> list[tuple[int, int]]:
    """Silence *inside* the file, in ms. Leading and trailing silence excluded.

    The edges are excluded because trimming owns them; this exists only for the
    pauses a provider leaves between words, which the run-level trim cannot see.
    """
    duration_ms = probe_duration_ms(path)
    if duration_ms <= 0:
        return []

    log = _stderr(
        [
            FFMPEG,
            "-hide_banner",
            "-nostdin",
            "-v",
            "info",
            "-i",
            str(path),
            "-af",
            f"silencedetect=noise={threshold_db}dB:d={min_ms / 1000:.3f}",
            "-f",
            "null",
            "-",
        ]
    )
    starts = [float(value) * 1000 for value in _SILENCE_START.findall(log)]
    ends = [float(value) * 1000 for value in _SILENCE_END.findall(log)]

    intervals: list[tuple[int, int]] = []
    for start, end in zip(starts, ends, strict=False):
        # A window that touches either edge is the trim's business, and a
        # zero-length one cannot be cut without inventing frames.
        if start <= EDGE_WINDOW_MS or end >= duration_ms - EDGE_WINDOW_MS:
            continue
        if end - start >= min_ms:
            intervals.append((round(start), round(end)))
    return intervals


def compress_pauses(
    path: Path,
    *,
    threshold_db: float = PAUSE_THRESHOLD_DB,
    min_ms: int = PAUSE_MIN_MS,
    max_ms: int = PAUSE_MAX_MS,
    keep_ms: int = PAUSE_KEEP_MS,
) -> tuple[list[PauseCut], int]:
    """Shorten provider-internal pauses in place; return the cuts and the frames.

    Every silence in `[min_ms, max_ms]` is reduced to `2 * keep_ms`, keeping
    `keep_ms` at each side so a consonant's onset is never clipped. Longer
    silences are left alone: inside a run they are sentence breaks, and the
    listener needs those. The PCM outside a cut is copied verbatim, so the only
    claim this makes is "silence is shorter", not "audio is better".

    Returns the removed intervals in the coordinates of the file *before* the
    cut, which is what lets `Stitcher` move word timings by exactly as much as
    the audio moved.
    """
    intervals = detect_silence_intervals(
        path, threshold_db=threshold_db, min_ms=min_ms
    )
    cuts: list[PauseCut] = []
    for start_ms, end_ms in intervals:
        if end_ms - start_ms > max_ms:
            continue
        start_frame = ms_to_frames(start_ms + keep_ms)
        end_frame = ms_to_frames(end_ms - keep_ms)
        if end_frame <= start_frame:
            continue
        cuts.append(
            PauseCut(
                start_ms=frames_to_ms(start_frame),
                end_ms=frames_to_ms(end_frame),
            )
        )

    if not cuts:
        return [], len(read_wav(path))

    samples = read_wav(path)
    kept: array = array("h")
    cursor = 0
    for cut in cuts:
        start_frame = ms_to_frames(cut.start_ms)
        end_frame = ms_to_frames(cut.end_ms)
        kept.extend(samples[cursor:start_frame])
        cursor = end_frame
    kept.extend(samples[cursor:])
    write_wav(path, kept)
    return cuts, len(kept)


def _loudnorm_measurement(filter_chain: str, path: Path) -> dict[str, str] | None:
    log = _stderr(
        [
            FFMPEG,
            "-hide_banner",
            "-nostdin",
            "-v",
            "info",
            "-i",
            str(path),
            "-af",
            filter_chain,
            "-f",
            "null",
            "-",
        ]
    )
    start = log.rfind("{")
    end = log.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        payload = json.loads(log[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    return {str(key): str(value) for key, value in payload.items()}


def _is_silent(measurement: dict[str, str] | None) -> bool:
    if measurement is None:
        return True
    value = measurement.get("input_i", "-inf")
    try:
        return float(value) <= -70.0
    except ValueError:
        return True


def trim_and_normalise(
    src: Path,
    dst: Path,
    *,
    start_ms: int,
    end_ms: int,
    target_lufs: float = TARGET_LUFS,
    true_peak: float = TRUE_PEAK_DBTP,
) -> int:
    """Trim to `[start_ms, end_ms]`, normalise, write 48 kHz mono PCM WAV.

    Returns the exact number of frames written. Loudness is measured on the
    *trimmed* run (pass 1) and applied linearly (pass 2), so silence at the edges
    cannot drag the gain around, and the sample count never changes.
    """
    if end_ms <= start_ms:
        raise AudioError("trim window is empty")

    trim = (
        f"atrim=start={start_ms / 1000:.3f}:end={end_ms / 1000:.3f},"
        "asetpts=PTS-STARTPTS,"
        f"aresample={SAMPLE_RATE}"
    )
    loudnorm = f"loudnorm=I={target_lufs}:TP={true_peak}:LRA=11"

    measurement = _loudnorm_measurement(
        f"{trim},{loudnorm}:print_format=json", src
    )

    filters = f"{trim},aformat=sample_fmts=s16:channel_layouts=mono"
    if not _is_silent(measurement):
        if measurement is None:  # pragma: no cover - _is_silent covers this
            raise AudioError("loudness measurement disappeared")
        filters += (
            f",{loudnorm}"
            f":measured_I={measurement['input_i']}"
            f":measured_TP={measurement['input_tp']}"
            f":measured_LRA={measurement['input_lra']}"
            f":measured_thresh={measurement['input_thresh']}"
            f":offset={measurement['target_offset']}"
            ":linear=true"
        )

    _run(
        [
            FFMPEG,
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-i",
            str(src),
            "-af",
            filters,
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            str(CHANNELS),
            "-c:a",
            "pcm_s16le",
            str(dst),
        ]
    )

    frames = wav_frames(dst)
    if frames == 0:
        raise AudioError("trim produced an empty file")
    return frames


@dataclass(slots=True)
class MasterGain:
    """What the master stage did, for the timeline and the tests."""

    gain_db: float
    limited: bool
    before_lufs: float
    before_dbtp: float


def _apply_filters(path: Path, filters: str, *, frames: int) -> None:
    """Rewrite `path` in place, refusing if the frame count moved."""
    tmp = path.with_name(f"{path.stem}.master{path.suffix}")
    _run(
        [
            FFMPEG,
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-i",
            str(path),
            "-af",
            filters,
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            str(CHANNELS),
            "-c:a",
            "pcm_s16le",
            str(tmp),
        ]
    )

    mastered = wav_frames(tmp)
    if mastered != frames:
        tmp.unlink(missing_ok=True)
        raise AudioError(
            f"master stage changed the frame count ({frames} -> {mastered})"
        )
    tmp.replace(path)


def _measure_program(
    path: Path, *, target_lufs: float, true_peak: float
) -> tuple[float, float] | None:
    measurement = _loudnorm_measurement(
        f"loudnorm=I={target_lufs}:TP={true_peak}:LRA=11:print_format=json", path
    )
    if _is_silent(measurement):
        return None
    if measurement is None:  # pragma: no cover - _is_silent covers this
        raise AudioError("master loudness measurement disappeared")
    return float(measurement["input_i"]), float(measurement["input_tp"])


def master_program(
    path: Path,
    *,
    target_lufs: float = TARGET_LUFS,
    true_peak: float = TRUE_PEAK_DBTP,
) -> MasterGain:
    """Bring the assembled program to `target_lufs` without moving a single frame.

    Per-run normalisation is peak-bound: every run lands at `true_peak` and the
    short ones end up 2-3 LU below target, so the program inherits both the
    quiet runs and the gaps. This stage fixes the program as a whole.

    Gain alone is not always enough. `alimiter` with `latency=true` compensates
    its own lookahead, so the frame count and the position of every sample are
    unchanged — that is the only reason it is allowed here.

    The limiter works on samples; the delivery ceiling is a *true* peak, so the
    result is measured again and, if inter-sample peaks still poke through, a
    plain gain trim closes the gap. That pass cannot move a frame either.
    """
    frames = wav_frames(path)
    if frames == 0:
        raise AudioError("cannot master an empty file")

    before = _measure_program(path, target_lufs=target_lufs, true_peak=true_peak)
    if before is None:
        return MasterGain(0.0, False, float("-inf"), float("-inf"))

    before_lufs, before_dbtp = before
    gain_db = target_lufs - before_lufs
    limited = before_dbtp + gain_db > true_peak

    if abs(gain_db) < 0.05 and not limited:
        return MasterGain(gain_db, False, before_lufs, before_dbtp)

    filters = f"volume={gain_db:.3f}dB"
    if limited:
        ceiling = 10 ** ((true_peak - LIMITER_MARGIN_DB) / 20)
        filters += (
            f",alimiter=limit={ceiling:.6f}"
            f":attack={LIMITER_ATTACK_MS}:release={LIMITER_RELEASE_MS}"
            ":level=false:latency=true"
        )
    _apply_filters(path, filters, frames=frames)

    applied_db = gain_db
    for _ in range(2):
        after = _measure_program(path, target_lufs=target_lufs, true_peak=true_peak)
        if after is None:  # pragma: no cover - the file was audible a moment ago
            break
        overshoot = after[1] - true_peak
        if overshoot <= 0.0:
            break
        trim_db = -(overshoot + LIMITER_MARGIN_DB)
        _apply_filters(path, f"volume={trim_db:.3f}dB", frames=frames)
        applied_db += trim_db

    return MasterGain(applied_db, limited, before_lufs, before_dbtp)


def wav_frames(path: Path) -> int:
    with wave.open(str(path), "rb") as handle:
        if handle.getsampwidth() != SAMPLE_WIDTH:
            raise AudioError(f"{path.name} is not 16-bit PCM")
        if handle.getframerate() != SAMPLE_RATE or handle.getnchannels() != CHANNELS:
            raise AudioError(f"{path.name} is not {SAMPLE_RATE} Hz mono")
        return handle.getnframes()


def read_wav(path: Path) -> array:
    with wave.open(str(path), "rb") as handle:
        samples = array("h")
        samples.frombytes(handle.readframes(handle.getnframes()))
    if samples.itemsize != SAMPLE_WIDTH:
        raise AudioError("unexpected sample width")
    return samples


def write_wav(path: Path, samples: array) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(CHANNELS)
        handle.setsampwidth(SAMPLE_WIDTH)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(samples.tobytes())


def ms_to_frames(ms: int) -> int:
    return round(ms * SAMPLE_RATE / 1000)


def frames_to_ms(frames: int) -> int:
    return round(frames * 1000 / SAMPLE_RATE)


def fade_edges(samples: array, fade_frames: int) -> None:
    """Equal-power fade in/out, in place, so joins never click."""
    total = len(samples)
    fade = min(fade_frames, total // 2)
    if fade <= 0:
        return
    for index in range(fade):
        gain = _sin_half((index + 0.5) / fade)
        samples[index] = int(samples[index] * gain)
        mirror = total - 1 - index
        samples[mirror] = int(samples[mirror] * gain)


def _sin_half(phase: float) -> float:
    return math.sin(math.pi / 2 * min(max(phase, 0.0), 1.0))


def encode_mp3(wav_path: Path, mp3_path: Path, *, bitrate: str = "192k") -> None:
    _run(
        [
            FFMPEG,
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-i",
            str(wav_path),
            "-c:a",
            "libmp3lame",
            "-b:a",
            bitrate,
            str(mp3_path),
        ]
    )
