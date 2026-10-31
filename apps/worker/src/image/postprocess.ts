/**
 * `create-images` post-processing — docs/04 §3 step 4 and the quality guard.
 *
 * Two jobs, in this order:
 *
 * 1. **Palette correction.** The decoded still is translated by one LAB vector
 *    toward the weighted style palette, clamped to 6 ΔE (docs/04). Bounded, so
 *    the model's shading survives; a nearest-colour remap would posterise it.
 * 2. **Consistency.** A 4×4×4 RGB histogram is compared with the scenes already
 *    accepted. If the nearest existing scene is further than the threshold, the
 *    still is an outlier and is regenerated **once** with the documented clause
 *    appended. A second failure is accepted: the guard is one-shot, so it cannot
 *    spin against a provider that keeps answering.
 *
 * Decoding/encoding are injected. Production uses ffmpeg for the decode (the
 * repo's existing raw-RGB path) and the in-repo PNG encoder for the encode, so
 * unit tests need neither a subprocess nor a network.
 */

import {
  DEFAULT_HISTOGRAM_BINS,
  DEFAULT_MAX_PALETTE_DELTA_E,
  MAX_HISTOGRAM_BINS,
  correctTowardPalette,
  histogramDistance,
  paletteLab,
  rgbHistogram,
} from '@facelesspro/core';
import {
  MAX_IMAGE_PROMPT_CHARS,
  generatedImageSchema,
  imageGenerationRequestSchema,
} from '@facelesspro/contracts';
import type { GeneratedImage, ImageGenerationRequest } from '@facelesspro/contracts';

import { runProcess } from '../art-style/frame-decode';
import type { ImageFn } from '../ports/image';
import { isPng } from './normalize';
import { encodeRgbPng } from './png';
import type { Raster } from './png';

export { DEFAULT_HISTOGRAM_BINS, DEFAULT_MAX_PALETTE_DELTA_E };

/** docs/04 quality guard, verbatim. */
export const CONSISTENCY_CLAUSE = 'same character, same palette as previous scene';

/**
 * Total-variation distance at which a scene stops resembling every accepted
 * scene. 0.35 was chosen against the synthetic artifact: same-palette scenes
 * from different seeds stay below 0.2, while a deliberately off-palette block
 * lands near 1.
 */
export const DEFAULT_CONSISTENCY_THRESHOLD = 0.35;

const DECODE_TIMEOUT_MS = 120_000;

export interface RasterSize {
  readonly width: number;
  readonly height: number;
}

export type DecodeRaster = (bytes: Uint8Array, size: RasterSize) => Promise<Raster>;

export type EncodeRaster = (raster: Raster) => Uint8Array;

export interface SceneCorrection {
  /** Magnitude of the applied LAB translation (≤ `maxDeltaE`). */
  readonly deltaE: number;
  readonly maxDeltaE: number;
}

export interface SceneConsistency {
  /** Distance from the accepted scene to its nearest reference; null with no references. */
  readonly distance: number | null;
  /** Whether the first draw was an outlier and triggered the one-shot regenerate. */
  readonly outlier: boolean;
  readonly regenerated: boolean;
  /** Distance of the accepted draw; equals `distance` when nothing was regenerated. */
  readonly finalDistance: number | null;
}

export interface SceneFrame {
  readonly image: GeneratedImage;
  /** Prompt actually used; carries the consistency clause after a regenerate. */
  readonly prompt: string;
  readonly histogram: readonly number[];
  readonly correction: SceneCorrection;
  readonly consistency: SceneConsistency;
}

