/**
 * Image generation boundary — shared by worker adapters and the future scene
 * manifest. Vendors never define this shape: they translate it.
 */

import { z } from 'zod';

import { sizeSchema } from './common';
import { MAX_IMAGE_PROMPT_CHARS } from './planner';
import { MAX_STYLE_SEED, styleProfileSchema } from './style-profile';

export const IMAGE_ADAPTERS = [
  'cloudflare',
  'pollinations',
  'comfyui',
  'procedural',
] as const;
export const imageAdapterSchema = z.enum(IMAGE_ADAPTERS);
export type ImageAdapter = z.infer<typeof imageAdapterSchema>;

/** 4K's long edge fits; anything larger is outside the current product. */
export const MAX_IMAGE_OUTPUT_SIDE = 4096;
/** Style negative text plus fixed safety clauses added by create-images. */
export const MAX_IMAGE_NEGATIVE_PROMPT_CHARS = 1200;

export const imageCapabilitiesSchema = z
  .strictObject({
    maxSide: z.int().min(1).max(MAX_IMAGE_OUTPUT_SIDE),
    sizes: z.array(sizeSchema).min(1),
    style: z.literal('profile'),
    /** Every shipped adapter must accept a deterministic caller-owned seed. */
    seed: z.literal(true),
  })
  .superRefine((capabilities, ctx) => {
    if (new Set(capabilities.sizes).size !== capabilities.sizes.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['sizes'],
        message: 'image capability sizes must be unique',
      });
    }
  });
export type ImageCapabilities = z.infer<typeof imageCapabilitiesSchema>;

export const imageGenerationRequestSchema = z.strictObject({
  /** Final style-composed scene prompt; adapters must not add vendor prose. */
  prompt: z.string().trim().min(1).max(MAX_IMAGE_PROMPT_CHARS),
  negativePrompt: z.string().trim().min(1).max(MAX_IMAGE_NEGATIVE_PROMPT_CHARS),
  seed: z.int().min(1).max(MAX_STYLE_SEED),
  size: sizeSchema,
  style: styleProfileSchema,
});
export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;

const imageBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0, 'image bytes must not be empty');

export const generatedImageSchema = z
  .strictObject({
    adapter: imageAdapterSchema,
    /** Adapters the chain tried first, in order. Empty on a direct adapter. */
    degradedFrom: z.array(imageAdapterSchema),
    mimeType: z.literal('image/png'),
    size: sizeSchema,
    width: z.int().min(1).max(MAX_IMAGE_OUTPUT_SIDE),
    height: z.int().min(1).max(MAX_IMAGE_OUTPUT_SIDE),
    seed: z.int().min(1).max(MAX_STYLE_SEED),
    bytes: imageBytesSchema,
  })
  .superRefine((image, ctx) => {
    const correctOrientation =
      image.size === 'landscape' ? image.width > image.height : image.height > image.width;
    if (!correctOrientation) {
      ctx.addIssue({
        code: 'custom',
        path: ['width'],
        message: `${image.size} image has incompatible ${image.width}x${image.height} geometry`,
      });
    }
  });
export type GeneratedImage = z.infer<typeof generatedImageSchema>;
