import { describe, expect, it, vi } from 'vitest';

import type { ImageGenerationRequest, StyleProfile } from '@facelesspro/contracts';

import { UpstreamError } from '../planner/http';
import { IMAGE_NATIVE_DIMENSIONS } from './dimensions';
import {
  DEFAULT_POLLINATIONS_BASE_URL,
  DEFAULT_POLLINATIONS_IMAGE_MODEL,
  POLLINATIONS_IMAGE_CAPABILITIES,
  createPollinationsImageAdapter,
  pollinationsImageOptionsFromEnv,
} from './pollinations';

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
  prompt: 'flat vector scene, தமிழ் freelancer / desk? no text #clean',
  negativePrompt: style.negative,
  seed: 42,
  size: 'landscape',
  style,
};

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageResponse(
  bytes: Uint8Array = jpeg,
  contentType = 'image/jpeg',
  status = 200,
): Response {
  return new Response(bytes, {
    status,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
    },
  });
}

describe('pollinationsImageOptionsFromEnv', () => {
  it('names the now-required API key', () => {
    expect(() => pollinationsImageOptionsFromEnv({})).toThrow(
      /missing POLLINATIONS_API_KEY/,
    );
  });

  it('uses the current endpoint and seed-capable model by default', () => {
    expect(pollinationsImageOptionsFromEnv({ POLLINATIONS_API_KEY: 'sk_test' })).toEqual({
      baseUrl: DEFAULT_POLLINATIONS_BASE_URL,
      model: DEFAULT_POLLINATIONS_IMAGE_MODEL,
      timeoutMs: 120_000,
      apiKey: 'sk_test',
    });
  });

  it('honours key, endpoint, model and timeout overrides', () => {
    expect(
      pollinationsImageOptionsFromEnv({
        POLLINATIONS_API_KEY: '  sk_test  ',
        POLLINATIONS_BASE_URL: 'https://images.example.test/api/',
        POLLINATIONS_IMAGE_MODEL: ' custom/image ',
        POLLINATIONS_IMAGE_TIMEOUT_MS: '90000',
      }),
    ).toEqual({
      apiKey: 'sk_test',
      baseUrl: 'https://images.example.test/api',
      model: 'custom/image',
      timeoutMs: 90_000,
    });
  });

  it('rejects an insecure endpoint and invalid timeout', () => {
    expect(() =>
      pollinationsImageOptionsFromEnv({
        POLLINATIONS_API_KEY: 'sk_test',
        POLLINATIONS_BASE_URL: 'http://example.test',
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      pollinationsImageOptionsFromEnv({
        POLLINATIONS_API_KEY: 'sk_test',
        POLLINATIONS_IMAGE_TIMEOUT_MS: '1.5',
      }),
    ).toThrow(/timeout.*integer/i);
    expect(() =>
      pollinationsImageOptionsFromEnv({
        POLLINATIONS_API_KEY: 'sk_test',
        POLLINATIONS_IMAGE_TIMEOUT_MS: '0',
      }),
    ).toThrow(/timeout.*positive/i);
  });

  it('rejects the known watermarked legacy host even when explicitly configured', () => {
    expect(() =>
      pollinationsImageOptionsFromEnv({
        POLLINATIONS_API_KEY: 'sk_test',
        POLLINATIONS_BASE_URL: 'https://image.pollinations.ai/prompt',
      }),
    ).toThrow(/legacy.*watermark/i);
  });
});

describe('createPollinationsImageAdapter', () => {
  it('GETs the encoded final prompt with exact geometry and seed, then normalizes to PNG', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const normalize = vi.fn(async () => png);
    const adapter = createPollinationsImageAdapter({
      apiKey: 'sk_test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize,
    });

    const image = await adapter.draw(request);

    expect(adapter.name).toBe('pollinations');
    expect(adapter.capabilities).toEqual(POLLINATIONS_IMAGE_CAPABILITIES);
    expect(image).toMatchObject({
      adapter: 'pollinations',
      degradedFrom: [],
      mimeType: 'image/png',
      size: 'landscape',
      seed: 42,
      ...IMAGE_NATIVE_DIMENSIONS.landscape,
    });
    expect(Buffer.from(image.bytes)).toEqual(png);
    expect(normalize).toHaveBeenCalledWith(
      new Uint8Array(jpeg),
      IMAGE_NATIVE_DIMENSIONS.landscape,
    );

    const [rawUrl, init] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    const url = new URL(rawUrl);
    expect(url.origin).toBe('https://gen.pollinations.ai');
    expect(url.pathname).toBe(`/image/${encodeURIComponent(request.prompt)}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: DEFAULT_POLLINATIONS_IMAGE_MODEL,
      width: '1024',
      height: '576',
      seed: '42',
    });
    expect(init).toMatchObject({ method: 'GET' });
    expect(init.headers).toEqual({
      Accept: 'image/jpeg, image/png, image/webp',
      Authorization: 'Bearer sk_test',
    });
  });

  it('uses bearer auth and portrait geometry without putting the key in the URL', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const normalize = vi.fn(async () => png);
    const adapter = createPollinationsImageAdapter({
      apiKey: 'sk_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize,
    });

    const image = await adapter.draw({ ...request, size: 'portrait' });

    expect(image).toMatchObject({ size: 'portrait', ...IMAGE_NATIVE_DIMENSIONS.portrait });
    const [rawUrl, init] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    const url = new URL(rawUrl);
    expect(url.origin).toBe('https://gen.pollinations.ai');
    expect(url.pathname).toBe(`/image/${encodeURIComponent(request.prompt)}`);
    expect(url.searchParams.has('key')).toBe(false);
    expect(init.headers).toEqual({
      Accept: 'image/jpeg, image/png, image/webp',
      Authorization: 'Bearer sk_secret',
    });
    expect(url.searchParams.get('width')).toBe('576');
    expect(url.searchParams.get('height')).toBe('1024');
  });

  it('classifies rate limits and network failures as retryable', async () => {
    const rateLimited = createPollinationsImageAdapter({
      apiKey: 'sk_test',
      fetchImpl: (async () => new Response('slow down', { status: 429 })) as typeof fetch,
      normalize: async () => png,
    });
    const rateError = await rateLimited.draw(request).catch((thrown: unknown) => thrown);
    expect(rateError).toBeInstanceOf(UpstreamError);
    expect((rateError as UpstreamError).status).toBe(429);
    expect((rateError as UpstreamError).retryable).toBe(true);

    const offline = createPollinationsImageAdapter({
      apiKey: 'sk_test',
      fetchImpl: (async () => {
        throw new Error('socket closed');
      }) as typeof fetch,
      normalize: async () => png,
    });
    const networkError = await offline.draw(request).catch((thrown: unknown) => thrown);
    expect(networkError).toBeInstanceOf(UpstreamError);
    expect((networkError as UpstreamError).retryable).toBe(true);
    expect((networkError as UpstreamError).message).toMatch(/socket closed/);
  });

  it('times out a response body as retryable', async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
          },
        });
        return new Response(body, { headers: { 'Content-Type': 'image/jpeg' } });
      },
    );
    const adapter = createPollinationsImageAdapter({
      apiKey: 'sk_test',
      timeoutMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize: async () => png,
    });

    const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).message).toMatch(/timed out after 1 ms/);
    expect((error as UpstreamError).retryable).toBe(true);
  });

  it('rejects auth errors, non-raster bodies and MIME/signature mismatches permanently', async () => {
    const responses = [
      new Response('auth required', { status: 401 }),
      imageResponse(Buffer.from('not an image'), 'application/json'),
      imageResponse(png, 'image/jpeg'),
    ];
    for (const response of responses) {
      const adapter = createPollinationsImageAdapter({
        apiKey: 'sk_test',
        fetchImpl: (async () => response) as typeof fetch,
        normalize: async () => png,
      });
      const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).retryable).toBe(false);
    }
  });

  it('bounds declared and streamed response bytes before normalization', async () => {
    for (const response of [
      new Response(jpeg, {
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '9' },
      }),
      new Response(Buffer.concat([jpeg, Buffer.alloc(5)]), {
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    ]) {
      const normalize = vi.fn(async () => png);
      const adapter = createPollinationsImageAdapter({
        apiKey: 'sk_test',
        maxResponseBytes: 8,
        fetchImpl: (async () => response) as typeof fetch,
        normalize,
      });
      const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).message).toMatch(/exceeds 8 bytes/);
      expect((error as UpstreamError).retryable).toBe(false);
      expect(normalize).not.toHaveBeenCalled();
    }
  });

  it('turns normalization failure or non-PNG output into a permanent failure', async () => {
    for (const normalize of [
      async () => Buffer.from('not-png'),
      async (): Promise<Uint8Array> => {
        throw new Error('ffmpeg unavailable');
      },
    ]) {
      const adapter = createPollinationsImageAdapter({
        apiKey: 'sk_test',
        fetchImpl: (async () => imageResponse()) as typeof fetch,
        normalize,
      });
      const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).message).toMatch(/normalization/i);
      expect((error as UpstreamError).retryable).toBe(false);
    }
  });

  it('validates the shared request before opening a socket', async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const adapter = createPollinationsImageAdapter({
      apiKey: 'sk_test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize: async () => png,
    });

    await expect(adapter.draw({ ...request, seed: 0 })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
