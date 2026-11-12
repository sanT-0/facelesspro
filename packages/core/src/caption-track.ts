/**
 * One narration's word timings → the cue track a caption template produces.
 *
 * `create-captions` and the API's caption-preview route both call this, so a
 * preview cannot disagree with the track a render would persist. It only
 * groups and decorates: line breaking still goes through `buildCaptionCues`,
 * which never splits a Tamil grapheme cluster.
 *
 * Pure: no I/O, no clock, no network.
 */

import { buildCaptionCues } from './captions';
import type { CaptionCue, CaptionWord } from './captions';
import { sprinkleEmoji } from './emoji';

/** Until workspace preferences land, omitted selectors use the first built-in. */
export const DEFAULT_CAPTION_TEMPLATE_ID = -1;
export const DEFAULT_CAPTION_WORD_LIMIT = 6;
export const DEFAULT_CAPTION_MAX_LINES = 2;
/** Grapheme cells at the stable 1080p ASS design canvas. */
export const CAPTION_MAX_CHARS_PER_LINE = {
  landscape: 32,
  portrait: 18,
} as const;

export interface CaptionTrackOptions {
  /** Words shown at once; template `wordLimit`, default 6. */
  readonly wordLimit?: number;
  /** Display lines allowed per cue; template `maxLines`, default 2. */
  readonly maxLines?: number;
  /** Line width in grapheme clusters at the design canvas. */
  readonly maxCharsPerLine: number;
  /** Opt-in one-cluster emoji per cue; default off. */
  readonly emoji?: boolean;
}

export function buildCaptionTrack(
  words: readonly CaptionWord[],
  options: CaptionTrackOptions,
): CaptionCue[] {
  const grouped = buildCaptionCues(words, {
    wordLimit: options.wordLimit ?? DEFAULT_CAPTION_WORD_LIMIT,
    maxLines: options.maxLines ?? DEFAULT_CAPTION_MAX_LINES,
    maxCharsPerLine: options.maxCharsPerLine,
  });
  return [...sprinkleEmoji(grouped, { enabled: options.emoji ?? false })];
}
