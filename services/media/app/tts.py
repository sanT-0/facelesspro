from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import edge_tts

from .models import WordTiming

TICKS_PER_MS = 10_000


class TTSError(RuntimeError):
    """The engine could not produce usable audio."""


@dataclass(slots=True)
class Synthesis:
    audio: bytes
    words: list[WordTiming]
    duration_ms: int


class TTSEngine(Protocol):
    async def synthesize(self, text: str, voice: str) -> Synthesis: ...


class EdgeTTSEngine:
    """Free Microsoft Edge neural voices. No API key."""

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")

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
