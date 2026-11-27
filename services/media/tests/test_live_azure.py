"""Live Azure Speech test: the licensed production transport.

Opt-in only. It needs a real subscription, so it never runs in CI:

    RUN_LIVE=1 AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... \
        services/media/.venv/bin/python -m pytest services/media/tests/test_live_azure.py -q

If the variables are set and the SDK is missing, the import inside the test
fails instead of skipping: a live run must prove the real transport, not a stub.
"""

from __future__ import annotations

import asyncio
import os

import pytest

from app.azure_tts import AzureTTSEngine

LIVE = os.environ.get("RUN_LIVE") == "1"
KEY = os.environ.get("AZURE_SPEECH_KEY", "").strip()
REGION = os.environ.get("AZURE_SPEECH_REGION", "").strip()

pytestmark = pytest.mark.skipif(
    not (LIVE and KEY and REGION),
    reason="live Azure test; set RUN_LIVE=1, AZURE_SPEECH_KEY and AZURE_SPEECH_REGION",
)

MIXED = "vanakkam, இன்னைக்கு நாம பாக்கப் போறது the biggest mistake first-time freelancers make."


def test_azure_synthesises_mixed_tamil_english() -> None:
    # Fail loudly if a live run was requested without the SDK installed.
    import azure.cognitiveservices.speech  # noqa: F401

    engine = AzureTTSEngine(KEY, REGION)
    synthesis = asyncio.run(engine.synthesize(MIXED, "ta-IN-PallaviNeural"))

    assert len(synthesis.audio) > 1_000, "no MP3 payload"
    assert synthesis.words, "no WordBoundary events"

    starts = [word.start_ms for word in synthesis.words]
    assert starts == sorted(starts), "word starts must be monotonic"
    for previous, current in zip(synthesis.words, synthesis.words[1:], strict=False):
        assert previous.end_ms <= current.start_ms, "words must not overlap"

    # The last word must land inside a plausible clip length, not at zero.
    assert synthesis.words[-1].end_ms > 0
    assert synthesis.duration_ms == synthesis.words[-1].end_ms
