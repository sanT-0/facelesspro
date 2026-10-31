import { describe, expect, it } from 'vitest';

import {
  STYLE_LINE_TEXTURES,
  STYLE_LINE_WEIGHTS,
  STYLE_SHADING,
} from '@facelesspro/contracts';

import { buildVisionPrompt } from './prompt';

describe('buildVisionPrompt', () => {
  it('names the frame count and demands one JSON object', () => {
    const prompt = buildVisionPrompt({ frameCount: 6 });
    expect(prompt).toContain('6 sampled frames');
    expect(prompt).toContain('one JSON object');
    expect(prompt).toContain('no code fences');
  });

  it('lists every answer key the schema requires', () => {
    const prompt = buildVisionPrompt({ frameCount: 1 });
    for (const key of [
      'medium',
      'promptPrefix',
      'line',
      'shading',
      'background',
      'composition',
      'characters',
      'typography',
      'negative',
    ]) {
      expect(prompt).toContain(`"${key}"`);
    }
  });

  it('spells out every enum value the parser accepts', () => {
    const prompt = buildVisionPrompt({ frameCount: 3 });
    for (const value of [
      ...STYLE_LINE_WEIGHTS,
      ...STYLE_LINE_TEXTURES,
      ...STYLE_SHADING,
    ]) {
      expect(prompt).toContain(value);
    }
  });

  it('forbids palette, timings and invented characters', () => {
    const prompt = buildVisionPrompt({ frameCount: 2 });
    expect(prompt).toContain('Do not output a palette');
    expect(prompt).toContain('Do not mention timings');
    expect(prompt).toContain('Do not invent characters');
  });

  it('is deterministic', () => {
    expect(buildVisionPrompt({ frameCount: 4 })).toBe(buildVisionPrompt({ frameCount: 4 }));
  });

  it('rejects a frame count below one', () => {
    expect(() => buildVisionPrompt({ frameCount: 0 })).toThrow(/positive integer/);
    expect(() => buildVisionPrompt({ frameCount: 1.5 })).toThrow(/positive integer/);
  });
});
