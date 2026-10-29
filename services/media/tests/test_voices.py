from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.voices import (
    CATALOGUE,
    DEFAULT_PAIR_ID,
    PAIRS,
    InvalidSelectorError,
    PairMismatchError,
    UnknownPairError,
    UnknownVoiceError,
    VoicePair,
    catalogue,
    get_pair,
    get_voice,
    pair_catalogue,
    resolve_pair,
    validate_pair,
    voice_dict,
    voice_for_lang,
)

EDGE_VOICE_IDS = {
    "ta-IN-PallaviNeural",
    "ta-IN-ValluvarNeural",
    "ta-LK-SaranyaNeural",
    "ta-LK-KumarNeural",
    "en-IN-NeerjaNeural",
    "en-IN-PrabhatNeural",
    "en-US-AvaMultilingualNeural",
    "en-US-AndrewMultilingualNeural",
    "en-US-EmmaMultilingualNeural",
    "de-DE-SeraphinaMultilingualNeural",
    "fr-FR-VivienneMultilingualNeural",
    "pt-BR-ThalitaMultilingualNeural",
}

PAIR_IDS = {
    "valluvar",
    "pallavi",
    "andrew",
    "ava",
    "emma",
    "seraphina",
    "vivienne",
    "thalita",
    "indicf5-ta",
    "piper-offline",
}


def test_ids_are_pinned_so_a_removal_is_a_deliberate_edit() -> None:
    assert {v.id for v in CATALOGUE.values() if v.engine == "edge"} == EDGE_VOICE_IDS
    assert set(PAIRS) == PAIR_IDS


def test_every_voice_is_well_formed() -> None:
    for voice in CATALOGUE.values():
        assert voice.id == voice.id.strip()
        assert voice.engine in {"edge", "indicf5", "piper"}
        assert voice.gender in {"female", "male", "neutral"}
        assert voice.languages, voice.id
        assert set(voice.languages) <= {"ta", "en"}, voice.id
        assert voice.locale == "multi" or "-" in voice.locale, voice.id
        assert voice.label, voice.id


def test_edge_voices_declare_the_languages_they_can_read() -> None:
    for voice in CATALOGUE.values():
        if voice.engine != "edge":
            continue
        assert voice.word_timings is True, voice.id
        if len(voice.languages) == 1:
            # Locale-locked voices: the locale is the language.
            assert voice.locale.split("-")[0] == voice.languages[0], voice.id
        else:
            # A multilingual model is the only edge voice that spans languages.
            assert "MultilingualNeural" in voice.id, voice.id


def test_every_pair_validates() -> None:
    for pair in PAIRS.values():
        validate_pair(pair)


def test_a_pair_never_switches_speaker_mid_sentence() -> None:
    """The rule the 2026-10-27 listening gate produced.

    Two locale-locked voices are two different people, no matter how well the
    gender and accent are matched; a listener hears the switch. So a pair may
    only use a second voice when the first one cannot speak English at all.
    """
    for pair in PAIRS.values():
        ta = get_voice(pair.ta)
        en = get_voice(pair.en)
        assert ta.gender == en.gender, pair.id
        assert "ta" in ta.languages, pair.id
        assert en.mixes_english or "en" in en.languages, pair.id
        if pair.ta != pair.en:
            assert not ta.mixes_english, pair.id
            assert "en" not in ta.languages, pair.id


def test_default_pair_is_one_male_speaker() -> None:
    assert DEFAULT_PAIR_ID == "valluvar"
    pair = resolve_pair()
    assert pair == resolve_pair(None) == get_pair("valluvar")
    assert pair.ta == pair.en == "ta-IN-ValluvarNeural"
    assert get_voice(pair.ta).gender == "male"


def test_pallavi_is_the_approved_female_speaker() -> None:
    """Chosen by ear on 2026-10-27, from the *fresh* sentence, not the gate clips.

    Emma/Ava were rejected on this text after passing the six fixed clips, and
    Seraphina/Vivienne/Thalita passed but are not native Tamil. Pallavi won on the
    product rule: Tamil is the channel's primary language, so the narrator's Tamil
    is a first language, and her English carries an Indian accent like Valluvar's.
    """
    pair = get_pair("pallavi")
    assert pair.ta == pair.en == "ta-IN-PallaviNeural"
    voice = get_voice(pair.ta)
    assert voice.gender == "female"
    assert voice.locale == "ta-IN"
    assert voice.mixes_english
    validate_pair(pair)
    assert voice_for_lang(pair, "ta") == voice_for_lang(pair, "en") == pair.ta


