from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import WordTiming
from app.tts import Synthesis, TTSError


class FakeEngine:
    def __init__(self, fail_contains: str | None = None) -> None:
        self.fail_contains = fail_contains
        self.calls: list[tuple[str, str]] = []

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        self.calls.append((text, voice))
        if self.fail_contains and self.fail_contains in text:
            raise TTSError("provider exploded")
        words = [
            WordTiming(text=word, start_ms=i * 300, end_ms=i * 300 + 250)
            for i, word in enumerate(text.split())
        ]
        return Synthesis(
            audio=b"ID3" + b"\x00" * 128,
            words=words,
            duration_ms=words[-1].end_ms + 100,
        )


def make_client(tmp_path: Path, engine: FakeEngine | None = None) -> TestClient:
    return TestClient(create_app(engine=engine or FakeEngine(), data_dir=tmp_path))


def test_health(tmp_path: Path) -> None:
    res = make_client(tmp_path).get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "stickman-media"
    assert body["engine"] == "FakeEngine"


def test_single_segment_writes_audio(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    res = client.post(
        "/synthesize",
        json={"segments": [{"text": "hello world", "voice": "en-IN-NeerjaNeural"}]},
    )
    assert res.status_code == 200
    body = res.json()

    assert len(body["segments"]) == 1
    segment = body["segments"][0]
    assert segment["voice"] == "en-IN-NeerjaNeural"
    assert segment["duration_ms"] == 650
    assert body["total_duration_ms"] == 650

    audio = Path(segment["audio_path"])
    assert audio.is_file()
    assert audio.read_bytes().startswith(b"ID3")


def test_two_segments_are_offset_by_gap(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    res = client.post(
        "/synthesize",
        json={
            "gap_ms": 150,
            "segments": [
                {"text": "hello world", "voice": "en-IN-NeerjaNeural"},
                {"text": "நல்லா இருக்கு", "voice": "ta-IN-PallaviNeural"},
            ],
        },
    )
    assert res.status_code == 200
    body = res.json()

    first, second = body["segments"]
    assert first["words"][0]["start_ms"] == 0
    assert second["words"][0]["start_ms"] == 650 + 150
    assert body["total_duration_ms"] == 650 + 150 + 650


def test_words_are_monotonic(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    body = client.post(
        "/synthesize",
        json={
            "segments": [
                {"text": "one two three", "voice": "en-IN-NeerjaNeural"},
                {"text": "நான்கு ஐந்து", "voice": "ta-IN-PallaviNeural"},
            ]
        },
    ).json()

    words = [word for segment in body["segments"] for word in segment["words"]]
    for previous, current in zip(words, words[1:]):
        assert previous["start_ms"] <= current["start_ms"]
        assert current["end_ms"] > current["start_ms"]
        assert previous["end_ms"] <= current["start_ms"]


def test_requests_get_distinct_directories(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    payload = {"segments": [{"text": "hi", "voice": "en-IN-NeerjaNeural"}]}
    first = client.post("/synthesize", json=payload).json()
    second = client.post("/synthesize", json=payload).json()
    assert first["request_id"] != second["request_id"]
    assert first["segments"][0]["audio_path"] != second["segments"][0]["audio_path"]


def test_empty_segments_rejected(tmp_path: Path) -> None:
    res = make_client(tmp_path).post("/synthesize", json={"segments": []})
    assert res.status_code == 422


def test_empty_text_rejected(tmp_path: Path) -> None:
    res = make_client(tmp_path).post(
        "/synthesize",
        json={"segments": [{"text": "", "voice": "en-IN-NeerjaNeural"}]},
    )
    assert res.status_code == 422


def test_invalid_voice_rejected(tmp_path: Path) -> None:
    res = make_client(tmp_path).post(
        "/synthesize",
        json={"segments": [{"text": "hi", "voice": "../../etc/passwd"}]},
    )
    assert res.status_code == 422


def test_engine_failure_becomes_502(tmp_path: Path) -> None:
    client = make_client(tmp_path, FakeEngine(fail_contains="boom"))
    res = client.post(
        "/synthesize",
        json={"segments": [{"text": "boom", "voice": "en-IN-NeerjaNeural"}]},
    )
    assert res.status_code == 502
    assert "provider exploded" in res.json()["detail"]


def test_timeline_file_is_written(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    body = client.post(
        "/synthesize",
        json={"segments": [{"text": "hello", "voice": "en-IN-NeerjaNeural"}]},
    ).json()

    timeline = Path(body["segments"][0]["audio_path"]).parent / "timeline.json"
    assert timeline.is_file()
    assert body["request_id"] in timeline.read_text(encoding="utf-8")
