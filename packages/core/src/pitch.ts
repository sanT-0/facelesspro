/**
 * The Roblox Rant pitch slider → media-service `pitch_percent`.
 *
 * The product contract exposes `voicePitch` as a 50–180 widget whose default is
 * 140 (`docs/01` §3.5, recovered from the baseline client). The media service
 * speaks percent: `0` is the voice untouched, `±100` is the engine's headroom.
 *
 * Two decisions worth stating, because the mapping is ours:
 *
 * 1. **140 is exactly 0.** A default request must sound like the plain voice,
 *    not "the plain voice plus a bit"; anything else makes every rant audibly
 *    different from a V3 video that used the same pair.
 * 2. **Each side of the default uses the full headroom.** 50…140 maps to
 *    −100…0 and 140…180 maps to 0…+100. The halves are unequal in slider units
 *    (90 below, 40 above), which is what the baseline range implies — dropping
 *    to the floor should be a big shift, and the ceiling is closer.
 *
 * The result is clamped to ±100, so a value outside the contract is a bug that
 * still cannot produce something the engine will reject.
 */

export const VOICE_PITCH_MIN = 50;
export const VOICE_PITCH_MAX = 180;
export const VOICE_PITCH_DEFAULT = 140;

/** Percent shift for a contract `voicePitch`, rounded to an integer. */
export function voicePitchPercent(pitch: number): number {
  if (!Number.isFinite(pitch)) {
    throw new RangeError('voicePitch must be a finite number');
  }
  const shifted = pitch - VOICE_PITCH_DEFAULT;
  if (shifted === 0) return 0;

  const span = shifted < 0 ? VOICE_PITCH_DEFAULT - VOICE_PITCH_MIN : VOICE_PITCH_MAX - VOICE_PITCH_DEFAULT;
  const percent = Math.round((shifted / span) * 100);
  return Math.max(-100, Math.min(100, percent));
}
