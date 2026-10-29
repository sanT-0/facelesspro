import { describe, expect, it } from 'vitest';

import {
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