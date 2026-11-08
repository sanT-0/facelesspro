from __future__ import annotations

from pydantic import BaseModel, Field

# e.g. ta-IN-PallaviNeural, en-IN-NeerjaNeural, en-US-AvaMultilingualNeural
VOICE_PATTERN = r"^[a-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9]+Neural$"


class SegmentRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5_000)
    voice: str = Field(pattern=VOICE_PATTERN)


class SynthesizeRequest(BaseModel):
    segments: list[SegmentRequest] = Field(min_length=1, max_length=500)
    # Explicit override for every join. When omitted, the gap comes from the
    # punctuation between runs (see `app/boundaries.py`).
    gap_ms: int | None = Field(default=None, ge=0, le=2_000)


class WordTiming(BaseModel):
    text: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class SegmentResult(BaseModel):
    index: int
    voice: str
    text: str
    audio_path: str
    # Exact position of this run in the master track. Captions rely on
    # `word.start_ms == start_ms + local_start`.
    start_ms: int = Field(ge=0)
    duration_ms: int = Field(ge=0)
    # Milliseconds removed from the head of the provider audio before the words
    # were rebased. Kept for debugging seams.
    head_trim_ms: int = Field(ge=0)
    words: list[WordTiming]


class SynthesizeResponse(BaseModel):
    request_id: str
    segments: list[SegmentResult]
    # The WAV is the frame-exact timing source; the MP3 is what the pipeline
    # stores as the narration asset.
    master_path: str
    master_mp3_path: str
    total_duration_ms: int = Field(ge=0)


class AsrSegment(BaseModel):
    text: str = Field(min_length=1)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    # A segment without usable word timings is dropped by the engine, not
    # shipped: captions depend on them.
    words: list[WordTiming] = Field(min_length=1)


class TranscribeResponse(BaseModel):
    request_id: str
    # ISO 639-1 code from the model (faster-whisper `info.language`).
    language: str = Field(min_length=1, max_length=8)
    duration_ms: int = Field(ge=0)
    text: str = Field(min_length=1)
    # Silence-only audio is a 502 at the engine, never an empty success.
    segments: list[AsrSegment] = Field(min_length=1)
