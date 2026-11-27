from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import edge_tts

from . import config
from .models import WordTiming

TICKS_PER_MS = 10_000


class TTSError(RuntimeError):
    """The engine could not produce usable audio."""


class TTSConfigurationError(RuntimeError):
    """No usable engine could be selected from the configured chain."""


@dataclass(slots=True)
class Synthesis:
    audio: bytes
    words: list[WordTiming]
    duration_ms: int


class TTSEngine(Protocol):
    async def synthesize(
        self,
        text: str,
        voice: str,
        *,
        pitch_percent: int | None = None,
    ) -> Synthesis: ...


class EdgeTTSEngine:
    """Free Microsoft Edge neural voices. No API key, not licensed for public use."""

    # Part of the cache key. Changing it is how a future adapter that sounds
    # different avoids reusing these entries.
    name = "edge"
    licensed = False

    async def synthesize(
        self,
        text: str,
        voice: str,
        *,
        pitch_percent: int | None = None,
    ) -> Synthesis:
        # Edge speaks percent ("+25%") or hertz ("+10Hz"). Percent keeps the
        # shift relative to whatever fundamental the chosen voice has, which is
        # what a 50–180 slider means.
        options: dict[str, str] = {}
        if pitch_percent is not None and pitch_percent != 0:
            options["pitch"] = f"{pitch_percent:+d}%"

        communicate = edge_tts.Communicate(
            text, voice, boundary="WordBoundary", **options
        )

        audio = bytearray()
        words: list[WordTiming] = []

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start_ms = int(chunk["offset"]) // TICKS_PER_MS
                duration_ms = int(chunk["duration"]) // TICKS_PER_MS
                words.append(
                    WordTiming(
                        text=str(chunk["text"]),
                        start_ms=start_ms,
                        end_ms=start_ms + duration_ms,
                    )
                )

        if not audio:
            raise TTSError(f"no audio returned for voice {voice}")
        if not words:
            raise TTSError(f"no word boundaries returned for voice {voice}")

        return Synthesis(
            audio=bytes(audio),
            words=words,
            duration_ms=words[-1].end_ms,
        )


def build_tts_engine(
    *,
    chain: str | None = None,
    require_licensed: bool | None = None,
    azure_key: str | None = None,
    azure_region: str | None = None,
) -> TTSEngine:
    """Select the first engine in `TTS` that can start.

    `edge` is skipped when `TTS_REQUIRE_LICENSED=1`, which is what makes a public
    deployment fail closed instead of silently shipping the unlicensed engine.
    Unimplemented adapters (`indicf5`, `piper`) are skipped, not fatal, so the
    documented chain keeps working as they land.
    """
    raw_chain = config.TTS if chain is None else chain
    require = (
        config.TTS_REQUIRE_LICENSED if require_licensed is None else require_licensed
    )
    key = config.AZURE_SPEECH_KEY if azure_key is None else azure_key
    region = config.AZURE_SPEECH_REGION if azure_region is None else azure_region

    names = [part.strip().lower() for part in raw_chain.split(",") if part.strip()]
    if not names:
        raise TTSConfigurationError("TTS is empty; set at least one engine")

    skipped: list[str] = []
    for name in names:
        if name == "edge":
            if require:
                skipped.append("edge (unlicensed)")
                continue
            return EdgeTTSEngine()
        if name == "azure":
            if key and region:
                # Imported lazily so edge-only installs need no Azure SDK.
                from .azure_tts import AzureTTSEngine

                return AzureTTSEngine(key, region)
            skipped.append("azure (AZURE_SPEECH_KEY/AZURE_SPEECH_REGION unset)")
            continue
        if name in {"indicf5", "piper"}:
            skipped.append(f"{name} (adapter not implemented)")
            continue
        raise TTSConfigurationError(
            f"unknown TTS engine {name!r} in TTS={raw_chain!r}"
        )

    detail = ", ".join(skipped) if skipped else "empty chain"
    if require:
        raise TTSConfigurationError(
            "TTS_REQUIRE_LICENSED=1 but no licensed engine could start: " + detail
        )
    raise TTSConfigurationError("no TTS engine could start: " + detail)
