from __future__ import annotations

from pydantic import BaseModel, Field

# e.g. ta-IN-PallaviNeural, en-IN-NeerjaNeural, en-US-AvaMultilingualNeural
VOICE_PATTERN = r"^[a-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9]+Neural$"


class SegmentRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5_000)
    voice: str = Field(pattern=VOICE_PATTERN)


class SynthesizeRequest(BaseModel):
    segments: list[SegmentRequest] = Field(min_length=1, max_length=500)
    gap_ms: int = Field(default=150, ge=0, le=2_000)


class WordTiming(BaseModel):
    text: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class SegmentResult(BaseModel):
    index: int
    voice: str
    audio_path: str
    duration_ms: int
    words: list[WordTiming]


class SynthesizeResponse(BaseModel):
    request_id: str
    segments: list[SegmentResult]
    total_duration_ms: int
