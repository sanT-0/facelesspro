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

export interface SegmentOptions {
  /**
   * Romanised Tamil words that must be routed to the Tamil voice.
   * Replaces the built-in list when provided.
   */
  tanglish?: ReadonlySet<string>;
}
