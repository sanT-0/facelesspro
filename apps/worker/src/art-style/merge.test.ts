import { describe, expect, it } from 'vitest';

import type { NumericStyleProfile, StyleVision } from '@facelesspro/contracts';
import { styleProfileSchema } from '@facelesspro/contracts';

import { mergeStyleProfile } from './merge';

const numeric: NumericStyleProfile = {
  palette: {
    hex: ['#f2c14e', '#1b2a41', '#e4572e', '#020202'],
    weights: [0.4, 0.35, 0.2, 0.05],
  },
  line: { strokeDensity: 0.0059, edgeEnergy: 0.0068 },
  tone: {
    saturation: { mean: 0.478, p95: 0.5022 },
    contrast: { mean: 0.0099, p95: 0.0195 },
    brightness: { mean: 0.5537, p95: 0.6277 },
  },
  aspect: { width: 640, height: 360, ratio: 1.7778, orientation: 'landscape' },
  safeArea: { edgeContentRatio: 0.0439, margin: 0.08 },
  frameCount: 8,
};

const vision: StyleVision = {
  medium: 'unknown',
  promptPrefix: 'landscape frame, thin outlines, medium-saturation palette, flat colour areas',
  line: { weight: 'thin', texture: 'unknown' },
  shading: 'flat',
  background: 'clean, simple background with empty edges',
  composition: 'landscape 1.78:1 frame, low edge content',
  characters: [],
  typography: { present: false },
  negative: 'photo, 3d render, text, watermark',
  adapter: 'heuristic',
  degradedFrom: [],
};

describe('mergeStyleProfile', () => {
  it('keeps the measured palette and takes the darkest colour as ink', () => {
    const profile = mergeStyleProfile(numeric, vision);

    expect(profile.palette).toEqual(numeric.palette);
    expect(profile.line.color).toBe('#020202');
    expect(profile.line.weight).toBe('thin');
    expect(profile.measured.line.strokeDensity).toBe(0.0059);
    expect(profile.measured.frameCount).toBe(8);
  });

  it('does not duplicate the palette inside measured', () => {
    const profile = mergeStyleProfile(numeric, vision);
    expect(profile.measured).not.toHaveProperty('palette');
  });

  it('always produces an ink colour that is in the palette', () => {
    const profile = mergeStyleProfile(numeric, vision);
    expect(profile.palette.hex.map((hex) => hex.toLowerCase())).toContain(profile.line.color);
  });

  it('preserves an unknown medium instead of inventing one', () => {
    expect(mergeStyleProfile(numeric, vision).medium).toBe('unknown');
  });

  it('copies the character bible and typography rules', () => {
    const profile = mergeStyleProfile(numeric, {
      ...vision,
      characters: [{ id: 'hero', description: 'young man, red hoodie' }],
      typography: { present: true, style: 'bold sans' },
    });

    expect(profile.characters).toEqual([{ id: 'hero', description: 'young man, red hoodie' }]);
    expect(profile.typography).toEqual({ present: true, style: 'bold sans' });
  });

  it('records the vision adapter and the degradation order', () => {
    const profile = mergeStyleProfile(numeric, {
      ...vision,
      adapter: 'gemini',
      degradedFrom: ['cloudflare'],
    });

    expect(profile.source).toEqual({ adapter: 'gemini', degradedFrom: ['cloudflare'] });
    expect(profile.source.degradedFrom).not.toBe(vision.degradedFrom);
  });

  it('returns a schema-valid profile', () => {
    const profile = mergeStyleProfile(numeric, vision);
    expect(styleProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile.version).toBe(1);
  });

  it('keeps the seed stable when only measurements change', () => {
    const retoned: NumericStyleProfile = {
      ...numeric,
      tone: {
        saturation: { mean: 0.1, p95: 0.2 },
        contrast: { mean: 0.9, p95: 0.95 },
        brightness: { mean: 0.1, p95: 0.2 },
      },
    };

    expect(mergeStyleProfile(retoned, vision).seedBase).toBe(
      mergeStyleProfile(numeric, vision).seedBase,
    );
  });

  it('refuses a vision answer that breaks the contract', () => {
    const broken = {
      ...vision,
      characters: [
        { id: 'hero', description: 'a' },
        { id: 'hero', description: 'b' },
      ],
    } as StyleVision;

    expect(() => mergeStyleProfile(numeric, broken)).toThrow(/duplicate character id/);
  });
});
