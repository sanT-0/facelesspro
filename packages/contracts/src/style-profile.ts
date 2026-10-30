/**
 * The merged `StyleProfile` — docs/04 §4.
 *
 * One document, two sources, and the split is the whole point:
 * - **measured** (numeric): palette, ink density, tone, aspect, safe area. A
 *   model never sets these, so a plausible-sounding sentence cannot override a
 *   pixel.
 * - **described** (vision): medium, prompt prefix, line weight/texture,
 *   shading, background, composition, characters, typography, negative.
 *
 * `line.color` is the one cross-over: the vision pass does not choose it (it
 * would invent `#141414`), so the merge takes the darkest measured palette
 * colour. The schema enforces that it is actually in `palette.hex`.
 *
 * `measured` keeps the numeric fields that are not already top-level
 * (`palette` is), so the export endpoint and a later re-merge can show what the
 * description was derived from. `source` makes a degraded build explainable
 * without log diving — same reasoning as `ScenePlan.degradedFrom`.
 *
 * Version 1 is a literal. A merge change that alters meaning increments it;
 * import code can then migrate instead of guessing.
 */

import { z } from 'zod';

import {
  numericStyleProfileSchema,
  stylePaletteSchema,
} from './art-style';
import { hexColorSchema } from './common';
import {
  MAX_STYLE_DESCRIPTION_CHARS,
  MAX_STYLE_MEDIUM_CHARS,
  MAX_STYLE_NEGATIVE_CHARS,
  MAX_STYLE_PROMPT_PREFIX_CHARS,
  styleAdapterSchema,
  styleCharactersSchema,
  styleLineTextureSchema,
  styleLineWeightSchema,
  styleShadingSchema,
  styleTypographySchema,
} from './style-vision';

export const STYLE_PROFILE_VERSION = 1;

/** Seed range accepted by image engines and JS bitwise-safe arithmetic. */
export const MAX_STYLE_SEED = 2_147_483_647;

/** Numeric fields that are not already represented at the top level. */
export const measuredStyleSchema = numericStyleProfileSchema.omit({ palette: true });
export type MeasuredStyle = z.infer<typeof measuredStyleSchema>;

export const styleProfileLineSchema = z.strictObject({
  weight: styleLineWeightSchema,
  /** Must be one of `palette.hex`; enforced below. */
  color: hexColorSchema,
  texture: styleLineTextureSchema,
});
export type StyleProfileLine = z.infer<typeof styleProfileLineSchema>;

export const styleProfileSourceSchema = z.strictObject({
  /** The vision adapter that produced the description. */
  adapter: styleAdapterSchema,
  /** Vision adapters that failed before `adapter`, in the order tried. */
  degradedFrom: z.array(styleAdapterSchema),
});
export type StyleProfileSource = z.infer<typeof styleProfileSourceSchema>;

/** Everything a consumer needs to keep one channel looking like one channel. */
export const styleProfileSchema = z
  .strictObject({
    version: z.literal(STYLE_PROFILE_VERSION),
    medium: z.string().min(1).max(MAX_STYLE_MEDIUM_CHARS),
    promptPrefix: z.string().min(1).max(MAX_STYLE_PROMPT_PREFIX_CHARS),
    palette: stylePaletteSchema,
    line: styleProfileLineSchema,
    shading: styleShadingSchema,
    background: z.string().min(1).max(MAX_STYLE_DESCRIPTION_CHARS),
    composition: z.string().min(1).max(MAX_STYLE_DESCRIPTION_CHARS),
    characters: styleCharactersSchema,
    typography: styleTypographySchema,
    negative: z.string().min(1).max(MAX_STYLE_NEGATIVE_CHARS),
    /** Deterministic from the prompt-relevant fields; never random. */
    seedBase: z.int().min(1).max(MAX_STYLE_SEED),
    measured: measuredStyleSchema,
    source: styleProfileSourceSchema,
  })
  .superRefine((profile, ctx) => {
    const palette = new Set(profile.palette.hex.map((hex) => hex.toLowerCase()));
    if (!palette.has(profile.line.color.toLowerCase())) {
      ctx.addIssue({
        code: 'custom',
        path: ['line', 'color'],
        message: `line.color ${profile.line.color} is not one of palette.hex`,
      });
    }
  });
export type StyleProfile = z.infer<typeof styleProfileSchema>;
