/** Language a text run is spoken in. */
export type Lang = 'ta' | 'en';

/**
 * How the run is written.
 * - `tamil`    native Tamil script
 * - `latin`    English / Latin script
 * - `tanglish` Tamil words written with Latin letters (romanised)
 */
export type ScriptKind = 'tamil' | 'latin' | 'tanglish';

export interface TextRun {
  /** Original text, edges trimmed. Punctuation is preserved. */
  text: string;
  lang: Lang;
  /**
   * Dominant writing system of the run. When a run mixes scripts,
   * `tamil` wins over `tanglish`, which wins over `latin`.
   */
  script: ScriptKind;
}

/**
 * A language the author forced with inline markup: `[[ta:…]]`, `[[en:…]]`
 * or `[[tl:…]]`. `tl` is a Tanglish alias for `ta`.
 */
export interface OverrideSpan {
  /** Start offset in the marker-stripped text. */
  start: number;
  /** End offset (exclusive) in the marker-stripped text. */
  end: number;
  /** Language forced for every whole word fully inside the span. */
  lang: Lang;
}

/**
 * Everything needed to decide which voice reads a Latin-script word.
 * Kept as a plain shape so `packages/core` stays dependency-free.
 */
export interface Lexicon {
  /** Lower-case romanised Tamil words, letters only. */
  readonly words: ReadonlySet<string>;
  /** Stems that may take a Tamil suffix (`veetu` → `veetukku`). */
  readonly roots: ReadonlySet<string>;
  /** Suffixes, longest first so the greedy match is unambiguous. */
  readonly suffixes: readonly string[];
  /** English words that must never be treated as Tanglish. */
  readonly protected: ReadonlySet<string>;
}

export interface SegmentOptions {
  /**
   * Romanised Tamil words that must be routed to the Tamil voice.
   * Replaces the built-in word list when provided. Ignored when `lexicon`
   * is given.
   */
  tanglish?: ReadonlySet<string>;
  /** Full lexicon, including roots/suffixes/protected words. */
  lexicon?: Lexicon;
  /**
   * Accept `<known root><known suffix>` as Tanglish. Defaults to `true`;
   * set `false` to require an exact word match.
   */
  morphology?: boolean;
  /**
   * Forced language spans, in the coordinates of the string being segmented.
   * Produced by `parseOverrides()`; the markers themselves must already be
   * stripped. A span forces every *whole word* it fully contains.
   */
  overrides?: readonly OverrideSpan[];
}
