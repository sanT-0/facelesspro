import { describe, expect, it } from 'vitest';

import {
  MAX_PALETTE_COLORS,
  hexToRgb,
  kmeansPalette,
  rgbToHex,
} from './palette';

type Rgb = [number, number, number];

/** Build an RGB24 buffer from a per-pixel colour function. */
function image(width: number, height: number, pixelAt: (x: number, y: number) => Rgb): Uint8Array {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const offset = (y * width + x) * 3;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
    }
  }
  return pixels;
}

/** First `share` of the pixels get `first`, the rest get `second`. */
function twoTone(width: number, height: number, share: number, first: Rgb, second: Rgb): Uint8Array {
  const total = width * height;
  const split = Math.round(total * share);
  return image(width, height, (_x, y) => {
    const index = y * width + _x;
    return index < split ? first : second;
  });
}

describe('rgbToHex / hexToRgb', () => {
  it('round-trips and clamps out-of-range channels', () => {
    expect(rgbToHex({ r: 27, g: 42, b: 65 })).toBe('#1b2a41');
    expect(hexToRgb('#1b2a41')).toEqual({ r: 27, g: 42, b: 65 });
    expect(rgbToHex({ r: 300, g: -5, b: 12.6 })).toBe('#ff000d');
  });

  it('rejects a hex colour without the leading #', () => {
    expect(() => hexToRgb('1b2a41')).toThrow(/#rrggbb/);
  });
});

describe('kmeansPalette', () => {
  it('recovers two dominant colours with their pixel shares', () => {
    const pixels = twoTone(40, 10, 0.75, [27, 42, 65], [242, 193, 78]);
    const palette = kmeansPalette(pixels, { colors: 5 });

    expect(palette.hex).toEqual(['#1b2a41', '#f2c14e']);
    expect(palette.weights[0]).toBeCloseTo(0.75, 3);
    expect(palette.weights[1]).toBeCloseTo(0.25, 3);
  });

  it('returns one colour and weight 1 for a flat frame', () => {
    const pixels = image(8, 8, () => [19, 19, 19]);
    const palette = kmeansPalette(pixels, { colors: 5 });

    expect(palette.hex).toEqual(['#131313']);
    expect(palette.weights).toEqual([1]);
  });

  it('merges near-identical clusters instead of reporting five greys', () => {
    const pixels = twoTone(20, 10, 0.5, [16, 16, 16], [22, 22, 22]);
    const palette = kmeansPalette(pixels, { colors: 5, mergeDistance: 12 });

    expect(palette.hex).toHaveLength(1);
    expect(palette.weights).toEqual([1]);
  });

  it('is deterministic across runs', () => {
    const pixels = image(24, 24, (x, y) => [(x * 11) % 256, (y * 7) % 256, (x * y) % 256]);
    const first = kmeansPalette(pixels, { colors: 4 });
    const second = kmeansPalette(pixels, { colors: 4 });

    expect(second).toEqual(first);
  });

  it('clamps the requested colour count to the distinct colours', () => {
    const pixels = image(12, 12, (x) => (x < 6 ? [255, 0, 0] : [0, 0, 255]));
    const palette = kmeansPalette(pixels, { colors: 5 });

    expect(palette.hex).toHaveLength(2);
    expect(palette.weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
  });

  it('never exceeds the eight-colour contract ceiling', () => {
    const pixels = image(32, 32, (x, y) => [
      (x * 8) % 256,
      (y * 8) % 256,
      ((x + y) * 4) % 256,
    ]);
    const palette = kmeansPalette(pixels, { colors: 20 });

    expect(palette.hex.length).toBeLessThanOrEqual(MAX_PALETTE_COLORS);
    expect(palette.weights.length).toBe(palette.hex.length);
  });

  it('samples with a stride without changing a two-colour result', () => {
    const pixels = twoTone(40, 10, 0.5, [0, 0, 0], [255, 255, 255]);
    const palette = kmeansPalette(pixels, { colors: 3, stride: 2 });

    expect(palette.hex).toEqual(['#000000', '#ffffff']);
    expect(palette.weights[0]).toBeCloseTo(0.5, 2);
  });

  it('rejects an empty buffer and a bad colour count', () => {
    expect(() => kmeansPalette(new Uint8Array(0))).toThrow(/non-empty RGB24/);
    expect(() => kmeansPalette(new Uint8Array(3), { colors: 0 })).toThrow(/positive integer/);
  });
});
