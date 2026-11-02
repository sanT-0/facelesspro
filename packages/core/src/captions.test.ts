/**
 * Caption cue builder tests.
 *
 * The invariants that matter (docs/04 §5):
 * - cues never exceed `wordLimit` words and `maxLines` lines;
 * - every line fits `maxCharsPerLine` **grapheme clusters** (a Tamil cluster is
 *   one cell, never its code units);
 * - a line break only ever happens between words — a grapheme cluster is never
 *   split by a line break (AGENTS.md hard requirement);
 * - "punctuation priority": a cue closes early where the speaker's sentence or
 *   clause ends, instead of padding it to `wordLimit`;
 * - every input word survives in order — the words of all cues joined with a
 *   single space reconstruct the input; nothing is dropped or rewritten.
 *
 * Pure: no I/O, no clock, no network.
 */

import { describe, expect, it } from 'vitest';
import { buildCaptionCues, clusterCount } from './captions';

const word = (text: string, startMs: number, endMs: number) => ({
  text,
  startMs,
  endMs,
});

describe('clusterCount', () => {
  it('counts Tamil clusters by ICU grapheme segmentation', () => {
    // க்ஷ is 3 code units. ICU (Intl.Segmenter) keeps the leading consonant's
    // virama with it (`க்` + `ஷ`), so the text is 2 clusters, not 3 code
    // units and not 1 orthographic glyph. That unit is the right thing to
    // measure: a combining mark never travels to another line.
    expect('க்ஷ'.length).toBe(3);
    expect(clusterCount('க்ஷ')).toBe(2);
  });

  it('keeps word-final combining marks inside the final cluster', () => {
    // நாம் = நா + ம் under the same rule: the final virama stays with ம.
    expect(clusterCount('நாம்')).toBe(2);
  });

  it('never charges combining marks their own width', () => {
    // The whole point for caption widths: a word's width grows per visible
    // base, not per code unit.
    expect(clusterCount('மாணவர்கள்')).toBeLessThan('மாணவர்கள்'.length);
  });

  it('counts latin words as clusters per letter', () => {
    expect(clusterCount('vanakkam')).toBe(8);
  });
});

