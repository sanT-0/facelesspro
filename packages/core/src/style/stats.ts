/**
 * Pixel statistics for the numeric pass — docs/04 §4.
 *
 * Every function takes raw RGB24 bytes (`width * height * 3`) and a fixed
 * `width`/`height`, returns 0..1 numbers, and does no I/O. That keeps the file
 * pure and lets the worker feed it whatever ffmpeg decoded.
 *
 * Definitions are contract, not taste — the vision pass and the prompt builder
 * both read these names, so they are written down in docs/04 §4:
 *
 * - `edgeEnergy` — mean Sobel gradient magnitude of luma, normalised by the
 *   maximum a single step can produce (`4 * 255 * sqrt(2)`). A flat frame is 0.
 * - `strokeDensity` — share of pixels that are **both** dark (`luma < 60`) and
 *   on a strong edge (`gradient >= 0.15` of that maximum). That is ink lines,
 *   not shadows: a big black shadow scores 0, a black outline scores high.
 * - `saturation` — HSV saturation `(max - min) / max`, 0 for black/white/grey.
 * - `contrast` — local luma range of the 3×3 neighbourhood, over 255. Measures
 *   "does this frame have darks and lights next to each other", which global
 *   standard deviation gets wrong on two-tone art.
 * - `brightness` — luma over 255.
 * - `edgeContentRatio` — share of pixels in the outer band that differ from the
 *   band's median colour by more than 32 in RGB. A clean border scores near 0;
 *   a subject bleeding off the frame scores high. It is a proxy for safe-area
 *   behaviour, not a composition detector.
 */

/** Luma ceiling for a pixel to count as "ink" (Rec. 709 weights). */
export const DARK_LUMA_MAX = 60;
/** Gradient magnitude (0..1) at which a pixel counts as an edge. */
export const STROKE_EDGE_MIN = 0.15;
/** RGB euclidean distance from the border colour that counts as content. */
export const SAFE_AREA_CONTENT_DISTANCE = 32;
/** Band thickness as a fraction of the short edge. */
export const DEFAULT_SAFE_AREA_MARGIN = 0.08;

/** Normalising constant: the largest Sobel magnitude a 0/255 step can give. */
const SOBEL_MAX = 4 * 255 * Math.SQRT2;

export interface LineStats {
  strokeDensity: number;
  edgeEnergy: number;
}

export interface StatSummary {
  mean: number;
  p95: number;
}

export interface SafeAreaStats {
  edgeContentRatio: number;
  margin: number;
}

/** Rec. 709 luma, 0..255. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Linear-interpolated percentile. `p` is 0..1. Empty input returns 0 so a
 * caller can aggregate without a special case.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const fraction = position - lower;
  return sorted[lower]! * (1 - fraction) + sorted[upper]! * fraction;
}

function assertRgb(pixels: Uint8Array, width: number, height: number): void {
  if (!(pixels instanceof Uint8Array)) {
    throw new TypeError('expected an RGB24 Uint8Array');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new TypeError(`width and height must be positive integers, got ${width}x${height}`);
  }
  if (pixels.length !== width * height * 3) {
    throw new TypeError(
      `expected ${width * height * 3} bytes for ${width}x${height} RGB24, got ${pixels.length}`,
    );
  }
}

/** Sobel gradient magnitude per pixel, normalised to 0..1 (borders are 0). */
function gradients(pixels: Uint8Array, width: number, height: number): Float64Array {
  const magnitudes = new Float64Array(width * height);
  const at = (x: number, y: number): number => {
    const offset = (y * width + x) * 3;
    return luma(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
  };
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      magnitudes[y * width + x] = Math.min(1, Math.hypot(gx, gy) / SOBEL_MAX);
    }
  }
  return magnitudes;
}

