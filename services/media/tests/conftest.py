from __future__ import annotations

import io
import json
import math
import subprocess
import wave
from array import array
from collections.abc import Callable
from pathlib import Path

import pytest


def make_tone_wav(
    duration_ms: int,
    *,
    lead_ms: int = 150,
    tail_ms: int = 150,
    freq: int = 320,
    sample_rate: int = 24_000,
) -> bytes:
    """A valid mono WAV with real silence at both ends.

    The provider gives us mp3 with silence around the speech; tests need the same
    shape or the trim/normalise path would never run.
    """
    total = round(duration_ms * sample_rate / 1000)
    lead = min(round(lead_ms * sample_rate / 1000), total // 3)
    tail = min(round(tail_ms * sample_rate / 1000), total // 3)
    samples = array("h", [0]) * total
    for index in range(lead, total - tail):
        samples[index] = int(12_000 * math.sin(2 * math.pi * freq * index / sample_rate))

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(samples.tobytes())
    return buffer.getvalue()


def make_gapped_wav(
    *,
    burst_ms: int = 300,
    pauses_ms: tuple[int, ...] = (150,),
    lead_ms: int = 150,
    tail_ms: int = 150,
    freq: int = 320,
    sample_rate: int = 48_000,
) -> bytes:
    """Tone bursts separated by real silence, at 48 kHz mono.

    This is the shape edge-tts's Tamil voice produces *inside* one run: words
    separated by 60-150 ms of silence that no run-level gap setting can reach.
    `len(pauses_ms) + 1` bursts, so the file starts and ends with speech.
    """
    bursts = len(pauses_ms) + 1
    total_ms = lead_ms + bursts * burst_ms + sum(pauses_ms) + tail_ms
    total = round(total_ms * sample_rate / 1000)
    samples = array("h", [0]) * total

    cursor = round(lead_ms * sample_rate / 1000)
    ramp = max(1, round(0.005 * sample_rate))  # 5 ms, so a burst has no step
    for index in range(bursts):
        length = round(burst_ms * sample_rate / 1000)
        for offset in range(length):
            phase = 2 * math.pi * freq * offset / sample_rate
            # A short ramp only at the edges: the level is full inside the
            # burst, so ffmpeg's silence detector sees the nominal pause length
            # rather than a slow fade.
            if offset < ramp:
                envelope = offset / ramp
            elif offset >= length - ramp:
                envelope = (length - 1 - offset) / ramp
            else:
                envelope = 1.0
            samples[cursor + offset] = int(12_000 * envelope * math.sin(phase))
        cursor += length
        if index < len(pauses_ms):
            cursor += round(pauses_ms[index] * sample_rate / 1000)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(samples.tobytes())
    return buffer.getvalue()


def make_peaky_wav(
    duration_ms: int = 1200,
    *,
    sample_rate: int = 48_000,
    bed: int = 4_800,
    spike_level: int = 20_000,
    spike_ms: float = 20.0,
    every_ms: int = 500,
) -> bytes:
    """A quiet bed with loud transients: the shape that forces real limiting.

    A sine has a ~3 dB crest factor and can always be normalised by gain alone.
    Speech cannot: edge-tts already ships near full scale, so a run needs 2-3 dB
    more level than its peaks allow. This stands in for that case, with peaks
    close enough to full scale that ~2 dB of limiting is needed — not so extreme
    that the limiter has to duck the bed.
    """
    total = round(duration_ms * sample_rate / 1000)
    samples = array("h", [0]) * total
    for index in range(total):
        samples[index] = int(bed * math.sin(2 * math.pi * 180 * index / sample_rate))

    spike = max(1, round(spike_ms * sample_rate / 1000))
    step = max(spike + 1, round(every_ms * sample_rate / 1000))
    for start in range(round(0.1 * sample_rate), total - spike, step):
        for offset in range(spike):
            # A windowed tone burst, not a step: a vertical edge would create
            # inter-sample peaks that no sample-domain limiter can see, which
            # real speech never does.
            envelope = math.sin(math.pi * (offset + 0.5) / spike) ** 2
            carrier = math.sin(2 * math.pi * 1_000 * offset / sample_rate)
            samples[start + offset] = int(spike_level * envelope * carrier)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(samples.tobytes())
    return buffer.getvalue()


def measure_loudness(path: Path) -> tuple[float, float]:
    """`(integrated_lufs, true_peak_dbtp)` exactly as the delivery gate measures."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-v",
            "info",
            "-i",
            str(path),
            "-af",
            "loudnorm=I=-16:TP=-1.5:print_format=json",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    log = result.stderr
    payload = json.loads(log[log.rfind("{") : log.rfind("}") + 1])
    return float(payload["input_i"]), float(payload["input_tp"])


@pytest.fixture
def tone_wav() -> Callable[..., bytes]:
    return make_tone_wav


@pytest.fixture
def gapped_wav() -> Callable[..., bytes]:
    return make_gapped_wav


@pytest.fixture
def peaky_wav() -> Callable[..., bytes]:
    return make_peaky_wav


@pytest.fixture
def loudness() -> Callable[[Path], tuple[float, float]]:
    return measure_loudness
