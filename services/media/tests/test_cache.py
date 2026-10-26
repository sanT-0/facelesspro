from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.cache import (
    CACHE_FORMAT,
    CachingTTSEngine,
    SynthesisCache,
    cache_key,
)
from app.main import create_app
from app.models import WordTiming
from app.tts import Synthesis, TTSError

VOICE = "en-IN-NeerjaNeural"
TA_VOICE = "ta-IN-PallaviNeural"


def make_synthesis(audio: bytes, text: str = "hello world") -> Synthesis:
    words = [
        WordTiming(text=word, start_ms=index * 300, end_ms=index * 300 + 250)
        for index, word in enumerate(text.split())
    ]
    return Synthesis(audio=audio, words=words, duration_ms=len(words) * 300)


class CountingEngine:
    name = "counting"

    def __init__(self, audio: bytes = b"RIFFfake") -> None:
        self.calls: list[tuple[str, str]] = []
        self.audio = audio

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        self.calls.append((text, voice))
        return make_synthesis(self.audio, text)


class BrokenEngine:
    name = "broken"

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        raise TTSError("provider exploded")


def test_key_is_stable_and_depends_on_every_input() -> None:
    base = cache_key(engine="edge", voice=VOICE, text="hello")

    assert base == cache_key(engine="edge", voice=VOICE, text="hello")
    assert len(base) == 64
    assert base != cache_key(engine="edge", voice=VOICE, text="hello ")
    assert base != cache_key(engine="edge", voice=TA_VOICE, text="hello")
    assert base != cache_key(engine="other", voice=VOICE, text="hello")
    assert CACHE_FORMAT >= 1


def test_round_trip_preserves_audio_and_words(tmp_path: Path) -> None:
    cache = SynthesisCache(tmp_path)
    synthesis = make_synthesis(b"RIFF-audio-bytes", "one two three")
    key = cache_key(engine="edge", voice=VOICE, text="one two three")

    cache.put(key, synthesis)
    restored = cache.get(key)

    assert restored is not None
    assert restored.audio == synthesis.audio
    assert restored.duration_ms == synthesis.duration_ms
    assert [word.model_dump() for word in restored.words] == [
        word.model_dump() for word in synthesis.words
    ]
    assert cache.stats().hits == 1


def test_unknown_key_is_a_miss(tmp_path: Path) -> None:
    cache = SynthesisCache(tmp_path)

    assert cache.get("0" * 64) is None

    stats = cache.stats()
    assert stats.misses == 1
    assert stats.hits == 0
    assert stats.entries == 0


def test_one_file_shorter_than_the_pair_is_not_a_hit(tmp_path: Path) -> None:
    """The metadata is written last: audio without metadata must never be served."""
    cache = SynthesisCache(tmp_path)
    key = cache_key(engine="edge", voice=VOICE, text="hi")
    cache.put(key, make_synthesis(b"RIFF"))
    (tmp_path / f"{key}.json").unlink()

    assert cache.get(key) is None
    assert not (tmp_path / f"{key}.audio").exists()


def test_corrupt_entry_is_dropped_not_raised(tmp_path: Path) -> None:
    cache = SynthesisCache(tmp_path)
    key = cache_key(engine="edge", voice=VOICE, text="hi")
    cache.put(key, make_synthesis(b"RIFF"))
    (tmp_path / f"{key}.json").write_bytes(b"{not json")

    assert cache.get(key) is None
    assert not (tmp_path / f"{key}.json").exists()


def test_entry_with_bad_words_is_dropped(tmp_path: Path) -> None:
    cache = SynthesisCache(tmp_path)
    key = cache_key(engine="edge", voice=VOICE, text="hi")
    cache.put(key, make_synthesis(b"RIFF"))
    (tmp_path / f"{key}.json").write_text(
        json.dumps({"duration_ms": 10, "words": [{"nope": 1}]}), encoding="utf-8"
    )

    assert cache.get(key) is None


