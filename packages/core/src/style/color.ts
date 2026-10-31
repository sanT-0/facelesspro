/**
 * CIELAB colour maths and scene histograms — docs/04 §3 step 4.
 *
 * The pipeline colour-corrects a generated still toward the measured style
 * palette by a **bounded** shift in LAB: the whole image moves by one vector of
 * at most 6 ΔE, so hues move toward the channel palette without flattening the
 * model's shading into poster art. A per-pixel nearest-colour remap would look
 * like a filter; a bounded translation reads as colour grading.
 *
 * Everything here is pure and operates on RGB24 bytes (`width * height * 3`),
 * the format ffmpeg already produces elsewhere. No I/O, no clock, no RNG.
 */

import { hexToRgb } from './palette';

export interface Lab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface PaletteCorrection {
  /** A new buffer; the input is never mutated. */
  readonly pixels: Uint8Array;
  /** Magnitude of the applied LAB translation, at most `maxDeltaE`. */
  readonly deltaE: number;
}

/** docs/04 §3: colour-correct toward the palette with ≤6 ΔE. */
export const DEFAULT_MAX_PALETTE_DELTA_E = 6;
export const DEFAULT_HISTOGRAM_BINS = 4;
export const MAX_HISTOGRAM_BINS = 16;

// D65 reference white, matching sRGB's viewing conditions.
const WHITE_X = 0.95047;
const WHITE_Y = 1;
const WHITE_Z = 1.08883;
const DELTA = 6 / 29;
const DELTA_CUBED = DELTA ** 3;

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const channel = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(channel * 255)));
}

function labForward(value: number): number {
  return value > DELTA_CUBED
    ? Math.cbrt(value)
    : value / (3 * DELTA * DELTA) + 4 / 29;
}

function labInverse(value: number): number {
  return value > DELTA ? value ** 3 : 3 * DELTA * DELTA * (value - 4 / 29);
}

/** sRGB byte triple → CIELAB (D65). */
export function rgbToLab(red: number, green: number, blue: number): Lab {
  const r = srgbToLinear(red);
  const g = srgbToLinear(green);
  const b = srgbToLinear(blue);

  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;

  const fx = labForward(x / WHITE_X);
  const fy = labForward(y / WHITE_Y);
  const fz = labForward(z / WHITE_Z);

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIELAB → sRGB bytes. Out-of-gamut channels are clamped, never NaN. */
export function labToRgb(lab: Lab): RgbColor {
  if (!Number.isFinite(lab.l) || !Number.isFinite(lab.a) || !Number.isFinite(lab.b)) {
    throw new TypeError('labToRgb expects finite l, a and b');
  }

  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;

  const x = WHITE_X * labInverse(fx);
  const y = WHITE_Y * labInverse(fy);
  const z = WHITE_Z * labInverse(fz);

  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b) };
}

/** CIE76 colour difference; the unit docs/04's ≤6 ΔE budget is expressed in. */
export function deltaE76(first: Lab, second: Lab): number {
  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

function assertRgb24(pixels: Uint8Array, label: string): void {
  if (!(pixels instanceof Uint8Array) || pixels.length === 0) {
    throw new TypeError(`${label} expects a non-empty RGB24 Uint8Array`);
  }
  if (pixels.length % 3 !== 0) {
    throw new TypeError(`${label} expects a byte length that is a multiple of 3`);
  }
}

/** Weighted mean of palette colours in LAB, independent of declaration order. */
export function paletteLab(
  hexes: readonly string[],
  weights: readonly number[],
): Lab {
  if (hexes.length === 0) throw new TypeError('paletteLab needs at least one colour');
  if (hexes.length !== weights.length) {
    throw new TypeError('paletteLab needs the same length for hexes and weights');
  }
  let total = 0;
  let l = 0;
  let a = 0;
  let b = 0;
  for (let index = 0; index < hexes.length; index += 1) {
    const weight = weights[index]!;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new TypeError(`paletteLab weight ${String(weight)} is not a non-negative number`);
    }
    const rgb = hexToRgb(hexes[index]!);
    const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
    l += lab.l * weight;
    a += lab.a * weight;
    b += lab.b * weight;
    total += weight;
  }
  if (total <= 0) throw new TypeError('paletteLab weights must have a positive sum');
  return { l: l / total, a: a / total, b: b / total };
}

/** Perceptually reasonable centroid of a decoded image. */
export function meanLab(pixels: Uint8Array): Lab {
  assertRgb24(pixels, 'meanLab');
  const count = pixels.length / 3;
  let l = 0;
  let a = 0;
  let b = 0;
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const lab = rgbToLab(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
    l += lab.l;
    a += lab.a;
    b += lab.b;
  }
  return { l: l / count, a: a / count, b: b / count };
}

