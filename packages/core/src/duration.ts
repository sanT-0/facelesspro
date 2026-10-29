/**
 * How long a script will take to speak.
 *
 * The scene planner needs seconds before any audio exists: to reject a script
 * that cannot fit the plan, to pack sentences into 8–20 s scenes, and to give
 * `POST /v1/videos/plan` a cost estimate. Guessing per language beats guessing
 * per character, because Tamil and English are not the same density: the
 * product rates are 130 wpm for Tamil and 150 for English (docs/04 §1), with
 * 140 for tokens that have no language at all — in practice a number too large
 * to spell out.
 *
 * Numbers are expanded before counting, because that is what the pipeline does
 * (`plan.ts` expands before segmentation) and because a digit is not a spoken
 * word: `₹1,20,000` is four Tamil words, not one. Calibrating against the
 * shipped sample sets moved a number-heavy clip from −27% to +0.5% error with
 * that one change (docs/PROGRESS.md, 2026-10-28).
 *
 * The result is an estimate, not a measurement: it deliberately excludes the
 * intra-sentence micro-pauses the stitcher adds, and includes one 300 ms gap per
 * sentence break, which is `BASE_GAP_MS["sentence"]` in `services/media`.
 *
 * Pure: no I/O, no clock, no network.
 */

import { expandNumbersContextual } from './numbers';
import { splitSentences } from './sentences';

export interface DurationRates {
  /** Words per minute for Tamil runs. */
  ta: number;
  /** Words per minute for English runs. */
  en: number;
  /** Words per minute for tokens with no language at all: a number too large to spell. */
  mixed: number;
}

export interface DurationOptions {
  rates?: Partial<DurationRates>;
  /** Silence between sentences; defaults to the stitcher's sentence gap. */
  sentencePauseSeconds?: number;
}

export interface DurationEstimate {
  seconds: number;
  durationMs: number;
  /** Spoken words: ta + en + mixed. Punctuation and emoji are not words. */
  words: number;
  taWords: number;
  enWords: number;
  mixedWords: number;
  /** Sentence breaks counted, i.e. `sentences - 1`. */
  sentencePauses: number;
  rates: DurationRates;
}

export const DEFAULT_DURATION_RATES: DurationRates = { ta: 130, en: 150, mixed: 140 };

/** `BASE_GAP_MS["sentence"] = 300` in `services/media/app/boundaries.py`. */
export const DEFAULT_SENTENCE_PAUSE_SECONDS = 0.3;

const TAMIL = /\p{Script=Tamil}/u;
const LATIN = /\p{Script=Latin}/u;
const DIGIT = /\p{Nd}/u;
// Punctuation and symbols at the edges are not part of the word. Marks are not
// in this class, or Tamil vowel signs (`வார்த்தை`) would be trimmed away.
const EDGE = /^[\p{P}\p{S}\p{Z}]+|[\p{P}\p{S}\p{Z}]+$/gu;

/**
 * The tokens that will actually be spoken, in order, with edge punctuation
 * trimmed. Shared with `scriptLanguagePlan()` so \"word\" means one thing.
 */
export function spokenWordTokens(text: string): string[] {
  const words: string[] = [];
  for (const token of text.split(/\s+/u)) {
    const word = token.replace(EDGE, '');
    if (word.length > 0) words.push(word);
  }
  return words;
}

export function estimateDuration(text: string, options: DurationOptions = {}): DurationEstimate {
  if (typeof text !== 'string') {
    throw new TypeError('estimateDuration expects a string');
  }
  const rates: DurationRates = { ...DEFAULT_DURATION_RATES, ...options.rates };
  for (const [lang, rate] of Object.entries(rates)) {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new TypeError(`duration rate for ${lang} must be a positive number, got ${rate}`);
    }
  }
  const sentencePauseSeconds =
    options.sentencePauseSeconds ?? DEFAULT_SENTENCE_PAUSE_SECONDS;
  if (!Number.isFinite(sentencePauseSeconds) || sentencePauseSeconds < 0) {
    throw new TypeError(
      `sentencePauseSeconds must be >= 0, got ${String(options.sentencePauseSeconds)}`,
    );
  }

  let taWords = 0;
  let enWords = 0;
  let mixedWords = 0;
  // Digits become the words the engine will speak; `mixed` is left for numbers
  // too large to spell (`MAX_SAFE` in `numbers.ts`) and anything else with no
  // script at all.
  const spoken = expandNumbersContextual(text);
  for (const word of spokenWordTokens(spoken)) {
    if (TAMIL.test(word)) taWords += 1;
    else if (LATIN.test(word)) enWords += 1;
    else if (DIGIT.test(word)) mixedWords += 1;
  }

  const sentencePauses = Math.max(0, splitSentences(spoken).length - 1);
  const speechSeconds =
    (taWords / rates.ta) * 60 + (enWords / rates.en) * 60 + (mixedWords / rates.mixed) * 60;
  const seconds = speechSeconds + sentencePauses * sentencePauseSeconds;

  return {
    seconds,
    durationMs: Math.round(seconds * 1000),
    words: taWords + enWords + mixedWords,
    taWords,
    enWords,
    mixedWords,
    sentencePauses,
    rates,
  };
}