def test_cache_is_bounded_and_evicts_oldest_first(tmp_path: Path) -> None:
    cache = SynthesisCache(tmp_path, max_bytes=3_000)
    keys = [cache_key(engine="edge", voice=VOICE, text=f"run {index}") for index in range(4)]

    for index, key in enumerate(keys):
        cache.put(key, make_synthesis(b"x" * 1_000, f"run {index}"))
        # mtime resolution is coarse on some filesystems; order is what matters.
        (tmp_path / f"{key}.json").touch()

    stats = cache.stats()
    assert stats.bytes <= 3_000
    assert stats.entries < 4
    assert not (tmp_path / f"{keys[0]}.json").exists()
    assert (tmp_path / f"{keys[-1]}.json").exists()


def test_engine_is_called_once_per_unique_run(tmp_path: Path) -> None:
    inner = CountingEngine()
    engine = CachingTTSEngine(inner, SynthesisCache(tmp_path))

    async def run() -> None:
        await engine.synthesize("hello", VOICE)
        await engine.synthesize("hello", VOICE)
        await engine.synthesize("hello", TA_VOICE)

    import asyncio

    asyncio.run(run())

    assert inner.calls == [("hello", VOICE), ("hello", TA_VOICE)]


def test_a_failed_synthesis_is_not_cached(tmp_path: Path) -> None:
    engine = CachingTTSEngine(BrokenEngine(), SynthesisCache(tmp_path))

    async def run() -> None:
        with pytest.raises(TTSError):
            await engine.synthesize("boom", VOICE)

    import asyncio

    asyncio.run(run())
    assert engine.cache.stats().entries == 0


def test_an_unwritable_cache_does_not_fail_the_request(tmp_path: Path) -> None:
    blocked = tmp_path / "blocked"
    blocked.write_bytes(b"not a directory")
    engine = CachingTTSEngine(CountingEngine(), SynthesisCache(blocked))

    async def run() -> Synthesis:
        return await engine.synthesize("hello", VOICE)

    import asyncio

    synthesis = asyncio.run(run())
    assert synthesis.audio == b"RIFFfake"


def test_synthesize_reuses_cached_audio_across_requests(
    tmp_path: Path, tone_wav
) -> None:
    engine = CountingEngine(tone_wav(900))
    client = TestClient(create_app(engine=engine, data_dir=tmp_path))
    payload = {"segments": [{"text": "hello world", "voice": VOICE}]}

    first = client.post("/synthesize", json=payload)
    second = client.post("/synthesize", json=payload)

    assert first.status_code == second.status_code == 200
    assert engine.calls == [("hello world", VOICE)]
    assert first.json()["segments"][0]["audio_path"] != second.json()["segments"][0]["audio_path"]
    assert first.json()["total_duration_ms"] == second.json()["total_duration_ms"]


def test_cache_endpoint_reports_hits_and_entries(tmp_path: Path, tone_wav) -> None:
    client = TestClient(create_app(engine=CountingEngine(tone_wav(900)), data_dir=tmp_path))
    payload = {"segments": [{"text": "hello", "voice": VOICE}]}
    client.post("/synthesize", json=payload)
    client.post("/synthesize", json=payload)

    body = client.get("/cache").json()
    assert body["enabled"] is True
    assert body["writes"] == 1
    assert body["hits"] == 1
    assert body["entries"] == 1
    assert body["bytes"] > 0

    assert client.get("/health").json()["cache"] is True
    assert client.get("/health").json()["engine"] == "CountingEngine"


def test_cache_can_be_disabled(tmp_path: Path, tone_wav) -> None:
    engine = CountingEngine(tone_wav(900))
    client = TestClient(create_app(engine=engine, data_dir=tmp_path, cache=False))
    payload = {"segments": [{"text": "hello", "voice": VOICE}]}

    client.post("/synthesize", json=payload)
    client.post("/synthesize", json=payload)

    assert len(engine.calls) == 2
    assert client.get("/cache").json() == {"enabled": False}
    assert client.get("/health").json()["cache"] is False