def test_a_rejected_female_voice_stays_available() -> None:
    # Emma passed the six fixed clips and failed fresh text. She is kept as an
    # option rather than deleted: rejecting a timbre answers "not this one".
    assert get_pair("emma").ta == "en-US-EmmaMultilingualNeural"
    assert get_pair("ava").ta == "en-US-AvaMultilingualNeural"


def test_the_two_defaults_are_native_tamil_and_one_speaker() -> None:
    # The pair the product actually ships with, in both genders.
    male = get_pair("valluvar")
    female = get_pair("pallavi")
    assert (male.ta, male.en) == ("ta-IN-ValluvarNeural", "ta-IN-ValluvarNeural")
    assert (female.ta, female.en) == ("ta-IN-PallaviNeural", "ta-IN-PallaviNeural")
    for pair in (male, female):
        assert get_voice(pair.ta).locale == "ta-IN", pair.id
        assert get_voice(pair.ta).mixes_english, pair.id
        validate_pair(pair)


def test_four_female_voices_are_selectable() -> None:
    """Approved on fresh text 2026-10-27; `pallavi` is the default, not the only option.

    The three multilingual women were each heard on the same sentence and accepted,
    so they ship as options. Each is one speaker for both languages, which is the
    only thing that keeps them legal pairs.
    """
    for pid in ("pallavi", "seraphina", "vivienne", "thalita"):
        pair = get_pair(pid)
        voice = get_voice(pair.ta)
        assert voice.gender == "female", pid
        assert pair.ta == pair.en, pid
        assert voice.mixes_english or "en" in voice.languages, pid
        validate_pair(pair)


def test_both_genders_ship() -> None:
    # A female narrator is a product requirement, so a catalogue edit that
    # silently drops every female pair must fail here, not in a render.
    genders = {get_voice(pair.ta).gender for pair in PAIRS.values()}
    assert {"male", "female"} <= genders


def test_resolve_by_pair_id_and_explicit_mapping() -> None:
    assert resolve_pair("andrew").ta == "en-US-AndrewMultilingualNeural"

    resolved = resolve_pair(
        {"ta": "ta-IN-ValluvarNeural", "en": "ta-IN-ValluvarNeural"}
    )
    assert resolved.ta == resolved.en == "ta-IN-ValluvarNeural"
    validate_pair(resolved)


def test_two_voices_are_rejected_when_one_voice_could_speak_both() -> None:
    """The female pair and the male pair the user rejected by ear.

    Both Tamil voices read English already, so the English half is a second
    person speaking the same sentence. This is what made clip 03 sound like a
    dialogue, so it must be unreachable through the selector.
    """
    for ta, en in (
        ("ta-IN-PallaviNeural", "en-IN-NeerjaNeural"),
        ("ta-IN-ValluvarNeural", "en-IN-PrabhatNeural"),
    ):
        with pytest.raises(PairMismatchError, match="switch speakers"):
            resolve_pair({"ta": ta, "en": en})

        with pytest.raises(PairMismatchError, match="switch speakers"):
            validate_pair(VoicePair(id="x", ta=ta, en=en, notes=""))


def test_sri_lankan_voices_are_catalogued_but_unpaired() -> None:
    # Pairing ta-LK with en-IN would put two accents in one mouth.
    paired = {voice for pair in PAIRS.values() for voice in (pair.ta, pair.en)}
    assert "ta-LK-SaranyaNeural" not in paired
    assert "ta-LK-KumarNeural" not in paired


def test_unknown_pair_is_rejected() -> None:
    with pytest.raises(UnknownPairError):
        resolve_pair("nobody-nowhere")


def test_a_single_language_voice_is_not_a_pair() -> None:
    with pytest.raises(InvalidSelectorError):
        resolve_pair("ta-IN-PallaviNeural")


def test_explicit_selector_must_name_both_languages() -> None:
    with pytest.raises(InvalidSelectorError):
        resolve_pair({"ta": "ta-IN-PallaviNeural"})
    with pytest.raises(InvalidSelectorError):
        resolve_pair({"en": "en-IN-NeerjaNeural"})


def test_explicit_selector_rejects_extra_keys_and_unknown_voices() -> None:
    with pytest.raises(InvalidSelectorError):
        resolve_pair({"ta": "ta-IN-PallaviNeural", "en": "en-IN-NeerjaNeural", "hi": "x"})
    with pytest.raises(UnknownVoiceError):
        resolve_pair({"ta": "ta-IN-Nobody", "en": "en-IN-NeerjaNeural"})


def test_gender_mismatch_is_not_silent() -> None:
    with pytest.raises(PairMismatchError):
        resolve_pair({"ta": "ta-IN-PallaviNeural", "en": "en-IN-PrabhatNeural"})


