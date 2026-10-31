import { describe, expect, it } from 'vitest';

import {
  MAX_STYLE_CHARACTERS,
  styleVisionAnswerSchema,
  styleVisionSchema,
} from './index';

/** A realistic answer: a flat cartoon with one recurring character. */
const answer = {
  medium: 'flat vector cartoon',
  promptPrefix: 'flat 2d cartoon illustration, thick black outlines',
  line: { weight: 'thick', texture: 'clean' },
  shading: 'cel',
  background: 'simple gradient, low detail',
  composition: 'centered subject, eye-level, medium shot',
  characters: [{ id: 'hero', description: 'young man, red hoodie, short black hair' }],
  typography: { present: true, style: 'bold sans, white with black outline' },
  negative: 'photo, 3d render, text, watermark',
};

describe('style vision answer', () => {
  it('accepts a full answer and keeps every field', () => {
    const parsed = styleVisionAnswerSchema.parse(answer);
    expect(parsed.medium).toBe('flat vector cartoon');
    expect(parsed.line).toEqual({ weight: 'thick', texture: 'clean' });
    expect(parsed.characters[0]!.id).toBe('hero');
    expect(parsed.typography.present).toBe(true);
  });

  it('accepts an empty cast and no typography', () => {
    const parsed = styleVisionAnswerSchema.parse({
      ...answer,
      characters: [],
      typography: { present: false },
    });
    expect(parsed.characters).toEqual([]);
    expect(parsed.typography.style).toBeUndefined();
  });

  it('accepts the honest unknown enum values', () => {
    const parsed = styleVisionAnswerSchema.parse({
      ...answer,
      medium: 'unknown',
      line: { weight: 'unknown', texture: 'unknown' },
      shading: 'unknown',
    });
    expect(parsed.shading).toBe('unknown');
  });

  it('strips a volunteered palette instead of failing the answer', () => {
    const parsed = styleVisionAnswerSchema.parse({
      ...answer,
      palette: { hex: ['#141414'], weights: [1] },
    });
    expect(parsed).not.toHaveProperty('palette');
  });

  it('strips a volunteered line colour, which belongs to the merge step', () => {
    const parsed = styleVisionAnswerSchema.parse({
      ...answer,
      line: { ...answer.line, color: '#141414' },
    });
    expect(parsed.line).toEqual({ weight: 'thick', texture: 'clean' });
  });

  it('rejects an unknown shading enum', () => {
    expect(() => styleVisionAnswerSchema.parse({ ...answer, shading: 'anime' })).toThrow();
  });

  it('rejects an unknown line weight', () => {
    expect(() =>
      styleVisionAnswerSchema.parse({ ...answer, line: { weight: 'bold', texture: 'clean' } }),
    ).toThrow();
  });

  it('rejects a character id that is not kebab-case', () => {
    expect(() =>
      styleVisionAnswerSchema.parse({ ...answer, characters: [{ id: 'Hero One', description: 'x' }] }),
    ).toThrow();
  });

  it('rejects duplicate character ids', () => {
    expect(() =>
      styleVisionAnswerSchema.parse({
        ...answer,
        characters: [
          { id: 'hero', description: 'a' },
          { id: 'hero', description: 'b' },
        ],
      }),
    ).toThrow(/duplicate character id/);
  });

  it(`rejects more than ${MAX_STYLE_CHARACTERS} characters`, () => {
    const characters = Array.from({ length: MAX_STYLE_CHARACTERS + 1 }, (_, index) => ({
      id: `support-${index}`,
      description: 'x',
    }));
    expect(() => styleVisionAnswerSchema.parse({ ...answer, characters })).toThrow();
  });

  it('requires a style when typography is present', () => {
    expect(() =>
      styleVisionAnswerSchema.parse({ ...answer, typography: { present: true } }),
    ).toThrow(/typography.style is required/);
  });

  it('rejects a style when typography is absent', () => {
    expect(() =>
      styleVisionAnswerSchema.parse({
        ...answer,
        typography: { present: false, style: 'bold sans' },
      }),
    ).toThrow(/must be omitted/);
  });

  it('rejects a missing negative and an empty medium', () => {
    expect(() => styleVisionAnswerSchema.parse({ ...answer, negative: '' })).toThrow();
    expect(() => styleVisionAnswerSchema.parse({ ...answer, medium: '' })).toThrow();
  });
});

describe('style vision with provenance', () => {
  it('requires an adapter and a degradation list', () => {
    const parsed = styleVisionSchema.parse({ ...answer, adapter: 'cloudflare', degradedFrom: [] });
    expect(parsed.adapter).toBe('cloudflare');
    expect(parsed.degradedFrom).toEqual([]);
  });

  it('accepts a degraded answer and records the order tried', () => {
    const parsed = styleVisionSchema.parse({
      ...answer,
      adapter: 'heuristic',
      degradedFrom: ['cloudflare', 'gemini'],
    });
    expect(parsed.degradedFrom).toEqual(['cloudflare', 'gemini']);
  });

  it('rejects an adapter that is not in the enum', () => {
    expect(() =>
      styleVisionSchema.parse({ ...answer, adapter: 'openai', degradedFrom: [] }),
    ).toThrow();
  });
});
