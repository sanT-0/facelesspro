import { describe, expect, it, vi } from 'vitest';

import { rgbHistogram } from '@facelesspro/core';
import type {
  GeneratedImage,
  ImageGenerationRequest,
  StyleProfile,
} from '@facelesspro/contracts';

import { UpstreamError } from '../planner/http';
import { IMAGE_NATIVE_DIMENSIONS } from './dimensions';
import type { DecodeRaster, EncodeRaster } from './postprocess';
import {
  CONSISTENCY_CLAUSE,
  DEFAULT_CONSISTENCY_THRESHOLD,
  DEFAULT_MAX_PALETTE_DELTA_E,
  postprocessScene,
} from './postprocess';
import type { Raster } from './png';

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const style: StyleProfile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene',
  palette: {
    hex: ['#14213d', '#fca311', '#ffffff'],
    weights: [0.5, 0.3, 0.2],
  },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple',
  composition: 'centred subject',
  characters: [],
  typography: { present: false },
  negative: 'photo, text, watermark',
  seedBase: 1234,
  measured: {
    line: { strokeDensity: 0.04, edgeEnergy: 0.08 },
    tone: {
      saturation: { mean: 0.5, p95: 0.8 },
      contrast: { mean: 0.2, p95: 0.5 },
      brightness: { mean: 0.6, p95: 0.9 },
    },
    aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
    safeArea: { edgeContentRatio: 0.04, margin: 0.08 },
    frameCount: 8,
  },
  source: { adapter: 'heuristic', degradedFrom: [] },
};

const request: ImageGenerationRequest = {
  prompt: 'flat vector freelancer at a desk',
  negativePrompt: style.negative,
  seed: 42,
  size: 'landscape',
  style,
};

const { width, height } = IMAGE_NATIVE_DIMENSIONS.landscape;

function imageOf(colour: readonly [number, number, number], seed = request.seed): GeneratedImage {
  return {
    adapter: 'procedural',
    degradedFrom: [],
    mimeType: 'image/png',
    size: 'landscape',
    width,
    height,
    seed,
    bytes: Uint8Array.from([...PNG, colour[0], colour[1], colour[2]]),
  };
}

/** Reads the flat colour out of the fake bytes and returns a full raster. */
const decodeFlat: DecodeRaster = async (bytes, size) => {
  const offset = bytes.length - 3;
  const pixels = new Uint8Array(size.width * size.height * 3);
  for (let index = 0; index < size.width * size.height; index += 1) {
    pixels[index * 3] = bytes[offset]!;
    pixels[index * 3 + 1] = bytes[offset + 1]!;
    pixels[index * 3 + 2] = bytes[offset + 2]!;
  }
  return { width: size.width, height: size.height, pixels };
};

const encodeFlat: EncodeRaster = (raster: Raster) =>
  Uint8Array.from([...PNG, raster.pixels[0]!, raster.pixels[1]!, raster.pixels[2]!]);

const flatOptions = {
  decode: decodeFlat,
  encode: encodeFlat,
  histogramBins: 4,
  maxDeltaE: DEFAULT_MAX_PALETTE_DELTA_E,
};

function drawOf(colour: readonly [number, number, number]) {
  return { draw: vi.fn(async (_request: ImageGenerationRequest) => imageOf(colour)) };
}

