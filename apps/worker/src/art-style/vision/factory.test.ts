import { describe, expect, it, vi } from 'vitest';

import type { NumericStyleProfile } from '@facelesspro/contracts';

import { createStyleVisionChainFromEnv } from './factory';

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

const answer = {
  medium: 'flat vector cartoon',
  promptPrefix: 'flat 2d cartoon',
  line: { weight: 'thick', texture: 'clean' },
  shading: 'cel',
  background: 'simple',
  composition: 'centered',
  characters: [],
  typography: { present: false },
  negative: 'photo, text',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const frames = async () => [
  { path: 'a.png', mimeType: 'image/jpeg' as const, data: 'base64-a' },
];

const request = { framePaths: ['a.png'], numeric };

describe('createStyleVisionChainFromEnv', () => {
  it('falls back to the heuristic alone when STYLE is unset', async () => {
    const logger = vi.fn();
    const chain = createStyleVisionChainFromEnv({ env: {}, logger });

    const result = await chain.describe(request);

    expect(result.adapter).toBe('heuristic');
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('STYLE is not set'));
  });

  it('warns about an unknown adapter and keeps the rest', async () => {
    const logger = vi.fn();
    const chain = createStyleVisionChainFromEnv({ env: { STYLE: 'openai,heuristic' }, logger });

    const result = await chain.describe(request);

    expect(result.adapter).toBe('heuristic');
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('unknown adapter "openai"'));
  });

  it('skips a provider whose credentials are missing and names the variables', async () => {
    const logger = vi.fn();
    const chain = createStyleVisionChainFromEnv({
      env: { STYLE: 'cloudflare,gemini,heuristic' },
      logger,
    });

    const result = await chain.describe(request);

    expect(result.adapter).toBe('heuristic');
    expect(result.degradedFrom).toEqual([]);
    const messages = logger.mock.calls.map((call) => String(call[0])).join('\n');
    expect(messages).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(messages).toContain('CLOUDFLARE_API_TOKEN');
    expect(messages).toContain('GEMINI_API_KEY');
  });

  it('falls back to the heuristic when every configured provider is unavailable', async () => {
    const logger = vi.fn();
    const chain = createStyleVisionChainFromEnv({ env: { STYLE: 'cloudflare' }, logger });

    const result = await chain.describe(request);

    expect(result.adapter).toBe('heuristic');
    expect(logger).toHaveBeenLastCalledWith(
      expect.stringContaining('describing art styles with the heuristic adapter'),
    );
  });

  it('preserves the configured order and degrades down it', async () => {
    const logger = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('generativelanguage')) {
        return json({ error: 'nope' }, 503);
      }
      return json({ result: { response: JSON.stringify(answer) } });
    });

    const chain = createStyleVisionChainFromEnv({
      env: {
        STYLE: 'gemini,cloudflare,heuristic',
        GEMINI_API_KEY: 'gemini-key',
        CLOUDFLARE_ACCOUNT_ID: 'acct',
        CLOUDFLARE_API_TOKEN: 'token',
      },
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: frames,
    });

    const result = await chain.describe(request);

    expect(result.adapter).toBe('cloudflare');
    expect(result.degradedFrom).toEqual(['gemini']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logger).not.toHaveBeenCalled();
  });

  it('uses the first healthy adapter without calling the later ones', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ result: { response: JSON.stringify(answer) } }),
    );

    const chain = createStyleVisionChainFromEnv({
      env: {
        STYLE: 'cloudflare,gemini',
        CLOUDFLARE_ACCOUNT_ID: 'acct',
        CLOUDFLARE_API_TOKEN: 'token',
        GEMINI_API_KEY: 'gemini-key',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: frames,
    });

    const result = await chain.describe(request);

    expect(result.adapter).toBe('cloudflare');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads the injected env, not the real one', async () => {
    const before = process.env.STYLE;
    process.env.STYLE = 'cloudflare,gemini';
    try {
      const chain = createStyleVisionChainFromEnv({ env: {}, logger: vi.fn() });
      await expect(chain.describe(request)).resolves.toMatchObject({ adapter: 'heuristic' });
    } finally {
      if (before === undefined) delete process.env.STYLE;
      else process.env.STYLE = before;
    }
  });
});
