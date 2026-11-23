from __future__ import annotations

import asyncio
from typing import ClassVar

import pytest

import app.tts as tts_module
from app.tts import EdgeTTSEngine, Synthesis


class _FakeCommunicate:
    """Stands in for `edge_tts.Communicate` so the kwargs are observable."""

    instances: ClassVar[list[_FakeCommunicate]] = []

    def __init__(self, text: str, voice: str, **kwargs: object) -> None:
        self.text = text
        self.voice = voice
        self.kwargs = kwargs
        _FakeCommunicate.instances.append(self)

    async def stream(self):
        yield {"type": "audio", "data": b"RIFFaudio"}
        yield {
            "type": "WordBoundary",
            "text": "hello",
            "offset": 10_000,
            "duration": 50_000,
        }


def run(coro):
    return asyncio.run(coro)


def test_default_voice_sends_no_pitch(monkeypatch: pytest.MonkeyPatch) -> None:
    _FakeCommunicate.instances = []
    monkeypatch.setattr(tts_module.edge_tts, "Communicate", _FakeCommunicate)

    synthesis = run(EdgeTTSEngine().synthesize("hello", "en-IN-NeerjaNeural"))

    assert isinstance(synthesis, Synthesis)
    assert _FakeCommunicate.instances[0].kwargs.get("pitch") is None


def test_pitch_is_percent_of_the_natural_voice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _FakeCommunicate.instances = []
    monkeypatch.setattr(tts_module.edge_tts, "Communicate", _FakeCommunicate)

    run(EdgeTTSEngine().synthesize("hello", "en-IN-NeerjaNeural", pitch_percent=50))
    run(EdgeTTSEngine().synthesize("hello", "en-IN-NeerjaNeural", pitch_percent=-100))

    assert _FakeCommunicate.instances[0].kwargs["pitch"] == "+50%"
    assert _FakeCommunicate.instances[1].kwargs["pitch"] == "-100%"


def test_zero_pitch_is_the_same_request_as_no_pitch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _FakeCommunicate.instances = []
    monkeypatch.setattr(tts_module.edge_tts, "Communicate", _FakeCommunicate)

    run(EdgeTTSEngine().synthesize("hello", "en-IN-NeerjaNeural", pitch_percent=0))

    assert "pitch" not in _FakeCommunicate.instances[0].kwargs
