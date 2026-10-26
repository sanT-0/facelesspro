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
}

PAIR_IDS = {"pallavi-neerja", "valluvar-prabhat", "indicf5-ta", "piper-offline"}


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


def test_edge_voices_are_single_language_and_report_word_boundaries() -> None:
    for voice in CATALOGUE.values():
        if voice.engine != "edge":
            continue
        assert len(voice.languages) == 1, voice.id
        assert voice.word_timings is True, voice.id


def test_every_pair_validates() -> None:
    for pair in PAIRS.values():
        validate_pair(pair)


def test_pairs_keep_one_speaker_across_languages() -> None:
    for pair in PAIRS.values():
        ta = get_voice(pair.ta)
        en = get_voice(pair.en)
        assert ta.gender == en.gender, pair.id
        assert "ta" in ta.languages, pair.id
        assert "en" in en.languages, pair.id


def test_default_pair_is_the_documented_one() -> None:
    assert DEFAULT_PAIR_ID == "pallavi-neerja"
    assert resolve_pair() == get_pair("pallavi-neerja")
    assert resolve_pair(None) == get_pair("pallavi-neerja")


def test_resolve_by_pair_id_and_explicit_mapping() -> None:
    assert resolve_pair("valluvar-prabhat").ta == "ta-IN-ValluvarNeural"

    resolved = resolve_pair(
        {"ta": "ta-IN-PallaviNeural", "en": "en-IN-NeerjaNeural"}
    )
    assert resolved.ta == "ta-IN-PallaviNeural"
    assert resolved.en == "en-IN-NeerjaNeural"
    validate_pair(resolved)


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
        resolve_pair(
            {"ta": "ta-IN-PallaviNeural", "en": "en-IN-NeerjaNeural", "hi": "x"}
        )
    with pytest.raises(UnknownVoiceError):
        resolve_pair({"ta": "ta-IN-Nobody", "en": "en-IN-NeerjaNeural"})


def test_gender_mismatch_is_not_silent() -> None:
    with pytest.raises(PairMismatchError):
        resolve_pair({"ta": "ta-IN-PallaviNeural", "en": "en-IN-PrabhatNeural"})


def test_language_mismatch_is_not_silent() -> None:
    with pytest.raises(PairMismatchError):
        resolve_pair({"ta": "ta-IN-PallaviNeural", "en": "ta-IN-ValluvarNeural"})


def test_mixed_engines_are_rejected() -> None:
    with pytest.raises(PairMismatchError):
        resolve_pair({"ta": "indicf5-ta", "en": "en-IN-NeerjaNeural"})


def test_unknown_voice_lookup() -> None:
    with pytest.raises(UnknownVoiceError):
        get_voice("ta-IN-Nobody")


def test_pair_of_one_voice_is_only_allowed_when_it_covers_both() -> None:
    for pair in PAIRS.values():
        if pair.ta == pair.en:
            voice = get_voice(pair.ta)
            assert {"ta", "en"} <= set(voice.languages), pair.id


def test_catalogue_is_json_ready() -> None:
    payload = {"voices": catalogue(), "pairs": pair_catalogue()}
    round_tripped = json.loads(json.dumps(payload))

    assert len(round_tripped["voices"]) == len(CATALOGUE)
    assert len(round_tripped["pairs"]) == len(PAIRS)
    assert round_tripped["pairs"][0]["id"] == "pallavi-neerja"
    assert isinstance(voice_dict(get_voice("indicf5-ta"))["languages"], list)


def test_documented_pairs_match_the_table_in_docs_05() -> None:
    expected = {
        "pallavi-neerja": ("ta-IN-PallaviNeural", "en-IN-NeerjaNeural"),
        "valluvar-prabhat": ("ta-IN-ValluvarNeural", "en-IN-PrabhatNeural"),
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

    body = client.get("/voices/pallavi-neerja").json()
    assert body["ta"] == "ta-IN-PallaviNeural"
    assert body["en"] == "en-IN-NeerjaNeural"

    assert client.get("/voices/nobody-nowhere").status_code == 404
    assert client.get("/voices/ta-IN-PallaviNeural").status_code == 422


def test_voice_for_lang_routes_each_run_to_its_half_of_the_pair() -> None:
    pair = resolve_pair("pallavi-neerja")
    assert voice_for_lang(pair, "ta") == "ta-IN-PallaviNeural"
    assert voice_for_lang(pair, "en") == "en-IN-NeerjaNeural"

    with pytest.raises(InvalidSelectorError):
        voice_for_lang(pair, "hi")


def test_single_model_pairs_use_the_same_voice_for_both_languages() -> None:
    pair = resolve_pair("indicf5-ta")
    assert voice_for_lang(pair, "ta") == voice_for_lang(pair, "en") == "indicf5-ta"
