"""`POST /transcribe` — the voiceover-intake boundary (docs/04 §1b).

Hermetic: the engine is a fake, so no model is downloaded and no network is
touched. The live round-trip at the bottom only runs with `RUN_LIVE=1`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.asr import AsrError, AsrSegment, AsrUnavailableError, Transcription
from app.main import create_app
from app.models import WordTiming

AUDIO = b"fake audio bytes"


class FakeAsr:
    """Records calls and returns a canned transcription."""

    def __init__(
        self,
        result: Transcription | None = None,
        error: Exception | None = None,
    ) -> None:
        self.result = result
        self.error = error
        self.calls: list[bytes] = []

    async def transcribe(self, audio: bytes) -> Transcription:
        self.calls.append(audio)
        if self.error is not None:
            raise self.error
        assert self.result is not None
        return self.result


def make_client(tmp_path, engine) -> TestClient:
    return TestClient(create_app(asr=engine, data_dir=tmp_path))


def result() -> Transcription:
    return Transcription(
        language="ta",
        duration_ms=4_100,
        text="வணக்கம் நண்பர்களே. Today we plan.",
        segments=[
            AsrSegment(
                text="வணக்கம் நண்பர்களே.",
                start_ms=120,
                end_ms=2_240,
                words=[
                    WordTiming(text="வணக்கம்", start_ms=120, end_ms=980),
                    WordTiming(text="நண்பர்களே", start_ms=1_020, end_ms=2_240),
                ],
            ),
            AsrSegment(
                text="Today we plan.",
                start_ms=2_500,
                end_ms=4_100,
                words=[WordTiming(text="Today", start_ms=2_500, end_ms=2_980)],
            ),
        ],
    )


def test_transcribe_round_trip(tmp_path) -> None:
    engine = FakeAsr(result())
    res = make_client(tmp_path, engine).post(
        "/transcribe", content=AUDIO, headers={"content-type": "audio/mpeg"}
    )

    assert res.status_code == 200
    body = res.json()
    assert engine.calls == [AUDIO]
    assert body["language"] == "ta"
    assert body["duration_ms"] == 4_100
    assert body["text"].startswith("வணக்கம்")
    assert len(body["segments"]) == 2
    first = body["segments"][0]
    assert first["start_ms"] == 120
    assert first["words"][1]["text"] == "நண்பர்களே"
    assert first["words"][1]["start_ms"] == 1_020


def test_transcribe_writes_a_transcript_artifact(tmp_path) -> None:
    engine = FakeAsr(result())
    res = make_client(tmp_path, engine).post("/transcribe", content=AUDIO)

    assert res.status_code == 200
    request_id = res.json()["request_id"]
    artifact = tmp_path / request_id / "transcript.json"
    assert artifact.exists()
    stored = json.loads(artifact.read_text(encoding="utf-8"))
    assert stored["language"] == "ta"
    assert len(stored["segments"]) == 2


def test_empty_upload_is_unprocessable(tmp_path) -> None:
    engine = FakeAsr(result())
    res = make_client(tmp_path, engine).post("/transcribe", content=b"")
    assert res.status_code == 422
    assert engine.calls == []


def test_oversized_upload_is_rejected_before_the_engine(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.main as main_module

    monkeypatch.setattr(main_module, "ASR_MAX_MB", 0)
    engine = FakeAsr(result())
    res = make_client(tmp_path, engine).post("/transcribe", content=AUDIO)
    assert res.status_code == 413
    assert engine.calls == []


def test_no_speech_is_a_clean_error_not_an_empty_answer(tmp_path) -> None:
    engine = FakeAsr(
        Transcription(language="ta", duration_ms=1_000, text="", segments=[])
    )
    res = make_client(tmp_path, engine).post("/transcribe", content=AUDIO)
    assert res.status_code == 502


def test_engine_failures_map_to_status_codes(tmp_path) -> None:
    unavailable = make_client(tmp_path, FakeAsr(error=AsrUnavailableError("no wheel")))
    res = unavailable.post("/transcribe", content=AUDIO)
    assert res.status_code == 503

    failed = make_client(tmp_path, FakeAsr(error=AsrError("decode failed")))
    res = failed.post("/transcribe", content=AUDIO)
    assert res.status_code == 502

    exploded = make_client(tmp_path, FakeAsr(error=RuntimeError("boom")))
    res = exploded.post("/transcribe", content=AUDIO)
    assert res.status_code == 502
    # The type name is the synthesize precedent; the message must not leak.
    assert "boom" not in res.json()["detail"]


def test_default_engine_reports_unavailable_without_faster_whisper(tmp_path) -> None:
    """No faster-whisper on this interpreter → 503 with an installable hint."""
    client = TestClient(create_app(data_dir=tmp_path))
    res = client.post("/transcribe", content=AUDIO)
    assert res.status_code in {502, 503}
    assert "faster-whisper" in res.json()["detail"]


@pytest.mark.skipif(os.environ.get("RUN_LIVE") != "1", reason="set RUN_LIVE=1")
def test_live_transcribe_round_trip(tmp_path) -> None:
    """Synthesize a short Tamil clip, then transcribe the encoded master back.

    Proves the real model decodes audio, detects language and returns usable
    word timings. Needs `faster-whisper` installed and its model downloaded.
    """
    client = TestClient(create_app(data_dir=tmp_path))
    synthesized = client.post(
        "/synthesize",
        json={
            "segments": [
                {"text": "வணக்கம் நண்பர்களே.", "voice": "ta-IN-PallaviNeural"}
            ]
        },
    )
    assert synthesized.status_code == 200
    # The service returns absolute paths under its data dir.
    master_bytes = Path(synthesized.json()["master_mp3_path"]).read_bytes()

    transcribed = client.post("/transcribe", content=master_bytes)
    assert transcribed.status_code == 200
    body = transcribed.json()
    assert body["language"] in {"ta", "en"}
    assert body["duration_ms"] > 0
    assert "வணக்கம்" in body["text"]
    words = [word for segment in body["segments"] for word in segment["words"]]
    assert words, "the live model returned no word timings"
    assert words[0]["start_ms"] >= 0
    assert all(word["end_ms"] > word["start_ms"] for word in words)
