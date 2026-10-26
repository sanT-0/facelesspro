"""Per-run TTS cache: `hash(engine, voice, text)` → raw provider audio + word timings.

Why the cache lives at the engine and not at the request: every retry gets a new
request id and a new output directory, but a run's `(voice, text)` does not change.
Caching here means a retried video pays for ffmpeg, not for the network.

The key deliberately contains the *text that is sent to the engine*, not the
author's script. Transliteration happens upstream, so a lexicon fix changes the
text and therefore the key; if a fix leaves the transliterated text identical the
audio really is identical and the hit is correct.

Each entry is two files. The audio is written first and the JSON metadata last,
through an atomic rename, so a crash mid-write leaves something the reader
ignores instead of a half-entry that would poison every later retry. Entries are
bounded by `max_bytes` and pruned oldest-first.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from pathlib import Path

from .models import WordTiming
from .tts import Synthesis, TTSEngine

# Bumping this invalidates every entry. Do it when the meaning of the inputs or
# the shape of the stored payload changes, not when the audio sounds different.
CACHE_FORMAT = 1

DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024


@dataclass(slots=True)
class CacheStats:
    hits: int
    misses: int
    writes: int
    entries: int
    bytes: int


def cache_key(*, engine: str, voice: str, text: str) -> str:
    """Stable across processes and platforms: canonical JSON, then SHA-256."""
    payload = json.dumps(
        {"v": CACHE_FORMAT, "engine": engine, "voice": voice, "text": text},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _atomic_write(path: Path, data: bytes) -> None:
    # A unique temp name, because two workers can race on the same key and the
    # rename is what makes the entry visible either way.
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


class SynthesisCache:
    def __init__(self, root: Path, *, max_bytes: int = DEFAULT_MAX_BYTES) -> None:
        self.root = Path(root)
        self.max_bytes = max_bytes
        self.hits = 0
        self.misses = 0
        self.writes = 0
        self._size: int | None = None

    def _paths(self, key: str) -> tuple[Path, Path]:
        return self.root / f"{key}.audio", self.root / f"{key}.json"

    def _scan(self) -> tuple[int, int]:
        entries = 0
        total = 0
        if not self.root.is_dir():
            return 0, 0
        for meta in self.root.glob("*.json"):
            try:
                size = meta.stat().st_size
            except FileNotFoundError:  # pruned between glob and stat
                continue
            audio, _ = self._paths(meta.stem)
            try:
                size += audio.stat().st_size
            except FileNotFoundError:
                pass
            entries += 1
            total += size
        return entries, total

    def _bytes(self) -> int:
        if self._size is None:
            self._size = self._scan()[1]
        return self._size

    def get(self, key: str) -> Synthesis | None:
        audio_path, meta_path = self._paths(key)
        try:
            meta = json.loads(meta_path.read_bytes())
            audio = audio_path.read_bytes()
        except FileNotFoundError:
            # One half without the other is unusable; remove whatever is left.
            self._drop(audio_path, meta_path)
            self.misses += 1
            return None
        except (OSError, ValueError):
            self._drop(audio_path, meta_path)
            self.misses += 1
            return None

        try:
            words = [WordTiming(**word) for word in meta["words"]]
            synthesis = Synthesis(
                audio=audio,
                words=words,
                duration_ms=int(meta["duration_ms"]),
            )
        except (KeyError, TypeError, ValueError):
            # A truncated or hand-edited entry must never break playback.
            self._drop(audio_path, meta_path)
            self.misses += 1
            return None

        self.hits += 1
        return synthesis

    def put(self, key: str, synthesis: Synthesis) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        audio_path, meta_path = self._paths(key)

        payload = json.dumps(
            {
                "duration_ms": synthesis.duration_ms,
                "words": [
                    {
                        "text": word.text,
                        "start_ms": word.start_ms,
                        "end_ms": word.end_ms,
                    }
                    for word in synthesis.words
                ],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        current = self._bytes()
        _atomic_write(audio_path, synthesis.audio)
        _atomic_write(meta_path, payload)
        self.writes += 1
        self._size = current + len(synthesis.audio) + len(payload)

        if self._size > self.max_bytes:
            self._prune()

    def _drop(self, audio_path: Path, meta_path: Path) -> None:
        removed = False
        for path in (audio_path, meta_path):
            try:
                path.unlink()
                removed = True
            except FileNotFoundError:
                pass
            except OSError:
                # A cache that cannot clean up must not turn a miss into an error.
                pass
        if removed:
            self._size = None

    def _prune(self) -> None:
        """Delete oldest entries until the cache fits; called only over budget."""
        entries: list[tuple[float, Path, Path, int]] = []
        total = 0
        for meta in self.root.glob("*.json"):
            audio, _ = self._paths(meta.stem)
            try:
                size = meta.stat().st_size
                modified = meta.stat().st_mtime
            except FileNotFoundError:
                continue
            try:
                size += audio.stat().st_size
            except FileNotFoundError:
                pass
            entries.append((modified, meta, audio, size))
            total += size

        entries.sort()
        for _, meta, audio, size in entries:
            if total <= self.max_bytes:
                break
            self._drop(audio, meta)
            total -= size
        self._size = total

    def stats(self) -> CacheStats:
        entries, total = self._scan()
        self._size = total
        return CacheStats(
            hits=self.hits,
            misses=self.misses,
            writes=self.writes,
            entries=entries,
            bytes=total,
        )


class CachingTTSEngine:
    """`TTSEngine` decorator. A cache failure must never fail a request."""

    def __init__(
        self,
        inner: TTSEngine,
        cache: SynthesisCache,
        *,
        name: str | None = None,
    ) -> None:
        self.inner = inner
        self.cache = cache
        self.name = name or getattr(inner, "name", type(inner).__name__)

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        key = cache_key(engine=self.name, voice=voice, text=text)
        try:
            cached = self.cache.get(key)
        except OSError:
            cached = None
        if cached is not None:
            return cached

        synthesis = await self.inner.synthesize(text, voice)
        try:
            self.cache.put(key, synthesis)
        except OSError:
            # A full or read-only disk must not lose audio we already have.
            pass
        return synthesis
