import { describe, expect, it } from 'vitest';

import {
  artStyleExportSchema,
  artStyleListSchema,
  artStyleMetaSchema,
  createArtStyleRequestSchema,
  createArtStyleResponseSchema,
} from './index';

describe('art style request', () => {
  it('accepts only formats with defaults', () => {
    const parsed = artStyleMetaSchema.parse({});
    expect(parsed.formats).toEqual(['landscape']);
    expect(parsed.published).toBe(false);
  });

  it('accepts a name and formats', () => {
    const parsed = artStyleMetaSchema.parse({
      name: 'My Style',
      formats: ['portrait'],
    });
    expect(parsed.name).toBe('My Style');
    expect(parsed.formats).toEqual(['portrait']);
  });

  it('rejects empty formats', () => {
    expect(artStyleMetaSchema.safeParse({ formats: [] }).success).toBe(false);
  });

  it('rejects unknown size in formats', () => {
    expect(artStyleMetaSchema.safeParse({ formats: ['square'] }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(
      createArtStyleRequestSchema.safeParse({ name: 'x', unknown: true }).success,
    ).toBe(false);
  });

  it('rejects empty name', () => {
    expect(
      artStyleMetaSchema.safeParse({ name: '' }).success,
    ).toBe(false);
  });
});

describe('art style create response', () => {
  it('accepts a building response', () => {
    const parsed = createArtStyleResponseSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'building',
      createdAt: '2026-10-29T10:00:00.000Z',
    });
    expect(parsed.status).toBe('building');
  });

  it('rejects any status other than building', () => {
    expect(
      createArtStyleResponseSchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'ready',
        createdAt: '2026-10-29T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

const profile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene',
  palette: {
    hex: ['#14213d', '#fca311', '#ffffff'],
    weights: [0.5, 0.3, 0.2],
  },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple background',
  composition: 'centred subject',
  characters: [],
  typography: { present: false },
  negative: 'photo, text, watermark',
  seedBase: 1234,
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

describe('art style list response', () => {
  it('accepts a ready style with previews and status', () => {
    const parsed = artStyleListSchema.parse({
      styles: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Whiteboard explainer',
          published: true,
          formats: ['landscape', 'portrait'],
          previewUrl: 'https://cdn.example/preview.png',
          portraitPreviewUrl: '/files/art-styles/x/preview-portrait.png',
          sampleVideoUrls: ['/files/art-styles/x/preview.mp4'],
          status: 'ready',
          createdAt: '2026-10-31T10:00:00.000Z',
        },
      ],
    });
    expect(parsed.styles[0]?.status).toBe('ready');
    expect(parsed.styles[0]?.sampleVideoUrls).toEqual(['/files/art-styles/x/preview.mp4']);
  });

  it('rejects a style without a preview or with empty formats', () => {
    const base = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'x',
      published: false,
      formats: ['landscape'],
      previewUrl: '/files/x.png',
      sampleVideoUrls: [],
      status: 'ready',
      createdAt: '2026-10-31T10:00:00.000Z',
    };
    expect(artStyleListSchema.safeParse({ styles: [{ ...base, previewUrl: undefined }] }).success).toBe(
      false,
    );
    expect(artStyleListSchema.safeParse({ styles: [{ ...base, formats: [] }] }).success).toBe(false);
  });
});

describe('art style export response', () => {
  it('accepts the portable document with a full StyleProfile', () => {
    const parsed = artStyleExportSchema.parse({
      version: 1,
      name: 'My Style',
      formats: ['landscape'],
      profile,
    });
    expect(parsed.profile.palette.hex).toEqual(profile.palette.hex);
  });

  it('rejects a profile that is not a complete StyleProfile', () => {
    const withoutSource = { ...profile, source: undefined };
    expect(
      artStyleExportSchema.safeParse({
        version: 1,
        name: 'My Style',
        formats: ['landscape'],
        profile: withoutSource,
      }).success,
    ).toBe(false);
    expect(
      artStyleExportSchema.safeParse({
        version: 2,
        name: 'My Style',
        formats: ['landscape'],
        profile,
      }).success,
    ).toBe(false);
  });
});