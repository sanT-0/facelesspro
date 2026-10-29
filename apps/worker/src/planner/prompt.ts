/**
 * Image-prompt composition — one place, two callers.
 *
 * An image prompt is always `"{style}, {what the scene shows}, {style}, {negative}"`.
 * The style belongs to the whole video, so it is injected here rather than asked
 * of a model: a model that forgets the palette on one scene out of twelve would
 * make that scene look like it came from a different video.
 *
 * Trimming is by whole word. A Tamil grapheme cluster (a consonant plus its vowel
 * sign) is several code points, so a character cut can split one and render a
 * broken glyph.
 */

import { MAX_IMAGE_PROMPT_CHARS } from '@facelesspro/contracts';

import type { PlanStyle } from '../ports/planner';

export const DEFAULT_NEGATIVE = 'no text, no watermark';

/** Compose a prompt, trimming the description (never the style) to fit the contract. */
export function composeImagePrompt(description: string, style: PlanStyle = {}): string {
  const prefix = style.prefix?.trim() ?? '';
  const suffix = style.suffix?.trim() ?? '';
  const negative = style.negative?.trim() ?? DEFAULT_NEGATIVE;

  let words = description.split(/\s+/u).filter((word) => word.length > 0);
  const build = (): string =>
    [prefix, words.join(' '), suffix, negative].filter((part) => part.length > 0).join(', ');

  let prompt = build();
  while (prompt.length > MAX_IMAGE_PROMPT_CHARS && words.length > 1) {
    words = words.slice(0, -1);
    prompt = build();
  }
  if (prompt.length > MAX_IMAGE_PROMPT_CHARS) {
    // Only possible when the style clauses alone fill the budget. That is a
    // configuration bug, and failing loudly beats shipping a truncated prompt.
    throw new RangeError(
      `style clauses leave no room for a description (${prompt.length} > ${MAX_IMAGE_PROMPT_CHARS} chars)`,
    );
  }
  return prompt;
}
