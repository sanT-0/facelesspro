from __future__ import annotations

import asyncio
from typing import Any, ClassVar

import pytest

from app.azure_tts import AzureConfigurationError, AzureTTSEngine
from app.tts import TTSError

TICKS_PER_MS = 10_000


class _Boundary:
    def __init__(self) -> None:
        self.handlers: list[Any] = []

    def connect(self, handler: Any) -> None:
        self.handlers.append(handler)


class _Event:
    def __init__(
        self,
        text: str,
        offset_ms: int,
        duration_ms: int,
        *,
        kind: str = "Word",
    ) -> None:
        self.text = text
        self.audio_offset = offset_ms * TICKS_PER_MS
        self.duration = duration_ms * TICKS_PER_MS
        self.boundary_type = kind


class _Details:
    def __init__(self, reason: str, error_details: str = "") -> None:
        self.reason = reason
        self.error_details = error_details


class _Result:
    def __init__(
        self,
        reason: str,
        *,
        audio: bytes = b"mp3",
        details: _Details | None = None,
    ) -> None:
        self.reason = reason
        self.audio_data = audio
        self.cancellation_details = details


class _Config:
    events: ClassVar[list[_Event]] = []
    result: ClassVar[_Result] = _Result("Completed")

    def __init__(self, *, subscription: str, region: str) -> None:
        self.subscription = subscription
        self.region = region
        self.output_format: str | None = None

    def set_speech_synthesis_output_format(self, value: str) -> None:
        self.output_format = value


class _Future:
    """The SDK returns a future whose `.get()` blocks; mirror that shape."""

    def __init__(self, result: _Result) -> None:
        self._result = result

    def get(self) -> _Result:
        return self._result


class _Synthesizer:
    instances: ClassVar[list[_Synthesizer]] = []

    def __init__(self, *, speech_config: _Config, audio_config: Any = None) -> None:
        self.config = speech_config
        self.audio_config = audio_config
        self.synthesis_word_boundary = _Boundary()
        self.ssml: str | None = None
        _Synthesizer.instances.append(self)

    def speak_ssml_async(self, ssml: str) -> _Future:
        self.ssml = ssml
        for event in self.config.events:
            for handler in self.synthesis_word_boundary.handlers:
                handler(event)
        return _Future(self.config.result)


class _Reason:
    Canceled = "Canceled"
    SynthesizingAudioCompleted = "Completed"


class _BoundaryType:
    Word = "Word"
    Punctuation = "Punctuation"
    Sentence = "Sentence"


class _OutputFormat:
    Audio24Khz96KBitRateMonoMp3 = "audio-24khz-96kbitrate-mono-mp3"


class _Sdk:
    SpeechConfig = _Config
    SpeechSynthesizer = _Synthesizer
    ResultReason = _Reason
    SpeechSynthesisBoundaryType = _BoundaryType
    SpeechSynthesisOutputFormat = _OutputFormat


@pytest.fixture(autouse=True)
def _reset_fake() -> None:
    _Config.events = []
    _Config.result = _Result("Completed")
    _Synthesizer.instances = []


def run(coro):
    return asyncio.run(coro)


def _engine() -> AzureTTSEngine:
    return AzureTTSEngine("secret", "southeastasia", sdk=_Sdk)


def test_synthesizes_ssml_and_converts_word_boundaries() -> None:
    _Config.events = [
        _Event("vanakkam", 0, 500),
        _Event(",", 500, 100, kind="Punctuation"),
        _Event("money", 600, 400),
    ]
    _Config.result = _Result("Completed", audio=b"mp3-bytes")

    synthesis = run(
        _engine().synthesize(
            "vanakkam, money",
            "ta-IN-ValluvarNeural",
            pitch_percent=25,
        )
    )

    assert synthesis.audio == b"mp3-bytes"
    assert [word.text for word in synthesis.words] == ["vanakkam", "money"]
    assert synthesis.words[0].start_ms == 0
    assert synthesis.words[0].end_ms == 500
    assert synthesis.words[1].start_ms == 600
    assert synthesis.words[1].end_ms == 1_000
    assert synthesis.duration_ms == 1_000

    synthesizer = _Synthesizer.instances[-1]
    assert synthesizer.ssml is not None
    assert "name='ta-IN-ValluvarNeural'" in synthesizer.ssml
    assert "xml:lang='ta-IN'" in synthesizer.ssml
    assert '<prosody pitch="+25%">' in synthesizer.ssml
    assert synthesizer.config.output_format == _OutputFormat.Audio24Khz96KBitRateMonoMp3


def test_ssml_escapes_author_text_and_omits_zero_pitch() -> None:
    _Config.events = [_Event("a", 0, 200), _Event("b", 200, 200), _Event("c", 400, 200)]
    run(_engine().synthesize("a & b < c", "ta-IN-PallaviNeural", pitch_percent=0))

    ssml = _Synthesizer.instances[-1].ssml
    assert ssml is not None
    assert "a &amp; b &lt; c" in ssml
    assert "<prosody" not in ssml


def test_overlapping_word_events_are_normalised() -> None:
    _Config.events = [
        _Event("first", 100, 500),
        _Event("second", 300, 100),
    ]

    synthesis = run(_engine().synthesize("first second", "ta-IN-ValluvarNeural"))

    first, second = synthesis.words
    assert first.start_ms == 100
    assert first.end_ms == 600
    assert second.start_ms == 600
    assert second.end_ms == 600
    assert first.end_ms <= second.start_ms


def test_cancelled_result_raises_with_the_provider_detail() -> None:
    _Config.result = _Result(
        "Canceled",
        audio=b"",
        details=_Details("Error", "401 Unauthorized"),
    )

    with pytest.raises(TTSError, match="401 Unauthorized"):
        run(_engine().synthesize("hello", "ta-IN-ValluvarNeural"))


def test_empty_audio_is_an_error() -> None:
    _Config.result = _Result("Completed", audio=b"")

    with pytest.raises(TTSError, match="no audio"):
        run(_engine().synthesize("hello", "ta-IN-ValluvarNeural"))


def test_missing_word_boundaries_is_an_error() -> None:
    with pytest.raises(TTSError, match="no word boundaries"):
        run(_engine().synthesize("hello", "ta-IN-ValluvarNeural"))


def test_credentials_are_required() -> None:
    with pytest.raises(AzureConfigurationError):
        AzureTTSEngine("", "southeastasia", sdk=_Sdk)
    with pytest.raises(AzureConfigurationError):
        AzureTTSEngine("secret", "", sdk=_Sdk)
