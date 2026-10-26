"""Voice catalogue and pairing.

A "pair" is the smallest thing the pipeline asks for: one Tamil voice and one
English voice that sound like the same person. Mixing a female Tamil voice with
a male English voice is the classic way a bilingual video stops sounding human,
so pairs are curated here and validated, never assembled by guessing.

Voice ids are engine-specific and Microsoft adds/removes voices without notice.
They are therefore pinned in one place, snapshotted by `test_voices.py`, and
verified against the live list by `test_live_voices.py` (`RUN_LIVE=1`).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass


class VoiceError(ValueError):
    """A voice or pair selector could not be honoured."""


class UnknownVoiceError(VoiceError):
    pass


class UnknownPairError(VoiceError):
    pass


class InvalidSelectorError(VoiceError):
    pass


class PairMismatchError(VoiceError):
    """A pair whose two voices cannot plausibly be the same speaker."""


@dataclass(frozen=True, slots=True)
class Voice:
    """One concrete engine voice."""

    id: str
    engine: str
    locale: str
    languages: tuple[str, ...]
    gender: str
    mixes_english: bool
    word_timings: bool
    label: str


@dataclass(frozen=True, slots=True)
class VoicePair:
    """A Tamil voice plus the English voice that continues the same speaker."""

    id: str
    ta: str
    en: str
    notes: str


# --- engine voices -----------------------------------------------------------

_VOICES: tuple[Voice, ...] = (
    # edge-tts (ta-IN) — verified live 2026-10-26
    Voice(
        id="ta-IN-PallaviNeural",
        engine="edge",
        locale="ta-IN",
        languages=("ta",),
        gender="female",
        mixes_english=True,
        word_timings=True,
        label="Pallavi (Tamil, India)",
    ),
    Voice(
        id="ta-IN-ValluvarNeural",
        engine="edge",
        locale="ta-IN",
        languages=("ta",),
        gender="male",
        mixes_english=True,
        word_timings=True,
        label="Valluvar (Tamil, India)",
    ),
    # edge-tts (en-IN) — same accent region, so pairing stays coherent
    Voice(
        id="en-IN-NeerjaNeural",
        engine="edge",
        locale="en-IN",
        languages=("en",),
        gender="female",
        mixes_english=True,
        word_timings=True,
        label="Neerja (English, India)",
    ),
    Voice(
        id="en-IN-PrabhatNeural",
        engine="edge",
        locale="en-IN",
        languages=("en",),
        gender="male",
        mixes_english=True,
        word_timings=True,
        label="Prabhat (English, India)",
    ),
    # Present in the live catalogue but deliberately unpaired: a Sri Lankan
    # Tamil accent under an Indian English sentence is the mismatch this module
    # exists to prevent. Wire a ta-LK + en-LK pair only when en-LK ships.
    Voice(
        id="ta-LK-SaranyaNeural",
        engine="edge",
        locale="ta-LK",
        languages=("ta",),
        gender="female",
        mixes_english=True,
        word_timings=True,
        label="Saranya (Tamil, Sri Lanka)",
    ),
    Voice(
        id="ta-LK-KumarNeural",
        engine="edge",
        locale="ta-LK",
        languages=("ta",),
        gender="male",
        mixes_english=True,
        word_timings=True,
        label="Kumar (Tamil, Sri Lanka)",
    ),
    # IndicF5: one model covers both languages, so timbre continuity is best.
    # No word boundaries — alignment happens after synthesis (P1 stitch work).
    Voice(
        id="indicf5-ta",
        engine="indicf5",
        locale="multi",
        languages=("ta", "en"),
        gender="neutral",
        mixes_english=True,
        word_timings=False,
        label="IndicF5 (Tamil + English, local GPU/CPU)",
    ),
    # Piper: offline fallback. Logical ids until the .onnx files are pinned at
    # install time; the engine reports the concrete file in its own logs.
    Voice(
        id="piper-ta",
        engine="piper",
        locale="ta-IN",
        languages=("ta",),
        gender="neutral",
        mixes_english=False,
        word_timings=False,
        label="Piper (Tamil, offline)",
    ),
    Voice(
        id="piper-en",
        engine="piper",
        locale="en-IN",
        languages=("en",),
        gender="neutral",
        mixes_english=False,
        word_timings=False,
        label="Piper (English, offline)",
    ),
)

CATALOGUE: dict[str, Voice] = {voice.id: voice for voice in _VOICES}


# --- pairs -------------------------------------------------------------------

_PAIRS: tuple[VoicePair, ...] = (
    VoicePair(
        id="pallavi-neerja",
        ta="ta-IN-PallaviNeural",
        en="en-IN-NeerjaNeural",
        notes="default narration; female",
    ),
    VoicePair(
        id="valluvar-prabhat",
        ta="ta-IN-ValluvarNeural",
        en="en-IN-PrabhatNeural",
        notes="male explainer",
    ),
    VoicePair(
        id="indicf5-ta",
        ta="indicf5-ta",
        en="indicf5-ta",
        notes="one model, best timbre continuity, slower",
    ),
    VoicePair(
        id="piper-offline",
        ta="piper-ta",
        en="piper-en",
        notes="zero network, lowest quality",
    ),
)

PAIRS: dict[str, VoicePair] = {pair.id: pair for pair in _PAIRS}

DEFAULT_PAIR_ID = "pallavi-neerja"


# --- lookup ------------------------------------------------------------------


def get_voice(voice_id: str) -> Voice:
    try:
        return CATALOGUE[voice_id]
    except KeyError:
        raise UnknownVoiceError(f"unknown voice: {voice_id!r}") from None


def get_pair(pair_id: str) -> VoicePair:
    try:
        return PAIRS[pair_id]
    except KeyError:
        raise UnknownPairError(f"unknown voice pair: {pair_id!r}") from None


def validate_pair(pair: VoicePair) -> None:
    ta = get_voice(pair.ta)
    en = get_voice(pair.en)

    if "ta" not in ta.languages:
        raise PairMismatchError(f"pair {pair.id!r}: {ta.id!r} is not a Tamil voice")
    if "en" not in en.languages:
        raise PairMismatchError(f"pair {pair.id!r}: {en.id!r} is not an English voice")
    if ta.engine != en.engine:
        raise PairMismatchError(
            f"pair {pair.id!r}: mixed engines {ta.engine!r} / {en.engine!r}"
        )
    if ta.gender != en.gender:
        raise PairMismatchError(
            f"pair {pair.id!r}: gender mismatch {ta.gender!r} / {en.gender!r}"
        )
    if ta.word_timings != en.word_timings:
        raise PairMismatchError(
            f"pair {pair.id!r}: only one side reports word timings"
        )


def voice_for_lang(pair: VoicePair, lang: str) -> str:
    """The engine voice a pair uses for one language.

    This is the only place the ta/en split happens, so a run can be routed straight
    from the segmenter's label to a voice id without a second mapping table.
    """
    if lang == "ta":
        return pair.ta
    if lang == "en":
        return pair.en
    raise InvalidSelectorError(f"unsupported language: {lang!r}")


def _explicit_pair(selector: Mapping[str, str]) -> VoicePair:
    allowed = {"ta", "en"}
    unknown = set(selector) - allowed
    if unknown:
        raise InvalidSelectorError(
            f"voice selector has unknown keys: {sorted(unknown)}"
        )
    missing = allowed - set(selector)
    if missing:
        raise InvalidSelectorError(
            f"voice selector must name both languages, missing: {sorted(missing)}"
        )

    ta = get_voice(selector["ta"])
    en = get_voice(selector["en"])
    pair = VoicePair(
        id=f"{ta.id}+{en.id}",
        ta=ta.id,
        en=en.id,
        notes="explicit per-language selection",
    )
    validate_pair(pair)
    return pair


def resolve_pair(selector: str | Mapping[str, str] | None = None) -> VoicePair:
    """Resolve `voiceId` to a validated pair.

    Accepts a pair id, an explicit `{"ta": ..., "en": ...}` mapping, or `None`
    for the default. A bare engine voice id is rejected: one edge voice cannot
    serve both languages, so accepting it would hide the second-language choice.
    """
    if selector is None:
        return get_pair(DEFAULT_PAIR_ID)

    if isinstance(selector, str):
        if selector in PAIRS:
            pair = PAIRS[selector]
            validate_pair(pair)
            return pair
        if selector in CATALOGUE:
            raise InvalidSelectorError(
                f"{selector!r} is a single-language voice; "
                "pass a pair id or {'ta': ..., 'en': ...}"
            )
        raise UnknownPairError(f"unknown voice pair: {selector!r}")

    return _explicit_pair(selector)


# --- serialisation -----------------------------------------------------------


def voice_dict(voice: Voice) -> dict[str, object]:
    data = asdict(voice)
    data["languages"] = list(voice.languages)
    return data


def pair_dict(pair: VoicePair) -> dict[str, object]:
    return asdict(pair)


def catalogue() -> list[dict[str, object]]:
    """Stable, JSON-ready view for the API and the web voice picker."""
    return [voice_dict(voice) for voice in _VOICES]


def pair_catalogue() -> list[dict[str, object]]:
    return [pair_dict(pair) for pair in _PAIRS]
