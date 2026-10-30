import { describe, expect, it, vi } from 'vitest';

import type {
  NumericStyleProfile,
  StyleAdapter,
  StyleVision,
} from '@facelesspro/contracts';

import type { StyleVisionPort } from '../../ports/style-vision';
import { UpstreamError } from '../../planner/http';
import { StyleVisionChainError, createStyleVisionChain } from './chain';

const numeric: NumericStyleProfile = {
  palette: { hex: ['#1b2a41'], weights: [1] },
  line: { strokeDensity: 0, edgeEnergy: 0 },
  tone: {
    saturation: { mean: 0.3, p95: 0.6 },
    contrast: { mean: 0.02, p95: 0.05 },
    brightness: { mean: 0.5, p95: 0.8 },
  },
  aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
  safeArea: { edgeContentRatio: 0.04, margin: 0.08 },
  frameCount: 8,
};

const request = { framePaths: ['a.png'], numeric };

function vision(adapter: StyleAdapter): StyleVision {
  return {
    medium: 'flat vector cartoon',
    promptPrefix: 'flat 2d cartoon',
    line: { weight: 'thick', texture: 'clean' },
    shading: 'cel',
    background: 'simple',
    composition: 'centered',
    characters: [],
    typography: { present: false },
    negative: 'photo, text',
    adapter,
    degradedFrom: [],
  };
}

function port(name: StyleAdapter, behaviour: () => Promise<StyleVision>): StyleVisionPort {
  return { name, describe: vi.fn(behaviour) };
}

describe('createStyleVisionChain', () => {
  it('returns the first healthy answer with an empty degradation list', async () => {
    const chain = createStyleVisionChain([port('cloudflare', async () => vision('cloudflare'))]);

    const result = await chain.describe(request);

    expect(result.adapter).toBe('cloudflare');
    expect(result.degradedFrom).toEqual([]);
  });

  it('degrades to the next adapter and records the order tried', async () => {
    const chain = createStyleVisionChain([
      port('cloudflare', async () => {
        throw new Error('model unavailable');
      }),
      port('gemini', async () => vision('gemini')),
    ]);

    const result = await chain.describe(request);

    expect(result.adapter).toBe('gemini');
    expect(result.degradedFrom).toEqual(['cloudflare']);
  });

  it('records every failed adapter, not just the last', async () => {
    const chain = createStyleVisionChain([
      port('cloudflare', async () => {
        throw new Error('a');
      }),
      port('gemini', async () => {
        throw new Error('b');
      }),
      port('heuristic', async () => vision('heuristic')),
    ]);

    const result = await chain.describe(request);

    expect(result.degradedFrom).toEqual(['cloudflare', 'gemini']);
  });

  it('passes the request through unchanged', async () => {
    const describe = vi.fn(async () => vision('heuristic'));
    const chain = createStyleVisionChain([{ name: 'heuristic', describe }]);

    await chain.describe(request);

    expect(describe).toHaveBeenCalledWith(request);
  });

  it('throws with every adapter diagnosis when all fail', async () => {
    const chain = createStyleVisionChain([
      port('cloudflare', async () => {
        throw new Error('timed out');
      }),
      port('gemini', async () => {
        throw new Error('bad key');
      }),
    ]);

    const error = await chain.describe(request).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StyleVisionChainError);
    expect((error as StyleVisionChainError).failures).toEqual([
      { adapter: 'cloudflare', message: 'timed out', retryable: false },
      { adapter: 'gemini', message: 'bad key', retryable: false },
    ]);
    expect((error as StyleVisionChainError).message).toContain('cloudflare: timed out');
    expect((error as StyleVisionChainError).message).toContain('gemini: bad key');
  });

  it('is retryable only when every failure was transient', async () => {
    const transient = () =>
      createStyleVisionChain([
        port('cloudflare', async () => {
          throw new UpstreamError('cloudflare', 'timeout', { retryable: true });
        }),
        port('gemini', async () => {
          throw new UpstreamError('gemini', '429', { retryable: true });
        }),
      ]);
    const mixed = () =>
      createStyleVisionChain([
        port('cloudflare', async () => {
          throw new UpstreamError('cloudflare', 'timeout', { retryable: true });
        }),
        port('gemini', async () => {
          throw new UpstreamError('gemini', '401', { retryable: false });
        }),
      ]);

    const allTransient = await transient().describe(request).catch((thrown: unknown) => thrown);
    const notAll = await mixed().describe(request).catch((thrown: unknown) => thrown);

    expect((allTransient as StyleVisionChainError).retryable).toBe(true);
    expect((notAll as StyleVisionChainError).retryable).toBe(false);
  });

  it('refuses an empty adapter list', () => {
    expect(() => createStyleVisionChain([])).toThrow(/at least one adapter/);
  });
});
