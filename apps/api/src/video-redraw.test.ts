/**
 * `POST /v1/videos/:id/scenes/:idx/redraw` — one scene, then render.
 *
 * The queue dependency is a fake here: the route's job is to validate the
 * request, scope it to the authenticated workspace and translate the guarded
 * transition into 202/404/409. The transition itself is exercised against real
 * Postgres in `videos.db.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createAiVideoV3RequestSchema,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient, NOW, WORKSPACE_ID } from './test-auth';
import type { QueueRedrawInput, QueueRedrawResult } from './videos';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
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
    status: 'completed',
    step: null,
    error: null,
    request: { kind: 'ai-video-v3', body },
    plan: null,
    redraw: null,
    revocal: null,
    webhook_url: null,
    duration_ms: 180_000,
    video_url: RENDER_KEY,
    editor_seen_at: null,
    created_at: '2026-11-05T08:00:00.000Z',
    updated_at: '2026-11-05T08:03:00.000Z',
    ...overrides,
  };
}

function appWith(queueRedraw: (input: QueueRedrawInput) => Promise<QueueRedrawResult>) {
  return testClient(
    createApp({
      probes: { db: async () => {}, queue: async () => {} },
      storageRoot: '.data-test',
      submitArtStyle: async () => {},
      listArtStyles: async () => [],
      readArtStyle: async () => null,
      listCaptionTemplates: async () => [],
      findWorkspace: async () => null,
      listCreditLogs: async () => [],
      listVoices: async () => [],
      listSoundEffects: async () => [],
      listBackgroundVideos: async () => [],
      synthesizeTts: async () => ({
        audioUrl: 'http://api.test/files/tts/abc.mp3',
        durationMs: 5000,
        voiceId: 'edge:ta-IN-ValluvarNeural',
      }),
      listBalanceLogs: async () => [],
      readVideo: async () => null,
      readVideoScenes: async () => [],
      readVideoVoicePlan: async () => null,
      readVideoCaptions: async () => null,
      readVideoNarrationKey: async () => null,
      readVideoWordTimings: async () => null,
      queueRender: async () => ({ kind: 'not_found' }),
      queueRetry: async () => ({ kind: 'not_found' }),
      queueRedraw,
      queueRevocal: async () => ({ kind: 'not_found' as const }),
      queueRecaption: async () => ({ kind: 'not_found' as const }),
      ...testAuth(WORKSPACE_ID),
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
      publicBaseUrl: BASE,
      listMembers: async () => [],
      checkSeatLimit: async () => ({ limit: 10, current: 1, exceeded: false }),
      findUserByEmail: async () => null,
      createUser: async () => ({ id: "test-user", email: "test@test.com", name: "Test" }),
      addMember: async () => ({ id: "test-user", workspaceId: WORKSPACE_ID, userId: "test-user", email: "test@test.com", name: "Test", role: "editor", joinedAt: NOW.toISOString() }),
      updateMemberRole: async () => ({ id: "test-user", workspaceId: WORKSPACE_ID, userId: "test-user", email: "test@test.com", name: "Test", role: "editor", joinedAt: NOW.toISOString() }),
      removeMember: async () => {},
    }),
  );
}

function redraw(
  app: ReturnType<typeof appWith>,
  idx = '0',
  body?: unknown,
): Promise<Response> {
  return app.request(`/v1/videos/${VIDEO_ID}/scenes/${idx}/redraw`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
}

describe('POST /v1/videos/:id/scenes/:idx/redraw', () => {
  it('answers 401 without a key and never touches the queue', async () => {
    const queueRedraw = vi.fn(
      async (_input: QueueRedrawInput): Promise<QueueRedrawResult> => ({
        kind: 'not_found',
      }),
    );

    const response = await appWith(queueRedraw).raw(
      `/v1/videos/${VIDEO_ID}/scenes/0/redraw`,
      { method: 'POST' },
    );

    expect(response.status).toBe(401);
    expect(queueRedraw).not.toHaveBeenCalled();
  });

  it('queues scene 2 and returns the video in processing', async () => {
    const queueRedraw = vi.fn(
      async (_input: QueueRedrawInput): Promise<QueueRedrawResult> => ({
        kind: 'queued',
        video: row({
          status: 'processing',
          step: 'create-images',
          redraw: { sceneIdx: 2, prompt: 'warmer light' },
        }),
      }),
    );

    const response = await redraw(appWith(queueRedraw), '2', {
      prompt: 'warmer light',
    });

    expect(response.status).toBe(202);
    expect(queueRedraw).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      videoId: VIDEO_ID,
      sceneIdx: 2,
      prompt: 'warmer light',
    });
    expect(await response.json()).toMatchObject({
      id: VIDEO_ID,
      status: 'processing',
      step: 'create-images',
      error: null,
    });
  });

  it('accepts an empty body and sends no prompt', async () => {
    const queueRedraw = vi.fn(
      async (_input: QueueRedrawInput): Promise<QueueRedrawResult> => ({
        kind: 'queued',
        video: row({ status: 'processing', step: 'create-images' }),
      }),
    );

    const response = await redraw(appWith(queueRedraw), '0');

    expect(response.status).toBe(202);
    expect(queueRedraw).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      videoId: VIDEO_ID,
      sceneIdx: 0,
    });
  });

  it('rejects a malformed scene index without touching the queue', async () => {
    const queueRedraw = vi.fn(
      async (_input: QueueRedrawInput): Promise<QueueRedrawResult> => ({
        kind: 'not_found',
      }),
    );
    const app = appWith(queueRedraw);

    for (const idx of ['-1', '1.5', 'x', '01']) {
      const response = await redraw(app, idx);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: 'invalid_request',
          message: 'idx must be a non-negative integer',
          field: 'idx',
        },
      });
    }
    expect(queueRedraw).not.toHaveBeenCalled();
  });

  it('rejects a scene index that cannot fit the integer column', async () => {
    const queueRedraw = vi.fn(
      async (_input: QueueRedrawInput): Promise<QueueRedrawResult> => ({
        kind: 'not_found',
      }),
    );

    const response = await redraw(appWith(queueRedraw), '2147483648');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'idx must fit in a 32-bit integer',
        field: 'idx',
      },
    });
    expect(queueRedraw).not.toHaveBeenCalled();
  });

  it('rejects a blank or unknown-key body without touching the queue', async () => {
    const queueRedraw = vi.fn(
      async (_input: QueueRedrawInput): Promise<QueueRedrawResult> => ({
        kind: 'not_found',
      }),
    );
    const app = appWith(queueRedraw);

    const blank = await redraw(app, '0', { prompt: '   ' });
    expect(blank.status).toBe(400);
    expect((await blank.json()) as { error: { code: string; field?: string } }).toMatchObject({
      error: { code: 'invalid_request', field: 'prompt' },
    });

    const unknown = await redraw(app, '0', { sceneIdx: 1 });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()) as { error: { code: string; field?: string } }).toMatchObject({
      error: { code: 'invalid_request', field: 'sceneIdx' },
    });

    expect(queueRedraw).not.toHaveBeenCalled();
  });

  it('answers 400 for malformed JSON and a non-UUID id', async () => {
    const queueRedraw = vi.fn(
      async (_input: QueueRedrawInput): Promise<QueueRedrawResult> => ({
        kind: 'not_found',
      }),
    );
    const app = appWith(queueRedraw);

    const badJson = await app.request(
      `/v1/videos/${VIDEO_ID}/scenes/0/redraw`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      },
    );
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({
      error: { code: 'invalid_request', message: 'request body must be JSON' },
    });

    const badId = await app.request('/v1/videos/not-a-uuid/scenes/0/redraw', {
      method: 'POST',
    });
    expect(badId.status).toBe(400);
    expect(await badId.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'id must be a UUID',
        field: 'id',
      },
    });

    expect(queueRedraw).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown video or scene', async () => {
    const missingVideo = await redraw(
      appWith(async () => ({ kind: 'not_found' })),
      '0',
    );
    expect(missingVideo.status).toBe(404);
    expect(await missingVideo.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });

    const missingScene = await redraw(
      appWith(async () => ({ kind: 'scene_not_found' })),
      '99',
    );
    expect(missingScene.status).toBe(404);
    expect(await missingScene.json()).toEqual({
      error: { code: 'not_found', message: 'scene not found' },
    });
  });

  it.each([
    ['processing', 'processing'],
    ['rendering', 'rendering'],
    ['failed', 'failed'],
  ] as const)('refuses to redraw a %s video', async (status, reported) => {
    const response = await redraw(
      appWith(async () => ({ kind: 'conflict', status })),
      '0',
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: `video is ${reported}` },
    });
  });
});
