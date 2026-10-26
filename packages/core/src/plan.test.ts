import { describe, expect, it } from 'vitest';
import { buildNarrationPlan, planToSegments } from './plan';
import type { NarrationPlanOptions } from './plan';
import { expandNumbersSpanned } from './numbers';

const VOICES: NarrationPlanOptions = {
  ta: 'ta-IN-PallaviNeural',
  en: 'en-IN-NeerjaNeural',
  pair: 'pallavi-neerja',
};

const LATIN = /[A-Za-z]/u;

describe('buildNarrationPlan — voice routing', () => {
  it('routes every run to the voice of its own language', () => {
    const plan = buildNarrationPlan(
      'இன்று நாம் budget planning பண்ணுவோம். today we talk about money.',
      VOICES,
    );

    expect(plan.runs.length).toBeGreaterThanOrEqual(2);
    for (const run of plan.runs) {
      expect(run.voice).toBe(run.lang === 'ta' ? VOICES.ta : VOICES.en);
    }
    expect(plan.runs.some((run) => run.lang === 'ta')).toBe(true);
    expect(plan.runs.some((run) => run.lang === 'en')).toBe(true);
  });

  it('never leaves two adjacent runs in the same language', () => {
    const plan = buildNarrationPlan(
      'நான் office-க்கு போறேன் and then I will come back home.',
      VOICES,
    );
    for (let i = 1; i < plan.runs.length; i += 1) {
      expect(plan.runs[i]!.lang).not.toBe(plan.runs[i - 1]!.lang);
    }
  });

  it('keeps the pair id and the original script', () => {
    const plan = buildNarrationPlan('hello', VOICES);
    expect(plan.pair).toBe('pallavi-neerja');
    expect(plan.script).toBe('hello');
  });

  it('returns no runs for empty or whitespace-only input', () => {
    for (const script of ['', '   ', '\n\n']) {
      const plan = buildNarrationPlan(script, VOICES);
      expect(plan.runs).toEqual([]);
      expect(plan.spokenText).toBe('');
    }
  });

  it('keeps a malformed marker as text instead of deleting it', () => {
    // The parser is forgiving by design: `[[en:]]` is not a marker, so the
    // words around it must survive. (The literal marker itself is not read
    // aloud nicely; that is documented in docs/05.)
    const plan = buildNarrationPlan('hello [[en:]] world', VOICES);
    expect(plan.runs.length).toBeGreaterThan(0);
    expect(plan.spokenText).toContain('hello');
    expect(plan.spokenText).toContain('world');
  });

  it('refuses to build a plan without both voices', () => {
    expect(() => buildNarrationPlan('hi', { ta: '', en: 'en-IN-NeerjaNeural' })).toThrow(
      TypeError,
    );
    expect(() => buildNarrationPlan('hi', { ta: 'ta-IN-PallaviNeural', en: '' })).toThrow(
      TypeError,
    );
  });
});

describe('buildNarrationPlan — ordering', () => {
  it('expands numbers before segmentation, so no digit reaches a run', () => {
    const plan = buildNarrationPlan('இந்த ஆண்டு 2024 மிக முக்கியம்.', VOICES);

    expect(plan.spokenText).toContain('இரண்டாயிரத்து இருபத்துநான்கு');
    for (const run of plan.runs) {
      expect(run.text, run.text).not.toMatch(/\d/u);
    }
    expect(plan.runs.every((run) => run.lang === 'ta')).toBe(true);
  });

  it('reads a number in the language of its sentence', () => {
    const tamil = buildNarrationPlan('விலை ₹500 மட்டுமே.', VOICES);
    expect(tamil.spokenText).toContain('ஐந்நூறு ரூபாய்');

    const english = buildNarrationPlan('the price is ₹500 only.', VOICES);
    expect(english.spokenText).toContain('five hundred rupees');
  });

  it('lets an override decide the language of a number', () => {
    const plan = buildNarrationPlan('இது [[en:₹500]] மட்டுமே.', VOICES);

    expect(plan.spokenText).toContain('five hundred rupees');
    expect(plan.spokenText).not.toContain('ஐந்நூறு');
    expect(plan.runs.find((run) => run.text.includes('rupees'))?.lang).toBe('en');
  });

  it('keeps override spans on the right words after a longer expansion', () => {
    const plan = buildNarrationPlan(
      '[[en:₹500]] கொடுங்க, [[ta:naan]] வருகிறேன்.',
      VOICES,
    );

    const english = plan.runs.find((run) => run.lang === 'en');
    expect(english?.text).toBe('five hundred rupees');
    const forcedTamil = plan.runs.find((run) => run.text.includes('வருகிறேன்'));
    expect(forcedTamil?.lang).toBe('ta');
  });
});

describe('buildNarrationPlan — Tanglish', () => {
  it('transliterates routed Tanglish and keeps the Tamil voice', () => {
    const plan = buildNarrationPlan('vanakkam machan epdi irukka', VOICES);

    expect(plan.runs).toHaveLength(1);
    const run = plan.runs[0]!;
    expect(run.lang).toBe('ta');
    expect(run.voice).toBe(VOICES.ta);
    expect(run.script).toBe('tanglish');
    expect(run.text).not.toMatch(LATIN);
  });

  it('does not transliterate English', () => {
    const plan = buildNarrationPlan('today we talk about money', VOICES);
    expect(plan.runs[0]!.text).toBe('today we talk about money');
    expect(plan.runs[0]!.lang).toBe('en');
  });

  it('mixes Tanglish, Tamil and English in one paragraph', () => {
    const plan = buildNarrationPlan(
      'vanakkam machan, இன்னைக்கு நாம பேசுவோம் about money and freelancing.',
      VOICES,
    );

    for (const run of plan.runs) {
      if (run.lang === 'ta') expect(run.text, run.text).not.toMatch(LATIN);
    }
    expect(plan.runs.some((run) => run.lang === 'en')).toBe(true);
    expect(plan.spokenText).not.toMatch(/\bvanakkam\b/u);
  });
});

describe('planToSegments', () => {
  it('is the exact payload the media service expects', () => {
    const plan = buildNarrationPlan('இன்று today', VOICES);
    const segments = planToSegments(plan);

    expect(segments).toHaveLength(plan.runs.length);
    expect(segments[0]).toEqual({
      text: plan.runs[0]!.text,
      voice: plan.runs[0]!.voice,
    });
    for (const segment of segments) {
      expect(Object.keys(segment).sort()).toEqual(['text', 'voice']);
      expect(segment.text.length).toBeGreaterThan(0);
    }
  });
});

describe('expandNumbersSpanned', () => {
  const span = { start: 4, end: 8, lang: 'en' as const };

  it('uses the span language and moves the span with the text', () => {
    const result = expandNumbersSpanned('குறை ₹500 நல்லது', [
      { start: 5, end: 9, lang: 'en' },
    ]);

    expect(result.text).toContain('five hundred rupees');
    expect(result.text.indexOf('five hundred')).toBe(5);
    const [moved] = result.spans;
    expect(moved?.start).toBe(5);
    expect(moved?.end).toBe(5 + 'five hundred rupees'.length);
  });

  it('leaves spans untouched when there is no number', () => {
    const result = expandNumbersSpanned('hello world', [span]);
    expect(result.text).toBe('hello world');
    expect(result.spans).toEqual([span]);
  });

  it('moves spans that come after an expansion', () => {
    const result = expandNumbersSpanned('₹500 x', [{ start: 5, end: 6, lang: 'ta' }]);
    const [moved] = result.spans;
    expect(moved?.start).toBe(result.text.length - 1);
    expect(moved?.end).toBe(result.text.length);
  });
});
