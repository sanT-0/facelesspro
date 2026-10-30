import { describe, expect, it } from 'vitest';

import { lineColorFor, seedBaseFor } from './profile';
import type { StyleSeedInput } from './profile';

const seedInput = (overrides: Partial<StyleSeedInput> = {}): StyleSeedInput => ({
  medium: 'unknown',
  promptPrefix: 'landscape frame, thin outlines, medium-saturation palette, flat colour areas',
  palette: { hex: ['#f2c14e', '#1b2a41', '#e4572e', '#020202'] },
  line: { weight: 'thin', color: '#020202', texture: 'unknown' },
  shading: 'flat',
  background: 'clean, simple background with empty edges',
  composition: 'landscape 1.78:1 frame, low edge content',
  characters: [],
  typography: { present: false },
  negative: 'photo, 3d render, text, watermark',
  ...overrides,
});

describe('lineColorFor', () => {
  it('picks the lowest-luma colour regardless of weight order', () => {
    expect(lineColorFor({ hex: ['#ffffff', '#f2c14e', '#1b2a41'] })).toBe('#1b2a41');
  });

  it('keeps the earlier entry on a luma tie', () => {
    expect(lineColorFor({ hex: ['#111111', '#111111'] })).toBe('#111111');
  });

  it('normalises uppercase input', () => {
    expect(lineColorFor({ hex: ['#FFFFFF', '#1B2A41'] })).toBe('#1b2a41');
  });

  it('rejects an empty palette and a malformed hex', () => {
    expect(() => lineColorFor({ hex: [] })).toThrow(/at least one palette colour/);
    expect(() => lineColorFor({ hex: ['navy'] })).toThrow(/#rrggbb/);
  });
});

describe('seedBaseFor', () => {
  it('is deterministic, positive and inside the contract range', () => {
    const first = seedBaseFor(seedInput());
    const second = seedBaseFor(seedInput());

    expect(second).toBe(first);
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(2_147_483_647);
  });

  it('changes when a prompt-relevant field changes', () => {
    expect(seedBaseFor(seedInput({ promptPrefix: 'different prefix' }))).not.toBe(
      seedBaseFor(seedInput()),
    );
    expect(seedBaseFor(seedInput({ palette: { hex: ['#010101'] } }))).not.toBe(
      seedBaseFor(seedInput()),
    );
  });

  it('ignores palette weights and order, so float drift cannot change a seed', () => {
    const reordered = { hex: [...seedInput().palette.hex].reverse() };
    expect(seedBaseFor(seedInput({ palette: reordered }))).toBe(seedBaseFor(seedInput()));
  });

  it('depends on the character bible and typography', () => {
    const withCast = seedBaseFor(
      seedInput({ characters: [{ id: 'hero', description: 'young man, red hoodie' }] }),
    );
    expect(withCast).not.toBe(seedBaseFor(seedInput()));

    const withType = seedBaseFor(
      seedInput({ typography: { present: true, style: 'bold sans' } }),
    );
    expect(withType).not.toBe(seedBaseFor(seedInput()));
  });
});
