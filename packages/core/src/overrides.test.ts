import { describe, expect, it } from 'vitest';
import { hasOverrides, parseOverrides, segmentWithOverrides } from './overrides';
import { segmentText } from './segmenter';
import type { TextRun } from './types';

const stripWs = (s: string): string => s.replace(/\s+/gu, '');

function expectWellFormed(runs: TextRun[]): void {
  for (const run of runs) {
    expect(run.text.trim().length).toBeGreaterThan(0);
  }
  for (let i = 1; i < runs.length; i += 1) {
    expect(runs[i]!.lang).not.toBe(runs[i - 1]!.lang);
  }
}

describe('hasOverrides', () => {
  it('is a cheap positive check', () => {
    expect(hasOverrides('[[ta:vanakkam]]')).toBe(true);
    expect(hasOverrides('vanakkam machan')).toBe(false);
    expect(hasOverrides('')).toBe(false);
    // a lone bracket is not an override
    expect(hasOverrides('array[0]')).toBe(false);
  });
});

describe('parseOverrides — well formed', () => {
  it('strips the marker and records the span', () => {
    const parsed = parseOverrides('[[ta:vanakkam]] machan');
    expect(parsed.text).toBe('vanakkam machan');
    expect(parsed.spans).toEqual([{ start: 0, end: 8, lang: 'ta' }]);
  });

  it('handles several markers with correct offsets', () => {
    const parsed = parseOverrides('hello [[ta:vanakkam]] and [[en:machan]] bye');
    expect(parsed.text).toBe('hello vanakkam and machan bye');
    expect(parsed.spans).toEqual([
      { start: 6, end: 14, lang: 'ta' },
      { start: 19, end: 25, lang: 'en' },
    ]);
  });

  it('maps tl to Tamil, because Tanglish is Tamil speech', () => {
    expect(parseOverrides('[[tl:vanakkam]]').spans).toEqual([
      { start: 0, end: 8, lang: 'ta' },
    ]);
  });

  it('is case-insensitive on the kind', () => {
    expect(parseOverrides('[[TA:vanakkam]]').spans[0]!.lang).toBe('ta');
    expect(parseOverrides('[[En:machan]]').spans[0]!.lang).toBe('en');
  });

  it('keeps the content verbatim, including inner spacing', () => {
    const parsed = parseOverrides('a [[ta: vanakkam ]] b');
    expect(parsed.text).toBe('a  vanakkam  b');
    expect(parsed.spans).toEqual([{ start: 2, end: 12, lang: 'ta' }]);
  });

  it('removes markers without eating any other character', () => {
    const input = 'one [[ta:two]] three [[en:four]] five';
    const { text } = parseOverrides(input);
    expect(stripWs(text)).toBe('onetwothreefourfive');
  });
});

describe('parseOverrides — malformed input never destroys text', () => {
  it('leaves an unclosed marker alone', () => {
    const parsed = parseOverrides('[[ta:vanakkam machan');
    expect(parsed.text).toBe('[[ta:vanakkam machan');
    expect(parsed.spans).toEqual([]);
  });

  it('leaves an empty marker alone', () => {
    const parsed = parseOverrides('before [[ta:]] after');
    expect(parsed.text).toBe('before [[ta:]] after');
    expect(parsed.spans).toEqual([]);
  });

  it('leaves an unknown kind alone', () => {
    const parsed = parseOverrides('[[xx:vanakkam]]');
    expect(parsed.text).toBe('[[xx:vanakkam]]');
    expect(parsed.spans).toEqual([]);
  });

  it('does not let one marker swallow another', () => {
    const parsed = parseOverrides('broken [[ta:marker and [[xx:nope]]');
    expect(parsed.text).toBe('broken [[ta:marker and [[xx:nope]]');
    expect(parsed.spans).toEqual([]);
  });

  it('still finds a valid marker after an unclosed one', () => {
    const parsed = parseOverrides('[[ta:oops [[en:x]] tail');
    expect(parsed.text).toBe('[[ta:oops x tail');
    expect(parsed.spans).toEqual([{ start: 10, end: 11, lang: 'en' }]);
  });

  it('does not throw on emoji, digits or lone brackets', () => {
    for (const input of ['[[', ']]', '[[]]', '[[ta:', '😀 [[en:😀]]', '[[en:123]]']) {
      expect(() => parseOverrides(input)).not.toThrow();
    }
  });
});

