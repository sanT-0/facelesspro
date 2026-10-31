import { describe, expect, it } from 'vitest';

import {
  brightnessStats,
  contrastStats,
  lineStats,
  percentile,
  safeAreaStats,
  saturationStats,
} from './stats';

type Rgb = [number, number, number];

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

/** 2 px black / 2 px white vertical stripes: the cheapest "ink drawing". */
function stripes(width: number, height: number): Uint8Array {
  return image(width, height, (x) => (Math.floor(x / 2) % 2 === 0 ? [0, 0, 0] : [255, 255, 255]));
}

describe('percentile', () => {
  it('interpolates and handles the edges', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 6);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe('lineStats', () => {
  it('reports zero ink and zero energy on a flat frame', () => {
    const pixels = image(16, 16, () => [128, 128, 128]);
    const stats = lineStats(pixels, 16, 16);

    expect(stats.edgeEnergy).toBe(0);
    expect(stats.strokeDensity).toBe(0);
  });

  it('reports high energy and ink density on high-contrast stripes', () => {
    const pixels = stripes(32, 32);
    const stats = lineStats(pixels, 32, 32);

    expect(stats.edgeEnergy).toBeGreaterThan(0.2);
    expect(stats.strokeDensity).toBeGreaterThan(0.05);
    expect(stats.edgeEnergy).toBeLessThanOrEqual(1);
    expect(stats.strokeDensity).toBeLessThanOrEqual(1);
  });

  it('does not count a dark block as ink unless it has an edge', () => {
    // A black square with a perfectly flat interior: only its border edges are
    // dark-and-edgy, so the interior must not inflate strokeDensity.
    const pixels = image(32, 32, (x, y) =>
      x > 8 && x < 24 && y > 8 && y < 24 ? [0, 0, 0] : [255, 255, 255],
    );
    const withBlock = lineStats(pixels, 32, 32).strokeDensity;
    const solid = lineStats(image(32, 32, () => [0, 0, 0]), 32, 32).strokeDensity;

    expect(solid).toBe(0);
    expect(withBlock).toBeGreaterThan(0);
    expect(withBlock).toBeLessThan(0.25);
  });
});

describe('tone stats', () => {
  it('reports zero saturation for grey and full saturation for red', () => {
    expect(saturationStats(image(8, 8, () => [128, 128, 128]), 8, 8)).toEqual({
      mean: 0,
      p95: 0,
    });
    const red = saturationStats(image(8, 8, () => [255, 0, 0]), 8, 8);
    expect(red.mean).toBe(1);
    expect(red.p95).toBe(1);
  });

  it('reports brightness 0 for black and 1 for white', () => {
    expect(brightnessStats(image(8, 8, () => [0, 0, 0]), 8, 8).mean).toBe(0);
    expect(brightnessStats(image(8, 8, () => [255, 255, 255]), 8, 8).mean).toBeCloseTo(1, 6);
  });

  it('reports zero contrast on a flat frame and high contrast on stripes', () => {
    expect(contrastStats(image(16, 16, () => [90, 90, 90]), 16, 16).mean).toBe(0);
    expect(contrastStats(stripes(32, 32), 32, 32).mean).toBeGreaterThan(0.4);
  });
});

describe('safeAreaStats', () => {
  it('reports a clean border when the subject sits inside the frame', () => {
    const pixels = image(16, 16, (x, y) =>
      x >= 2 && x < 14 && y >= 2 && y < 14 ? [0, 0, 0] : [255, 255, 255],
    );
    const stats = safeAreaStats(pixels, 16, 16, 0.125);

    expect(stats.edgeContentRatio).toBe(0);
    expect(stats.margin).toBe(0.125);
  });

  it('reports high edge content when the subject bleeds off the frame', () => {
    // Left half black, right half white: half the border band is content.
    const pixels = image(32, 32, (x) => (x < 16 ? [0, 0, 0] : [255, 255, 255]));
    const stats = safeAreaStats(pixels, 32, 32, 0.1);

    expect(stats.edgeContentRatio).toBeGreaterThan(0.3);
  });

  it('rejects an out-of-range margin and a mis-sized buffer', () => {
    const pixels = image(8, 8, () => [0, 0, 0]);
    expect(() => safeAreaStats(pixels, 8, 8, 0)).toThrow(/margin/);
    expect(() => safeAreaStats(pixels, 8, 8, 0.6)).toThrow(/margin/);
    expect(() => safeAreaStats(new Uint8Array(4), 8, 8)).toThrow(/expected 192 bytes/);
  });
});