/**
 * Translate every pixel by one LAB vector toward `target`, clamped so no pixel
 * moves more than `maxDeltaE`. The input buffer is not mutated.
 */
export function correctTowardPalette(
  pixels: Uint8Array,
  target: Lab,
  maxDeltaE: number = DEFAULT_MAX_PALETTE_DELTA_E,
): PaletteCorrection {
  assertRgb24(pixels, 'correctTowardPalette');
  if (!Number.isFinite(maxDeltaE) || maxDeltaE < 0) {
    throw new TypeError(`maxDeltaE must be a non-negative number, got ${String(maxDeltaE)}`);
  }
  if (!Number.isFinite(target.l) || !Number.isFinite(target.a) || !Number.isFinite(target.b)) {
    throw new TypeError('correctTowardPalette expects a finite target Lab');
  }

  const mean = meanLab(pixels);
  const dl = target.l - mean.l;
  const da = target.a - mean.a;
  const db = target.b - mean.b;
  const magnitude = Math.hypot(dl, da, db);

  if (magnitude <= 1e-9 || maxDeltaE === 0) {
    return { pixels: pixels.slice(), deltaE: 0 };
  }

  const scale = Math.min(1, maxDeltaE / magnitude);
  const shiftL = dl * scale;
  const shiftA = da * scale;
  const shiftB = db * scale;

  const corrected = new Uint8Array(pixels.length);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const lab = rgbToLab(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
    const rgb = labToRgb({
      l: lab.l + shiftL,
      a: lab.a + shiftA,
      b: lab.b + shiftB,
    });
    corrected[offset] = rgb.r;
    corrected[offset + 1] = rgb.g;
    corrected[offset + 2] = rgb.b;
  }

  return { pixels: corrected, deltaE: magnitude * scale };
}

function assertBins(bins: number): void {
  if (!Number.isInteger(bins) || bins < 1 || bins > MAX_HISTOGRAM_BINS) {
    throw new TypeError(
      `histogram bins must be an integer between 1 and ${MAX_HISTOGRAM_BINS}, got ${String(bins)}`,
    );
  }
}

/**
 * Soft per-channel bin assignment: a value contributes to the two nearest bin
 * centres, weighted by distance. Hard bins made two visually identical scenes
 * differ by ~0.9 when a channel sat one byte either side of an edge.
 */
function channelBins(value: number, bins: number): ReadonlyArray<readonly [number, number]> {
  const scaled = (value / 256) * bins - 0.5;
  const clamped = Math.min(bins - 1, Math.max(0, scaled));
  const lower = Math.floor(clamped);
  const upper = Math.min(bins - 1, lower + 1);
  if (lower === upper) return [[lower, 1]];
  const fraction = clamped - lower;
  return [
    [lower, 1 - fraction],
    [upper, fraction],
  ];
}

/**
 * Normalised RGB histogram with `bins^3` cells; sums to 1.
 *
 * Soft assignment along each channel makes the distance a measure of colour
 * distribution rather than of byte values landing on a particular side of a
 * bin boundary.
 */
export function rgbHistogram(
  pixels: Uint8Array,
  bins: number = DEFAULT_HISTOGRAM_BINS,
): number[] {
  assertRgb24(pixels, 'rgbHistogram');
  assertBins(bins);

  const histogram = new Array<number>(bins ** 3).fill(0);
  const pixelCount = pixels.length / 3;
  const stride = bins * bins;
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const red = channelBins(pixels[offset]!, bins);
    const green = channelBins(pixels[offset + 1]!, bins);
    const blue = channelBins(pixels[offset + 2]!, bins);
    for (const [r, rw] of red) {
      for (const [g, gw] of green) {
        const rg = r * stride + g * bins;
        for (const [b, bw] of blue) {
          const index = rg + b;
          histogram[index] = (histogram[index] ?? 0) + rw * gw * bw;
        }
      }
    }
  }
  return histogram.map((count) => count / pixelCount);
}

/**
 * Total-variation distance between two normalised histograms, in [0, 1]:
 * 0 means identical distributions, 1 means disjoint.
 */
export function histogramDistance(
  first: readonly number[],
  second: readonly number[],
): number {
  if (first.length === 0 || second.length === 0) {
    throw new TypeError('histogramDistance needs non-empty histograms');
  }
  if (first.length !== second.length) {
    throw new TypeError('histogramDistance needs histograms with the same length');
  }
  let total = 0;
  for (let index = 0; index < first.length; index += 1) {
    const left = first[index]!;
    const right = second[index]!;
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      throw new TypeError('histogramDistance histograms must contain finite numbers');
    }
    total += Math.abs(left - right);
  }
  return total / 2;
}
