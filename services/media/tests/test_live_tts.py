from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE") != "1",
    reason="live provider test; set RUN_LIVE=1",
)


def test_live_tamil_english(tmp_path: Path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))
    res = client.post(
        "/synthesize",
        json={
            "segments": [
                {"text": "இன்று நாம budget planning பண்ணுவோம்", "voice": "ta-IN-PallaviNeural"},
                {"text": "let us start now", "voice": "en-IN-NeerjaNeural"},
            ]
        },
    )
    assert res.status_code == 200
    body = res.json()

    for segment in body["segments"]:
        audio = Path(segment["audio_path"])
        assert audio.is_file()
        assert audio.stat().st_size > 5_000
        assert len(segment["words"]) > 0

    words = [word for segment in body["segments"] for word in segment["words"]]
    assert words == sorted(words, key=lambda word: word["start_ms"])
    assert body["total_duration_ms"] > 1_500
