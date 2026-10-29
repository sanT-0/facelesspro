from __future__ import annotations

import json
import math
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException

from . import __version__
from .audio import AudioError, MasterGain
from .boundaries import classify_boundary, gap_ms_for
from .cache import CachingTTSEngine, SynthesisCache
from .config import (
    SERVICE_NAME,
    TTS_CACHE_DIR,
    TTS_CACHE_ENABLED,
    TTS_CACHE_MAX_MB,
    TTS_DIR,
    TTS_PAUSE_COMPRESSION,
)
from .models import (
    SegmentResult,
    SynthesizeRequest,
    SynthesizeResponse,
    WordTiming,
)
from .stitch import Stitcher
from .tts import EdgeTTSEngine, TTSEngine, TTSError
from .voices import (
    DEFAULT_PAIR_ID,
    UnknownPairError,
    catalogue,
    pair_catalogue,
    pair_dict,
    resolve_pair,
)


def _db(value: float) -> float | None:
    """JSON has no infinity; a silent program reports `null` instead."""
    return round(value, 2) if math.isfinite(value) else None


def _master_summary(master: MasterGain | None) -> dict[str, object] | None:
    if master is None:
        return None
    return {
        "gain_db": _db(master.gain_db),
        "limited": master.limited,
        "input_lufs": _db(master.before_lufs),
        "input_dbtp": _db(master.before_dbtp),
    }


def _engine_name(engine: TTSEngine) -> str:
    """Unwrap the cache decorator: `/health` reports the engine that speaks."""
    inner = getattr(engine, "inner", None)
    return type(inner).__name__ if inner is not None else type(engine).__name__


def create_app(
    engine: TTSEngine | None = None,
    data_dir: Path | None = None,
    cache: SynthesisCache | bool | None = None,
) -> FastAPI:
    """`cache=False` disables it; passing a `SynthesisCache` uses that one."""
    app = FastAPI(title=SERVICE_NAME, version=__version__)
    base_engine = engine if engine is not None else EdgeTTSEngine()
    app.state.data_dir = (data_dir or TTS_DIR).resolve()

    if cache is False:
        resolved_cache = None
    elif isinstance(cache, SynthesisCache):
        resolved_cache = cache
    elif TTS_CACHE_ENABLED:
        cache_root = TTS_CACHE_DIR if data_dir is None else app.state.data_dir / "cache"
        resolved_cache = SynthesisCache(
            cache_root, max_bytes=TTS_CACHE_MAX_MB * 1024 * 1024
        )
    else:
        resolved_cache = None

    app.state.cache = resolved_cache
    app.state.engine = (
        CachingTTSEngine(base_engine, resolved_cache)
        if resolved_cache is not None
        else base_engine
    )

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            "service": SERVICE_NAME,
            "version": __version__,
            "engine": _engine_name(app.state.engine),
            "cache": app.state.cache is not None,
            "time": datetime.now(UTC).isoformat(),
        }

    @app.get("/cache")
    async def cache_stats() -> dict[str, object]:
        store = app.state.cache
        if store is None:
            return {"enabled": False}
        stats = store.stats()
        return {
            "enabled": True,
            "hits": stats.hits,
            "misses": stats.misses,
            "writes": stats.writes,
            "entries": stats.entries,
            "bytes": stats.bytes,
            "max_bytes": store.max_bytes,
        }

    @app.get("/voices")
    async def voices() -> dict[str, object]:
        return {
            "default": DEFAULT_PAIR_ID,
            "voices": catalogue(),
            "pairs": pair_catalogue(),
        }

    @app.get("/voices/{pair_id}")
    async def voice_pair(pair_id: str) -> dict[str, object]:
        try:
            return pair_dict(resolve_pair(pair_id))
        except UnknownPairError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/synthesize", response_model=SynthesizeResponse)
    async def synthesize(request: SynthesizeRequest) -> SynthesizeResponse:
        request_id = uuid.uuid4().hex
        output_dir = Path(app.state.data_dir) / request_id
        output_dir.mkdir(parents=True, exist_ok=True)

        stitcher = Stitcher(pause_compression=TTS_PAUSE_COMPRESSION)
        runs = []
        gaps_ms: list[int] = []
        boundaries: list[str] = []

        for index, segment in enumerate(request.segments):
            try:
                synthesis = await app.state.engine.synthesize(
                    segment.text, segment.voice
                )
            except TTSError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            except Exception as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"tts provider failed: {type(exc).__name__}",
                ) from exc

            if index == 0:
                gaps_ms.append(0)
                boundaries.append("start")
            else:
                boundary = classify_boundary(
                    request.segments[index - 1].text, segment.text
                )
                boundaries.append(boundary)
                gaps_ms.append(
                    request.gap_ms
                    if request.gap_ms is not None
                    else gap_ms_for(boundary)
                )

            try:
                runs.append(
                    stitcher.process(
                        synthesis.audio,
                        index=index,
                        out_dir=output_dir,
                        words=synthesis.words,
                    )
                )
            except AudioError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"audio processing failed: {exc}",
                ) from exc

        try:
            result = stitcher.assemble(runs, gaps_ms, out_dir=output_dir)
        except AudioError as exc:
            raise HTTPException(
                status_code=502, detail=f"stitching failed: {exc}"
            ) from exc

        segments = [
            SegmentResult(
                index=run.index,
                voice=request.segments[run.index].voice,
                text=request.segments[run.index].text,
                audio_path=str(run.path),
                start_ms=run.start_ms,
                duration_ms=run.duration_ms,
                head_trim_ms=run.head_trim_ms,
                words=[
                    WordTiming(
                        text=word.text,
                        start_ms=run.start_ms + word.start_ms,
                        end_ms=run.start_ms + word.end_ms,
                    )
                    for word in run.words
                ],
            )
            for run in result.runs
        ]

        timeline = {
            "request_id": request_id,
            "master_path": str(result.master_wav),
            "master_mp3_path": str(result.master_mp3),
            "total_duration_ms": result.total_duration_ms,
            "segments": [segment.model_dump() for segment in segments],
            "gaps_ms": result.gaps_ms,
            "boundaries": boundaries,
            "master": _master_summary(result.master),
            "created_at": datetime.now(UTC).isoformat(),
        }
        (output_dir / "timeline.json").write_text(
            json.dumps(timeline, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return SynthesizeResponse(
            request_id=request_id,
            segments=segments,
            master_path=str(result.master_wav),
            total_duration_ms=result.total_duration_ms,
        )

    return app


app = create_app()
