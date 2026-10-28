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
export { normalizeScript, splitSentences } from './sentences';
export type { Sentence } from './sentences';
export {
  DEFAULT_DURATION_RATES,
  DEFAULT_SENTENCE_PAUSE_SECONDS,
  estimateDuration,
} from './duration';
export type { DurationEstimate, DurationOptions, DurationRates } from './duration';
export {
  DEFAULT_MAX_SCENES,
  DEFAULT_SCENE_MAX_SECONDS,
  DEFAULT_SCENE_MIN_SECONDS,
  packScenes,
} from './scenes';
export type { PackScenesOptions, SceneDraft } from './scenes';
