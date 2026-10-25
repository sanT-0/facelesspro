from __future__ import annotations

import os
from pathlib import Path

SERVICE_NAME = "stickman-media"
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

# Milliseconds of silence inserted between synthesized runs so that a voice
# change does not sound clipped.
DEFAULT_GAP_MS = 150
MAX_GAP_MS = 2_000
