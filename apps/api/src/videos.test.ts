import { describe, expect, it, vi } from 'vitest';

import {
  createAiVideoV3RequestSchema,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';
import type { VideoArtifacts } from './video-response';

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
  readVideo: (workspaceId: string, id: string) => Promise<VideoRow | null>,
  publicBaseUrl = BASE,
  workspaceId = WORKSPACE_ID,
  artifacts: VideoArtifacts = {},
) {
  return testClient(createApp({
    probes: { db: async () => {}, queue: async () => {} },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [],
    findWorkspace: async () => null,
    listCreditLogs: async () => [],
    listVoices: async () => [],    listSoundEffects: async () => [],
    listBackgroundVideos: async () => [],    synthesizeTts: async () => ({
      audioUrl: "http://api.test/files/tts/abc.mp3",
      durationMs: 5000,
      voiceId: "edge:ta-IN-ValluvarNeural",
    }),


    listBalanceLogs: async () => [],
    readVideo,
    readVideoScenes: async () => artifacts.scenes ?? [],
    readVideoVoicePlan: async () => artifacts.voicePlan ?? null,
    readVideoCaptions: async () => null,
    readVideoNarrationKey: async () => artifacts.narrationKey ?? null,
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    ...testAuth(workspaceId),
    createApiKey: async () => {
      throw new Error('api keys are not used in this suite');
    },
    listApiKeys: async () => [],
    revokeApiKey: async () => null,
    submitVideo: async () => {
      throw new Error('ai-videos-v3 is not used in this suite');
    },
    storeFile: async () => ({
      key: 'test-key',
      bytes: 0,
      mime: 'application/octet-stream',
    }),
    publicBaseUrl,
  }));
}

describe('GET /v1/videos/:id', () => {
  it('answers 401 and never reads a video without a key', async () => {
    const readVideo = vi.fn(async () => row());
    const response = await appWith(readVideo).raw(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(readVideo).not.toHaveBeenCalled();
  });

  it('scopes the read to the authenticated workspace', async () => {
    const readVideo = vi.fn(async () => row());
    const response = await appWith(readVideo).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(200);
    expect(readVideo).toHaveBeenCalledWith(WORKSPACE_ID, VIDEO_ID);
  });

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

  it('returns scenes, the voice plan and the narration URL', async () => {
    const scene = (idx: number, imageAssetId: string | null) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${idx}`,
      video_id: VIDEO_ID,
      idx,
      text: idx === 0 ? 'தமிழ் முதல் காட்சி' : 'இரண்டாவது காட்சி',
      image_asset_id: imageAssetId,
      motion: {},
      start_ms: idx * 5_000,
      end_ms: (idx + 1) * 5_000,
    });

    const response = await appWith(async () => row(), BASE, WORKSPACE_ID, {
      scenes: [
        { scene: scene(0, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), imageKey: `ws/${WORKSPACE_ID}/images/one.png` },
        { scene: scene(1, null), imageKey: null },
      ],
      voicePlan: {
        script: 'வணக்கம் நண்பர்களே. Today fire!',
        spokenText: 'வணக்கம் நண்பர்களே. Today fire!',
        runs: [
          { text: 'வணக்கம் நண்பர்களே.', lang: 'ta', voice: 'ta-IN-ValluvarNeural', script: 'tamil' },
          { text: 'Today fire!', lang: 'en', voice: 'en-IN-NeerjaNeural', script: 'latin' },
        ],
        overrides: [],
        pair: null,
      },
      narrationKey: `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/audio/narration.mp3`,
    }).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as {
      scenes: unknown[];
      voicePlan: unknown;
      narrationUrl: unknown;
    };
    expect(parsed.scenes).toEqual([
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000',
        idx: 0,
        text: 'தமிழ் முதல் காட்சி',
        imageUrl: `${BASE}/files/ws/${WORKSPACE_ID}/images/one.png`,
        startMs: 0,
        endMs: 5_000,
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
        idx: 1,
        text: 'இரண்டாவது காட்சி',
        startMs: 5_000,
        endMs: 10_000,
      },
    ]);
    expect(parsed.voicePlan).toMatchObject({
      runs: [
        { text: 'வணக்கம் நண்பர்களே.', lang: 'ta' },
        { text: 'Today fire!', lang: 'en' },
      ],
    });
    expect(parsed.narrationUrl).toBe(
      `${BASE}/files/ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/audio/narration.mp3`,
    );
  });

  it('omits scenes, the voice plan and the narration URL until the steps commit', async () => {
    const response = await appWith(async () =>
      row({ status: 'processing', step: 'create-vocal', video_url: null, duration_ms: null }),
    ).request(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(200);
    const parsed = await response.json();
    expect(parsed).not.toHaveProperty('scenes');
    expect(parsed).not.toHaveProperty('voicePlan');
    expect(parsed).not.toHaveProperty('narrationUrl');
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
