"""Azure AI Speech adapter: the licensed production TTS engine.

Why this exists: `edge-tts` speaks to Microsoft's consumer Read Aloud endpoint,
which is not a public API and is a launch blocker for any public deployment
(docs/11 §2). Azure AI Speech is the licensed service behind the same `ta-IN-*`
voice ids, so switching transport does not change the approved voice catalogue.

The adapter uses the official Speech SDK for real-time synthesis and
`WordBoundary` events. The SDK is imported lazily: an edge-only install and the
unit suite do not need the native package, and the tests inject a fake SDK.

Timing conversion: the SDK reports `audio_offset` and `duration` in ticks of
100 ns. `(ticks + 5_000) // 10_000` rounds to the nearest millisecond, matching
the documented SDK example. Word events are normalised so `start_ms` is
monotonic and no word overlaps the next — `create-captions` rejects overlaps.

The SDK is a proprietary Microsoft package, used under Azure terms; it is
recorded in `THIRD_PARTY_NOTICES.md`. The *service* is the paid, licensed part;
the Python package itself carries no fee.
"""

from __future__ import annotations

import asyncio
import html
from typing import Any

from .models import WordTiming
from .tts import Synthesis, TTSError

TICKS_PER_MS = 10_000


class AzureConfigurationError(RuntimeError):
    """The Azure adapter cannot start with the configured credentials."""


class AzureTTSEngine:
    """Real-time Azure Speech synthesis with exact word boundaries."""

    # Part of the cache key: Azure entries must not be served to edge runs.
    name = "azure"
    licensed = True

    def __init__(self, key: str, region: str, *, sdk: Any | None = None) -> None:
        if not key or not region:
            raise AzureConfigurationError(
                "AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are both required for TTS=azure"
            )
        if sdk is None:
            try:
                import azure.cognitiveservices.speech as speechsdk
            except ImportError as exc:  # pragma: no cover - install error path
                raise AzureConfigurationError(
                    "azure-cognitiveservices-speech is not installed; "
                    "install services/media/requirements.txt"
                ) from exc
            sdk = speechsdk
        self._sdk = sdk
        self._key = key
        self._region = region

    async def synthesize(
        self,
        text: str,
        voice: str,
        *,
        pitch_percent: int | None = None,
    ) -> Synthesis:
        # The SDK is synchronous; one thread per run keeps the FastAPI event loop
        # free while the websocket is open.
        return await asyncio.to_thread(
            self._synthesize, text, voice, pitch_percent
        )

    def _synthesize(
        self,
        text: str,
        voice: str,
        pitch_percent: int | None,
    ) -> Synthesis:
        sdk = self._sdk
        config = sdk.SpeechConfig(subscription=self._key, region=self._region)
        config.set_speech_synthesis_output_format(
            sdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3
        )
        synthesizer = sdk.SpeechSynthesizer(speech_config=config, audio_config=None)
        words: list[WordTiming] = []

        def on_boundary(event: Any) -> None:
            # Capture both Word and Punctuation boundaries so captions keep
            # commas, periods, question marks, etc. Sentence boundaries are
            # already handled by the gap logic in stitch.py.
            if event.boundary_type not in {
                sdk.SpeechSynthesisBoundaryType.Word,
                sdk.SpeechSynthesisBoundaryType.Punctuation,
            }:
                return
            label = str(getattr(event, "text", "") or "").strip()
            if not label:
                return
            start_ms = _ticks_to_ms(getattr(event, "audio_offset", 0))
            duration_ms = _ticks_to_ms(getattr(event, "duration", 0))
            words.append(
                WordTiming(
                    text=label,
                    start_ms=start_ms,
                    end_ms=start_ms + duration_ms,
                )
            )

        synthesizer.synthesis_word_boundary.connect(on_boundary)
        result = synthesizer.speak_ssml_async(
            _ssml(text, voice, pitch_percent)
        ).get()

        if result.reason == sdk.ResultReason.Canceled:
            details = result.cancellation_details
            reason = getattr(details, "reason", "unknown")
            error = str(getattr(details, "error_details", "") or "").strip()
            message = f"azure synthesis canceled ({reason})"
            if error:
                message = f"{message}: {error}"
            raise TTSError(message)

        audio = bytes(getattr(result, "audio_data", b"") or b"")
        if not audio:
            raise TTSError(f"no audio returned for voice {voice}")

        normalised = _normalise_words(words)
        if not normalised:
            raise TTSError(f"no word boundaries returned for voice {voice}")

        return Synthesis(
            audio=audio,
            words=normalised,
            duration_ms=normalised[-1].end_ms,
        )


def _ticks_to_ms(ticks: object) -> int:
    """100 ns ticks → nearest millisecond, never negative."""
    try:
        value = int(ticks)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return max(0, (value + TICKS_PER_MS // 2) // TICKS_PER_MS)


def _normalise_words(words: list[WordTiming]) -> list[WordTiming]:
    """Keep the provider order, but guarantee non-overlapping, valid spans."""
    normalised: list[WordTiming] = []
    previous_end = 0
    for word in words:
        start = max(word.start_ms, previous_end)
        end = max(word.end_ms, start)
        normalised.append(WordTiming(text=word.text, start_ms=start, end_ms=end))
        previous_end = end
    return normalised


def _ssml(text: str, voice: str, pitch_percent: int | None) -> str:
    escaped = html.escape(text, quote=False)
    body = escaped
    if pitch_percent is not None and pitch_percent != 0:
        body = f'<prosody pitch="{pitch_percent:+d}%">{escaped}</prosody>'
    return (
        f"<speak version='1.0' xml:lang='{_locale_of(voice)}' "
        "xmlns='http://www.w3.org/2001/10/synthesis'>"
        f"<voice name='{voice}'>{body}</voice></speak>"
    )


def _locale_of(voice: str) -> str:
    """`ta-IN-PallaviNeural` → `ta-IN`; unknown shapes fall back to `en-US`."""
    parts = voice.split("-")
    if len(parts) >= 2 and len(parts[0]) in {2, 3} and len(parts[1]) == 2:
        return f"{parts[0]}-{parts[1]}"
    return "en-US"