describe('segmentText with overrides', () => {
  it('lets a marker beat the lexicon', () => {
    // vanakkam is Tanglish, but the author asked for English.
    const runs = segmentText('vanakkam', {
      overrides: [{ start: 0, end: 8, lang: 'en' }],
    });
    expect(runs).toEqual([{ text: 'vanakkam', lang: 'en', script: 'latin' }]);
  });

  it('lets a marker beat the classifier for an unknown word', () => {
    const runs = segmentText('super', {
      overrides: [{ start: 0, end: 5, lang: 'ta' }],
    });
    expect(runs).toEqual([{ text: 'super', lang: 'ta', script: 'tanglish' }]);
  });

  it('merges forced words into an adjacent run of the same language', () => {
    // "vanakkam machan" is forced to English, and "today" is already English,
    // so the whole sentence is one run with no needless split.
    const runs = segmentText('vanakkam machan today', {
      overrides: [{ start: 0, end: 15, lang: 'en' }],
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ lang: 'en', script: 'latin' });
    expect(runs[0]!.text).toBe('vanakkam machan today');
  });

  it('splits runs when the forced language differs from the neighbours', () => {
    const runs = segmentText('vanakkam machan today', {
      overrides: [{ start: 0, end: 8, lang: 'en' }],
    });
    expect(runs.map((r) => r.lang)).toEqual(['en', 'ta', 'en']);
    expect(runs[0]).toMatchObject({ text: 'vanakkam' });
    expect(runs[1]).toMatchObject({ script: 'tanglish', text: 'machan' });
    expect(runs[2]).toMatchObject({ text: 'today' });
    expectWellFormed(runs);
  });

  it('ignores a span that only covers part of a word', () => {
    const runs = segmentText('vanakkam', {
      overrides: [{ start: 3, end: 8, lang: 'en' }],
    });
    // half a word cannot be half a voice
    expect(runs).toEqual([{ text: 'vanakkam', lang: 'ta', script: 'tanglish' }]);
  });

  it('keeps the run invariants', () => {
    const input = 'இன்னைக்கு vanakkam about money';
    const tokens = input.split(' ');
    let offset = 0;
    const overrides: { start: number; end: number; lang: 'ta' | 'en' }[] = [];
    for (const token of tokens) {
      if (token === 'about') {
        overrides.push({ start: offset, end: offset + token.length, lang: 'ta' });
      }
      offset += token.length + 1;
    }
    const runs = segmentText(input, { overrides });
    expectWellFormed(runs);
    expect(stripWs(runs.map((r) => r.text).join(''))).toBe(stripWs(input));
    // "about" is forced to Tamil and merges into the surrounding Tamil run
    const taRun = runs.find((r) => r.lang === 'ta' && r.text.includes('about'));
    expect(taRun).toBeDefined();
    expect(runs.at(-1)).toMatchObject({ lang: 'en', text: 'money' });
  });
});

describe('segmentWithOverrides', () => {
  it('is the one call the pipeline needs', () => {
    const result = segmentWithOverrides(
      'today we say [[tl:vanakkam]] to everyone',
    );
    expect(result.text).toBe('today we say vanakkam to everyone');
    expect(result.spans).toEqual([{ start: 13, end: 21, lang: 'ta' }]);
    expect(result.runs.map((r) => r.lang)).toEqual(['en', 'ta', 'en']);
    expectWellFormed(result.runs);
  });

  it('is a pass-through when there are no markers', () => {
    const input = 'vanakkam machan';
    const result = segmentWithOverrides(input);
    expect(result.text).toBe(input);
    expect(result.spans).toEqual([]);
    expect(result.runs).toEqual(segmentText(input));
  });

  it('still honours the caller options for unforced text', () => {
    const result = segmentWithOverrides('oorukku [[en:x]]', { morphology: false });
    expect(result.runs[0]).toMatchObject({ lang: 'en' });
  });

  it('forces a Tamil run in the middle of an English sentence', () => {
    const result = segmentWithOverrides(
      'The biggest mistake is [[ta:நேரம் வீணாக்குவது]], and everyone does it.',
    );
    expect(result.runs.map((r) => r.lang)).toEqual(['en', 'ta', 'en']);
    expect(result.runs[1]!.script).toBe('tamil');
  });
});
