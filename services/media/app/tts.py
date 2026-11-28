from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from . import config
from .models import WordTiming

TICKS_PER_MS = 10_000


class TTSError(RuntimeError):
    """The engine could not produce usable audio."""


class TTSConfigurationError(RuntimeError):
    """No usable engine could be selected from the configured chain."""


class TTSEngine(Protocol):
    async def synthesize(
        self,
        text: str,
        voice: str,
        *,
        pitch_percent: int | None = None,
    ) -> Synthesis: ...


@dataclass(slots=True)
class Synthesis:
    audio: bytes
    words: list[WordTiming]
    duration_ms: int


class EdgeTTSEngine:
    """Free Microsoft Edge neural voices. No API key, not licensed for public use."""

    name = "edge"
    licensed = False

    async def synthesize(
        self,
        text: str,
        voice: str,
        *,
        pitch_percent: int | None = None,
    ) -> Synthesis:
        import edge_tts

        options: dict[str, str] = {}
        if pitch_percent is not None and pitch_percent != 0:
            options["pitch"] = f"{pitch_percent:+d}%"

        communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary", **options)

        audio = bytearray()
        words: list[WordTiming] = []

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start_ms = int(chunk["offset"]) // TICKS_PER_MS
                duration_ms = int(chunk["duration"]) // TICKS_PER_MS
                words.append(
                    WordTiming(
                        text=str(chunk["text"]),
                        start_ms=start_ms,
                        end_ms=start_ms + duration_ms,
                    )
                )

        if not audio:
            raise TTSError(f"no audio returned for voice {voice}")
        if not words:
            raise TTSError(f"no word boundaries returned for voice {voice}")

        return Synthesis(
            audio=bytes(audio),
            words=words,
            duration_ms=words[-1].end_ms,
        )


class PiperTTSEngine:
    """Local Piper TTS - runs offline on CPU, completely free."""

    name = "piper"
    licensed = True  # Local execution, no licensing concerns

    # Voice mapping from our IDs to Piper voice names
    VOICE_MAP = {
        # English voices
        "en-US-AndrewMultilingualNeural": "en_US-lessac-medium",
        "en-US-EmmaMultilingualNeural": "en_US-amy-medium",
        "en-US-AvaMultilingualNeural": "en_US-ryan-medium",
        # Tamil voices (if available)
        "ta-IN-ValluvarNeural": "ta_IN-murugan-medium",
        "ta-IN-PallaviNeural": "ta_IN-priya-medium",
        # Fallback generic
        "en": "en_US-lessac-medium",
        "ta": "ta_IN-murugan-medium",
    }

    def __init__(self):
        self.piper_path = shutil.which("piper") or "piper"
        self.voices_dir = Path(config.DATA_DIR) / "piper_voices"
        self.voices_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_voice(self, voice: str) -> str:
        """Map our voice ID to Piper voice name."""
        return self.VOICE_MAP.get(voice, self.VOICE_MAP.get(voice.split("-")[0], "en_US-lessac-medium"))

    def _ensure_voice(self, voice_name: str) -> Path:
        """Download Piper voice if not present."""
        # Piper voices are .onnx + .onnx.json files
        # Hosted on Hugging Face: https://huggingface.co/rhasspy/piper-voices
        onnx_path = self.voices_dir / f"{voice_name}.onnx"
        json_path = self.voices_dir / f"{voice_name}.onnx.json"

        if onnx_path.exists() and json_path.exists():
            return onnx_path

        base_url = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
        # Map voice_name to HF path: en_US-lessac-medium -> en/en_US/lessac/medium
        # Voice name format: {lang}_{region}-{voice_name}-{quality}
        # HF path format: {lang}/{lang}_{region}/{voice_name}/{quality}
        parts = voice_name.split("-")
        if len(parts) == 3:
            lang_region, voice, quality = parts
            hf_path = f"{lang_region[0:2]}/{lang_region}/{voice}/{quality}"
        else:
            # Fallback: replace underscores and hyphens
            hf_path = voice_name.replace("_", "/").replace("-", "/")
        
        for ext in [".onnx", ".onnx.json"]:
            url = f"{base_url}/{hf_path}/{voice_name}{ext}"
            dest = self.voices_dir / f"{voice_name}{ext}"
            try:
                import urllib.request
                urllib.request.urlretrieve(url, dest)
            except Exception as e:
                raise TTSError(f"failed to download Piper voice {voice_name}{ext}: {e}")

        return onnx_path

    async def synthesize(
        self,
        text: str,
        voice: str,
        *,
        pitch_percent: int | None = None,
    ) -> Synthesis:
        voice_name = self._resolve_voice(voice)
        model_path = self._ensure_voice(voice_name)

        # Create temp files for input/output
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f_in:
            f_in.write(text)
            input_path = Path(f_in.name)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f_out:
            output_path = Path(f_out.name)

        try:
            # Run piper: piper --model <model.onnx> --input <input.txt> --output <output.wav>
            cmd = [
                self.piper_path,
                "--model", str(model_path),
                "--input-file", str(input_path),
                "--output-file", str(output_path),
                "--sentence-silence", "0.3",  # 300ms between sentences
            ]
            if pitch_percent is not None and pitch_percent != 0:
                # Piper uses length_scale for speed (inverse of pitch roughly)
                # pitch +20% ≈ length_scale 0.83, pitch -20% ≈ length_scale 1.2
                length_scale = 1.0 - (pitch_percent / 500.0)  # rough mapping
                length_scale = max(0.5, min(2.0, length_scale))
                cmd.extend(["--length-scale", str(length_scale)])

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                raise TTSError(f"Piper failed: {stderr.decode()}")

            audio = output_path.read_bytes()
            if not audio:
                raise TTSError("Piper produced empty audio")

            # Piper doesn't give word boundaries, so we estimate
            # Rough: 150 words/min = 2.5 words/sec = 400ms per word
            words_list = text.split()
            words: list[WordTiming] = []
            current_ms = 0
            for word in words_list:
                word_duration = max(200, len(word) * 50)  # rough estimate
                words.append(WordTiming(
                    text=word,
                    start_ms=current_ms,
                    end_ms=current_ms + word_duration,
                ))
                current_ms += word_duration + 50  # small gap

            return Synthesis(
                audio=audio,
                words=words,
                duration_ms=current_ms,
            )

        finally:
            # Cleanup temp files
            input_path.unlink(missing_ok=True)
            output_path.unlink(missing_ok=True)


