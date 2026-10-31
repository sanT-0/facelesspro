import { describe, expect, it, vi } from 'vitest';

import type {
  GeneratedImage,
  ImageAdapter,
  ImageGenerationRequest,
  StyleProfile,
} from '@facelesspro/contracts';

import type { ImagePort } from '../ports/image';
import { UpstreamError } from '../planner/http';
import { ImageChainError, createImageChain } from './chain';

const style: StyleProfile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene',
  palette: { hex: ['#14213d'], weights: [1] },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple',
  composition: 'centred',
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

function image(adapter: ImageAdapter, degradedFrom: ImageAdapter[] = []): GeneratedImage {
  return {
    adapter,
    degradedFrom,
    mimeType: 'image/png',
    size: 'landscape',
    width: 1024,
    height: 576,
    seed: 42,
    bytes: new Uint8Array([137, 80, 78, 71]),
  };
}

function port(name: ImageAdapter, behaviour: () => Promise<GeneratedImage>): ImagePort {
  return {
    name,
    capabilities: { maxSide: 1024, sizes: ['landscape', 'portrait'], style: 'profile', seed: true },
    draw: vi.fn(behaviour),
  };
}

describe('createImageChain', () => {
  it('returns the first healthy image with empty degradation provenance', async () => {
    const chain = createImageChain([port('cloudflare', async () => image('cloudflare'))]);

    await expect(chain.draw(request)).resolves.toMatchObject({
      adapter: 'cloudflare',
      degradedFrom: [],
    });
  });

  it('falls through in order and records every failed adapter', async () => {
    const procedural = port('procedural', async () => image('procedural', ['comfyui']));
    const chain = createImageChain([
      port('cloudflare', async () => {
        throw new Error('cloud down');
      }),
      port('pollinations', async () => {
        throw new Error('quota');
      }),
      procedural,
    ]);

    const result = await chain.draw(request);

    expect(result.adapter).toBe('procedural');
    expect(result.degradedFrom).toEqual(['cloudflare', 'pollinations']);
  });

  it('passes the request through unchanged and short-circuits later adapters', async () => {
    const draw = vi.fn(async () => image('cloudflare'));
    const later = port('procedural', async () => image('procedural'));
    const chain = createImageChain([
      { name: 'cloudflare', capabilities: port('cloudflare', draw).capabilities, draw },
      later,
    ]);

    await chain.draw(request);

    expect(draw).toHaveBeenCalledWith(request);
    expect(later.draw).not.toHaveBeenCalled();
  });

  it('throws every diagnosis when all adapters fail, including non-Error values', async () => {
    const chain = createImageChain([
      port('cloudflare', async () => {
        throw new Error('timed out');
      }),
      port('pollinations', async () => {
        throw 'rate limited';
      }),
    ]);

    const error = await chain.draw(request).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ImageChainError);
    expect((error as ImageChainError).failures).toEqual([
      { adapter: 'cloudflare', message: 'timed out', retryable: false },
      { adapter: 'pollinations', message: 'rate limited', retryable: false },
    ]);
    expect((error as ImageChainError).message).toContain('cloudflare: timed out');
    expect((error as ImageChainError).message).toContain('pollinations: rate limited');
  });

  it('is retryable only when every failure was transient', async () => {
    const transient = createImageChain([
      port('cloudflare', async () => {
        throw new UpstreamError('cloudflare', 'timeout', { retryable: true });
      }),
      port('pollinations', async () => {
        throw new UpstreamError('pollinations', '429', { retryable: true });
      }),
    ]);
    const mixed = createImageChain([
      port('cloudflare', async () => {
        throw new UpstreamError('cloudflare', 'timeout', { retryable: true });
      }),
      port('pollinations', async () => {
        throw new UpstreamError('pollinations', 'bad body', { retryable: false });
      }),
    ]);

    const allTransient = await transient.draw(request).catch((thrown: unknown) => thrown);
    const notAll = await mixed.draw(request).catch((thrown: unknown) => thrown);

    expect((allTransient as ImageChainError).retryable).toBe(true);
    expect((notAll as ImageChainError).retryable).toBe(false);
  });

  it('refuses an empty adapter list', () => {
    expect(() => createImageChain([])).toThrow(/at least one adapter/);
  });
});
