import { describe, expect, it, vi } from 'vitest';

import type { NumericStyleProfile } from '@facelesspro/contracts';

import { UpstreamError } from '../../planner/http';
import { VisionResponseError } from './parse';
import {
  DEFAULT_CLOUDFLARE_VISION_MODEL,
  cloudflareVisionOptionsFromEnv,
  createCloudflareStyleVision,
} from './cloudflare';

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
  promptPrefix: 'flat 2d cartoon illustration, thick black outlines',
  line: { weight: 'thick', texture: 'clean' },
  shading: 'cel',
  background: 'simple gradient, low detail',
  composition: 'centered subject, eye-level, medium shot',
  characters: [{ id: 'hero', description: 'young man, red hoodie' }],
  typography: { present: false },
  negative: 'photo, 3d render, text, watermark',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const frames = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    path: `f${index}.png`,
    mimeType: 'image/jpeg' as const,
    data: `base64-${index}`,
  }));

const request = {
  framePaths: ['a.png', 'b.png', 'c.png'],
  numeric,
};

describe('cloudflareVisionOptionsFromEnv', () => {
  it('names every missing variable', () => {
    expect(() => cloudflareVisionOptionsFromEnv({})).toThrow(
      /missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN/,
    );
  });

  it('names only the variable that is absent', () => {
    expect(() =>
      cloudflareVisionOptionsFromEnv({ CLOUDFLARE_ACCOUNT_ID: 'acct' }),
    ).toThrow(/missing CLOUDFLARE_API_TOKEN/);
  });

  it('uses the default model and timeout, and honours overrides', () => {
    const defaults = cloudflareVisionOptionsFromEnv({
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'token',
    });
    expect(defaults.model).toBe(DEFAULT_CLOUDFLARE_VISION_MODEL);
    expect(defaults.timeoutMs).toBe(60_000);

    const overridden = cloudflareVisionOptionsFromEnv({
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'token',
      CLOUDFLARE_VISION_MODEL: '@cf/other/model',
      CLOUDFLARE_VISION_TIMEOUT_MS: '5000',
    });
    expect(overridden.model).toBe('@cf/other/model');
    expect(overridden.timeoutMs).toBe(5000);
  });
});

describe('createCloudflareStyleVision', () => {
  it('sends the account-scoped URL, bearer token and one image per frame', async () => {
    const fetchImpl = vi.fn(async () => json({ result: { response: JSON.stringify(answer) } }));
    const loadFrames = vi.fn(async () => frames(3));

    const vision = createCloudflareStyleVision({
      accountId: 'acct-1',
      apiToken: 'token-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames,
    });
    const result = await vision.describe(request);

    expect(vision.name).toBe('cloudflare');
    expect(result.adapter).toBe('cloudflare');
    expect(result.degradedFrom).toEqual([]);
    expect(result.medium).toBe('flat vector cartoon');
    expect(loadFrames).toHaveBeenCalledWith(request.framePaths);

    const [url, init] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/${DEFAULT_CLOUDFLARE_VISION_MODEL}`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
    const body = JSON.parse(String(init.body)) as {
      image: string[];
      prompt: string;
      max_tokens: number;
    };
    expect(body.image).toEqual(['base64-0', 'base64-1', 'base64-2']);
    expect(body.prompt).toContain('3 sampled frames');
    expect(body.max_tokens).toBe(1024);
  });

  it('accepts `result.description` from image-to-text models', async () => {
    const fetchImpl = async () => json({ result: { description: JSON.stringify(answer) } });
    const vision = createCloudflareStyleVision({
      accountId: 'acct',
      apiToken: 'token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    await expect(vision.describe(request)).resolves.toMatchObject({ adapter: 'cloudflare' });
  });

  it('fails permanently when the response carries no text', async () => {
    const fetchImpl = async () => json({ result: {} });
    const vision = createCloudflareStyleVision({
      accountId: 'acct',
      apiToken: 'token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    const error = await vision.describe(request).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).retryable).toBe(false);
    expect((error as UpstreamError).message).toContain('no text');
  });

  it('propagates a rate limit as retryable', async () => {
    const fetchImpl = async () => new Response('rate limited', { status: 429 });
    const vision = createCloudflareStyleVision({
      accountId: 'acct',
      apiToken: 'token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    const error = await vision.describe(request).catch((thrown: unknown) => thrown);
    expect((error as UpstreamError).retryable).toBe(true);
  });

  it('surfaces a bad answer as a response error, not an upstream failure', async () => {
    const fetchImpl = async () =>
      json({ result: { response: JSON.stringify({ ...answer, shading: 'anime' }) } });
    const vision = createCloudflareStyleVision({
      accountId: 'acct',
      apiToken: 'token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    const error = await vision.describe(request).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(VisionResponseError);
  });

  it('puts a model override in the URL', async () => {
    const fetchImpl = vi.fn(async () => json({ result: { response: JSON.stringify(answer) } }));
    const vision = createCloudflareStyleVision({
      accountId: 'acct',
      apiToken: 'token',
      model: '@cf/other/model',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    await vision.describe(request);

    const [url] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string];
    expect(url).toContain('/ai/run/@cf/other/model');
  });
});
