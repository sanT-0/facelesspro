from __future__ import annotations

import asyncio
from typing import ClassVar

import pytest

import app.tts as tts_module
from app.tts import (
    EdgeTTSEngine,
    Synthesis,
    TTSConfigurationError,
    build_tts_engine,
)


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


def test_engine_chain_falls_back_to_edge_when_not_licensed() -> None:
    engine = build_tts_engine(
        chain="edge,azure,indicf5,piper",
        require_licensed=False,
        azure_key="",
        azure_region="",
    )

    assert isinstance(engine, EdgeTTSEngine)
    assert engine.licensed is False


def test_require_licensed_skips_edge_and_selects_azure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.azure_tts as azure_tts

    class _StubAzure:
        licensed = True

        def __init__(self, key: str, region: str) -> None:
            self.key = key
            self.region = region

    monkeypatch.setattr(azure_tts, "AzureTTSEngine", _StubAzure)

    engine = build_tts_engine(
        chain="edge,azure",
        require_licensed=True,
        azure_key="secret",
        azure_region="southeastasia",
    )

    assert isinstance(engine, _StubAzure)
    assert engine.key == "secret"
    assert engine.region == "southeastasia"


def test_require_licensed_without_azure_credentials_fails() -> None:
    with pytest.raises(TTSConfigurationError, match="no licensed engine"):
        build_tts_engine(
            chain="edge,azure",
            require_licensed=True,
            azure_key="",
            azure_region="",
        )


def test_unknown_engine_name_is_a_configuration_error() -> None:
    with pytest.raises(TTSConfigurationError, match="unknown TTS engine"):
        build_tts_engine(
            chain="nope,edge",
            require_licensed=False,
            azure_key="",
            azure_region="",
        )


def test_a_chain_with_no_available_engine_fails() -> None:
    with pytest.raises(TTSConfigurationError, match="no TTS engine"):
        build_tts_engine(
            chain="azure",
            require_licensed=False,
            azure_key="",
            azure_region="",
        )
