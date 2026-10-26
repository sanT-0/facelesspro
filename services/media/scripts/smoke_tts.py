"""Smoke test: Tamil + English code-switched synthesis with word timings.

Gate G3 (pre-build): prove that the free edge-tts provider
  - produces audio for both a Tamil run and an English run,
  - returns WordBoundary timings,
  - can be stitched into one timeline without time drift.

Run:
    .venv/Scripts/python.exe scripts/smoke_tts.py
"""

from __future__ import annotations

import asyncio
import itertools
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import edge_tts

TAMIL = (0x0B80, 0x0BFF)
ZERO_WIDTH = {"\u200c", "\u200d"}

VOICES = {
    "ta": "ta-IN-PallaviNeural",
    "en": "en-IN-NeerjaNeural",
}

# Ticks are 100 ns units.
TICKS_PER_MS = 10_000


def script_of(ch: str) -> str | None:
    cp = ord(ch)
    if TAMIL[0] <= cp <= TAMIL[1] or ch in ZERO_WIDTH:
        return "ta"
    if ("a" <= ch <= "z") or ("A" <= ch <= "Z"):
        return "en"
    return None


@dataclass
class Run:
    lang: str
    text: str


def split_runs(text: str) -> list[Run]:
    """Split mixed text into script-homogeneous runs.

    Neutral characters (space, punctuation, digits) attach to the current run
    so we never synthesize a punctuation-only clip.
    """
    runs: list[Run] = []
    current: list[str] = []
    current_lang: str | None = None

    for ch in text:
        lang = script_of(ch)
        if lang is None:
            current.append(ch)
            continue
        if current_lang is None:
            current_lang = lang
            current.append(ch)
            continue
        if lang != current_lang:
            runs.append(Run(current_lang, "".join(current)))
            current = [ch]
            current_lang = lang
        else:
            current.append(ch)

    if current and current_lang is not None:
        runs.append(Run(current_lang, "".join(current)))

    # Attach leading/trailing neutral-only fragments to a neighbour.
    merged: list[Run] = []
    for run in runs:
        text_part = run.text.strip()
        if not text_part:
            if merged:
                merged[-1].text += run.text
            continue
        if not merged and run.text[:1].isspace():
            run = Run(run.lang, text_part)
        merged.append(run)
    return merged


async def synth(text: str, lang: str) -> tuple[bytes, list[dict], int]:
    voice = VOICES[lang]
    # edge-tts 7.x defaults to SentenceBoundary; we need word-level timing.
    communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    audio = bytearray()
    words: list[dict] = []
    last_end = 0

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            start_ms = chunk["offset"] // TICKS_PER_MS
            dur_ms = chunk["duration"] // TICKS_PER_MS
            words.append(
                {
                    "text": chunk["text"],
                    "start_ms": start_ms,
                    "end_ms": start_ms + dur_ms,
                }
            )
            last_end = start_ms + dur_ms

    if not audio:
        raise RuntimeError(f"no audio returned for lang={lang} voice={voice}")
    if not words:
        raise RuntimeError(f"no word boundaries returned for lang={lang}")

    return bytes(audio), words, last_end


async def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    sample = "இன்று நாம budget planning பண்ணுவோம், let's start now."
    out_dir = Path(__file__).resolve().parent.parent / ".smoke"
    out_dir.mkdir(parents=True, exist_ok=True)

    runs = split_runs(sample)
    print(json.dumps([asdict(r) for r in runs], ensure_ascii=False, indent=2))

    timeline: list[dict] = []
    cursor_ms = 0
    total_audio = 0

    for i, run in enumerate(runs):
        audio, words, run_end = await synth(run.text, run.lang)
        mp3 = out_dir / f"run{i}-{run.lang}.mp3"
        mp3.write_bytes(audio)
        total_audio += len(audio)

        for w in words:
            timeline.append(
                {
                    "lang": run.lang,
                    "voice": VOICES[run.lang],
                    "text": w["text"],
                    "start_ms": w["start_ms"] + cursor_ms,
                    "end_ms": w["end_ms"] + cursor_ms,
                }
            )
        print(
            f"run {i} lang={run.lang:2s} chars={len(run.text):3d} "
            f"bytes={len(audio):6d} words={len(words):2d} end={run_end}ms"
        )
        # 150 ms inter-run breathing gap, as planned.
        cursor_ms += run_end + (150 if i < len(runs) - 1 else 0)

    (out_dir / "timeline.json").write_text(
        json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # --- assertions (this is the gate) ---
    assert len(runs) == 4, f"expected 4 runs, got {len(runs)}"
    assert {r.lang for r in runs} == {"ta", "en"}
    assert total_audio > 10_000, "suspiciously small audio payload"
    assert timeline == sorted(timeline, key=lambda w: w["start_ms"]), "timings not monotonic"
    assert all(w["end_ms"] > w["start_ms"] for w in timeline), "zero-length word"
    assert all(
        a["end_ms"] <= b["start_ms"]
        for a, b in itertools.pairwise(timeline)
    ), "overlapping words"
    assert timeline[-1]["end_ms"] <= cursor_ms, "timeline drift"

    print(
        f"\nOK  runs={len(runs)} words={len(timeline)} "
        f"audio_bytes={total_audio} duration={cursor_ms}ms"
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
