"""Voice catalogue and pairing.

A "pair" is the smallest thing the pipeline asks for, and it is **one speaker**
who reads both languages — `{ta: X, en: X}`. Two locale-locked voices are two
different people: the 2026-10-27 listening gate rejected exactly that, because a
mixed Tamil/English paragraph audibly changed narrator mid-sentence. Gender and
accent matching cannot fix it, so `validate_pair` now rejects a second voice
whenever the Tamil voice can read English itself (`mixes_english` or a
multilingual model). A second voice survives only where the first one genuinely
cannot speak English (Piper).

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
    # Multilingual models: one speaker for every supported language, Tamil
    # included (Azure documents ta-IN for `*MultilingualNeural`). This is the
    # only way to get a second-language speaker that is literally the first
    # speaker, so these are the natural "one voice for both" pairs.
    Voice(
        id="en-US-AndrewMultilingualNeural",
        engine="edge",
        locale="en-US",
        languages=("en", "ta"),
        gender="male",
        mixes_english=True,
        word_timings=True,
        label="Andrew (multilingual, male; Tamil is a secondary language)",
    ),
    Voice(
        id="en-US-AvaMultilingualNeural",
        engine="edge",
        locale="en-US",
        languages=("en", "ta"),
        gender="female",
        mixes_english=True,
        word_timings=True,
        label="Ava (multilingual, female; Tamil is a secondary language)",
    ),
    # Approved by ear 2026-10-27 as the female narrator; the Tamil voice
    # (Pallavi) and the other multilingual female (Ava) were rejected, and
    # Saranya's Sri Lankan accent was rejected with them.
    Voice(
        id="en-US-EmmaMultilingualNeural",
        engine="edge",
        locale="en-US",
        languages=("en", "ta"),
        gender="female",
        mixes_english=True,
        word_timings=True,
        label="Emma (multilingual, female; approved female narrator)",
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
#
# One voice per pair is the norm; `ta == en` means "this speaker reads both".
# A pair with two different voices is only legal when the Tamil voice cannot
# read English at all — see `validate_pair`.

_PAIRS: tuple[VoicePair, ...] = (
    VoicePair(
        id="valluvar",
        ta="ta-IN-ValluvarNeural",
        en="ta-IN-ValluvarNeural",
        notes="default narration; one male Tamil speaker reads the English too",
    ),
    VoicePair(
        id="pallavi",
        ta="ta-IN-PallaviNeural",
        en="ta-IN-PallaviNeural",
        notes="female; one speaker, kept while a better female voice is auditioned",
    ),
    VoicePair(
        id="andrew",
        ta="en-US-AndrewMultilingualNeural",
        en="en-US-AndrewMultilingualNeural",
        notes="male multilingual model; one speaker, US-English primary",
    ),
    VoicePair(
        id="emma",
        ta="en-US-EmmaMultilingualNeural",
        en="en-US-EmmaMultilingualNeural",
        notes="female narration, approved by ear 2026-10-27; one speaker for both languages",
    ),
    VoicePair(
        id="ava",
        ta="en-US-AvaMultilingualNeural",
        en="en-US-AvaMultilingualNeural",
        notes="female multilingual model; one speaker, US-English primary",
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
        notes="zero network, lowest quality; two voices, because the Tamil model has no English",
    ),
)

PAIRS: dict[str, VoicePair] = {pair.id: pair for pair in _PAIRS}

DEFAULT_PAIR_ID = "valluvar"


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

    speaks_english = ta.mixes_english or "en" in ta.languages

    if ta.id == en.id:
        if not speaks_english:
            raise PairMismatchError(
                f"pair {pair.id!r}: {ta.id!r} cannot speak English, so it cannot "
                "be both halves of the pair"
            )
        return

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

    if speaks_english:
        # The 2026-10-27 listening gate: a Tamil voice that reads English plus a
        # separate English voice is two people, and the switch is audible even
        # when gender and accent match. Refusing it here is the only way the
        # rejected configuration stays unreachable.
        raise PairMismatchError(
            f"pair {pair.id!r}: {ta.id!r} can already speak English, so "
            f"{en.id!r} would make one sentence switch speakers"
        )


def voice_for_lang(pair: VoicePair, lang: str) -> str:
    """The engine voice a pair uses for one language.

    This is the only place the ta/en split happens. For a one-speaker pair the
    two halves are identical, so the split resolves to the same voice id and the
    sentence never changes narrator; only Piper's two-voice pair differs.
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
