import { describe, expect, it } from 'vitest';

import {
  IMAGE_ADAPTERS,
  MAX_IMAGE_OUTPUT_SIDE,
  generatedImageSchema,
  imageAdapterSchema,
  imageCapabilitiesSchema,
  imageGenerationRequestSchema,
} from './index';
import type { ImageGenerationRequest, StyleProfile } from './index';

const style: StyleProfile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene, bold geometric shapes',
  palette: {
    hex: ['#14213d', '#fca311', '#e5e5e5', '#ffffff'],
    weights: [0.4, 0.3, 0.2, 0.1],
  },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple background with open edges',
  composition: 'centred subject, medium shot',
  characters: [],
  typography: { present: false },
  negative: 'photo, 3d render, text, watermark, logo, signature',
  seedBase: 1_234_567,
  measured: {
    line: { strokeDensity: 0.04, edgeEnergy: 0.08 },
    tone: {
      saturation: { mean: 0.5, p95: 0.8 },
      contrast: { mean: 0.2, p95: 0.5 },
      brightness: { mean: 0.6, p95: 0.9 },
    },
    aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
    safeArea: { edgeContentRatio: 0.04, margin: 0.08 },
    frameCount: 8,
  },
  source: { adapter: 'heuristic', degradedFrom: [] },
};

const request: ImageGenerationRequest = {
  prompt: 'a freelancer reviewing an invoice at a clean desk',
  negativePrompt: style.negative,
  seed: 42,
  size: 'landscape',
  style,
};

describe('image adapter contracts', () => {
  it('pins the adapter vocabulary and rejects an unknown provider', () => {
    expect(IMAGE_ADAPTERS).toEqual(['cloudflare', 'pollinations', 'comfyui', 'procedural']);
    for (const adapter of IMAGE_ADAPTERS) {
      expect(imageAdapterSchema.parse(adapter)).toBe(adapter);
    }
    expect(imageAdapterSchema.safeParse('openai').success).toBe(false);
  });

  it('accepts capabilities for a seeded profile-aware adapter', () => {
    expect(
      imageCapabilitiesSchema.parse({
        maxSide: 1024,
        sizes: ['landscape', 'portrait'],
        style: 'profile',
        seed: true,
      }),
    ).toEqual({
      maxSide: 1024,
      sizes: ['landscape', 'portrait'],
      style: 'profile',
      seed: true,
    });
  });

  it('rejects empty/duplicate capabilities and unknown keys', () => {
    expect(
      imageCapabilitiesSchema.safeParse({ maxSide: 1024, sizes: [], style: 'profile', seed: true })
        .success,
    ).toBe(false);
    expect(
      imageCapabilitiesSchema.safeParse({
        maxSide: 1024,
        sizes: ['landscape', 'landscape'],
        style: 'profile',
        seed: true,
      }).success,
    ).toBe(false);
    expect(
      imageCapabilitiesSchema.safeParse({
        maxSide: 1024,
        sizes: ['landscape'],
        style: 'profile',
        seed: true,
        gpu: false,
      }).success,
    ).toBe(false);
  });
});

describe('imageGenerationRequestSchema', () => {
  it('parses the complete request without dropping or defaulting fields', () => {
    expect(imageGenerationRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects bad prompts, seeds, sizes, profiles and unknown keys', () => {
    expect(imageGenerationRequestSchema.safeParse({ ...request, prompt: '' }).success).toBe(false);
    expect(imageGenerationRequestSchema.safeParse({ ...request, seed: 0 }).success).toBe(false);
    expect(imageGenerationRequestSchema.safeParse({ ...request, seed: 2_147_483_648 }).success).toBe(
      false,
    );
    expect(imageGenerationRequestSchema.safeParse({ ...request, size: 'square' }).success).toBe(
      false,
    );
    expect(
      imageGenerationRequestSchema.safeParse({
        ...request,
        style: { ...style, line: { ...style.line, color: '#000000' } },
      }).success,
    ).toBe(false);
    expect(imageGenerationRequestSchema.safeParse({ ...request, count: 2 }).success).toBe(false);
  });
});

describe('generatedImageSchema', () => {
  const image = {
    adapter: 'procedural',
    degradedFrom: [],
    mimeType: 'image/png',
    size: 'landscape',
    width: 1024,
    height: 576,
    seed: 42,
    bytes: new Uint8Array([137, 80, 78, 71]),
  } as const;

  it('accepts a non-empty PNG result with provenance', () => {
    expect(generatedImageSchema.parse(image)).toEqual(image);
  });

  it('rejects empty bytes, invalid geometry/provenance and unknown keys', () => {
    expect(
      generatedImageSchema.safeParse({ ...image, bytes: new Uint8Array() }).success,
    ).toBe(false);
    expect(generatedImageSchema.safeParse({ ...image, width: 0 }).success).toBe(false);
    expect(
      generatedImageSchema.safeParse({ ...image, width: MAX_IMAGE_OUTPUT_SIDE + 1 }).success,
    ).toBe(false);
    expect(generatedImageSchema.safeParse({ ...image, mimeType: 'image/jpeg' }).success).toBe(false);
    expect(generatedImageSchema.safeParse({ ...image, adapter: 'unknown' }).success).toBe(false);
    expect(generatedImageSchema.safeParse({ ...image, size: 'portrait' }).success).toBe(false);
    expect(generatedImageSchema.safeParse({ ...image, path: '/tmp/x.png' }).success).toBe(false);
  });
});
