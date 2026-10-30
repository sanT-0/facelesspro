/**
 * Palette extraction for art-style cloning — docs/04 §4 "k-means palette".
 *
 * Input is raw RGB24 bytes (`width * height * 3`), the same format ffmpeg
 * writes with `-pix_fmt rgb24`. Pure: no I/O, no clock, no random numbers, so
 * the same frames always produce the same hex list — which the golden path
 * needs, and which a seeded RNG would also give but only with a seed to manage.
 *
 * Determinism comes from the initialisation: farthest-point (maximin) seeding
 * instead of k-means++, so there is nothing to seed and nothing to inject.
 *
 * Contract note: the output must satisfy `stylePaletteSchema` in
 * `packages/contracts` — 1..8 colours, weights summing to 1 within 0.01.
 */

/** Mirrors the contract's 8-colour ceiling; the pipeline asks for 5. */
export const MAX_PALETTE_COLORS = 8;
export const DEFAULT_PALETTE_COLORS = 5;

export interface PaletteOptions {
  /** Target cluster count. Clamped to the number of distinct colours. */
  colors?: number;
  /** Lloyd iterations before we accept the result. */
  maxIterations?: number;
  /** Pixel stride: 1 reads every pixel, 2 every other one, … */
  stride?: number;
  /**
   * Clusters closer than this (RGB euclidean distance) are merged, so a flat
   * frame reports one colour instead of five near-identical greys.
   */
  mergeDistance?: number;
}

/** Ordered by weight, descending. `hex` is `#rrggbb`, lowercase. */
export interface StylePalette {
  hex: string[];
  weights: number[];
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rrggbb` for a channel triple; out-of-range channels are clamped. */
export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Inverse of `rgbToHex`. Accepts `#rgb`-less input only with the hash. */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) throw new TypeError(`hexToRgb expects #rrggbb, got ${hex}`);
  const value = Number.parseInt(match[1]!, 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

function distanceSquared(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function readSamples(pixels: Uint8Array, stride: number): Rgb[] {
  const pixelCount = Math.floor(pixels.length / 3);
  const samples: Rgb[] = [];
  for (let index = 0; index < pixelCount; index += stride) {
    const offset = index * 3;
    samples.push({ r: pixels[offset]!, g: pixels[offset + 1]!, b: pixels[offset + 2]! });
  }
  return samples;
}

/**
 * Dominant colours with their pixel share.
 *
 * @throws TypeError when `pixels` is not a non-empty RGB24 buffer.
 */
export function kmeansPalette(
  pixels: Uint8Array,
  options: PaletteOptions = {},
): StylePalette {
  if (!(pixels instanceof Uint8Array) || pixels.length < 3) {
    throw new TypeError('kmeansPalette expects a non-empty RGB24 Uint8Array');
  }
  const requestedColors = options.colors ?? DEFAULT_PALETTE_COLORS;
  if (!Number.isInteger(requestedColors) || requestedColors < 1) {
    throw new TypeError(`colors must be a positive integer, got ${String(requestedColors)}`);
  }
  const maxIterations = options.maxIterations ?? 20;
  const stride = options.stride ?? 1;
  if (!Number.isInteger(stride) || stride < 1) {
    throw new TypeError(`stride must be a positive integer, got ${String(stride)}`);
  }

  const samples = readSamples(pixels, stride);
  if (samples.length === 0) throw new TypeError('kmeansPalette found no samples');

  const distinct = new Set<number>();
  for (const sample of samples) {
    distinct.add((sample.r << 16) | (sample.g << 8) | sample.b);
  }
  const colors = Math.min(requestedColors, distinct.size, MAX_PALETTE_COLORS);

  let centers = seedCenters(samples, colors);
  const assignments = new Int32Array(samples.length).fill(-1);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let center = 0; center < centers.length; center += 1) {
        const distance = distanceSquared(sample, centers[center]!);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = center;
        }
      }
      if (assignments[index] !== best) {
        assignments[index] = best;
        changed = true;
      }
    }
    if (!changed && iteration > 0) break;

    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      const bucket = sums[assignments[index]!]!;
      bucket.r += sample.r;
      bucket.g += sample.g;
      bucket.b += sample.b;
      bucket.count += 1;
    }
    centers = centers
      .map((center, index) => {
        const bucket = sums[index]!;
        if (bucket.count === 0) return center;
        return {
          r: bucket.r / bucket.count,
          g: bucket.g / bucket.count,
          b: bucket.b / bucket.count,
        };
      })
      .filter((_, index) => sums[index]!.count > 0);
    if (centers.length === 0) break;
  }

  const counts = new Array<number>(centers.length).fill(0);
  for (let index = 0; index < samples.length; index += 1) {
    const assignment = assignments[index]!;
    if (assignment >= 0 && assignment < counts.length) counts[assignment] = (counts[assignment] ?? 0) + 1;
  }

  const clusters = centers
    .map((center, index) => ({ color: center, count: counts[index]! }))
    .filter((cluster) => cluster.count > 0)
    .sort((a, b) => b.count - a.count || a.color.r - b.color.r);

  const mergeDistance = options.mergeDistance ?? 12;
  const merged: Array<{ color: Rgb; count: number }> = [];
  for (const cluster of clusters) {
    const target = merged.find(
      (candidate) => distanceSquared(candidate.color, cluster.color) <= mergeDistance ** 2,
    );
    if (!target) {
      merged.push({ color: { ...cluster.color }, count: cluster.count });
      continue;
    }
    const total = target.count + cluster.count;
    target.color = {
      r: (target.color.r * target.count + cluster.color.r * cluster.count) / total,
      g: (target.color.g * target.count + cluster.color.g * cluster.count) / total,
      b: (target.color.b * target.count + cluster.color.b * cluster.count) / total,
    };
    target.count = total;
  }

  merged.sort((a, b) => {
    const byCount = b.count - a.count;
    if (byCount !== 0) return byCount;
    return rgbToHex(a.color) < rgbToHex(b.color) ? -1 : 1;
  });

  const totalSamples = merged.reduce((sum, cluster) => sum + cluster.count, 0);
  const weights = merged.map((cluster) => round(cluster.count / totalSamples, 4));
  // Float rounding can drift by up to 4e-4 per entry; the contract allows 0.01,
  // but putting the whole residual on the dominant colour keeps the sum exact.
  if (weights.length > 0) {
    const residual = 1 - weights.reduce((sum, weight) => sum + weight, 0);
    weights[0] = round(weights[0]! + residual, 4);
  }

  return { hex: merged.map((cluster) => rgbToHex(cluster.color)), weights };
}

