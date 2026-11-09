import { describe, expect, it } from 'vitest';

import {
  createAiVideoV3RequestSchema,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const BASE = 'http://api.test';
const RENDER_KEY = `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/render-1080p-30-standard.mp4`;

const body = createAiVideoV3RequestSchema.parse({
  artStyleId: STYLE_ID,
  script: 'வணக்கம் நண்பர்களே. Today fire!',
  size: 'landscape',
  captions: true,
  render: { resolution: 1080, frameRate: 30, format: 'standard' },
});

function row(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    id: VIDEO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'ai-video-v3',
    status: 'completed',
    step: null,
    error: null,
    request: { kind: 'ai-video-v3', body },
    plan: null,
    webhook_url: null,
    duration_ms: 180_000,
    video_url: RENDER_KEY,
    editor_seen_at: null,
    created_at: '2026-11-05T08:00:00.000Z',
    updated_at: '2026-11-05T08:01:00.000Z',
    ...overrides,
  };
}

function appWith(
  readVideo: (id: string) => Promise<VideoRow | null>,
  publicBaseUrl = BASE,
) {
  return createApp({
    probes: { db: async () => {}, queue: async () => {} },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [],
    readVideo,
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    authenticateApiKey: async () => null,
    rateLimit: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
    createApiKey: async () => {
      throw new Error('api keys are not used in this suite');
    },
    listApiKeys: async () => [],
    revokeApiKey: async () => null,
    publicBaseUrl,
  });
}

describe('GET /v1/videos/:id', () => {
  it('returns the completed video with a public render URL and no error', async () => {
    const response = await appWith(async () => row()).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: VIDEO_ID,
      kind: 'ai-video-v3',
      status: 'completed',
      step: null,
      render: true,
      videoUrl: `${BASE}/files/${RENDER_KEY}`,
      durationMs: 180_000,
      error: null,
      editorUrl: `${BASE}/editor?id=${VIDEO_ID}`,
      createdAt: '2026-11-05T08:00:00.000Z',
      updatedAt: '2026-11-05T08:01:00.000Z',
    });
  });

  it('keeps a failed step as the resume point and returns its error', async () => {
    const response = await appWith(async () =>
      row({
        status: 'failed',
        step: 'create-images',
        error: { code: 'upstream_failed', message: 'image provider timed out' },
        video_url: null,
        duration_ms: null,
      }),
    ).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'failed',
      step: 'create-images',
      render: true,
      error: { code: 'upstream_failed', message: 'image provider timed out' },
    });
    expect(body).not.toHaveProperty('videoUrl');
    expect(body).not.toHaveProperty('durationMs');
    expect(body).not.toHaveProperty('scenes');
    expect(body).not.toHaveProperty('thumbnailUrl');
  });

  it('reports render:false for an editable project and hides an absent render', async () => {
    const editable = createAiVideoV3RequestSchema.parse({
      artStyleId: STYLE_ID,
      script: body.script,
      captions: false,
    });
    const response = await appWith(async () =>
      row({
        status: 'processing',
        step: 'create-captions',
        request: { kind: 'ai-video-v3', body: editable },
        video_url: null,
        duration_ms: null,
      }),
    ).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(200);
    const parsed = await response.json();
    expect(parsed).toMatchObject({ status: 'processing', step: 'create-captions', render: false });
    expect(parsed).not.toHaveProperty('videoUrl');
  });

  it('passes an absolute stored URL through and tolerates a trailing base slash', async () => {
    const response = await appWith(
      async () => row({ video_url: 'https://cdn.example.com/ws/videos/v/render.mp4' }),
      `${BASE}/`,
    ).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as {
      videoUrl: string;
      editorUrl: string;
    };
    expect(parsed.videoUrl).toBe('https://cdn.example.com/ws/videos/v/render.mp4');
    expect(parsed.editorUrl).toBe(`${BASE}/editor?id=${VIDEO_ID}`);
  });

  it('answers 404 for an unknown id', async () => {
    const response = await appWith(async () => null).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });
  });

  it('answers 400 and names the field when the id is not a UUID', async () => {
    const response = await appWith(async () => row()).request('/v1/videos/not-a-uuid');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'id must be a UUID',
        field: 'id',
      },
    });
  });

  it('answers 500 instead of publishing a completed video with no render', async () => {
    const response = await appWith(async () => row({ video_url: null })).request(
      `/v1/videos/${VIDEO_ID}`,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'completed video has no render' },
    });
  });

  it('answers 500 when a stored error is not the public error shape', async () => {
    const response = await appWith(async () =>
      row({ status: 'failed', error: { reason: 'boom' } }),
    ).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'stored video error is invalid' },
    });
  });

  it('answers 500 when the stored row does not match the video contract', async () => {
    const response = await appWith(async () =>
      ({ ...row(), status: 'done' }) as unknown as VideoRow,
    ).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'stored video row is invalid' },
    });
  });
});
