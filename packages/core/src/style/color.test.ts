import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HISTOGRAM_BINS,
  DEFAULT_MAX_PALETTE_DELTA_E,
  correctTowardPalette,
  deltaE76,
  histogramDistance,
  labToRgb,
  meanLab,
  paletteLab,
  rgbHistogram,
  rgbToLab,
} from './color';

function rgbBuffer(colour: readonly [number, number, number], pixels = 4): Uint8Array {
  const buffer = new Uint8Array(pixels * 3);
  for (let index = 0; index < pixels; index += 1) {
    buffer[index * 3] = colour[0];
    buffer[index * 3 + 1] = colour[1];
    buffer[index * 3 + 2] = colour[2];
  }
  return buffer;
}

function nearestPaletteDeltaE(
  colour: { r: number; g: number; b: number },
  hexes: readonly string[],
): number {
  const lab = rgbToLab(colour.r, colour.g, colour.b);
  return Math.min(
    ...hexes.map((hex) => {
      const value = Number.parseInt(hex.slice(1), 16);
      return deltaE76(lab, rgbToLab((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff));
    }),
  );
}

describe('rgbToLab / labToRgb', () => {
  it('maps the sRGB extremes to the expected D65 CIELAB values', () => {
    expect(rgbToLab(0, 0, 0)).toEqual({ l: 0, a: 0, b: 0 });

    const white = rgbToLab(255, 255, 255);
    expect(white.l).toBeCloseTo(100, 5);
    expect(white.a).toBeCloseTo(0, 4);
    expect(white.b).toBeCloseTo(0, 4);

    const red = rgbToLab(255, 0, 0);
    expect(red.l).toBeCloseTo(53.2408, 2);
    expect(red.a).toBeCloseTo(80.0925, 2);
    expect(red.b).toBeCloseTo(67.2032, 2);
  });

  it('round-trips palette colours within one 8-bit step', () => {
    for (const hex of ['#14213d', '#fca311', '#ffffff', '#000000', '#e4572e', '#1b2a41']) {
      const value = Number.parseInt(hex.slice(1), 16);
      const original = { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
      const back = labToRgb(rgbToLab(original.r, original.g, original.b));
      expect(Math.abs(back.r - original.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - original.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - original.b)).toBeLessThanOrEqual(1);
    }
  });

  it('clamps out-of-gamut LAB input instead of returning NaN', () => {
    const back = labToRgb({ l: 150, a: 250, b: -250 });
    for (const channel of [back.r, back.g, back.b]) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});

describe('deltaE76 / paletteLab / meanLab', () => {
  it('is zero for a colour and symmetric between two colours', () => {
    const navy = rgbToLab(20, 33, 61);
    const orange = rgbToLab(252, 163, 17);
    expect(deltaE76(navy, navy)).toBe(0);
    expect(deltaE76(navy, orange)).toBeCloseTo(deltaE76(orange, navy), 12);
    expect(deltaE76(navy, orange)).toBeGreaterThan(50);
  });

  it('averages palette colours with their weights', () => {
    expect(paletteLab(['#000000', '#ffffff'], [0.5, 0.5]).l).toBeCloseTo(50, 1);
    expect(paletteLab(['#ffffff'], [1])).toEqual(rgbToLab(255, 255, 255));
    expect(paletteLab(['#000000', '#ffffff'], [3, 1]).l).toBeCloseTo(25, 1);
  });

  it('normalises unnormalised weights and rejects malformed palettes', () => {
    expect(paletteLab(['#000000', '#ffffff'], [1, 1]).l).toBeCloseTo(50, 1);
    expect(() => paletteLab([], [])).toThrow(/at least one colour/i);
    expect(() => paletteLab(['#000000'], [0.5, 0.5])).toThrow(/same length/i);
    expect(() => paletteLab(['#000000'], [0])).toThrow(/weight/i);
    expect(() => paletteLab(['#000000'], [Number.NaN])).toThrow(/weight/i);
  });

  it('reads the mean of a uniform RGB24 buffer', () => {
    const mean = meanLab(rgbBuffer([20, 33, 61]));
    expect(mean.l).toBeCloseTo(rgbToLab(20, 33, 61).l, 4);
    expect(mean.a).toBeCloseTo(rgbToLab(20, 33, 61).a, 4);
    expect(mean.b).toBeCloseTo(rgbToLab(20, 33, 61).b, 4);
  });

  it('rejects buffers that are not RGB24', () => {
    expect(() => meanLab(new Uint8Array())).toThrow(/non-empty RGB24/i);
    expect(() => meanLab(new Uint8Array(4))).toThrow(/multiple of 3/i);
  });
});

describe('correctTowardPalette', () => {
  it('moves a flat image toward the target by at most the ΔE cap', () => {
    const source = rgbBuffer([128, 128, 128], 8);
    const target = paletteLab(['#14213d', '#fca311'], [0.6, 0.4]);
    const { pixels, deltaE } = correctTowardPalette(source, target);

    expect(deltaE).toBeCloseTo(DEFAULT_MAX_PALETTE_DELTA_E, 6);
    expect(pixels).not.toBe(source);
    expect(source[0]).toBe(128);

    const corrected = { r: pixels[0]!, g: pixels[1]!, b: pixels[2]! };
    const before = rgbToLab(128, 128, 128);
    const after = rgbToLab(corrected.r, corrected.g, corrected.b);
    expect(deltaE76(before, after)).toBeLessThanOrEqual(DEFAULT_MAX_PALETTE_DELTA_E + 0.75);
    expect(after.a).toBeGreaterThan(before.a);
  });

  it('applies the requested cap and never leaves a larger shift', () => {
    const source = rgbBuffer([90, 110, 130], 4);
    const target = rgbToLab(250, 40, 40);
    const { pixels, deltaE } = correctTowardPalette(source, target, 3);

    expect(deltaE).toBeCloseTo(3, 6);
    const before = rgbToLab(90, 110, 130);
    const after = rgbToLab(pixels[0]!, pixels[1]!, pixels[2]!);
    expect(deltaE76(before, after)).toBeLessThanOrEqual(3.75);
  });

  it('is a no-op when the image already matches the target or the cap is zero', () => {
    const source = rgbBuffer([20, 33, 61], 4);
    const exact = correctTowardPalette(source, rgbToLab(20, 33, 61));
    expect(exact.deltaE).toBe(0);
    expect(Array.from(exact.pixels)).toEqual(Array.from(source));

    const zero = correctTowardPalette(source, rgbToLab(255, 255, 255), 0);
    expect(zero.deltaE).toBe(0);
    expect(Array.from(zero.pixels)).toEqual(Array.from(source));
  });

  it('validates the buffer and the cap', () => {
    expect(() => correctTowardPalette(new Uint8Array(3), rgbToLab(1, 2, 3), -1)).toThrow(
      /maxDeltaE/i,
    );
    expect(() => correctTowardPalette(new Uint8Array(3), rgbToLab(1, 2, 3), Number.NaN)).toThrow(
      /maxDeltaE/i,
    );
    expect(() => correctTowardPalette(new Uint8Array(4), rgbToLab(1, 2, 3))).toThrow(
      /multiple of 3/i,
    );
  });

  it('reduces the distance from the dominant colour to the palette', () => {
    const palette = ['#14213d', '#fca311', '#ffffff'];
    const source = rgbBuffer([190, 70, 90], 16);
    const before = nearestPaletteDeltaE({ r: 190, g: 70, b: 90 }, palette);
    const { pixels } = correctTowardPalette(source, paletteLab(palette, [0.5, 0.3, 0.2]), 6);
    const after = nearestPaletteDeltaE(
      { r: pixels[0]!, g: pixels[1]!, b: pixels[2]! },
      palette,
    );
    expect(after).toBeLessThan(before);
  });
});

describe('rgbHistogram / histogramDistance', () => {
  it('normalises counts into default 4x4x4 bins', () => {
    expect(rgbHistogram(rgbBuffer([0, 0, 0], 2))).toHaveLength(
      DEFAULT_HISTOGRAM_BINS ** 3,
    );
    const black = rgbHistogram(rgbBuffer([0, 0, 0], 2));
    expect(black[0]).toBe(1);
    expect(black.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);

    // 128 sits exactly between the centres of bins 1 and 2, so soft
    // assignment spreads it over the 2x2x2 corners at 1/8 each.
    const grey = rgbHistogram(rgbBuffer([128, 128, 128], 2));
    for (const r of [1, 2]) {
      for (const g of [1, 2]) {
        for (const b of [1, 2]) {
          expect(grey[r * 16 + g * 4 + b]).toBeCloseTo(0.125, 12);
        }
      }
    }
    expect(grey.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });

  it('barely moves when a channel crosses a bin edge by one byte', () => {
    const below = rgbHistogram(rgbBuffer([127, 127, 127], 2));
    const above = rgbHistogram(rgbBuffer([128, 128, 128], 2));
    const distance = histogramDistance(below, above);

    // Hard bins would report 1 here; a byte must not mean a different palette.
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(0.05);
  });

  it('keeps two-tone shares and honours the bin count', () => {
    const pixels = new Uint8Array([0, 0, 0, 255, 255, 255]);
    const histogram = rgbHistogram(pixels, 2);
    expect(histogram).toHaveLength(8);
    expect(histogram[0]).toBeCloseTo(0.5, 12);
    expect(histogram[7]).toBeCloseTo(0.5, 12);
  });

  it('is 0 for identical scenes and 1 for disjoint extremes', () => {
    const black = rgbHistogram(rgbBuffer([0, 0, 0], 2));
    const white = rgbHistogram(rgbBuffer([255, 255, 255], 2));
    expect(histogramDistance(black, black)).toBe(0);
    expect(histogramDistance(black, white)).toBe(1);
    expect(histogramDistance(black, white)).toBeCloseTo(histogramDistance(white, black), 12);
  });

  it('rejects empty, mismatched and invalid inputs', () => {
    expect(() => rgbHistogram(new Uint8Array())).toThrow(/non-empty RGB24/i);
    expect(() => rgbHistogram(rgbBuffer([0, 0, 0]), 0)).toThrow(/bins/i);
    expect(() => rgbHistogram(rgbBuffer([0, 0, 0]), 1.5)).toThrow(/bins/i);
    expect(() => histogramDistance([], [])).toThrow(/non-empty/i);
    expect(() => histogramDistance([1], [1, 0])).toThrow(/same length/i);
  });
});
