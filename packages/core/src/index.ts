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
  spokenWordTokens,
} from './duration';
export type { DurationEstimate, DurationOptions, DurationRates } from './duration';
export {
  DEFAULT_MAX_SCENES,
  DEFAULT_SCENE_MAX_SECONDS,
  DEFAULT_SCENE_MIN_SECONDS,
  packScenes,
} from './scenes';
export type { PackScenesOptions, SceneDraft } from './scenes';
export { EmptyScriptError, estimateScenePlan, scriptLanguagePlan } from './estimate';
export type {
  PlanLanguageRun,
  PlanSceneEstimate,
  ScenePlanEstimate,
  ScriptLanguagePlan,
} from './estimate';
export {
  DEFAULT_PALETTE_COLORS,
  MAX_PALETTE_COLORS,
  hexToRgb,
  kmeansPalette,
  rgbToHex,
} from './style/palette';
export type { PaletteOptions, StylePalette } from './style/palette';
export {
  DARK_LUMA_MAX,
  DEFAULT_SAFE_AREA_MARGIN,
  SAFE_AREA_CONTENT_DISTANCE,
  STROKE_EDGE_MIN,
  brightnessStats,
  contrastStats,
  edgeEnergy,
  lineStats,
  luma,
  percentile,
  safeAreaStats,
  saturationStats,
  strokeDensity,
} from './style/stats';
export type { LineStats, SafeAreaStats, StatSummary } from './style/stats';
export { lineColorFor, seedBaseFor } from './style/profile';
export type { PaletteHexes, StyleSeedInput } from './style/profile';
export {
  LANDSCAPE_PREVIEW,
  PORTRAIT_PREVIEW,
  PREVIEW_CELLS,
  PREVIEW_CLIP_FRAMES,
  PREVIEW_CLIP_SECONDS,
  PREVIEW_COLUMNS,
  PREVIEW_FPS,
  PREVIEW_FRAME_COUNT,
  PREVIEW_GUTTER,
  PREVIEW_MARGIN,
  PREVIEW_ROWS,
  centreCrop,
  paletteBands,
  previewClipTimeline,
  previewGrid,
} from './style/preview';
export type {
  PreviewClipTimeline,
  PreviewGrid,
  PreviewGridOptions,
  PreviewRect,
  PreviewSize,
} from './style/preview';
