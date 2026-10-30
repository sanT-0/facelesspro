import { describe, expect, it } from 'vitest';

import { MAX_STYLE_SEED, styleProfileSchema } from './index';

/** A profile the merge can actually produce: measured palette + vision text. */
const profile = {
  version: 1,
  medium: 'flat vector cartoon',
  promptPrefix: 'flat 2d cartoon illustration, thick black outlines',
  palette: {
    hex: ['#1b2a41', '#f2c14e', '#e4572e'],
    weights: [0.5, 0.3, 0.2],
  },
  line: { weight: 'thick', color: '#1b2a41', texture: 'clean' },
  shading: 'cel',
  background: 'simple gradient, low detail',
  composition: 'centered subject, eye-level, medium shot',
  characters: [{ id: 'hero', description: 'young man, red hoodie, short black hair' }],
  typography: { present: true, style: 'bold sans, white with black outline' },
  negative: 'photo, 3d render, text, watermark',
  seedBase: 1_234_567,
  measured: {
    line: { strokeDensity: 0.08, edgeEnergy: 0.14 },
    tone: {
      saturation: { mean: 0.41, p95: 0.86 },
      contrast: { mean: 0.18, p95: 0.52 },
      brightness: { mean: 0.44, p95: 0.81 },
    },
    aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
    safeArea: { edgeContentRatio: 0.06, margin: 0.08 },
    frameCount: 11,
  },
  source: { adapter: 'cloudflare', degradedFrom: ['gemini'] },
};

const edit = (patch: Record<string, unknown>) => ({ ...profile, ...patch });

describe('style profile', () => {
  it('accepts a full merged profile and keeps both halves', () => {
    const parsed = styleProfileSchema.parse(profile);

    expect(parsed.palette.hex).toHaveLength(3);
    expect(parsed.line.color).toBe('#1b2a41');
    expect(parsed.measured.frameCount).toBe(11);
    expect(parsed.source).toEqual({ adapter: 'cloudflare', degradedFrom: ['gemini'] });
  });

  it('accepts an unknown medium and an empty cast honestly', () => {
    const parsed = styleProfileSchema.parse(
      edit({ medium: 'unknown', characters: [], typography: { present: false } }),
    );
    expect(parsed.medium).toBe('unknown');
    expect(parsed.characters).toEqual([]);
  });

  it('rejects an unknown top-level key', () => {
    expect(() => styleProfileSchema.parse(edit({ adapter: 'cloudflare' }))).toThrow();
  });

  it('rejects a future version instead of guessing', () => {
    expect(() => styleProfileSchema.parse(edit({ version: 2 }))).toThrow();
  });

  it('rejects a seed outside the safe range', () => {
    expect(() => styleProfileSchema.parse(edit({ seedBase: 0 }))).toThrow();
    expect(() => styleProfileSchema.parse(edit({ seedBase: -1 }))).toThrow();
    expect(() => styleProfileSchema.parse(edit({ seedBase: MAX_STYLE_SEED + 1 }))).toThrow();
  });

  it('rejects an ink colour that is not in the measured palette', () => {
    expect(() =>
      styleProfileSchema.parse(edit({ line: { ...profile.line, color: '#141414' } })),
    ).toThrow(/not one of palette.hex/);
  });

  it('matches the ink colour case-insensitively', () => {
    const parsed = styleProfileSchema.parse(
      edit({
        palette: { hex: ['#1B2A41', '#f2c14e'], weights: [0.7, 0.3] },
        line: { ...profile.line, color: '#1b2a41' },
      }),
    );
    expect(parsed.line.color).toBe('#1b2a41');
  });

  it('still rejects duplicate character ids', () => {
    expect(() =>
      styleProfileSchema.parse(
        edit({
          characters: [
            { id: 'hero', description: 'a' },
            { id: 'hero', description: 'b' },
          ],
        }),
      ),
    ).toThrow(/duplicate character id/);
  });

  it('still requires typography style when present', () => {
    expect(() => styleProfileSchema.parse(edit({ typography: { present: true } }))).toThrow(
      /typography.style is required/,
    );
  });

  it('rejects a measured block missing a field', () => {
    const withoutTone: Record<string, unknown> = { ...profile.measured };
    delete withoutTone.tone;
    expect(() => styleProfileSchema.parse(edit({ measured: withoutTone }))).toThrow();
  });

  it('rejects unknown keys inside measured', () => {
    expect(() =>
      styleProfileSchema.parse(edit({ measured: { ...profile.measured, sharpness: 0.5 } })),
    ).toThrow();
  });

  it('rejects a palette duplicated inside measured', () => {
    expect(() =>
      styleProfileSchema.parse(
        edit({ measured: { ...profile.measured, palette: profile.palette } }),
      ),
    ).toThrow();
  });

  it('rejects an unknown source adapter', () => {
    expect(() =>
      styleProfileSchema.parse(edit({ source: { adapter: 'openai', degradedFrom: [] } })),
    ).toThrow();
  });

  it('rejects palette weights that do not sum to 1', () => {
    expect(() =>
      styleProfileSchema.parse(
        edit({ palette: { hex: ['#1b2a41', '#f2c14e'], weights: [0.5, 0.2] } }),
      ),
    ).toThrow(/weights must sum to 1/);
  });
});
