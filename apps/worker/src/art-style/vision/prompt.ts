/**
 * The vision prompt — pure, deterministic, and the only place the model is told
 * what it may answer.
 *
 * Three bans are deliberate and tested:
 * - **No palette.** Colours are measured by the numeric pass; a model guessing
 *   `#141414` for art that has no such pixel makes the merged profile lie.
 * - **No timings/audio.** This pass never sees the narration.
 * - **No invented cast.** A character that appears in one frame is a background
 *   extra, not part of a character bible.
 *
 * Enum values are spelled out literally because the parser rejects anything
 * else. If an enum changes in `packages/contracts`, this prompt must change in
 * the same commit or every answer degrades to the heuristic.
 */

import {
  STYLE_LINE_TEXTURES,
  STYLE_LINE_WEIGHTS,
  STYLE_SHADING,
} from '@facelesspro/contracts';

export interface VisionPromptOptions {
  /** How many frames the adapter is sending. Must be >= 1. */
  frameCount: number;
}

/** Build the single user message sent with the sampled frames. */
export function buildVisionPrompt(options: VisionPromptOptions): string {
  const { frameCount } = options;
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new TypeError(`frameCount must be a positive integer, got ${String(frameCount)}`);
  }

  return `You are describing the visual style of one reference video from ${frameCount} sampled frames.
Describe only how the frames look — not what happens in them.

Answer with one JSON object and nothing else: no prose, no code fences, no comments.
Every key below is mandatory.

- "medium": free text up to 80 characters (for example "flat vector cartoon", "watercolour storybook"). Use "unknown" if the frames do not show it.
- "promptPrefix": one comma-separated clause up to 400 characters that could start an image prompt: medium, line and overall look. Do not mention colours.
- "line": { "weight": one of ${STYLE_LINE_WEIGHTS.join(' | ')}, "texture": one of ${STYLE_LINE_TEXTURES.join(' | ')} }
- "shading": one of ${STYLE_SHADING.join(' | ')}
- "background": free text up to 200 characters: how detailed it is and how it is treated.
- "composition": free text up to 200 characters: framing, subject placement, camera angle.
- "characters": array of characters that recur across frames, each { "id": lowercase kebab-case such as "hero" or "support-1", "description": up to 200 characters }. Use an empty array when nobody recurs.
- "typography": { "present": true or false, "style": description up to 200 characters }. "style" is required when "present" is true and must be omitted when it is false.
- "negative": comma-separated things to keep out of generated images, up to 300 characters.

Rules:
- Do not output a palette, hex colours or colour names. Colours are measured separately and a guess would conflict with the measurement.
- Do not mention timings, durations, audio, music or narration.
- Do not invent characters that do not appear in at least two frames.
- Use only the enum values listed above. Any other value rejects the whole answer.`;
}
