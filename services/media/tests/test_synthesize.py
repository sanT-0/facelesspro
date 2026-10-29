from __future__ import annotations

import itertools
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import WordTiming
from app.tts import Synthesis, TTSError

LEAD_MS = 150
TAIL_MS = 150
STEP_MS = 300
TRIMMED_MS = LEAD_MS + 2 * STEP_MS + TAIL_MS - 260


def trimmed_ms(word_count: int) -> int:
    return LEAD_MS + word_count * STEP_MS + TAIL_MS - 260


class FakeEngine:
    def __init__(self, tone, fail_contains: str | None = None) -> None:
        self.tone = tone
        self.fail_contains = fail_contains
        self.calls: list[tuple[str, str]] = []

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        self.calls.append((text, voice))
        if self.fail_contains and self.fail_contains in text:
            raise TTSError("provider exploded")
        words = [
            WordTiming(
                text=word,
                start_ms=LEAD_MS + index * STEP_MS,
                end_ms=LEAD_MS + index * STEP_MS + 250,
            )
            for index, word in enumerate(text.split())
        ]
        duration_ms = LEAD_MS + len(words) * STEP_MS + TAIL_MS
        return Synthesis(
            audio=self.tone(duration_ms),
            words=words,
            duration_ms=duration_ms,
        )


def make_client(
    tmp_path: Path, tone, engine: FakeEngine | None = None
) -> TestClient:
    return TestClient(
        create_app(engine=engine or FakeEngine(tone), data_dir=tmp_path)
    )


def test_health(tmp_path: Path, tone_wav) -> None:
    res = make_client(tmp_path, tone_wav).get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "facelesspro-media"
    assert body["engine"] == "FakeEngine"


def test_single_segment_writes_trimmed_audio(tmp_path: Path, tone_wav) -> None:
    client = make_client(tmp_path, tone_wav)
    res = client.post(
        "/synthesize",
        json={"segments": [{"text": "hello world", "voice": "en-IN-NeerjaNeural"}]},
    )
    assert res.status_code == 200
    body = res.json()

    assert len(body["segments"]) == 1
    segment = body["segments"][0]
    assert segment["voice"] == "en-IN-NeerjaNeural"
    assert segment["start_ms"] == 0
    assert segment["duration_ms"] == TRIMMED_MS
    assert segment["head_trim_ms"] == 130
    assert body["total_duration_ms"] == TRIMMED_MS

    audio = Path(segment["audio_path"])
    assert audio.is_file()
    assert audio.read_bytes().startswith(b"RIFF")
    assert Path(body["master_path"]).is_file()


def test_two_segments_are_offset_by_the_explicit_gap(
    tmp_path: Path, tone_wav
) -> None:
    client = make_client(tmp_path, tone_wav)
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
    assert first["start_ms"] == 0
    assert second["start_ms"] == TRIMMED_MS + 150
    assert body["total_duration_ms"] == 2 * TRIMMED_MS + 150


@pytest.mark.parametrize(
    ("first_text", "second_text", "expected_gap"),
    [
        ("hello.", "world", 300),
        ("hello?", "world", 300),
        ("hello,", "world", 110),
        ("hello;", "world", 180),
        ("hello", "world", 0),
    ],
)
def test_gap_comes_from_the_punctuation_between_runs(
    tmp_path: Path, tone_wav, first_text: str, second_text: str, expected_gap: int
) -> None:
    body = make_client(tmp_path, tone_wav).post(
        "/synthesize",
        json={
            "segments": [
                {"text": first_text, "voice": "en-IN-NeerjaNeural"},
                {"text": second_text, "voice": "ta-IN-PallaviNeural"},
            ]
        },
    ).json()

    assert body["segments"][1]["start_ms"] == trimmed_ms(1) + expected_gap
    assert body["total_duration_ms"] == 2 * trimmed_ms(1) + expected_gap


def test_words_are_global_monotonic_and_inside_their_run(
    tmp_path: Path, tone_wav
) -> None:
    body = make_client(tmp_path, tone_wav).post(
        "/synthesize",
        json={
            "segments": [
                {"text": "one two three", "voice": "en-IN-NeerjaNeural"},
                {"text": "நான்கு ஐந்து", "voice": "ta-IN-PallaviNeural"},
            ]
        },
    ).json()

    words = [word for segment in body["segments"] for word in segment["words"]]
    for previous, current in itertools.pairwise(words):
        assert previous["start_ms"] <= current["start_ms"]
        assert current["end_ms"] > current["start_ms"]
        assert previous["end_ms"] <= current["start_ms"]

    for segment in body["segments"]:
        for word in segment["words"]:
            assert segment["start_ms"] <= word["start_ms"]
            assert word["end_ms"] <= segment["start_ms"] + segment["duration_ms"]


def test_requests_get_distinct_directories(tmp_path: Path, tone_wav) -> None:
    client = make_client(tmp_path, tone_wav)
    payload = {"segments": [{"text": "hi", "voice": "en-IN-NeerjaNeural"}]}
    first = client.post("/synthesize", json=payload).json()
    second = client.post("/synthesize", json=payload).json()
    assert first["request_id"] != second["request_id"]
    assert first["segments"][0]["audio_path"] != second["segments"][0]["audio_path"]


def test_empty_segments_rejected(tmp_path: Path, tone_wav) -> None:
    res = make_client(tmp_path, tone_wav).post("/synthesize", json={"segments": []})
    assert res.status_code == 422


def test_empty_text_rejected(tmp_path: Path, tone_wav) -> None:
    res = make_client(tmp_path, tone_wav).post(
        "/synthesize",
        json={"segments": [{"text": "", "voice": "en-IN-NeerjaNeural"}]},
    )
    assert res.status_code == 422


def test_invalid_voice_rejected(tmp_path: Path, tone_wav) -> None:
    res = make_client(tmp_path, tone_wav).post(
        "/synthesize",
        json={"segments": [{"text": "hi", "voice": "../../etc/passwd"}]},
    )
    assert res.status_code == 422


def test_engine_failure_becomes_502(tmp_path: Path, tone_wav) -> None:
    client = make_client(
        tmp_path, tone_wav, FakeEngine(tone_wav, fail_contains="boom")
    )
    res = client.post(
        "/synthesize",
        json={"segments": [{"text": "boom", "voice": "en-IN-NeerjaNeural"}]},
    )
    assert res.status_code == 502
    assert "provider exploded" in res.json()["detail"]


def test_timeline_file_is_written(tmp_path: Path, tone_wav) -> None:
    body = make_client(tmp_path, tone_wav).post(
        "/synthesize",
        json={
            "segments": [
                {"text": "hello.", "voice": "en-IN-NeerjaNeural"},
                {"text": "world", "voice": "en-IN-NeerjaNeural"},
            ]
        },
    ).json()

    timeline_path = Path(body["segments"][0]["audio_path"]).parent / "timeline.json"
    assert timeline_path.is_file()
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    assert timeline["request_id"] == body["request_id"]
    assert timeline["gaps_ms"] == [0, 300]
    assert timeline["boundaries"] == ["start", "sentence"]
    assert timeline["master_path"] == body["master_path"]
