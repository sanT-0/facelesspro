import { describe, expect, it } from 'vitest';

import { numericStyleProfileSchema } from './index';

/** A profile the numeric pass can actually produce: 7 colours, 16:9, flat ink. */
const profile = {
  palette: {
    hex: ['#1b2a41', '#f2c14e', '#e4572e'],
    weights: [0.5, 0.3, 0.2],
  },
  line: { strokeDensity: 0.08, edgeEnergy: 0.14 },
  tone: {
    saturation: { mean: 0.41, p95: 0.86 },
    contrast: { mean: 0.18, p95: 0.52 },
    brightness: { mean: 0.44, p95: 0.81 },
  },
  aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
  safeArea: { edgeContentRatio: 0.06, margin: 0.08 },
  frameCount: 11,
};

describe('numeric style profile', () => {
  it('accepts a numeric pass and keeps every field', () => {
    const parsed = numericStyleProfileSchema.parse(profile);
    expect(parsed.palette.hex).toHaveLength(3);
    expect(parsed.line.strokeDensity).toBeCloseTo(0.08, 5);
    expect(parsed.aspect.orientation).toBe('landscape');
    expect(parsed.frameCount).toBe(11);
  });

  it('accepts a single-colour reference with weight 1', () => {
    const parsed = numericStyleProfileSchema.parse({
      ...profile,
      palette: { hex: ['#ffffff'], weights: [1] },
    });
    expect(parsed.palette.weights).toEqual([1]);
  });

  it('accepts a portrait reference', () => {
    const parsed = numericStyleProfileSchema.parse({
      ...profile,
      aspect: { width: 1080, height: 1920, ratio: 0.5625, orientation: 'portrait' },
    });
    expect(parsed.aspect.orientation).toBe('portrait');
  });

  it('rejects weights that do not sum to 1', () => {
    const result = numericStyleProfileSchema.safeParse({
      ...profile,
      palette: { hex: ['#111111', '#222222'], weights: [0.5, 0.2] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a palette whose hex and weight counts differ', () => {
    const result = numericStyleProfileSchema.safeParse({
      ...profile,
      palette: { hex: ['#111111', '#222222'], weights: [1] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty palette', () => {
    const result = numericStyleProfileSchema.safeParse({
      ...profile,
      palette: { hex: [], weights: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a hex colour without #', () => {
    const result = numericStyleProfileSchema.safeParse({
      ...profile,
      palette: { hex: ['1b2a41'], weights: [1] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects metrics outside 0..1', () => {
    const result = numericStyleProfileSchema.safeParse({
      ...profile,
      line: { strokeDensity: 0.08, edgeEnergy: 1.2 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a ratio that disagrees with width/height', () => {
    const result = numericStyleProfileSchema.safeParse({
      ...profile,
      aspect: { width: 1920, height: 1080, ratio: 1.5, orientation: 'landscape' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an orientation that disagrees with the ratio', () => {
    const result = numericStyleProfileSchema.safeParse({
      ...profile,
      aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'portrait' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a zero frame count', () => {
    const result = numericStyleProfileSchema.safeParse({ ...profile, frameCount: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys, so a vision-pass field cannot leak in', () => {
    const result = numericStyleProfileSchema.safeParse({ ...profile, medium: 'flat vector' });
    expect(result.success).toBe(false);
  });
});
