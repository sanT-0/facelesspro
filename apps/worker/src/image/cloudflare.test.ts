import { describe, expect, it, vi } from 'vitest';

import type { ImageGenerationRequest, StyleProfile } from '@facelesspro/contracts';

import { UpstreamError } from '../planner/http';
import {
  CLOUDFLARE_IMAGE_CAPABILITIES,
  DEFAULT_CLOUDFLARE_IMAGE_MODEL,
  cloudflareImageOptionsFromEnv,
  createCloudflareImageAdapter,
} from './cloudflare';
import { IMAGE_NATIVE_DIMENSIONS } from './dimensions';

const style: StyleProfile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene, bold geometric shapes',
  palette: { hex: ['#14213d', '#fca311', '#ffffff'], weights: [0.5, 0.3, 0.2] },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple background',
  composition: 'centred subject',
  characters: [],
  typography: { present: false },
  negative: 'photo, 3d render, text, watermark, logo, signature',
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
  prompt: 'flat vector scene, a freelancer at a desk, no text, no watermark',
  negativePrompt: style.negative,
  seed: 42,
  size: 'landscape',
  style,
};

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('cloudflareImageOptionsFromEnv', () => {
  it('names every missing credential', () => {
    expect(() => cloudflareImageOptionsFromEnv({})).toThrow(
      /missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN/,
    );
    expect(() =>
      cloudflareImageOptionsFromEnv({ CLOUDFLARE_ACCOUNT_ID: 'acct' }),
    ).toThrow(/missing CLOUDFLARE_API_TOKEN/);
  });

  it('uses documented defaults and honours model/step/timeout overrides', () => {
    const defaults = cloudflareImageOptionsFromEnv({
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'token',
    });
    expect(defaults).toMatchObject({
      model: DEFAULT_CLOUDFLARE_IMAGE_MODEL,
      steps: 4,
      timeoutMs: 120_000,
    });

    const overridden = cloudflareImageOptionsFromEnv({
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'token',
      CLOUDFLARE_IMAGE_MODEL: '@cf/other/image',
      CLOUDFLARE_IMAGE_STEPS: '8',
      CLOUDFLARE_IMAGE_TIMEOUT_MS: '90000',
    });
    expect(overridden).toMatchObject({ model: '@cf/other/image', steps: 8, timeoutMs: 90_000 });
  });

  it('rejects invalid step and timeout configuration', () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'token' };
    expect(() => cloudflareImageOptionsFromEnv({ ...env, CLOUDFLARE_IMAGE_STEPS: '0' })).toThrow(
      /steps.*1.*8/i,
    );
    expect(() => cloudflareImageOptionsFromEnv({ ...env, CLOUDFLARE_IMAGE_STEPS: '4.5' })).toThrow(
      /steps.*integer/i,
    );
    expect(() =>
      cloudflareImageOptionsFromEnv({ ...env, CLOUDFLARE_IMAGE_TIMEOUT_MS: '-1' }),
    ).toThrow(/timeout.*at least 1/i);
  });
});

describe('createCloudflareImageAdapter', () => {
  it('posts Flux prompt/seed/steps, then normalizes the JPEG into our PNG contract', async () => {
    const fetchImpl = vi.fn(async () => json({ result: { image: jpeg.toString('base64') } }));
    const normalize = vi.fn(async () => png);
    const adapter = createCloudflareImageAdapter({
      accountId: 'acct-1',
      apiToken: 'token-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize,
    });

    const image = await adapter.draw(request);

    expect(adapter.name).toBe('cloudflare');
    expect(adapter.capabilities).toEqual(CLOUDFLARE_IMAGE_CAPABILITIES);
    expect(image).toMatchObject({
      adapter: 'cloudflare',
      degradedFrom: [],
      mimeType: 'image/png',
      size: 'landscape',
      seed: 42,
      ...IMAGE_NATIVE_DIMENSIONS.landscape,
    });
    expect(Buffer.from(image.bytes)).toEqual(png);
    expect(normalize).toHaveBeenCalledWith(jpeg, IMAGE_NATIVE_DIMENSIONS.landscape);

    const [url, init] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/${DEFAULT_CLOUDFLARE_IMAGE_MODEL}`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
    expect(JSON.parse(String(init.body))).toEqual({ prompt: request.prompt, seed: 42, steps: 4 });
  });

  it('normalizes portrait output to the portrait native size', async () => {
    const normalize = vi.fn(async () => png);
    const adapter = createCloudflareImageAdapter({
      accountId: 'acct',
      apiToken: 'token',
      fetchImpl: (async () => json({ result: { image: jpeg.toString('base64') } })) as typeof fetch,
      normalize,
    });

    const image = await adapter.draw({ ...request, size: 'portrait' });

    expect(image).toMatchObject({ size: 'portrait', ...IMAGE_NATIVE_DIMENSIONS.portrait });
    expect(normalize).toHaveBeenCalledWith(jpeg, IMAGE_NATIVE_DIMENSIONS.portrait);
  });

  it('uses a model override in the account-scoped URL', async () => {
    const fetchImpl = vi.fn(async () => json({ result: { image: jpeg.toString('base64') } }));
    const adapter = createCloudflareImageAdapter({
      accountId: 'acct',
      apiToken: 'token',
      model: '@cf/other/image',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize: async () => png,
    });

    await adapter.draw(request);
    const [url] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string];
    expect(url).toContain('/ai/run/@cf/other/image');
  });

  it('treats a missing/invalid image envelope as a permanent provider failure', async () => {
    for (const image of [undefined, '', 'not base64!', Buffer.from('not-image').toString('base64')]) {
      const adapter = createCloudflareImageAdapter({
        accountId: 'acct',
        apiToken: 'token',
        fetchImpl: (async () =>
          json({ result: image === undefined ? {} : { image } })) as typeof fetch,
        normalize: async () => png,
      });

      const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).retryable).toBe(false);
    }
  });

  it('classifies HTTP 429 as retryable and never invokes the normalizer', async () => {
    const normalize = vi.fn(async () => png);
    const adapter = createCloudflareImageAdapter({
      accountId: 'acct',
      apiToken: 'token',
      fetchImpl: (async () => new Response('rate limited', { status: 429 })) as typeof fetch,
      normalize,
    });

    const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).retryable).toBe(true);
    expect(normalize).not.toHaveBeenCalled();
  });

  it('turns corrupt normalized output into a permanent adapter failure', async () => {
    const adapter = createCloudflareImageAdapter({
      accountId: 'acct',
      apiToken: 'token',
      fetchImpl: (async () => json({ result: { image: jpeg.toString('base64') } })) as typeof fetch,
      normalize: async () => Buffer.from('not-png'),
    });

    const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).message).toMatch(/normalization.*PNG/i);
    expect((error as UpstreamError).retryable).toBe(false);
  });
});