def build_tts_engine(
    *,
    chain: str | None = None,
    require_licensed: bool | None = None,
    azure_key: str | None = None,
    azure_region: str | None = None,
) -> TTSEngine:
    """Select the first engine in `TTS` that can start.

    `edge` is skipped when `TTS_REQUIRE_LICENSED=1`, which is what makes a public
    deployment fail closed instead of silently shipping the unlicensed engine.
    Unimplemented adapters (`indicf5`) are skipped, not fatal, so the
    documented chain keeps working as they land.
    """
    raw_chain = config.TTS if chain is None else chain
    require = (
        config.TTS_REQUIRE_LICENSED if require_licensed is None else require_licensed
    )
    key = config.AZURE_SPEECH_KEY if azure_key is None else azure_key
    region = config.AZURE_SPEECH_REGION if azure_region is None else azure_region

    names = [part.strip().lower() for part in raw_chain.split(",") if part.strip()]
    if not names:
        raise TTSConfigurationError("TTS is empty; set at least one engine")

    skipped: list[str] = []
    for name in names:
        if name == "edge":
            if require:
                skipped.append("edge (unlicensed)")
                continue
            return EdgeTTSEngine()
        if name == "azure":
            if key and region:
                # Imported lazily so edge-only installs need no Azure SDK.
                from .azure_tts import AzureTTSEngine

                return AzureTTSEngine(key, region)
            skipped.append("azure (AZURE_SPEECH_KEY/AZURE_SPEECH_REGION unset)")
            continue
        if name == "piper":
            try:
                # Check if piper binary exists
                if shutil.which("piper"):
                    return PiperTTSEngine()
                skipped.append("piper (binary not found, install with: pip install piper-tts)")
                continue
            except Exception as e:
                skipped.append(f"piper ({e})")
                continue
        if name == "indicf5":
            skipped.append("indicf5 (adapter not implemented)")
            continue
        raise TTSConfigurationError(
            f"unknown TTS engine {name!r} in TTS={raw_chain!r}"
        )

    detail = ", ".join(skipped) if skipped else "empty chain"
    if require:
        raise TTSConfigurationError(
            "TTS_REQUIRE_LICENSED=1 but no licensed engine could start: " + detail
        )
    raise TTSConfigurationError("no TTS engine could start: " + detail)