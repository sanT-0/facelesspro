/**
 * Script → narration plan.
 *
 * This is the one place the ordering is fixed, and the ordering is the whole
 * point:
 *
 *   parse overrides → expand numbers → segment → transliterate → assign voices
 *
 * Numbers must be expanded *before* segmentation because the tokenizer treats
 * digits as separators: after segmentation the digits are already gone and a
 * Tamil voice says "two zero two four". Overrides must be parsed before number
 * expansion so `[[en:₹500]]` is read as English even inside a Tamil sentence.
 *
 * Pure: no I/O, no clock, no network. Voice ids are passed in, not looked up,
 * because engine catalogues belong to the media service.
 */

import { expandNumbersSpanned } from './numbers';
import type { ExpandContextualOptions } from './numbers';
import { parseOverrides, segmentWithOverrides } from './overrides';
import { DEFAULT_TRANSLITERATION, transliterateRuns } from './transliterate';
import type { TransliterationDict } from './transliterate';
import type { Lang, OverrideSpan, ScriptKind, SegmentOptions } from './types';

export interface NarrationVoiceIds {
  /** Engine voice for Tamil runs. */
  ta: string;
  /** Engine voice for English runs. */
  en: string;
}

export interface NarrationPlanOptions extends NarrationVoiceIds {
  /** Pair id, kept for the timeline and the inspector. */
  pair?: string;
  segment?: SegmentOptions;
  numbers?: ExpandContextualOptions;
  transliteration?: TransliterationDict;
}

export interface NarrationRun {
  /** What is sent to the engine: Tamil script for Tanglish. */
  text: string;
  lang: Lang;
  voice: string;
  /** How it was written before transliteration. */
  script: ScriptKind;
}

export interface NarrationPlan {
  /** The input, untouched. */
  script: string;
  /** Runs joined for inspection; `runs` is authoritative. */
  spokenText: string;
  runs: NarrationRun[];
  overrides: OverrideSpan[];
  pair: string | null;
}

export interface NarrationSegment {
  text: string;
  voice: string;
}

/**
 * Turn a script into per-run `{text, voice}` segments for the media service.
 */
export function buildNarrationPlan(
  script: string,
  options: NarrationPlanOptions,
): NarrationPlan {
  if (typeof script !== 'string') {
    throw new TypeError('buildNarrationPlan expects a string');
  }
  if (options.ta.length === 0 || options.en.length === 0) {
    throw new TypeError('buildNarrationPlan needs both a Tamil and an English voice');
  }

  const parsed = parseOverrides(script);
  const expanded = expandNumbersSpanned(parsed.text, parsed.spans, options.numbers ?? {});

  if (expanded.text.trim().length === 0) {
    return {
      script,
      spokenText: '',
      runs: [],
      overrides: expanded.spans,
      pair: options.pair ?? null,
    };
  }

  const segmented = segmentWithOverrides(expanded.text, {
    ...options.segment,
    overrides: expanded.spans,
  });
  const transliterated = transliterateRuns(
    segmented.runs,
    options.transliteration ?? DEFAULT_TRANSLITERATION,
  );

  const runs: NarrationRun[] = transliterated.map((run) => ({
    text: run.text,
    lang: run.lang,
    voice: run.lang === 'ta' ? options.ta : options.en,
    script: run.script,
  }));

  return {
    script,
    spokenText: runs.map((run) => run.text).join(' '),
    runs,
    overrides: expanded.spans,
    pair: options.pair ?? null,
  };
}

/** The exact payload `POST /synthesize` expects. */
export function planToSegments(plan: NarrationPlan): NarrationSegment[] {
  return plan.runs.map((run) => ({ text: run.text, voice: run.voice }));
}
