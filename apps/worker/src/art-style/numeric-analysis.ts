/**
 * The numeric half of an art style, computed without a model.
 *
 * Runs docs/04 §4's "numeric pass": palette, ink properties, tone and frame
 * geometry over the sampled reference frames. The vision pass (VLM) runs next
 * and only describes what numbers cannot — medium, composition, characters —
 * so the two halves never guess at each other's job.
 *
 * Aggregation choices, written down because they are surprising otherwise:
 * - **The palette is computed once over all frames.** Per-frame palettes would
 *   give a different channel colour per scene; a style needs one.
 * - **Line and tone metrics are averaged across frames.** A mostly-flat video
 *   should not look like a striped one just because one frame was busy.
 * - **Aspect comes from the native frame size**, not from the scaled decode.
 *
 * Output is parsed through `numericStyleProfileSchema`, so a bug here fails at
 * the boundary instead of writing a bad `art_style.profile` row.
 */

import {
  DEFAULT_PALETTE_COLORS,
  DEFAULT_SAFE_AREA_MARGIN,
  brightnessStats,
  contrastStats,
  kmeansPalette,
  lineStats,
  safeAreaStats,
  saturationStats,
} from '@facelesspro/core';
import { numericStyleProfileSchema } from '@facelesspro/contracts';
import type { NumericStyleProfile, StyleStat } from '@facelesspro/contracts';

import { decodeFrame, probeFrameSize } from './frame-decode';

/** Long edge of the decoded frames, matching `DEFAULT_DECODE_MAX_SIZE`. */
const DEFAULT_MAX_SIZE = 128;
/** Pixels fed to k-means; more than this buys nothing at k <= 8. */
const DEFAULT_PALETTE_SAMPLE_BUDGET = 20_000;

export interface AnalyzeFramesOptions {
  /** Long-edge ceiling for decoding. Default 128. */
  maxSize?: number;
  /** Palette cluster target. Default 5. */
  paletteColors?: number;
  /** Safe-area band as a fraction of the short edge. Default 0.08. */
  margin?: number;
  /** Maximum pixels sampled for k-means. Default 20 000. */
  paletteSampleBudget?: number;
}

/**
 * Analyse sampled frames into the numeric style profile.
 *
 * @throws when `framePaths` is empty, or when any frame cannot be decoded.
 */
export async function analyzeFrames(
  framePaths: readonly string[],
  options: AnalyzeFramesOptions = {},
): Promise<NumericStyleProfile> {
  if (framePaths.length === 0) {
    throw new Error('analyzeFrames requires at least one frame');
  }
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  const margin = options.margin ?? DEFAULT_SAFE_AREA_MARGIN;

  // Native geometry comes from the first frame; sampling already guarantees the
  // frames come from one video, so they share a size.
  const firstPath = framePaths[0]!;
  const nativeSize = await probeFrameSize(firstPath);

  const lineSamples: Array<{ strokeDensity: number; edgeEnergy: number }> = [];
  const toneSamples: Array<{
    saturation: StyleStat;
    contrast: StyleStat;
    brightness: StyleStat;
  }> = [];
  const safeAreaSamples: number[] = [];
  const decoded: Array<{ data: Uint8Array }> = [];

  for (const framePath of framePaths) {
    const frame = await decodeFrame(framePath, { maxSize, sourceSize: nativeSize });
    decoded.push({ data: frame.data });
    lineSamples.push(lineStats(frame.data, frame.width, frame.height));
    toneSamples.push({
      saturation: saturationStats(frame.data, frame.width, frame.height),
      contrast: contrastStats(frame.data, frame.width, frame.height),
      brightness: brightnessStats(frame.data, frame.width, frame.height),
    });
    safeAreaSamples.push(
      safeAreaStats(frame.data, frame.width, frame.height, margin).edgeContentRatio,
    );
  }

  // One palette across the video: concatenate the same-sized frames, then
  // stride through them so k-means sees a bounded sample.
  const totalBytes = decoded.reduce((sum, frame) => sum + frame.data.length, 0);
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const frame of decoded) {
    joined.set(frame.data, offset);
    offset += frame.data.length;
  }
  const pixelCount = Math.floor(joined.length / 3);
  const budget = options.paletteSampleBudget ?? DEFAULT_PALETTE_SAMPLE_BUDGET;
  const stride = Math.max(1, Math.ceil(pixelCount / Math.max(1, budget)));
  const palette = kmeansPalette(joined, {
    colors: options.paletteColors ?? DEFAULT_PALETTE_COLORS,
    stride,
  });

  const ratio = round(nativeSize.width / nativeSize.height, 4);

  return numericStyleProfileSchema.parse({
    palette,
    line: {
      strokeDensity: mean(lineSamples.map((sample) => sample.strokeDensity)),
      edgeEnergy: mean(lineSamples.map((sample) => sample.edgeEnergy)),
    },
    tone: {
      saturation: summarise(toneSamples.map((sample) => sample.saturation)),
      contrast: summarise(toneSamples.map((sample) => sample.contrast)),
      brightness: summarise(toneSamples.map((sample) => sample.brightness)),
    },
    aspect: {
      width: nativeSize.width,
      height: nativeSize.height,
      ratio,
      orientation: ratio >= 1 ? 'landscape' : 'portrait',
    },
    safeArea: {
      edgeContentRatio: mean(safeAreaSamples),
      margin,
    },
    frameCount: framePaths.length,
  });
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return round(sum / values.length, 4);
}

/** Average of per-frame means and of per-frame p95s, not a pooled percentile. */
function summarise(values: readonly StyleStat[]): StyleStat {
  return {
    mean: mean(values.map((value) => value.mean)),
    p95: mean(values.map((value) => value.p95)),
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
