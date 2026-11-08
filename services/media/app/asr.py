"""ASR for voiceover intake (docs/04 §1b, docs/06 §1.4).

The first engine is faster-whisper local (rank 1); Cloudflare's hosted whisper
(rank 2, no local install) can join behind the same interface later. faster-
whisper is an optional import on purpose: its wheels lag new CPython releases,
and the service must still boot — a transcript request then fails with a 503
that names the missing package instead of crashing the process.

Word timings are absolute (global) milliseconds. The pipeline adds no offsets
to them, matching the synthesize response's rebased words.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from .models import WordTiming


class AsrError(Exception):
    """The engine ran but produced nothing usable (undecodable, no speech)."""


class AsrUnavailableError(AsrError):
    """The engine cannot run at all (package missing, model not loadable)."""


@dataclass
class AsrSegment:
    text: str
    start_ms: int
    end_ms: int
    words: list[WordTiming] = field(default_factory=list)


@dataclass
class Transcription:
    language: str
    duration_ms: int
    text: str
    segments: list[AsrSegment]


class AsrEngine:
    """`bytes in, transcript out`. Implementations must be awaitable."""

    async def transcribe(self, audio: bytes) -> Transcription:  # pragma: no cover
        raise NotImplementedError


class WhisperLocalEngine(AsrEngine):
    """faster-whisper, lazy-loaded, CPU int8, word timestamps on."""

    def __init__(self, model_name: str, *, cpu_threads: int = 4) -> None:
        self.model_name = model_name
        self.cpu_threads = cpu_threads
        self._model: object | None = None

    def _load(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise AsrUnavailableError(
                    "faster-whisper is not installed on this interpreter; "
                    "install it (pip install faster-whisper) or set ASR= to "
                    "another engine"
                ) from exc
            try:
                self._model = WhisperModel(
                    self.model_name,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=self.cpu_threads,
                )
            except Exception as exc:
                raise AsrUnavailableError(
                    f"could not load whisper model {self.model_name!r}: {exc}"
                ) from exc
        return self._model

    def _run(self, audio: bytes) -> Transcription:
        model = self._load()
        try:
            segments_iter, info = model.transcribe(
                audio,
                word_timestamps=True,
                vad_filter=True,
            )
            raw = list(segments_iter)
        except AsrError:
            raise
        except Exception as exc:
            raise AsrError(f"whisper failed to decode the audio: {exc}") from exc

        segments: list[AsrSegment] = []
        texts: list[str] = []
        for segment in raw:
            words = [
                WordTiming(
                    text=word.word.strip(),
                    start_ms=round(word.start * 1000),
                    end_ms=round(word.end * 1000),
                )
                for word in (segment.words or [])
                if word.word.strip()
            ]
            if not words:
                # A span without word timings cannot carry captions.
                continue
            segments.append(
                AsrSegment(
                    text=segment.text.strip(),
                    start_ms=round(segment.start * 1000),
                    end_ms=round(segment.end * 1000),
                    words=words,
                )
            )
            texts.append(segment.text.strip())

        if not segments:
            raise AsrError("no speech detected in the uploaded audio")

        return Transcription(
            language=info.language or "unknown",
            duration_ms=round((info.duration or 0) * 1000),
            text=" ".join(texts),
            segments=segments,
        )

    async def transcribe(self, audio: bytes) -> Transcription:
        # The model call is CPU-bound and slow (seconds per minute of audio);
        # keep it off the event loop so /health stays responsive.
        return await asyncio.to_thread(self._run, audio)
