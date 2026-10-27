export type { Lang, Lexicon, OverrideSpan, ScriptKind, SegmentOptions, TextRun } from './types';
export { segmentText, DEFAULT_TANGLISH } from './segmenter';
export {
  DEFAULT_LEXICON,
  TANGLISH_DATA,
  createLexicon,
  extendLexicon,
  hasTanglishInflection,
  isTanglishWord,
  normalizeWord,
} from './lexicon';
export type { LexiconOverrides, TanglishData } from './lexicon';
export { hasOverrides, parseOverrides, segmentWithOverrides } from './overrides';
export type { OverrideSegmentation, ParsedOverrides } from './overrides';
export {
  DEFAULT_TRANSLITERATION,
  TRANSLITERATION_DATA,
  createTransliterationDict,
  transliterateRuns,
  transliterateTanglish,
  transliterateText,
  transliterateWord,
  transliterationSource,
} from './transliterate';
export type {
  TanglishNarration,
  TransliterationData,
  TransliterationDict,
  TransliterationSource,
} from './transliterate';
export {
  expandNumbers,
  expandNumbersContextual,
  expandNumbersSpanned,
  numberToWords,
} from './numbers';
export type {
  ExpandContextualOptions,
  ExpandedWithSpans,
  NumberLang,
  NumberWordsOptions,
} from './numbers';
export { buildNarrationPlan, planToSegments } from './plan';
export type {
  NarrationPlan,
  NarrationPlanOptions,
  NarrationRun,
  NarrationSegment,
  NarrationVoiceIds,
} from './plan';
export { SAMPLE_ROOT, sampleSetDir } from './samples';
