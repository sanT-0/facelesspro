/**
 * Merge the measured and described halves into one `StyleProfile` — docs/04 §4.
 *
 * The pure colour/seed helpers live in `packages/core` (dependency-free); the
 * schema-validated merge lives here because `packages/core` may not import
 * `@facelesspro/contracts`. Worker is the right boundary anyway: it is where
 * ffmpeg and the model chain already meet.
 *
 * The rules that matter:
 * - **Palette is measured.** The vision pass cannot override it; it has no
 *   palette field at all.
 * - **Ink colour is measured too.** `line.color` is the darkest palette colour,
 *   because a model would invent `#141414` for art that has no such pixel. The
 *   schema then rejects any profile whose ink is not in its own palette.
 * - **`unknown` stays `unknown`.** The heuristic never invents a medium, and
 *   the merge does not "help" by substituting one.
 * - **The seed ignores measurements.** Two runs that differ only in float
 *   drift (or in `tone`/`aspect`/`safeArea`) keep the same seed, so previews do
 *   not change for no visual reason.
 */

import { styleProfileSchema } from '@facelesspro/contracts';
import type { NumericStyleProfile, StyleProfile, StyleVision } from '@facelesspro/contracts';
import { lineColorFor, seedBaseFor } from '@facelesspro/core';

/**
 * Combine one numeric pass and one vision answer.
 *
 * @throws ZodError when the vision answer would produce an invalid profile —
 *         a bug in the caller or a contract drift, not something downstream
 *         should discover after writing the row.
 */
export function mergeStyleProfile(
  numeric: NumericStyleProfile,
  vision: StyleVision,
): StyleProfile {
  const { palette, ...measured } = numeric;

  const promptFields = {
    medium: vision.medium,
    promptPrefix: vision.promptPrefix,
    palette,
    line: {
      weight: vision.line.weight,
      color: lineColorFor(palette),
      texture: vision.line.texture,
    },
    shading: vision.shading,
    background: vision.background,
    composition: vision.composition,
    characters: vision.characters,
    typography: vision.typography,
    negative: vision.negative,
  };

  return styleProfileSchema.parse({
    version: 1,
    ...promptFields,
    seedBase: seedBaseFor(promptFields),
    measured,
    source: {
      adapter: vision.adapter,
      degradedFrom: [...vision.degradedFrom],
    },
  });
}
