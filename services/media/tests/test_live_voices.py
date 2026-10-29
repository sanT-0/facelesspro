from __future__ import annotations

import asyncio
import os

import edge_tts
import pytest

from app.voices import CATALOGUE, PAIRS, validate_pair

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE") != "1",
    reason="live provider test; set RUN_LIVE=1",
)


def test_pinned_edge_voices_still_exist() -> None:
    """Microsoft removes voices without notice; a pair must fail loudly, not mid-render."""
    live = {voice["ShortName"] for voice in asyncio.run(edge_tts.list_voices())}
    pinned = {v.id for v in CATALOGUE.values() if v.engine == "edge"}

    missing = sorted(pinned - live)
    assert not missing, f"voices disappeared from edge-tts: {missing}"


def test_every_pinned_pair_still_validates() -> None:
    for pair in PAIRS.values():
        validate_pair(pair)