describe('postprocessScene', () => {
  it('corrects the image toward the style palette and reports no reference distance', async () => {
    const source = imageOf([128, 128, 128]);
    const frame = await postprocessScene(request, source, {
      ...flatOptions,
      draw: drawOf([128, 128, 128]),
    });

    expect(frame.image.bytes).not.toEqual(source.bytes);
    expect(frame.image.width).toBe(width);
    expect(frame.image.height).toBe(height);
    expect(frame.image.seed).toBe(42);
    expect(frame.prompt).toBe(request.prompt);
    expect(frame.correction.deltaE).toBeCloseTo(DEFAULT_MAX_PALETTE_DELTA_E, 6);
    expect(frame.correction.maxDeltaE).toBe(DEFAULT_MAX_PALETTE_DELTA_E);
    expect(frame.consistency).toEqual({
      distance: null,
      outlier: false,
      regenerated: false,
      finalDistance: null,
    });
    expect(frame.histogram).toHaveLength(64);
    expect(frame.histogram.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
  });

  it('accepts a scene whose histogram matches an existing scene', async () => {
    const first = await postprocessScene(request, imageOf([120, 90, 40]), {
      ...flatOptions,
      draw: drawOf([120, 90, 40]),
    });
    const draw = drawOf([120, 90, 40]);

    const second = await postprocessScene(request, imageOf([120, 90, 40]), {
      ...flatOptions,
      draw,
      referenceHistograms: [first.histogram],
    });

    expect(second.consistency.distance).toBeCloseTo(0, 10);
    expect(second.consistency.outlier).toBe(false);
    expect(second.consistency.regenerated).toBe(false);
    expect(draw.draw).not.toHaveBeenCalled();
  });

  it('regenerates exactly once with the consistency clause when the scene is an outlier', async () => {
    const orangeReference = rgbHistogram(new Uint8Array([252, 163, 17]), 4);
    const draw = drawOf([252, 163, 17]);

    const frame = await postprocessScene(request, imageOf([120, 120, 120]), {
      ...flatOptions,
      draw,
      referenceHistograms: [orangeReference],
      consistencyThreshold: 0.2,
    });

    expect(draw.draw).toHaveBeenCalledOnce();
    expect(draw.draw.mock.calls[0]?.[0]).toMatchObject({
      prompt: `${request.prompt}, ${CONSISTENCY_CLAUSE}`,
      seed: request.seed,
      size: request.size,
    });
    expect(frame.image.seed).toBe(request.seed);
    expect(frame.image.adapter).toBe('procedural');
    expect(frame.prompt).toBe(`${request.prompt}, ${CONSISTENCY_CLAUSE}`);
    expect(frame.consistency.outlier).toBe(true);
    expect(frame.consistency.regenerated).toBe(true);
    expect(frame.consistency.distance).toBeCloseTo(1, 10);
    // The reference is the uncorrected orange, so the accepted still is close
    // rather than identical: palette correction moved it a few ΔE.
    expect(frame.consistency.finalDistance).toBeLessThan(0.1);
    expect(frame.image.bytes).not.toEqual(imageOf([120, 120, 120]).bytes);
  });

  it('accepts the second attempt even when it is still an outlier, without a third call', async () => {
    const orangeReference = rgbHistogram(new Uint8Array([252, 163, 17]), 4);
    const draw = drawOf([20, 20, 20]);

    const frame = await postprocessScene(request, imageOf([120, 120, 120]), {
      ...flatOptions,
      draw,
      referenceHistograms: [orangeReference],
      consistencyThreshold: 0.2,
    });

    expect(draw.draw).toHaveBeenCalledOnce();
    expect(frame.consistency.regenerated).toBe(true);
    expect(frame.consistency.finalDistance).toBeGreaterThan(0.2);
    expect(frame.image.bytes).not.toEqual(imageOf([120, 120, 120]).bytes);
  });

  it('keeps the regenerated prompt inside the contract limit', async () => {
    const blackReference = rgbHistogram(new Uint8Array([0, 0, 0]), 4);
    const draw = drawOf([252, 163, 17]);
    const longPrompt = 'a'.repeat(1000);

    const frame = await postprocessScene({ ...request, prompt: longPrompt }, imageOf([120, 120, 120]), {
      ...flatOptions,
      draw,
      referenceHistograms: [blackReference],
      consistencyThreshold: 0.2,
    });

    expect(draw.draw).toHaveBeenCalledOnce();
    expect(frame.prompt.length).toBeLessThanOrEqual(1000);
    expect(frame.prompt.endsWith(CONSISTENCY_CLAUSE)).toBe(true);
    expect(frame.prompt.startsWith('a')).toBe(true);
  });

  it('treats a distance equal to the threshold as consistent', async () => {
    const blackReference = rgbHistogram(new Uint8Array([0, 0, 0]), 4);
    const draw = drawOf([252, 163, 17]);

    const frame = await postprocessScene(request, imageOf([120, 120, 120]), {
      ...flatOptions,
      draw,
      referenceHistograms: [blackReference],
      consistencyThreshold: 1,
    });

    expect(frame.consistency.distance).toBe(1);
    expect(frame.consistency.outlier).toBe(false);
    expect(draw.draw).not.toHaveBeenCalled();
  });

  it('propagates a regeneration failure and does not retry it', async () => {
    const blackReference = rgbHistogram(new Uint8Array([0, 0, 0]), 4);
    const draw = vi.fn(async () => {
      throw new UpstreamError('procedural', 'provider down', { retryable: true });
    });

    const error = await postprocessScene(request, imageOf([120, 120, 120]), {
      ...flatOptions,
      draw: { draw },
      referenceHistograms: [blackReference],
      consistencyThreshold: 0.2,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UpstreamError);
    expect(draw).toHaveBeenCalledOnce();
  });

  it('rejects mismatched size or seed, malformed requests and bad references', async () => {
    const draw = drawOf([128, 128, 128]);
    const base = { ...flatOptions, draw };

    await expect(
      postprocessScene({ ...request, seed: 43 }, imageOf([128, 128, 128], 42), base),
    ).rejects.toThrow(/seed/i);

    await expect(
      postprocessScene(
        { ...request, size: 'portrait' },
        { ...imageOf([128, 128, 128]), size: 'portrait', width: 576, height: 1024 },
        base,
      ),
    ).resolves.toBeDefined();

    await expect(
      postprocessScene({ ...request, seed: 0 }, imageOf([128, 128, 128]), base),
    ).rejects.toThrow();

    await expect(
      postprocessScene(request, imageOf([128, 128, 128]), {
        ...base,
        referenceHistograms: [[1, 2]],
      }),
    ).rejects.toThrow(/histogram/i);

    expect(draw.draw).not.toHaveBeenCalled();
  });

  it('rejects a decoder raster that disagrees with the provider geometry', async () => {
    const draw = drawOf([128, 128, 128]);
    const error = await postprocessScene(request, imageOf([128, 128, 128]), {
      ...flatOptions,
      draw,
      decode: async () => ({ width: 1, height: 1, pixels: new Uint8Array(3) }),
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/geometry/i);
    expect(draw.draw).not.toHaveBeenCalled();
  });

  it('rejects encoder output that is not a PNG', async () => {
    const draw = drawOf([128, 128, 128]);
    const error = await postprocessScene(request, imageOf([128, 128, 128]), {
      ...flatOptions,
      draw,
      encode: () => Uint8Array.from([1, 2, 3]),
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/PNG/i);
  });

  it('keeps the documented default threshold available to callers', () => {
    expect(DEFAULT_CONSISTENCY_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_CONSISTENCY_THRESHOLD).toBeLessThan(1);
  });
});