/** Mean edge energy and dark-edge share for one frame. */
export function lineStats(pixels: Uint8Array, width: number, height: number): LineStats {
  assertRgb(pixels, width, height);
  const magnitudes = gradients(pixels, width, height);
  const total = width * height;
  let energySum = 0;
  let inkCount = 0;
  for (let index = 0; index < total; index += 1) {
    const magnitude = magnitudes[index]!;
    energySum += magnitude;
    if (magnitude < STROKE_EDGE_MIN) continue;
    const offset = index * 3;
    if (luma(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) < DARK_LUMA_MAX) {
      inkCount += 1;
    }
  }
  return { strokeDensity: inkCount / total, edgeEnergy: energySum / total };
}

/** Mean Sobel edge energy only; kept for callers that do not need stroke density. */
export function edgeEnergy(pixels: Uint8Array, width: number, height: number): number {
  return lineStats(pixels, width, height).edgeEnergy;
}

/** Dark-edge share only. See `lineStats` for the full definition. */
export function strokeDensity(pixels: Uint8Array, width: number, height: number): number {
  return lineStats(pixels, width, height).strokeDensity;
}

/** Mean and p95 of HSV saturation across the frame. */
export function saturationStats(
  pixels: Uint8Array,
  width: number,
  height: number,
): StatSummary {
  assertRgb(pixels, width, height);
  const values: number[] = [];
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const r = pixels[offset]!;
    const g = pixels[offset + 1]!;
    const b = pixels[offset + 2]!;
    const max = Math.max(r, g, b);
    values.push(max === 0 ? 0 : (max - Math.min(r, g, b)) / max);
  }
  return summarise(values);
}

/** Mean and p95 of the 3×3 local luma range, over 255. */
export function contrastStats(
  pixels: Uint8Array,
  width: number,
  height: number,
): StatSummary {
  assertRgb(pixels, width, height);
  const values: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          const offset = (yy * width + xx) * 3;
          const value = luma(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      values.push((max - min) / 255);
    }
  }
  return summarise(values);
}

/** Mean and p95 of luma over 255. */
export function brightnessStats(
  pixels: Uint8Array,
  width: number,
  height: number,
): StatSummary {
  assertRgb(pixels, width, height);
  const values: number[] = [];
  for (let offset = 0; offset < pixels.length; offset += 3) {
    values.push(luma(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) / 255);
  }
  return summarise(values);
}

/**
 * Share of the outer band whose colour differs from the band's median colour.
 * `margin` is the band thickness as a fraction of the short edge (0..0.5).
 */
export function safeAreaStats(
  pixels: Uint8Array,
  width: number,
  height: number,
  margin: number = DEFAULT_SAFE_AREA_MARGIN,
): SafeAreaStats {
  assertRgb(pixels, width, height);
  if (!(margin > 0) || margin > 0.5) {
    throw new TypeError(`margin must be in (0, 0.5], got ${String(margin)}`);
  }
  const band = Math.max(1, Math.round(Math.min(width, height) * margin));

  const bandPixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const inVerticalBand = y < band || y >= height - band;
    for (let x = 0; x < width; x += 1) {
      if (inVerticalBand || x < band || x >= width - band) {
        bandPixels.push((y * width + x) * 3);
      }
    }
  }

  const medianChannel = (channel: number): number => {
    const values = bandPixels.map((offset) => pixels[offset + channel]!);
    return percentile(values, 0.5);
  };
  const medianR = medianChannel(0);
  const medianG = medianChannel(1);
  const medianB = medianChannel(2);

  let content = 0;
  for (const offset of bandPixels) {
    const dr = pixels[offset]! - medianR;
    const dg = pixels[offset + 1]! - medianG;
    const db = pixels[offset + 2]! - medianB;
    if (Math.hypot(dr, dg, db) > SAFE_AREA_CONTENT_DISTANCE) content += 1;
  }

  return {
    edgeContentRatio: bandPixels.length === 0 ? 0 : content / bandPixels.length,
    margin,
  };
}

function summarise(values: readonly number[]): StatSummary {
  if (values.length === 0) return { mean: 0, p95: 0 };
  let sum = 0;
  for (const value of values) sum += value;
  return { mean: sum / values.length, p95: percentile(values, 0.95) };
}
