/**
 * Emoji sprinkling contract (roadmap P4 task 4).
 *
 * docs/04 §5: emoji are opt-in, only on emphasis words, only from an
 * allow-list, and never more than one per two cues. These tests pin the exact
 * allow-list, the deterministic selection and the rule that sprinkling never
 * mutates the caption text — `cue.lines` still reconstructs the narration, and
 * the emoji is a separate presentational field the ASS writer may use.
 */

import { describe, expect, it } from 'vitest';

import { clusterCount, type CaptionCue, type CaptionWord } from './captions';
import {
  EMOJI_ALLOW_LIST,
  emojiForWord,
  isEmphasisWord,
  sprinkleEmoji,
} from './emoji';

const word = (text: string, startMs: number, endMs: number): CaptionWord => ({
  text,
  startMs,
  endMs,
});

function cue(words: readonly CaptionWord[], emoji?: string): CaptionCue {
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) throw new Error('empty cue');
  return {
    lines: [words.map((entry) => entry.text).join(' ')],
    words: [...words],
    startMs: first.startMs,
    endMs: last.endMs,
    ...(emoji === undefined ? {} : { emoji }),
  };
}

const cueWith = (text: string, offsetMs = 0): CaptionCue =>
  cue([word(text, offsetMs, offsetMs + 400)]);

describe('emoji allow-list', () => {
  it('only contains single-cluster emoji with unique, lowercase words', () => {
    const emoji = EMOJI_ALLOW_LIST.map((rule) => rule.emoji);
    expect(new Set(emoji).size).toBe(emoji.length);
    expect(emoji.length).toBeGreaterThanOrEqual(6);

    const words = EMOJI_ALLOW_LIST.flatMap((rule) => rule.words);
    expect(new Set(words).size).toBe(words.length);
    for (const value of words) {
      expect(value).not.toBe('');
      expect(value).toBe(value.toLowerCase());
    }
    for (const value of emoji) {
      expect(clusterCount(value)).toBe(1);
    }
  });

  it('maps punctuation-wrapped English and Tamil words case-insensitively', () => {
    expect(emojiForWord('FIRE!')).toBe('🔥');
    expect(emojiForWord('fire,')).toBe('🔥');
    expect(emojiForWord('நன்றி!')).toBe('🙏');
    expect(emojiForWord('not-on-the-list')).toBeUndefined();
    expect(emojiForWord('')).toBeUndefined();
  });

  it('trims long punctuation runs without a backtracking regex', () => {
    const noise = '"'.repeat(20_000);
    expect(emojiForWord(`${noise}fire!${noise}`)).toBe('🔥');
    expect(isEmphasisWord(`${noise}wow!${noise}`)).toBe(true);
  });

  it('treats trailing ! ? … and ALL-CAPS Latin words as emphasis', () => {
    expect(isEmphasisWord('wow!')).toBe(true);
    expect(isEmphasisWord('really?')).toBe(true);
    expect(isEmphasisWord('நன்றி!')).toBe(true);
    expect(isEmphasisWord('NO')).toBe(false); // too short to be deliberate
    expect(isEmphasisWord('SUPER')).toBe(true);
    expect(isEmphasisWord('super')).toBe(false);
    expect(isEmphasisWord('நல்லது')).toBe(false);
  });
});