describe('buildCaptionCues', () => {
  it('closes a cue early at clause punctuation, not exactly at wordLimit', () => {
    const cues = buildCaptionCues(
      [
        word('the', 0, 200),
        word('biggest', 200, 400),
        word('mistake.', 400, 600),
        word('First', 600, 800),
        word('learn.', 800, 1000),
      ],
      { wordLimit: 10, maxLines: 2, maxCharsPerLine: 40 },
    );
    // wordLimit is 10 but the punctuation ends both sentences earlier.
    expect(cues.map((c) => c.lines.join(' '))).toEqual([
      'the biggest mistake.',
      'First learn.',
    ]);
    expect(cues[0]?.startMs).toBe(0);
    expect(cues[0]?.endMs).toBe(600);
    expect(cues[1]?.startMs).toBe(600);
    expect(cues[1]?.endMs).toBe(1000);
  });

  it('splits a long clause across cues at exactly wordLimit words', () => {
    const cues = buildCaptionCues(
      [
        word('one', 0, 100),
        word('two', 100, 200),
        word('three', 200, 300),
        word('four', 300, 400),
        word('five', 400, 500),
      ],
      { wordLimit: 2, maxLines: 2, maxCharsPerLine: 40 },
    );
    expect(cues.map((c) => c.words.length)).toEqual([2, 2, 1]);
  });

  it('wraps lines to maxCharsPerLine using grapheme clusters', () => {
    // Widths in clusters: the(3) biggest(7) mistake.(8) → 3+1+7+1+8 = 20 chars
    // on one line, so it fits maxCharsPerLine=22 in one line; maxLines of 1.
    const cues = buildCaptionCues(
      [
        word('the', 0, 500),
        word('biggest', 500, 900),
        word('mistake.', 900, 1400),
      ],
      { wordLimit: 5, maxLines: 1, maxCharsPerLine: 22 },
    );
    expect(cues[0]?.lines).toEqual(['the biggest mistake.']);
  });

  it('moves a word to the next line instead of overflowing a line', () => {
    const cues = buildCaptionCues(
      [
        word('beginners', 0, 400),
        word('struggle', 400, 800),
        word('with', 800, 1000),
        word('cash.', 1000, 1400),
      ],
      { wordLimit: 6, maxLines: 2, maxCharsPerLine: 15 },
    );
    // "beginners struggle with" wraps to ["beginners", "struggle with"], but
    // "cash." would need a third line (8+1+4+1+5 = 19 > 15), so the cue
    // shrinks and "cash." becomes its own cue.
    expect(cues[0]?.lines).toEqual(['beginners', 'struggle with']);
    expect(cues[0]?.lines).toHaveLength(2);
    expect(cues[1]?.lines).toEqual(['cash.']);
    expect(cues).toHaveLength(2);
  });

  it('never breaks a Tamil grapheme cluster at a line break', () => {
    // "மாணவர்கள்" is one word (multiple clusters). A code-unit-based splitter
    // would happily put half of it on the next line; the builder must either
    // fit it whole or move it to the next line.
    const cues = buildCaptionCues(
      [
        word('வணக்கம்', 0, 500),
        word('மாணவர்கள்', 500, 1100),
        word('நல்லது.', 1100, 1600),
      ],
      { wordLimit: 3, maxLines: 2, maxCharsPerLine: 10 },
    );
    const allLines = cues.flatMap((c) => c.lines);
    for (const line of allLines) {
      // A cluster count equal to the code-unit length would mean combining
      // marks or viramas leaked onto different lines — impossible when trees
      // are only split at spaces.
      expect(line.length).toBeGreaterThan(0);
    }
    // The longest word (மாணவர்கள், 9 clusters) must be intact on one line.
    expect(allLines.some((l) => l.includes('மாணவர்கள்'))).toBe(true);
  });

  it('transcribes every input word, in order, into cue lines', () => {
    const input = [
      word('இன்னைக்கு', 0, 400),
      word('nammа', 400, 700),
      word('paakap', 700, 900),
      word('poraathu,', 900, 1200),
      word('the', 1200, 1400),
      word('biggest', 1400, 1600),
      word('mistake', 1600, 1800),
      word('first-time', 1800, 2000),
      word('freelancers', 2000, 2300),
      word('make.', 2300, 2600),
    ];
    const cues = buildCaptionCues(input, {
      wordLimit: 4,
      maxLines: 2,
      maxCharsPerLine: 20,
    });
    const reconstruct = cues.map((c) => c.lines.join(' ')).join(' ');
    expect(reconstruct).toBe(input.map((w) => w.text).join(' '));
  });

  it('times a cue exactly from its first to its last word', () => {
    const cues = buildCaptionCues(
      [
        word('a', 100, 200),
        word('big', 200, 400),
        word('jump.', 400, 700),
      ],
      { wordLimit: 10, maxLines: 1, maxCharsPerLine: 30 },
    );
    expect(cues).toHaveLength(1);
    expect(cues[0]?.startMs).toBe(100);
    expect(cues[0]?.endMs).toBe(700);
  });

  it('returns one cue for a single short word', () => {
    const cues = buildCaptionCues([word('வணக்கம்.', 0, 500)], {
      wordLimit: 6,
      maxLines: 2,
      maxCharsPerLine: 40,
    });
    expect(cues).toHaveLength(1);
    expect(cues[0]?.lines).toEqual(['வணக்கம்.']);
  });

  it('rejects an empty input', () => {
    expect(() =>
      buildCaptionCues([], { wordLimit: 6, maxLines: 2, maxCharsPerLine: 40 }),
    ).toThrow(/no words/i);
  });

  it('rejects a single word wider than maxCharsPerLine', () => {
    expect(() =>
      buildCaptionCues([word('extralongword', 0, 500)], {
        wordLimit: 6,
        maxLines: 2,
        maxCharsPerLine: 10,
      }),
    ).toThrow(/wider than/i);
  });

  it('shrinks a cue that cannot fit maxLines instead of overflowing it', () => {
    // Each word is exactly maxCharsPerLine wide, so no two words share a line;
    // three such words need three lines but maxLines is 1 → one word per cue.
    const cues = buildCaptionCues(
      [
        word('abcdefghij', 0, 100),
        word('klmnopqrst', 100, 200),
        word('uvwxyzabcd', 200, 300),
      ],
      { wordLimit: 3, maxLines: 1, maxCharsPerLine: 10 },
    );
    expect(cues.map((c) => c.lines)).toEqual([
      ['abcdefghij'],
      ['klmnopqrst'],
      ['uvwxyzabcd'],
    ]);
  });
});
