"""Gap length between runs, decided by the punctuation between them.

A bilingual narration needs pauses of different sizes: a comma is a breath, a
full stop is a beat, a paragraph is a scene change. One global `gap_ms` cannot
express that, and using sentence-sized pauses everywhere is what makes
machine narration sound monotonous.

Values are midpoints of the ranges in `docs/05-tts-tamil-mixed.md` §3.4. They are
deterministic on purpose: the same script must produce the same timeline.
"""

from __future__ import annotations

from typing import Literal

Boundary = Literal["none", "comma", "clause", "sentence", "paragraph"]

# docs/05 §3.4, midpoint of each documented range.
BASE_GAP_MS: dict[Boundary, int] = {
    "none": 0,
    "comma": 110,
    "clause": 180,
    "sentence": 300,
    "paragraph": 475,
}

SENTENCE_END = ".!?।…"
CLAUSE_END = ";:—–"
COMMA_END = ",，、"


def classify_boundary(before: str, after: str) -> Boundary:
    """Classify the join between two runs from their own text.

    `before` is the text of the run that just finished, `after` the text of the
    next run. The segmenter keeps punctuation attached to runs, so the join is
    visible without a separate punctuation track.
    """
    if "\n" in before or "\n" in after:
        return "paragraph"

    tail = before.rstrip()
    head = after.lstrip()

    if tail and tail[-1] in SENTENCE_END:
        return "sentence"
    if tail and tail[-1] in CLAUSE_END:
        return "clause"
    if tail and tail[-1] in COMMA_END:
        return "comma"
    # A run may start with the punctuation that closed the previous one when the
    # caller split text on whitespace instead of using the segmenter.
    if head and head[0] in SENTENCE_END:
        return "sentence"
    if head and head[0] in CLAUSE_END:
        return "clause"
    if head and head[0] in COMMA_END:
        return "comma"
    return "none"


def gap_ms_for(boundary: Boundary, *, speed: float = 1.0) -> int:
    """Base gap scaled by delivery speed, so a 120 % read does not drag."""
    if speed <= 0:
        raise ValueError(f"speed must be positive, got {speed!r}")
    return round(BASE_GAP_MS[boundary] / speed)