/**
 * Farthest-point seeding: the sample furthest from the mean, then each further
 * sample furthest from everything chosen so far. Deterministic by construction.
 */
function seedCenters(samples: readonly Rgb[], colors: number): Rgb[] {
  if (colors <= 1) return [{ ...samples[0]! }];

  let mean = { r: 0, g: 0, b: 0 };
  for (const sample of samples) {
    mean = { r: mean.r + sample.r, g: mean.g + sample.g, b: mean.b + sample.b };
  }
  mean = {
    r: mean.r / samples.length,
    g: mean.g / samples.length,
    b: mean.b / samples.length,
  };

  const centers: Rgb[] = [];
  let firstIndex = 0;
  let firstDistance = -1;
  for (let index = 0; index < samples.length; index += 1) {
    const distance = distanceSquared(samples[index]!, mean);
    if (distance > firstDistance) {
      firstDistance = distance;
      firstIndex = index;
    }
  }
  centers.push({ ...samples[firstIndex]! });

  const nearest = samples.map((sample) => distanceSquared(sample, centers[0]!));
  while (centers.length < colors) {
    let bestIndex = 0;
    let bestDistance = -1;
    for (let index = 0; index < samples.length; index += 1) {
      if (nearest[index]! > bestDistance) {
        bestDistance = nearest[index]!;
        bestIndex = index;
      }
    }
    if (bestDistance <= 0) break;
    const next = { ...samples[bestIndex]! };
    centers.push(next);
    for (let index = 0; index < samples.length; index += 1) {
      const distance = distanceSquared(samples[index]!, next);
      if (distance < nearest[index]!) nearest[index] = distance;
    }
  }
  return centers;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
