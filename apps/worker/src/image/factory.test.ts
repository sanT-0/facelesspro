import { describe, expect, it, vi } from 'vitest';

import type { ImageGenerationRequest, StyleProfile } from '@facelesspro/contracts';

import { createImageChainFromEnv } from './factory';

const style: StyleProfile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene',
  palette: { hex: ['#14213d', '#fca311', '#ffffff'], weights: [0.5, 0.3, 0.2] },
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

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const imageResponse = () =>
  new Response(jpeg, {
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(jpeg.byteLength) },
  });

describe('createImageChainFromEnv', () => {
  it('uses the procedural floor when IMAGE is unset', async () => {
    const logger = vi.fn();
    const chain = createImageChainFromEnv({ env: {}, logger });

    const result = await chain.draw(request);

    expect(result.adapter).toBe('procedural');
    expect(result.degradedFrom).toEqual([]);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('IMAGE is not set'));
  });

  it('warns about unknown and duplicate names without running an adapter twice', () => {
    const logger = vi.fn();
    createImageChainFromEnv({
      env: { IMAGE: 'unknown,procedural,procedural' },
      logger,
    });

    const messages = logger.mock.calls.map((call) => String(call[0])).join('\n');
    expect(messages).toContain('unknown adapter "unknown"');
    expect(messages).toContain('duplicate adapter "procedural"');
  });

  it('skips unconfigured adapters, names every missing setting and does not call them degradation', async () => {
    const logger = vi.fn();
    const chain = createImageChainFromEnv({
      env: { IMAGE: 'cloudflare,pollinations,comfyui,procedural' },
      logger,
    });

    const result = await chain.draw(request);

    expect(result.adapter).toBe('procedural');
    expect(result.degradedFrom).toEqual([]);
    const messages = logger.mock.calls.map((call) => String(call[0])).join('\n');
    expect(messages).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(messages).toContain('CLOUDFLARE_API_TOKEN');
    expect(messages).toContain('POLLINATIONS_API_KEY');
    expect(messages).toContain('COMFYUI_WORKFLOW');
    expect(messages).toContain('COMFYUI_OUTPUT_NODE');
  });

  it('falls back to procedural when every requested adapter is unavailable', async () => {
    const logger = vi.fn();
    const chain = createImageChainFromEnv({ env: { IMAGE: 'cloudflare' }, logger });

    await expect(chain.draw(request)).resolves.toMatchObject({ adapter: 'procedural' });
    expect(logger).toHaveBeenLastCalledWith(
      expect.stringContaining('using the procedural image adapter'),
    );
  });

  it('preserves configured order and records only runtime failures', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('gen.pollinations.ai')) return new Response('busy', { status: 503 });
      if (url.includes('api.cloudflare.com')) {
        return json({ result: { image: jpeg.toString('base64') } });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const chain = createImageChainFromEnv({
      env: {
        IMAGE: 'pollinations,cloudflare,procedural',
        POLLINATIONS_API_KEY: 'pollinations-key',
        CLOUDFLARE_ACCOUNT_ID: 'account',
        CLOUDFLARE_API_TOKEN: 'cloudflare-key',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize: async () => png,
    });

    const result = await chain.draw(request);

    expect(result.adapter).toBe('cloudflare');
    expect(result.degradedFrom).toEqual(['pollinations']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops after the first healthy configured adapter', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('api.cloudflare.com')) {
        return json({ result: { image: jpeg.toString('base64') } });
      }
      return imageResponse();
    });
    const chain = createImageChainFromEnv({
      env: {
        IMAGE: 'cloudflare,pollinations',
        CLOUDFLARE_ACCOUNT_ID: 'account',
        CLOUDFLARE_API_TOKEN: 'cloudflare-key',
        POLLINATIONS_API_KEY: 'pollinations-key',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize: async () => png,
    });

    await expect(chain.draw(request)).resolves.toMatchObject({ adapter: 'cloudflare' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('constructs and runs ComfyUI from its env workflow configuration', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/prompt') return json({ prompt_id: 'job' });
      if (path === '/history/job') {
        return json({
          job: {
            status: { status_str: 'success', completed: true },
            outputs: { '9': { images: [{ filename: 'x.jpg', subfolder: '', type: 'output' }] } },
          },
        });
      }
      if (path === '/view') return imageResponse();
      throw new Error(`unexpected path ${path}`);
    });
    const chain = createImageChainFromEnv({
      env: {
        IMAGE: 'comfyui,procedural',
        COMFYUI_URL: 'http://127.0.0.1:8188',
        COMFYUI_WORKFLOW: 'fixtures/workflows/comfyui-sdxl-api.json',
        COMFYUI_OUTPUT_NODE: '9',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize: async () => png,
      comfyWait: async () => undefined,
    });

    const result = await chain.draw(request);

    expect(result.adapter).toBe('comfyui');
    expect(result.degradedFrom).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('reads only the injected environment', async () => {
    const before = process.env.IMAGE;
    process.env.IMAGE = 'cloudflare,pollinations';
    try {
      const chain = createImageChainFromEnv({ env: {}, logger: vi.fn() });
      await expect(chain.draw(request)).resolves.toMatchObject({ adapter: 'procedural' });
    } finally {
      if (before === undefined) delete process.env.IMAGE;
      else process.env.IMAGE = before;
    }
  });
});
