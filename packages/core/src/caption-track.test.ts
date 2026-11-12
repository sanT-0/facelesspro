/**
 * Shared caption-track builder.
 *
 * `create-captions` and the preview route must produce the same cues for the
 * same narration and template. These tests pin the defaults, the template
 * overrides and the Tamil rule: a line break never falls inside a grapheme
 * cluster.
 */

import { describe, expect, it } from 'vitest';

import { CAPTION_MAX_CHARS_PER_LINE, buildCaptionTrack } from './caption-track';
import type { CaptionWord } from './captions';

const words: CaptionWord[] = [
  { text: 'தமிழ்', startMs: 0, endMs: 400 },
  { text: 'முதல்', startMs: 400, endMs: 800 },
  { text: 'காட்சி', startMs: 800, endMs: 1_200 },
  { text: 'இரண்டாவது', startMs: 1_200, endMs: 1_600 },
  { text: 'காட்சி', startMs: 1_600, endMs: 2_000 },
  { text: 'முடிந்தது.', startMs: 2_000, endMs: 2_400 },
  { text: 'அடுத்து', startMs: 2_400, endMs: 2_800 },
];

describe('buildCaptionTrack', () => {
  it('applies the documented defaults: six words, two lines', () => {
    const cues = buildCaptionTrack(words, {
      maxCharsPerLine: CAPTION_MAX_CHARS_PER_LINE.landscape,
    });

    expect(cues[0]?.words).toHaveLength(6);
    expect(cues[0]?.lines.length).toBeLessThanOrEqual(2);
    expect(cues.map((cue) => cue.words.length).reduce((a, b) => a + b, 0)).toBe(7);
    expect(cues[1]?.words[0]?.text).toBe('அடுத்து');
  });

  it('honours a smaller word limit and never splits a Tamil cluster', () => {
    const cues = buildCaptionTrack(words, {
      wordLimit: 2,
      maxCharsPerLine: CAPTION_MAX_CHARS_PER_LINE.portrait,
    });

    expect(cues.length).toBeGreaterThan(2);
    for (const cue of cues) {
      expect(cue.words.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) {
        // Every Tamil word survives whole: no line starts or ends mid-cluster.
        for (const word of cue.words) {
          if (line.includes(word.text.slice(0, 2))) {
            expect(line).toContain(word.text);
          }
        }
      }
    }
    expect(cues.flatMap((cue) => cue.words.map((word) => word.text))).toEqual(
      words.map((word) => word.text),
    );
  });

  it('decorates cues only when emoji is enabled', () => {
    const emphasis: CaptionWord[] = [
      { text: 'இந்த', startMs: 0, endMs: 300 },
      { text: 'fire!', startMs: 300, endMs: 600 },
      { text: 'அடுத்து', startMs: 600, endMs: 900 },
    ];
    const plain = buildCaptionTrack(emphasis, {
      maxCharsPerLine: CAPTION_MAX_CHARS_PER_LINE.landscape,
      emoji: false,
    });
    const decorated = buildCaptionTrack(emphasis, {
      maxCharsPerLine: CAPTION_MAX_CHARS_PER_LINE.landscape,
      emoji: true,
    });

    expect(plain.every((cue) => cue.emoji === undefined)).toBe(true);
    expect(decorated[0]?.emoji).toBe('🔥');
    // Decoration never rewrites the spoken text.
    expect(decorated.map((cue) => cue.lines.join(' ')).join(' ')).toBe(
      plain.map((cue) => cue.lines.join(' ')).join(' '),
    );
  });

  it('rejects an empty narration', () => {
    expect(() =>
      buildCaptionTrack([], { maxCharsPerLine: CAPTION_MAX_CHARS_PER_LINE.landscape }),
    ).toThrow(/no words/);
  });
});
