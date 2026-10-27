from __future__ import annotations

import os
from pathlib import Path

SERVICE_NAME = "facelesspro-media"
SERVICE_VERSION = "0.1.0"

# Files are written here and picked up by the Node worker through a shared
# volume. Overridable for tests and container deployments.
DATA_DIR = Path(
    os.environ.get(
        "MEDIA_DATA_DIR",
        Path(__file__).resolve().parent.parent / ".data",
    )
).resolve()

TTS_DIR = DATA_DIR / "tts"

# Per-run synthesis cache: `(engine, voice, text)` → raw provider audio + words.
# It stores audio *before* trimming, so stitch settings can change without
# invalidating it.
TTS_CACHE_DIR = Path(os.environ.get("TTS_CACHE_DIR", DATA_DIR / "cache")).resolve()
TTS_CACHE_ENABLED = os.environ.get("TTS_CACHE", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
TTS_CACHE_MAX_MB = int(os.environ.get("TTS_CACHE_MAX_MB", "2048"))

# Shorten provider-internal word pauses (60-250 ms) to 2 x 25 ms. On by default:
# the free Tamil voice inserts them and they are what "words are separated"
# sounds like. Set to 0 to reproduce the raw provider delivery.
TTS_PAUSE_COMPRESSION = os.environ.get("TTS_PAUSE_COMPRESSION", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

# Milliseconds of silence inserted between synthesized runs so that a voice
# change does not sound clipped.
DEFAULT_GAP_MS = 150
MAX_GAP_MS = 2_000
