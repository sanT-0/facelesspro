import { describe, expect, it, vi } from 'vitest';

import {
  createAiVideoV3RequestSchema,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import type { QueueRenderInput, QueueRenderResult } from './videos';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const BASE = 'http://api.test';
const RENDER_KEY = `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/render-1080p-30-standard.mp4`;
const WEBHOOK = 'https://hooks.example.com/facelesspro';

const body = createAiVideoV3RequestSchema.parse({
  artStyleId: STYLE_ID,
  script: 'வணக்கம் நண்பர்களே. Today fire!',
  captions: true,
  render: { resolution: 1080, frameRate: 30, format: 'standard' },
});

function row(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    id: VIDEO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'ai-video-v3',
    status: 'rendering',
    step: 'render',
    error: null,
    request: { kind: 'ai-video-v3', body },
    plan: null,
    webhook_url: null,
    duration_ms: 180_000,
    video_url: RENDER_KEY,
    editor_seen_at: null,
    created_at: '2026-11-05T08:00:00.000Z',
    updated_at: '2026-11-05T08:05:00.000Z',
    ...overrides,
  };
}

function appWith(
  queueRender: (input: QueueRenderInput) => Promise<QueueRenderResult>,
) {
  return createApp({
    probes: { db: async () => {}, queue: async () => {} },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [],
    readVideo: async () => null,
    queueRender,
    queueRetry: async () => ({ kind: 'not_found' as const }),
    publicBaseUrl: BASE,
  });
}

async function post(
  app: ReturnType<typeof createApp>,
  payload?: unknown,
): Promise<Response> {
  return app.request(`/v1/videos/${VIDEO_ID}/render`, {
    method: 'POST',
    ...(payload === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
  });
}

describe('POST /v1/videos/:id/render', () => {
  it('queues the requested 60 fps greenscreen profile and returns the rendering video', async () => {
    const queueRender = vi.fn(
      async (_input: QueueRenderInput): Promise<QueueRenderResult> => ({
        kind: 'queued',
        video: row({
          request: {
            kind: 'ai-video-v3',
            body: {
              ...body,
              render: { resolution: 2160, frameRate: 60, format: 'greenscreen' },
            },
          },
        }),
      }),
    );
    const response = await post(
      appWith(queueRender),
      { resolution: 2160, frameRate: 60, format: 'greenscreen' },
    );

    expect(response.status).toBe(202);
    expect(queueRender).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      render: { resolution: 2160, frameRate: 60, format: 'greenscreen' },
    });
    expect(await response.json()).toEqual({
      id: VIDEO_ID,
      kind: 'ai-video-v3',
      status: 'rendering',
      step: 'render',
      render: true,
      videoUrl: `${BASE}/files/${RENDER_KEY}`,
      durationMs: 180_000,
      error: null,
      editorUrl: `${BASE}/editor?id=${VIDEO_ID}`,
      createdAt: '2026-11-05T08:00:00.000Z',
      updatedAt: '2026-11-05T08:05:00.000Z',
    });
  });

  it('accepts no body as "render with the defaults"', async () => {
    const queueRender = vi.fn(
      async (_input: QueueRenderInput): Promise<QueueRenderResult> => ({
        kind: 'queued',
        video: row({
          request: {
            kind: 'ai-video-v3',
            body: {
              ...body,
              render: { resolution: 1080, frameRate: 30, format: 'standard' },
            },
          },
        }),
      }),
    );
    const response = await post(appWith(queueRender));

    expect(response.status).toBe(202);
    expect(queueRender).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      render: { resolution: 1080, frameRate: 30, format: 'standard' },
    });
  });

  it('persists a render-call webhook for later renders', async () => {
    const queueRender = vi.fn(
      async (_input: QueueRenderInput): Promise<QueueRenderResult> => ({
        kind: 'queued',
        video: row({ webhook_url: WEBHOOK }),
      }),
    );
    const response = await post(appWith(queueRender), { webhookUrl: WEBHOOK });

    expect(response.status).toBe(202);
    expect(queueRender).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      render: { resolution: 1080, frameRate: 30, format: 'standard' },
      webhookUrl: WEBHOOK,
    });
  });

  it.each(['processing', 'rendering', 'failed'] as const)(
    'refuses to render a video that is %s',
    async (status) => {
      const queueRender = vi.fn(
        async (_input: QueueRenderInput): Promise<QueueRenderResult> => ({
          kind: 'conflict',
          status,
        }),
      );
      const response = await post(appWith(queueRender), {});

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: 'conflict', message: `video is ${status}` },
      });
    },
  );

  it('answers 404 for an unknown id', async () => {
    const queueRender = vi.fn(
      async (_input: QueueRenderInput): Promise<QueueRenderResult> => ({
        kind: 'not_found',
      }),
    );
    const response = await post(appWith(queueRender), {});

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });
  });

  it('answers 400 for a malformed id without touching the queue', async () => {
    const queueRender = vi.fn(async (): Promise<QueueRenderResult> => ({ kind: 'not_found' }));
    const response = await appWith(queueRender).request('/v1/videos/nope/render', {
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'invalid_request', message: 'id must be a UUID', field: 'id' },
    });
    expect(queueRender).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const queueRender = vi.fn(async (): Promise<QueueRenderResult> => ({ kind: 'not_found' }));
    const response = await appWith(queueRender).request(
      `/v1/videos/${VIDEO_ID}/render`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'invalid_request', message: 'request body must be JSON' },
    });
    expect(queueRender).not.toHaveBeenCalled();
  });

  it.each([
    [{ frameRate: 24 }, 'frameRate'],
    [{ resolution: 720 }, 'resolution'],
    [{ format: 'portrait' }, 'format'],
    [{ webhookUrl: 'http://hooks.example.com/x' }, 'webhookUrl'],
    [{ unknown: true }, 'unknown'],
  ])('rejects %j naming %s', async (payload, field) => {
    const queueRender = vi.fn(async (): Promise<QueueRenderResult> => ({ kind: 'not_found' }));
    const response = await post(appWith(queueRender), payload);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_request', field },
    });
    expect(queueRender).not.toHaveBeenCalled();
  });
});
