/**
 * Emoji sprinkling — opt-in decoration for emphasis words.
 *
 * docs/04 §5: emoji are allowed only on emphasis words, only from an
 * allow-list, at most one per two cues, and only when the template sets
 * `emoji: true`. The choice is deterministic: scan a cue from its last word
 * backwards, accept the first allow-listed word that either ends the cue (the
 * natural stress position) or carries an explicit emphasis mark (`!`, `?`,
 * `…`, or an ALL-CAPS Latin word). Consecutive chosen cues are at least
 * `minCueGap` apart.
 *
 * The emoji is presentation, not text: `Cue.lines` and `Cue.words` are never
 * rewritten, so the "join every cue's lines reconstructs the narration"
 * invariant still holds. The ASS writer renders the separate `emoji` field.
 *
 * Pure: no I/O, no clock, no network.
 */

import type { CaptionCue } from './captions';

export interface EmojiRule {
  /** Exactly one grapheme cluster, e.g. `🔥` or `❤️`. */
  readonly emoji: string;
  /** Lowercase Latin stems and Tamil words that select this emoji. */
  readonly words: readonly string[];
}

/**
 * The complete allow-list. Curated on purpose: only distinctive topic and
 * emphasis words, never frequent function words such as "like" or "super",
 * so captions do not become a wall of icons.
 */
export const EMOJI_ALLOW_LIST: readonly EmojiRule[] = [
  { emoji: '🔥', words: ['fire', 'mass', 'அசத்தல்'] },
  { emoji: '😂', words: ['comedy', 'சிரிப்பு'] },
  { emoji: '😮', words: ['wow', 'ஆச்சரியம்'] },
  { emoji: '💡', words: ['idea', 'ஐடியா'] },
  { emoji: '⚡', words: ['fast', 'வேகம்'] },
  { emoji: '✅', words: ['perfect', 'சிறந்த'] },
  { emoji: '❤️', words: ['அன்பு'] },
  { emoji: '🎯', words: ['focus', 'இலக்கு'] },
  { emoji: '🙏', words: ['thanks', 'நன்றி'] },
  { emoji: '💰', words: ['income', 'வருமானம்'] },
];

const EMOJI_BY_WORD: ReadonlyMap<string, string> = new Map(
  EMOJI_ALLOW_LIST.flatMap((rule) =>
    rule.words.map((word) => [word, rule.emoji] as const),
  ),
);

/** Bidi-safe: punctuation and symbols around a word are ignored; marks stay. */
const WORD_EDGES = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu;
/** Closing quotes/brackets stay outside an emphasis mark. */
const TRAILING_CLOSERS = /[)\]}"'”’»]+$/u;

function bareWord(text: string): string {
  return text.replace(WORD_EDGES, '').toLowerCase();
}

/** Allow-list lookup; punctuation-wrapped and case-insensitive. */
export function emojiForWord(text: string): string | undefined {
  const bare = bareWord(text);
  return bare === '' ? undefined : EMOJI_BY_WORD.get(bare);
}

/**
 * Explicit stress: a trailing `!`, `?` or `…`, or an ALL-CAPS Latin word of
 * at least three letters. Tamil has no case, so its emphasis signal is the
 * curated allow-list word itself when it ends the cue.
 */
export function isEmphasisWord(text: string): boolean {
  const withoutClosers = text.replace(TRAILING_CLOSERS, '');
  if (/[!?…]$/u.test(withoutClosers)) return true;
  const stripped = withoutClosers.replace(WORD_EDGES, '');
  return /^[A-Z][A-Z0-9]{2,}$/u.test(stripped);
}

export interface SprinkleEmojiOptions {
  /** The template's `emoji` flag. When false this is a strict no-op. */
  readonly enabled: boolean;
  /** Minimum index distance between decorated cues. Defaults to 2. */
  readonly minCueGap?: number;
}

const DEFAULT_MIN_CUE_GAP = 2;

/**
 * Return cues with an optional `emoji` set. Never mutates the input, never
 * rewrites words or lines, and is idempotent: an already-decorated cue is
 * preserved and still counts toward the minimum gap.
 */
export function sprinkleEmoji(
  cues: readonly CaptionCue[],
  options: SprinkleEmojiOptions,
): readonly CaptionCue[] {
  if (!options.enabled) return cues;

  const gap = options.minCueGap ?? DEFAULT_MIN_CUE_GAP;
  if (!Number.isInteger(gap) || gap < 1) {
    throw new Error(`sprinkleEmoji: minCueGap must be an integer >= 1 (got ${gap})`);
  }

  let lastDecorated = -gap;
  return cues.map((cue, index) => {
    if (cue.emoji !== undefined) {
      lastDecorated = index;
      return cue;
    }
    if (index - lastDecorated < gap) return cue;

    const emoji = emojiForCue(cue);
    if (emoji === undefined) return cue;
    lastDecorated = index;
    return { ...cue, emoji };
  });
}

/** Last allow-listed stressed word wins; the cue's final word is always stressed. */
function emojiForCue(cue: CaptionCue): string | undefined {
  const lastIndex = cue.words.length - 1;
  for (let index = lastIndex; index >= 0; index -= 1) {
    const word = cue.words[index];
    if (word === undefined) continue;
    if (index !== lastIndex && !isEmphasisWord(word.text)) continue;
    const emoji = emojiForWord(word.text);
    if (emoji !== undefined) return emoji;
  }
  return undefined;
}
