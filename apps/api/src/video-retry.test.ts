import { describe, expect, it, vi } from 'vitest';

import {
  createAiVideoV3RequestSchema,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import type { QueueRetryResult } from './videos';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const BASE = 'http://api.test';
const RENDER_KEY = `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/render-1080p-30-standard.mp4`;

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
    status: 'failed',
    step: 'create-images',
    error: { code: 'upstream_failed', message: 'image provider timed out' },
    request: { kind: 'ai-video-v3', body },
    plan: null,
    webhook_url: null,
    duration_ms: null,
    video_url: null,
    editor_seen_at: null,
    created_at: '2026-11-05T08:00:00.000Z',
    updated_at: '2026-11-05T08:03:00.000Z',
    ...overrides,
  };
}

function appWith(queueRetry: (videoId: string) => Promise<QueueRetryResult>) {
  return createApp({
    probes: { db: async () => {}, queue: async () => {} },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [],
    readVideo: async () => null,
    queueRender: async () => ({ kind: 'not_found' }),
    queueRetry,
    authenticateApiKey: async () => null,
    createApiKey: async () => {
      throw new Error('api keys are not used in this suite');
    },
    listApiKeys: async () => [],
    revokeApiKey: async () => null,
    publicBaseUrl: BASE,
  });
}

async function retry(app: ReturnType<typeof createApp>): Promise<Response> {
  return app.request(`/v1/videos/${VIDEO_ID}/retry`, { method: 'POST' });
}

describe('POST /v1/videos/:id/retry', () => {
  it('resumes a failed generation step and clears the error', async () => {
    const queueRetry = vi.fn(
      async (_id: string): Promise<QueueRetryResult> => ({
        kind: 'queued',
        step: 'create-images',
        video: row({ status: 'processing', error: null }),
      }),
    );
    const response = await retry(appWith(queueRetry));

    expect(response.status).toBe(202);
    expect(queueRetry).toHaveBeenCalledWith(VIDEO_ID);
    expect(await response.json()).toEqual({
      id: VIDEO_ID,
      kind: 'ai-video-v3',
      status: 'processing',
      step: 'create-images',
      render: true,
      error: null,
      editorUrl: `${BASE}/editor?id=${VIDEO_ID}`,
      createdAt: '2026-11-05T08:00:00.000Z',
      updatedAt: '2026-11-05T08:03:00.000Z',
    });
  });

  it('returns a failed render to rendering and keeps the old mp4 playable', async () => {
    const queueRetry = vi.fn(
      async (_id: string): Promise<QueueRetryResult> => ({
        kind: 'queued',
        step: 'render',
        video: row({
          status: 'rendering',
          step: 'render',
          error: null,
          duration_ms: 180_000,
          video_url: RENDER_KEY,
        }),
      }),
    );
    const response = await retry(appWith(queueRetry));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: 'rendering',
      step: 'render',
      error: null,
      durationMs: 180_000,
      videoUrl: `${BASE}/files/${RENDER_KEY}`,
    });
  });

  it.each([
    ['processing', 'processing'],
    ['rendering', 'rendering'],
    ['completed', 'completed'],
  ] as const)('refuses to retry a %s video', async (status, reported) => {
    const queueRetry = vi.fn(
      async (_id: string): Promise<QueueRetryResult> => ({
        kind: 'conflict',
        status,
      }),
    );
    const response = await retry(appWith(queueRetry));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: `video is ${reported}` },
    });
  });

  it('answers 404 for an unknown id', async () => {
    const queueRetry = vi.fn(
      async (_id: string): Promise<QueueRetryResult> => ({ kind: 'not_found' }),
    );
    const response = await retry(appWith(queueRetry));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });
  });

  it('answers 400 for a malformed id without touching the queue', async () => {
    const queueRetry = vi.fn(
      async (_id: string): Promise<QueueRetryResult> => ({ kind: 'not_found' }),
    );
    const response = await appWith(queueRetry).request('/v1/videos/nope/retry', {
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'invalid_request', message: 'id must be a UUID', field: 'id' },
    });
    expect(queueRetry).not.toHaveBeenCalled();
  });

  it('answers 500 when the resumed row does not match the video contract', async () => {
    const queueRetry = vi.fn(
      async (_id: string): Promise<QueueRetryResult> => ({
        kind: 'queued',
        step: 'create-images',
        video: { ...row(), status: 'done' } as unknown as VideoRow,
      }),
    );
    const response = await retry(appWith(queueRetry));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'stored video row is invalid' },
    });
  });
});
