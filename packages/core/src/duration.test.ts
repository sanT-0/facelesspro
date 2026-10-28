import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DURATION_RATES,
  DEFAULT_SENTENCE_PAUSE_SECONDS,
  estimateDuration,
} from './duration';
import { expandNumbersContextual } from './numbers';

const words = (text: string) => estimateDuration(text).words;

describe('estimateDuration', () => {
  it('uses the documented rates for a single language', () => {
    expect(DEFAULT_DURATION_RATES).toEqual({ ta: 130, en: 150, mixed: 140 });
    // 130 Tamil words at 130 wpm = 60 s.
    const tamil = Array.from({ length: 130 }, () => 'வார்த்தை').join(' ');
    expect(estimateDuration(tamil).seconds).toBeCloseTo(60, 3);
    // 150 English words at 150 wpm = 60 s.
    const english = Array.from({ length: 150 }, () => 'word').join(' ');
    expect(estimateDuration(english).seconds).toBeCloseTo(60, 3);
  });

  it('blends the two languages per word, not per text', () => {
    // 130 Tamil words (60 s) + 150 English words (60 s).
    const text = `${Array.from({ length: 130 }, () => 'வார்த்தை').join(' ')} ${Array.from(
      { length: 150 },
      () => 'word',
    ).join(' ')}`;
    const estimate = estimateDuration(text);
    expect(estimate.taWords).toBe(130);
    expect(estimate.enWords).toBe(150);
    expect(estimate.seconds).toBeCloseTo(120, 3);
  });

  it('counts a mixed-script token as Tamil, because Tamil wins', () => {
    // `channel-க்கு` is one spoken word; the Tamil side decides the rate.
    const estimate = estimateDuration('இன்று channel-க்கு ஒரு வீடியோ');
    expect(estimate.taWords).toBe(4);
    expect(estimate.enWords).toBe(0);
    expect(estimate.words).toBe(4);
  });

  it('counts the words the engine speaks, not the digits', () => {
    // `₹1,20,000` is "one lakh twenty thousand rupees"; a digit is not a spoken
    // word, so pricing it as one underestimates a number-heavy script badly.
    const estimate = estimateDuration('₹1,20,000');
    expect(estimate.words).toBe(5);
    expect(estimate.mixedWords).toBe(0);
    // Nothing in the clause to ask, so the number takes `defaultLang` (English).
    expect(estimate.enWords).toBe(5);
  });

  it('expands a number in the language of its own clause', () => {
    expect(estimateDuration('₹1,20,000 லாபம்').taWords).toBe(5);
    expect(estimateDuration('the budget is ₹1,20,000').enWords).toBe(8);
  });

  it('keeps the mixed rate for digits that cannot be spelled', () => {
    // At or above `MAX_SAFE` the number stays as digits; it still costs time.
    const estimate = estimateDuration('9999999999');
    expect(estimate.mixedWords).toBe(1);
    expect(estimate.words).toBe(1);
    expect(estimate.seconds).toBeCloseTo((1 / 140) * 60, 6);
  });

  it('gives the same answer for text that is already expanded', () => {
    // The pipeline hands the planner post-expansion text, so expanding twice
    // must not double-count.
    const text = '2024 ஆம் ஆண்டில் ₹1,20,000 லாபம், அதாவது 15% வளர்ச்சி.';
    expect(estimateDuration(expandNumbersContextual(text)).words).toBe(
      estimateDuration(text).words,
    );
  });

  it('ignores punctuation and emoji', () => {
    expect(words('வணக்கம், நண்பர்களே! — 🙏 ...')).toBe(2);
    expect(words('— … !!!')).toBe(0);
  });

  it('adds the stitcher sentence gap between sentences', () => {
    // Same words, but with a terminator that makes two sentences.
    const one = estimateDuration('வணக்கம் நண்பர்களே இன்று பேசுவோம்');
    const two = estimateDuration('வணக்கம் நண்பர்களே. இன்று பேசுவோம்');
    expect(two.sentencePauses).toBe(1);
    expect(one.sentencePauses).toBe(0);
    expect(two.seconds - one.seconds).toBeCloseTo(DEFAULT_SENTENCE_PAUSE_SECONDS, 6);
  });

  it('returns milliseconds for the planner', () => {
    const estimate = estimateDuration('வார்த்தை '.repeat(13).trim());
    expect(estimate.durationMs).toBe(Math.round(estimate.seconds * 1000));
    expect(Number.isInteger(estimate.durationMs)).toBe(true);
  });

  it('is zero for empty or non-speech input', () => {
    for (const text of ['', '   ', '\n\n', '🙏']) {
      const estimate = estimateDuration(text);
      expect(estimate.seconds).toBe(0);
      expect(estimate.durationMs).toBe(0);
      expect(estimate.words).toBe(0);
    }
  });

  it('scales linearly with the text (speech, ignoring sentence gaps)', () => {
    const text = 'இன்று ஒரு நாள். Today is the day!';
    // Doubling adds one more sentence break, so the linear claim is about
    // speech only; the pause term is counted, not interpolated.
    const once = estimateDuration(text, { sentencePauseSeconds: 0 });
    const twice = estimateDuration(`${text} ${text}`, { sentencePauseSeconds: 0 });
    expect(twice.seconds).toBeCloseTo(once.seconds * 2, 6);
  });

  it('accepts overrides for a slower or faster narrator', () => {
    const text = Array.from({ length: 130 }, () => 'word').join(' ');
    expect(estimateDuration(text, { rates: { en: 65 } }).seconds).toBeCloseTo(120, 3);
    const paused = estimateDuration('ஒரு வார்த்தை. a word');
    const unpaused = estimateDuration('ஒரு வார்த்தை. a word', { sentencePauseSeconds: 0 });
    expect(unpaused.sentencePauses).toBe(1);
    expect(paused.seconds - unpaused.seconds).toBeCloseTo(DEFAULT_SENTENCE_PAUSE_SECONDS, 6);
  });

  it('rejects rates that cannot produce a duration', () => {
    for (const rates of [
      { ta: 0 },
      { en: -1 },
      { mixed: Number.NaN },
      { ta: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => estimateDuration('ஒரு வார்த்தை. a word', { rates }), JSON.stringify(rates)).toThrow(
        /rate/u,
      );
    }
  });

  it('rejects a non-string script', () => {
    expect(() => estimateDuration(42 as unknown as string)).toThrow(TypeError);
  });
});