export interface ScenePostprocessOptions {
  /** Adapter used only for the one-shot regenerate. */
  readonly draw: ImageFn;
  /** Histograms of already accepted scenes, nearest-neighbour compared. */
  readonly referenceHistograms?: readonly (readonly number[])[];
  readonly maxDeltaE?: number;
  readonly histogramBins?: number;
  readonly consistencyThreshold?: number;
  /** Injected in tests; defaults to ffmpeg. */
  readonly decode?: DecodeRaster;
  /** Injected in tests; defaults to the in-repo PNG encoder. */
  readonly encode?: EncodeRaster;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number, got ${String(value)}`);
  }
  return value;
}

function validateBins(bins: number): number {
  if (!Number.isInteger(bins) || bins < 1 || bins > MAX_HISTOGRAM_BINS) {
    throw new TypeError(
      `histogramBins must be an integer between 1 and ${MAX_HISTOGRAM_BINS}, got ${String(bins)}`,
    );
  }
  return bins;
}

const decodeWithFfmpeg: DecodeRaster = async (bytes, size) => {
  if (bytes.byteLength === 0) throw new TypeError('cannot decode an empty image');
  const expected = size.width * size.height * 3;
  const { code, stdout, stderr } = await runProcess(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      'pipe:0',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    DECODE_TIMEOUT_MS,
    bytes,
  );
  if (code !== 0) {
    throw new Error(`ffmpeg image decode exited with ${code}: ${stderr.trim()}`);
  }
  if (stdout.length !== expected) {
    throw new Error(
      `ffmpeg image decode returned ${stdout.length} bytes, expected ${expected} ` +
        `for ${size.width}x${size.height}`,
    );
  }
  return {
    width: size.width,
    height: size.height,
    pixels: new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.length),
  };
};

const encodeWithRepoPng: EncodeRaster = (raster) => encodeRgbPng(raster);

function assertMatchesRequest(image: GeneratedImage, request: ImageGenerationRequest): void {
  if (image.size !== request.size) {
    throw new TypeError(`image size ${image.size} does not match request size ${request.size}`);
  }
  if (image.seed !== request.seed) {
    throw new TypeError(`image seed ${image.seed} does not match request seed ${request.seed}`);
  }
}

function assertGeometry(raster: Raster, image: GeneratedImage): void {
  if (
    raster.width !== image.width ||
    raster.height !== image.height ||
    raster.pixels.length !== raster.width * raster.height * 3
  ) {
    throw new Error(
      `decoded raster geometry ${raster.width}x${raster.height} (${raster.pixels.length} bytes) ` +
        `does not match image geometry ${image.width}x${image.height}`,
    );
  }
}

function nearestDistance(
  histogram: readonly number[],
  references: readonly (readonly number[])[],
): number | null {
  if (references.length === 0) return null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const reference of references) {
    const distance = histogramDistance(histogram, reference);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

/**
 * Append the quality-guard clause without ever exceeding the request contract.
 * A 1000-character prompt loses its tail, not its subject at the front.
 */
export function withConsistencyClause(prompt: string): string {
  const suffix = `, ${CONSISTENCY_CLAUSE}`;
  const room = MAX_IMAGE_PROMPT_CHARS - suffix.length;
  const head = (prompt.length <= room ? prompt : prompt.slice(0, room))
    .replace(/[,\s]+$/u, '')
    .trimEnd();
  return `${head}${suffix}`;
}

export async function postprocessScene(
  input: ImageGenerationRequest,
  providerImage: GeneratedImage,
  options: ScenePostprocessOptions,
): Promise<SceneFrame> {
  const request = imageGenerationRequestSchema.parse(input);
  const image = generatedImageSchema.parse(providerImage);
  assertMatchesRequest(image, request);

  const maxDeltaE = finiteNonNegative(
    options.maxDeltaE ?? DEFAULT_MAX_PALETTE_DELTA_E,
    'maxDeltaE',
  );
  const bins = validateBins(options.histogramBins ?? DEFAULT_HISTOGRAM_BINS);
  const threshold = finiteNonNegative(
    options.consistencyThreshold ?? DEFAULT_CONSISTENCY_THRESHOLD,
    'consistencyThreshold',
  );
  const decode = options.decode ?? decodeWithFfmpeg;
  const encode = options.encode ?? encodeWithRepoPng;

  const references = options.referenceHistograms ?? [];
  const expectedBins = bins ** 3;
  references.forEach((reference, index) => {
    if (reference.length !== expectedBins) {
      throw new TypeError(
        `reference histogram ${index} has ${reference.length} bins, expected ${expectedBins}`,
      );
    }
  });

  const target = paletteLab(request.style.palette.hex, request.style.palette.weights);

  const prepare = async (source: GeneratedImage): Promise<{
    image: GeneratedImage;
    histogram: readonly number[];
    correction: SceneCorrection;
  }> => {
    const raster = await decode(source.bytes, {
      width: source.width,
      height: source.height,
    });
    assertGeometry(raster, source);

    const corrected = correctTowardPalette(raster.pixels, target, maxDeltaE);
    const bytes = encode({ ...raster, pixels: corrected.pixels });
    if (!isPng(bytes)) throw new Error('postprocess encoder did not return a PNG');

    const correctedImage = generatedImageSchema.parse({ ...source, bytes });
    return {
      image: correctedImage,
      histogram: rgbHistogram(corrected.pixels, bins),
      correction: { deltaE: corrected.deltaE, maxDeltaE },
    };
  };

  const first = await prepare(image);
  const distance = nearestDistance(first.histogram, references);
  const outlier = distance !== null && distance > threshold;

  if (!outlier) {
    return {
      image: first.image,
      prompt: request.prompt,
      histogram: first.histogram,
      correction: first.correction,
      consistency: {
        distance,
        outlier: false,
        regenerated: false,
        finalDistance: distance,
      },
    };
  }

  const retryRequest = imageGenerationRequestSchema.parse({
    ...request,
    prompt: withConsistencyClause(request.prompt),
  });
  const retryImage = generatedImageSchema.parse(await options.draw.draw(retryRequest));
  assertMatchesRequest(retryImage, retryRequest);
  const second = await prepare(retryImage);
  const finalDistance = nearestDistance(second.histogram, references);

  return {
    image: second.image,
    prompt: retryRequest.prompt,
    histogram: second.histogram,
    correction: second.correction,
    consistency: {
      distance,
      outlier: true,
      regenerated: true,
      finalDistance,
    },
  };
}
