/**
 * The numeric half of a `StyleProfile` — docs/04 §4 "numeric pass (no model)".
 *
 * Produced by `analyzeFrames()` in `apps/worker` over the sampled reference
 * frames, and merged with the vision pass later in P3. Kept as a contract
 * shape because the same object is written to `art_style.profile` (jsonb),
 * exported by `GET /v1/art-styles/:id/export`, and re-validated on import —
 * three boundaries, one schema.
 *
 * Every ratio here is 0..1 so a consumer never has to know which metric was
 * normalised against what.
 */

import { z } from 'zod';

import { hexColorSchema, sizeSchema } from './common';

/** A 0..1 metric. Rejects `NaN` and infinities by construction. */
const unitIntervalSchema = z.number().min(0).max(1);

/**
 * Dominant colours with their share of the pixels.
 *
 * `hex` is `#rrggbb` and `weights` sum to 1 (±0.01 for float drift), so a
 * prompt builder can say "use 50% #1b2a41" without recomputing anything.
 * Ordered by weight, descending.
 */
export const stylePaletteSchema = z
  .strictObject({
    hex: z.array(hexColorSchema).min(1).max(8),
    weights: z.array(z.number().min(0).max(1)).min(1).max(8),
  })
  .superRefine((value, ctx) => {
    if (value.hex.length !== value.weights.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['weights'],
        message: 'weights must have one entry per hex colour',
      });
      return;
    }
    const total = value.weights.reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(total - 1) > 0.01) {
      ctx.addIssue({
        code: 'custom',
        path: ['weights'],
        message: `weights must sum to 1, got ${total.toFixed(3)}`,
      });
    }
  });
export type StylePalette = z.infer<typeof stylePaletteSchema>;

/** `mean` and 95th percentile of one 0..1 metric across a frame's pixels. */
export const styleStatSchema = z.strictObject({
  mean: unitIntervalSchema,
  p95: unitIntervalSchema,
});
export type StyleStat = z.infer<typeof styleStatSchema>;

/**
 * Ink properties. `strokeDensity` is the share of pixels that are both dark
 * and on a strong edge (ink lines, not shadows); `edgeEnergy` is the mean
 * Sobel gradient magnitude, normalised. Definitions live in docs/04 §4.
 */
export const styleLineSchema = z.strictObject({
  strokeDensity: unitIntervalSchema,
  edgeEnergy: unitIntervalSchema,
});
export type StyleLine = z.infer<typeof styleLineSchema>;

export const styleToneSchema = z.strictObject({
  saturation: styleStatSchema,
  contrast: styleStatSchema,
  brightness: styleStatSchema,
});
export type StyleTone = z.infer<typeof styleToneSchema>;

/** Source frame geometry. Square counts as `landscape` (ratio >= 1). */
export const styleAspectSchema = z
  .strictObject({
    width: z.int().positive(),
    height: z.int().positive(),
    ratio: z.number().positive(),
    orientation: sizeSchema,
  })
  .superRefine((value, ctx) => {
    const expected = value.width / value.height;
    if (Math.abs(expected - value.ratio) > 0.02) {
      ctx.addIssue({
        code: 'custom',
        path: ['ratio'],
        message: `ratio ${value.ratio} does not match ${value.width}x${value.height}`,
      });
    }
    const orientation = value.ratio >= 1 ? 'landscape' : 'portrait';
    if (value.orientation !== orientation) {
      ctx.addIssue({
        code: 'custom',
        path: ['orientation'],
        message: `orientation must be ${orientation} for ratio ${value.ratio}`,
      });
    }
  });
export type StyleAspect = z.infer<typeof styleAspectSchema>;

/**
 * How much the subject touches the frame edge.
 *
 * `edgeContentRatio` is the share of pixels in the outer `margin` band whose
 * colour differs from the band's median: near 0 means a clean border, which is
 * what a "safe area" style looks like. It is a proxy, not a composition
 * detector — docs/04 §4 states the limitation.
 */
export const styleSafeAreaSchema = z.strictObject({
  edgeContentRatio: unitIntervalSchema,
  margin: z.number().gt(0).max(0.5),
});
export type StyleSafeArea = z.infer<typeof styleSafeAreaSchema>;

/** The whole numeric pass. No model was called to produce this. */
export const numericStyleProfileSchema = z.strictObject({
  palette: stylePaletteSchema,
  line: styleLineSchema,
  tone: styleToneSchema,
  aspect: styleAspectSchema,
  safeArea: styleSafeAreaSchema,
  /** How many sampled frames were averaged. 1 is legal (a still reference). */
  frameCount: z.int().positive(),
});
export type NumericStyleProfile = z.infer<typeof numericStyleProfileSchema>;
