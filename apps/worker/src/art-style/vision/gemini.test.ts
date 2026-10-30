import { describe, expect, it, vi } from 'vitest';

import type { NumericStyleProfile } from '@facelesspro/contracts';

import { UpstreamError } from '../../planner/http';
import {
  DEFAULT_GEMINI_VISION_MODEL,
  createGeminiStyleVision,
  geminiVisionOptionsFromEnv,
} from './gemini';
import { VisionResponseError } from './parse';

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
  characters: [],
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
  framePaths: ['a.png', 'b.png'],
  numeric,
};

const geminiResponse = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] } }],
});

describe('geminiVisionOptionsFromEnv', () => {
  it('names the missing key', () => {
    expect(() => geminiVisionOptionsFromEnv({})).toThrow(/missing GEMINI_API_KEY/);
  });

  it('uses the default model and timeout, and honours overrides', () => {
    const defaults = geminiVisionOptionsFromEnv({ GEMINI_API_KEY: 'key-1' });
    expect(defaults.model).toBe(DEFAULT_GEMINI_VISION_MODEL);
    expect(defaults.timeoutMs).toBe(60_000);

    const overridden = geminiVisionOptionsFromEnv({
      GEMINI_API_KEY: 'key-1',
      GEMINI_VISION_MODEL: 'gemini-2.5-flash',
      GEMINI_VISION_TIMEOUT_MS: '9000',
    });
    expect(overridden.model).toBe('gemini-2.5-flash');
    expect(overridden.timeoutMs).toBe(9000);
  });
});

describe('createGeminiStyleVision', () => {
  it('sends the API-key header, the prompt and one inline image per frame', async () => {
    const fetchImpl = vi.fn(async () => json(geminiResponse(JSON.stringify(answer))));
    const loadFrames = vi.fn(async () => frames(2));

    const vision = createGeminiStyleVision({
      apiKey: 'key-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames,
    });
    const result = await vision.describe(request);

    expect(vision.name).toBe('gemini');
    expect(result.adapter).toBe('gemini');
    expect(loadFrames).toHaveBeenCalledWith(request.framePaths);

    const [url, init] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_VISION_MODEL}:generateContent`,
    );
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('key-1');

    const body = JSON.parse(String(init.body)) as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      generationConfig: { responseMimeType: string };
    };
    const parts = body.contents[0]!.parts;
    expect(parts).toHaveLength(3);
    expect((parts[0] as { text: string }).text).toContain('2 sampled frames');
    expect(parts[1]).toEqual({
      inline_data: { mime_type: 'image/jpeg', data: 'base64-0' },
    });
    expect(parts[2]).toEqual({
      inline_data: { mime_type: 'image/jpeg', data: 'base64-1' },
    });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('joins text split across several parts', async () => {
    const raw = JSON.stringify(answer);
    const fetchImpl = async () =>
      json({
        candidates: [
          {
            content: {
              parts: [{ text: raw.slice(0, 20) }, { text: raw.slice(20) }],
            },
          },
        ],
      });
    const vision = createGeminiStyleVision({
      apiKey: 'key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    await expect(vision.describe(request)).resolves.toMatchObject({
      medium: 'flat vector cartoon',
    });
  });

  it('fails permanently when there is no candidate text', async () => {
    const fetchImpl = async () => json({ candidates: [] });
    const vision = createGeminiStyleVision({
      apiKey: 'key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    const error = await vision.describe(request).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).retryable).toBe(false);
  });

  it('propagates a server error as retryable', async () => {
    const fetchImpl = async () => new Response('boom', { status: 503 });
    const vision = createGeminiStyleVision({
      apiKey: 'key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    const error = await vision.describe(request).catch((thrown: unknown) => thrown);
    expect((error as UpstreamError).retryable).toBe(true);
  });

  it('rejects a bad answer as a response error', async () => {
    const fetchImpl = async () =>
      json(geminiResponse(JSON.stringify({ ...answer, typography: { present: true } })));
    const vision = createGeminiStyleVision({
      apiKey: 'key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    await expect(vision.describe(request)).rejects.toBeInstanceOf(VisionResponseError);
  });

  it('puts a model override in the URL', async () => {
    const fetchImpl = vi.fn(async () => json(geminiResponse(JSON.stringify(answer))));
    const vision = createGeminiStyleVision({
      apiKey: 'key',
      model: 'gemini-2.5-flash',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadFrames: async () => frames(1),
    });

    await vision.describe(request);

    const [url] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string];
    expect(url).toContain('/models/gemini-2.5-flash:generateContent');
  });
});
