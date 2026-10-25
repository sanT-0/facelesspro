from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException

from . import __version__
from .config import DEFAULT_GAP_MS, SERVICE_NAME, TTS_DIR
from .models import (
    SegmentResult,
    SynthesizeRequest,
    SynthesizeResponse,
    WordTiming,
)
from .tts import EdgeTTSEngine, TTSError, TTSEngine


def create_app(
    engine: TTSEngine | None = None,
    data_dir: Path | None = None,
) -> FastAPI:
    app = FastAPI(title=SERVICE_NAME, version=__version__)
    app.state.engine = engine if engine is not None else EdgeTTSEngine()
    app.state.data_dir = (data_dir or TTS_DIR).resolve()

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            "service": SERVICE_NAME,
            "version": __version__,
            "engine": type(app.state.engine).__name__,
            "time": datetime.now(timezone.utc).isoformat(),
        }

    @app.post("/synthesize", response_model=SynthesizeResponse)
    async def synthesize(request: SynthesizeRequest) -> SynthesizeResponse:
        request_id = uuid.uuid4().hex
        output_dir = Path(app.state.data_dir) / request_id
        output_dir.mkdir(parents=True, exist_ok=True)

        gap_ms = request.gap_ms if request.gap_ms is not None else DEFAULT_GAP_MS
        results: list[SegmentResult] = []
        cursor_ms = 0
        last_index = len(request.segments) - 1

        for index, segment in enumerate(request.segments):
            try:
                synthesis = await app.state.engine.synthesize(
                    segment.text, segment.voice
                )
            except TTSError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            except Exception as exc:  # noqa: BLE001 - provider failures are opaque
                raise HTTPException(
                    status_code=502,
                    detail=f"tts provider failed: {type(exc).__name__}",
                ) from exc

            audio_path = output_dir / f"seg-{index}.mp3"
            audio_path.write_bytes(synthesis.audio)

            words = [
                WordTiming(
                    text=word.text,
                    start_ms=word.start_ms + cursor_ms,
                    end_ms=word.end_ms + cursor_ms,
                )
                for word in synthesis.words
            ]

            results.append(
                SegmentResult(
                    index=index,
                    voice=segment.voice,
                    audio_path=str(audio_path),
                    duration_ms=synthesis.duration_ms,
                    words=words,
                )
            )

            cursor_ms += synthesis.duration_ms
            if index < last_index:
                cursor_ms += gap_ms

        timeline = {
            "request_id": request_id,
            "gap_ms": gap_ms,
            "segments": [result.model_dump() for result in results],
            "total_duration_ms": cursor_ms,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        (output_dir / "timeline.json").write_text(
            json.dumps(timeline, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return SynthesizeResponse(
            request_id=request_id,
            segments=results,
            total_duration_ms=cursor_ms,
        )

    return app


app = create_app()
