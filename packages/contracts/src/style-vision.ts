/**
 * The vision half of a `StyleProfile` — docs/04 §4 "vision pass (VLM)".
 *
 * A model looks at the sampled frames and describes only what pixels cannot
 * tell us: medium, line character, shading, background treatment, composition,
 * typography and recurring characters. It is explicitly **not** asked for the
 * palette — that is measured by the numeric pass — and it is not asked for
 * timings, character ids that do not follow the convention, or colours.
 *
 * Two shapes:
 * - `styleVisionAnswerSchema` — exactly what a model is allowed to answer. The
 *   adapter fills `adapter`/`degradedFrom`, so a model cannot claim to be a
 *   different provider or hide that it was a fallback.
 * - `styleVisionSchema` — the answer plus those two provenance fields, which is
 *   what the chain returns and the merge step consumes.
 *
 * Unlike the numeric profile, these objects **strip unknown keys** instead of
 * rejecting them. Models volunteer `palette` and `line.color` no matter what
 * the prompt says; killing an otherwise good answer over a harmless extra key
 * would degrade the chain for no gain. An invalid *enum* is still fatal: that
 * is a model ignoring the contract, not a model being chatty.
 */

import { z } from 'zod';

/** Adapters that can produce the vision half (docs/03 §7). */
export const STYLE_ADAPTERS = ['cloudflare', 'gemini', 'heuristic'] as const;
export const styleAdapterSchema = z.enum(STYLE_ADAPTERS);
export type StyleAdapter = z.infer<typeof styleAdapterSchema>;

/** Ink weight. `unknown` is honest, not a placeholder to be filled later. */
export const STYLE_LINE_WEIGHTS = ['none', 'thin', 'medium', 'thick', 'unknown'] as const;
export const styleLineWeightSchema = z.enum(STYLE_LINE_WEIGHTS);
export type StyleLineWeight = z.infer<typeof styleLineWeightSchema>;

export const STYLE_LINE_TEXTURES = ['clean', 'sketchy', 'rough', 'painterly', 'unknown'] as const;
export const styleLineTextureSchema = z.enum(STYLE_LINE_TEXTURES);
export type StyleLineTexture = z.infer<typeof styleLineTextureSchema>;

/** How volume is rendered: no gradient, hard cel steps, soft blends, … */
export const STYLE_SHADING = ['flat', 'cel', 'soft', 'gradient', 'painterly', 'unknown'] as const;
export const styleShadingSchema = z.enum(STYLE_SHADING);
export type StyleShading = z.infer<typeof styleShadingSchema>;

/** Character bible cap: enough for a cast, small enough to stay a prompt. */
export const MAX_STYLE_CHARACTERS = 8;
/** A prompt clause, not an essay. */
export const MAX_STYLE_PROMPT_PREFIX_CHARS = 400;
export const MAX_STYLE_DESCRIPTION_CHARS = 200;
export const MAX_STYLE_NEGATIVE_CHARS = 300;
export const MAX_STYLE_MEDIUM_CHARS = 80;

/**
 * Character ids are a public convention: `hero`, `support-1`, `support-2`.
 * Lowercase kebab-case only, so a merge step can join on them and so a model
 * cannot smuggle prose into the id.
 */
export const styleCharacterIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'expected a lowercase kebab-case id such as hero');

export const styleCharacterSchema = z.object({
  id: styleCharacterIdSchema,
  description: z.string().min(1).max(MAX_STYLE_DESCRIPTION_CHARS),
});
export type StyleCharacter = z.infer<typeof styleCharacterSchema>;

/** A cast list with unique ids. Shared by the vision answer and the profile. */
export const styleCharactersSchema = z
  .array(styleCharacterSchema)
  .max(MAX_STYLE_CHARACTERS)
  .superRefine((characters, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index]!;
      if (seen.has(character.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `duplicate character id "${character.id}"`,
        });
      }
      seen.add(character.id);
    }
  });
export type StyleCharacters = z.infer<typeof styleCharactersSchema>;

/**
 * Lettering rules. A style either has typography and describes it, or has none
 * and omits the description — "present: true" with no style is unusable, and
 * "present: false" with a style is a contradiction.
 */
export const styleTypographySchema = z
  .object({
    present: z.boolean(),
    /** Required when `present` is true; omitted for clean art with no lettering. */
    style: z.string().min(1).max(MAX_STYLE_DESCRIPTION_CHARS).optional(),
  })
  .superRefine((typography, ctx) => {
    if (typography.present && !typography.style) {
      ctx.addIssue({
        code: 'custom',
        path: ['style'],
        message: 'typography.style is required when typography.present is true',
      });
    }
    if (!typography.present && typography.style !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['style'],
        message: 'typography.style must be omitted when typography.present is false',
      });
    }
  });
export type StyleTypography = z.infer<typeof styleTypographySchema>;

const answerShape = {
  /** Free text: "flat vector cartoon", "watercolour storybook". `unknown` is legal. */
  medium: z.string().min(1).max(MAX_STYLE_MEDIUM_CHARS),
  /** Prepended to every image prompt; must stand alone without the palette. */
  promptPrefix: z.string().min(1).max(MAX_STYLE_PROMPT_PREFIX_CHARS),
  line: z.object({
    weight: styleLineWeightSchema,
    texture: styleLineTextureSchema,
  }),
  shading: styleShadingSchema,
  background: z.string().min(1).max(MAX_STYLE_DESCRIPTION_CHARS),
  composition: z.string().min(1).max(MAX_STYLE_DESCRIPTION_CHARS),
  /** Recurring characters only. Empty is valid: a style may have no cast. */
  characters: styleCharactersSchema,
  typography: styleTypographySchema,
  /** Things to keep out of every generated image. */
  negative: z.string().min(1).max(MAX_STYLE_NEGATIVE_CHARS),
};

/** Exactly what a model may answer. Unknown keys are stripped, not rejected. */
export const styleVisionAnswerSchema = z.object(answerShape);
export type StyleVisionAnswer = z.infer<typeof styleVisionAnswerSchema>;

/** The answer plus provenance: what the chain returns and the merge step reads. */
export const styleVisionSchema = z.object({
  ...answerShape,
  adapter: styleAdapterSchema,
  /** Adapters that failed before `adapter` succeeded, in the order tried. */
  degradedFrom: z.array(styleAdapterSchema),
});
export type StyleVision = z.infer<typeof styleVisionSchema>;