describe('sprinkleEmoji', () => {
  it('is a no-op unless the template opts in', () => {
    const cues = [cueWith('fire!'), cueWith('wow!', 1000)];
    expect(sprinkleEmoji(cues, { enabled: false })).toBe(cues);
    for (const entry of sprinkleEmoji(cues, { enabled: false })) {
      expect('emoji' in entry).toBe(false);
    }
  });

  it('adds the allow-listed emoji without rewriting words, lines or timing', () => {
    const original = cueWith('fire!');
    const [sprinkled] = sprinkleEmoji([original], { enabled: true });

    expect(sprinkled?.emoji).toBe('🔥');
    expect(sprinkled?.words).toEqual(original.words);
    expect(sprinkled?.lines).toEqual(original.lines);
    expect(sprinkled?.startMs).toBe(original.startMs);
    expect(sprinkled?.endMs).toBe(original.endMs);
    expect(sprinkled?.lines.join(' ')).toBe('fire!');
    expect(original.emoji).toBeUndefined();
  });

  it('never puts an emoji on two consecutive cues', () => {
    const cues = Array.from({ length: 5 }, (_, index) =>
      cueWith('fire!', index * 1000),
    );
    const chosen = sprinkleEmoji(cues, { enabled: true })
      .map((entry, index) => (entry.emoji === undefined ? -1 : index))
      .filter((index) => index >= 0);
    expect(chosen).toEqual([0, 2, 4]);
  });

  it('honours a larger minimum gap', () => {
    const cues = Array.from({ length: 7 }, (_, index) =>
      cueWith('நன்றி!', index * 1000),
    );
    const chosen = sprinkleEmoji(cues, { enabled: true, minCueGap: 3 })
      .map((entry, index) => (entry.emoji === undefined ? -1 : index))
      .filter((index) => index >= 0);
    expect(chosen).toEqual([0, 3, 6]);
  });

  it('ignores words that are not on the allow-list', () => {
    const [sprinkled] = sprinkleEmoji([cueWith('சாதாரண வார்த்தை.')], {
      enabled: true,
    });
    expect(sprinkled?.emoji).toBeUndefined();
  });

  it('matches a Tamil allow-listed word', () => {
    const [sprinkled] = sprinkleEmoji(
      [cue([word('மிக்க', 0, 300), word('நன்றி!', 300, 700)])],
      { enabled: true },
    );
    expect(sprinkled?.emoji).toBe('🙏');
  });

  it('accepts an emphasised allow-listed word inside a cue', () => {
    const [sprinkled] = sprinkleEmoji(
      [cue([word('wow!', 0, 200), word('இது', 200, 500), word('நல்லது.', 500, 900)])],
      { enabled: true },
    );
    expect(sprinkled?.emoji).toBe('😮');
  });

  it('does not treat an unmarked allow-listed word mid-cue as emphasis', () => {
    const [sprinkled] = sprinkleEmoji(
      [cue([word('idea', 0, 200), word('இது', 200, 500), word('நல்லது.', 500, 900)])],
      { enabled: true },
    );
    expect(sprinkled?.emoji).toBeUndefined();
  });

  it('is idempotent and preserves an existing emoji while counting its gap', () => {
    const cues = [
      cueWith('fire!'),
      cueWith('wow!', 1000),
      cueWith('wow!', 2000),
      cueWith('wow!', 3000),
    ];
    const once = sprinkleEmoji(cues, { enabled: true });
    expect(sprinkleEmoji(once, { enabled: true })).toEqual(once);
    expect(once[0]?.emoji).toBe('🔥');
    expect(once[1]?.emoji).toBeUndefined();
    expect(once[2]?.emoji).toBe('😮');
    expect(once[3]?.emoji).toBeUndefined();

    const pinned = sprinkleEmoji(
      [cueWith('plain', 0), cueWith('wow!', 1000), cueWith('wow!', 2000), cueWith('wow!', 3000)],
      { enabled: true },
    );
    expect(pinned[1]?.emoji).toBe('😮');
    expect(pinned[2]?.emoji).toBeUndefined();
    expect(pinned[3]?.emoji).toBe('😮');
  });

  it('rejects an impossible gap instead of silently changing it', () => {
    expect(() => sprinkleEmoji([cueWith('fire!')], { enabled: true, minCueGap: 0 })).toThrow(
      /minCueGap/,
    );
    expect(() => sprinkleEmoji([cueWith('fire!')], { enabled: true, minCueGap: 1.5 })).toThrow(
      /minCueGap/,
    );
  });
});
