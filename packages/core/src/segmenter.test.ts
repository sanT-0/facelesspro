import { describe, expect, it } from 'vitest';
import { DEFAULT_TANGLISH, segmentText } from './segmenter';
import type { TextRun } from './types';

const stripWs = (s: string): string => s.replace(/\s+/gu, '');

function expectLossless(input: string, runs: TextRun[]): void {
  expect(stripWs(runs.map((r) => r.text).join(''))).toBe(stripWs(input));
}

function expectWellFormed(runs: TextRun[]): void {
  for (const run of runs) {
    expect(run.text.trim().length).toBeGreaterThan(0);
  }
  for (let i = 1; i < runs.length; i += 1) {
    expect(runs[i]!.lang).not.toBe(runs[i - 1]!.lang);
  }
}

describe('segmentText — single script', () => {
  it('keeps pure Tamil as one run', () => {
    const input = 'இன்று நாம படம் பார்க்கப் போகிறோம்.';
    const runs = segmentText(input);
    expect(runs).toEqual([{ text: input, lang: 'ta', script: 'tamil' }]);
    expectLossless(input, runs);
  });

  it('keeps pure English as one run', () => {
    const input = 'Today we are going to the movies.';
    const runs = segmentText(input);
    expect(runs).toEqual([{ text: input, lang: 'en', script: 'latin' }]);
    expectLossless(input, runs);
  });

  it('treats English acronyms as English', () => {
    const runs = segmentText('AI is changing everything');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.lang).toBe('en');
  });
});

describe('segmentText — mixed Tamil and English', () => {
  it('splits the gate sample into exactly four runs', () => {
    const input = "இன்று budget planning பண்ணுவோம், let's start";
    const runs = segmentText(input);

    expect(runs).toHaveLength(4);
    expect(runs).toEqual([
      { text: 'இன்று', lang: 'ta', script: 'tamil' },
      { text: 'budget planning', lang: 'en', script: 'latin' },
      { text: 'பண்ணுவோம்,', lang: 'ta', script: 'tamil' },
      { text: "let's start", lang: 'en', script: 'latin' },
    ]);
    expectWellFormed(runs);
    expectLossless(input, runs);
  });

  it('preserves order when English comes first', () => {
    const runs = segmentText('Let us start. இப்போ ஆரம்பிக்கலாம்.');
    expect(runs.map((r) => r.lang)).toEqual(['en', 'ta']);
    expect(runs[0]!.text).toBe('Let us start.');
  });

  it('alternates for long code-switched sentences', () => {
    const runs = segmentText('one இரு two மூன்று three');
    expect(runs.map((r) => r.lang)).toEqual(['en', 'ta', 'en', 'ta', 'en']);
    expectWellFormed(runs);
  });

  it('keeps punctuation with the preceding run', () => {
    const runs = segmentText('நல்லா இருக்கு, really good!');
    expect(runs[0]).toEqual({
      text: 'நல்லா இருக்கு,',
      lang: 'ta',
      script: 'tamil',
    });
    expect(runs[1]).toMatchObject({ text: 'really good!', lang: 'en' });
  });

  it('handles a Latin brand name inside Tamil', () => {
    const runs = segmentText('இது Google Maps பத்தி');
    expect(runs.map((r) => r.lang)).toEqual(['ta', 'en', 'ta']);
  });

  it('handles newlines as separators', () => {
    const runs = segmentText('hello\n\nவணக்கம்');
    expect(runs.map((r) => r.lang)).toEqual(['en', 'ta']);
    expect(runs[1]!.text).toBe('வணக்கம்');
  });
});

describe('segmentText — Tanglish', () => {
  it('routes a romanised Tamil word to the Tamil voice', () => {
    const runs = segmentText('vanakkam');
    expect(runs).toEqual([
      { text: 'vanakkam', lang: 'ta', script: 'tanglish' },
    ]);
  });

  it('recognises uppercase Tanglish', () => {
    const runs = segmentText('Vanakkam Machan');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.lang).toBe('ta');
    expect(runs[0]!.script).toBe('tanglish');
  });

  it('splits Tanglish from English', () => {
    const runs = segmentText("vanakkam machan, let's go");
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ lang: 'ta', script: 'tanglish' });
    expect(runs[1]).toMatchObject({ lang: 'en', script: 'latin' });
    expectWellFormed(runs);
  });

  it('merges Tanglish and Tamil script into one Tamil run', () => {
    const runs = segmentText('vanakkam இருங்க');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.lang).toBe('ta');
    expect(runs[0]!.script).toBe('tamil');
  });

  it('accepts a custom lexicon', () => {
    const lexicon = new Set(['thalapathy']);
    const runs = segmentText('thalapathy is back', { tanglish: lexicon });
    expect(runs[0]).toMatchObject({ lang: 'ta', script: 'tanglish' });
    expect(DEFAULT_TANGLISH.has('thalapathy')).toBe(false);
  });
});

describe('segmentText — edge cases', () => {
  it('returns nothing for an empty string', () => {
    expect(segmentText('')).toEqual([]);
  });

  it('returns nothing for whitespace only', () => {
    expect(segmentText('   \n\t ')).toEqual([]);
  });

  it('returns nothing for punctuation only', () => {
    expect(segmentText('... !!! ,,,')).toEqual([]);
  });

  it('attaches digits to the surrounding run', () => {
    const runs = segmentText('அத்தியாயம் 5');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe('அத்தியாயம் 5');
    expect(runs[0]!.lang).toBe('ta');
  });

  it('attaches emoji to the surrounding run', () => {
    const input = 'நல்லா இருக்கு 😀';
    const runs = segmentText(input);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.lang).toBe('ta');
    expectLossless(input, runs);
  });

  it('keeps zero-width joiners inside Tamil words', () => {
    const runs = segmentText('க\u200dஷ');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.lang).toBe('ta');
  });

  it('trims only the edges', () => {
    const runs = segmentText('   இன்று  நாம   ');
    expect(runs).toEqual([
      { text: 'இன்று  நாம', lang: 'ta', script: 'tamil' },
    ]);
  });

  it('keeps quotes around Tamil text in the same run', () => {
    const runs = segmentText('"வணக்கம்" என்றார்');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe('"வணக்கம்" என்றார்');
  });

  it('treats a sentence of English after Tamil as two runs', () => {
    const input = 'இது ஒரு test. This is English.';
    const runs = segmentText(input);
    expect(runs.map((r) => r.lang)).toEqual(['ta', 'en']);
    expectLossless(input, runs);
  });

  it('never loses non-whitespace characters', () => {
    const samples = [
      'இன்று budget planning பண்ணுவோம், let\'s start',
      'hello\n\nவணக்கம்',
      '"வணக்கம்" என்றார்',
      'Episode 5: நாம ஆரம்பிக்கலாம்',
      'one இரு two மூன்று three',
    ];
    for (const sample of samples) {
      expectLossless(sample, segmentText(sample));
    }
  });
});