def test_a_tamil_voice_is_not_an_english_half() -> None:
    # Two Tamil voices: the second one cannot be the English side at all.
    with pytest.raises(PairMismatchError, match="not an English voice"):
        resolve_pair({"ta": "ta-IN-PallaviNeural", "en": "ta-IN-ValluvarNeural"})


def test_mixed_engines_are_rejected() -> None:
    with pytest.raises(PairMismatchError):
        resolve_pair({"ta": "indicf5-ta", "en": "en-IN-NeerjaNeural"})


def test_unknown_voice_lookup() -> None:
    with pytest.raises(UnknownVoiceError):
        get_voice("ta-IN-Nobody")


def test_single_voice_pair_needs_a_voice_that_can_speak_both() -> None:
    """Piper's Tamil model has no English, so it cannot be both halves."""
    with pytest.raises(PairMismatchError, match="cannot speak English"):
        resolve_pair({"ta": "piper-ta", "en": "piper-ta"})


def test_single_voice_pairs_cover_both_languages() -> None:
    for pair in PAIRS.values():
        if pair.ta != pair.en:
            continue
        voice = get_voice(pair.ta)
        assert voice.mixes_english or {"ta", "en"} <= set(voice.languages), pair.id


def test_catalogue_is_json_ready() -> None:
    payload = {"voices": catalogue(), "pairs": pair_catalogue()}
    round_tripped = json.loads(json.dumps(payload))

    assert len(round_tripped["voices"]) == len(CATALOGUE)
    assert len(round_tripped["pairs"]) == len(PAIRS)
    assert round_tripped["pairs"][0]["id"] == "valluvar"
    assert isinstance(voice_dict(get_voice("indicf5-ta"))["languages"], list)


def test_documented_pairs_match_the_table_in_docs_05() -> None:
    expected = {
        "valluvar": ("ta-IN-ValluvarNeural", "ta-IN-ValluvarNeural"),
        "pallavi": ("ta-IN-PallaviNeural", "ta-IN-PallaviNeural"),
        "andrew": ("en-US-AndrewMultilingualNeural", "en-US-AndrewMultilingualNeural"),
        "ava": ("en-US-AvaMultilingualNeural", "en-US-AvaMultilingualNeural"),
        "emma": ("en-US-EmmaMultilingualNeural", "en-US-EmmaMultilingualNeural"),
        "seraphina": ("de-DE-SeraphinaMultilingualNeural", "de-DE-SeraphinaMultilingualNeural"),
        "vivienne": ("fr-FR-VivienneMultilingualNeural", "fr-FR-VivienneMultilingualNeural"),
        "thalita": ("pt-BR-ThalitaMultilingualNeural", "pt-BR-ThalitaMultilingualNeural"),
        "indicf5-ta": ("indicf5-ta", "indicf5-ta"),
        "piper-offline": ("piper-ta", "piper-en"),
    }
    assert {pid: (pair.ta, pair.en) for pid, pair in PAIRS.items()} == expected


def test_validate_pair_rejects_a_hand_built_bad_pair() -> None:
    bad = VoicePair(id="x", ta="ta-IN-PallaviNeural", en="ta-IN-ValluvarNeural", notes="")
    with pytest.raises(PairMismatchError):
        validate_pair(bad)


def test_voices_endpoint_exposes_the_catalogue(tmp_path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))
    body = client.get("/voices").json()

    assert body["default"] == DEFAULT_PAIR_ID
    assert len(body["voices"]) == len(CATALOGUE)
    assert {pair["id"] for pair in body["pairs"]} == PAIR_IDS


def test_voice_pair_endpoint_resolves_and_rejects(tmp_path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))

    body = client.get("/voices/valluvar").json()
    assert body["ta"] == "ta-IN-ValluvarNeural"
    assert body["en"] == "ta-IN-ValluvarNeural"

    assert client.get("/voices/nobody-nowhere").status_code == 404
    assert client.get("/voices/ta-IN-PallaviNeural").status_code == 422


def test_voice_for_lang_returns_the_one_speaker_for_both_languages() -> None:
    pair = resolve_pair("valluvar")
    assert voice_for_lang(pair, "ta") == "ta-IN-ValluvarNeural"
    assert voice_for_lang(pair, "en") == "ta-IN-ValluvarNeural"

    with pytest.raises(InvalidSelectorError):
        voice_for_lang(pair, "hi")


def test_single_model_pairs_use_the_same_voice_for_both_languages() -> None:
    pair = resolve_pair("indicf5-ta")
    assert voice_for_lang(pair, "ta") == voice_for_lang(pair, "en") == "indicf5-ta"
