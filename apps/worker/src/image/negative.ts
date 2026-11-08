/**
 * The fixed safety terms every image prompt must avoid (docs/04 §3 step 2).
 *
 * Kept in one place so the planner's clauses and the image adapter request
 * cannot drift apart: both must always include text, watermark, logo and
 * signature, even when a style profile already mentions some of them.
 */

export const REQUIRED_NEGATIVES = ['text', 'watermark', 'logo', 'signature'] as const;

/** Add the required terms once, preserving the style's own wording and order. */
export function withRequiredNegatives(negative: string): string {
  const existing = new Set(
    negative
      .split(',')
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length > 0),
  );
  const missing = REQUIRED_NEGATIVES.filter((term) => !existing.has(term));
  return [negative.trim(), ...missing].filter((term) => term.length > 0).join(', ');
}
