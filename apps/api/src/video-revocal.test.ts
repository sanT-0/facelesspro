/**
 * `POST /v1/videos/:id/narration` — selective re-narrate of edited scene text.
 *
 * The queue dependency is a fake here: the route's job is to validate the
 * request, scope it to the authenticated workspace and translate the guarded
 * transition into 202/400/404/409. The transition itself is exercised against
 * real Postgres in `videos.db.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createAiVideoV3RequestSchema,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient, NOW, WORKSPACE_ID } from './test-auth';
import type { QueueRevocalInput, QueueRevocalResult } from './videos';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const BASE = 'http://api.test';

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
    video_url: null,
    editor_seen_at: null,
    created_at: '2026-11-05T08:00:00.000Z',
    updated_at: '2026-11-05T08:03:00.000Z',
    ...overrides,
  };
}

function appWith(
  queueRevocal: (input: QueueRevocalInput) => Promise<QueueRevocalResult>,
) {
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
      queueRedraw: async () => ({ kind: 'not_found' }),
      queueRevocal,
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

function renarrate(
  app: ReturnType<typeof appWith>,
  body?: unknown,
): Promise<Response> {
  return app.request(`/v1/videos/${VIDEO_ID}/narration`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
}

describe('POST /v1/videos/:id/narration', () => {
  it('answers 401 without a key and never touches the queue', async () => {
    const queueRevocal = vi.fn(
      async (_input: QueueRevocalInput): Promise<QueueRevocalResult> => ({
        kind: 'not_found',
      }),
    );

    const response = await appWith(queueRevocal).raw(
      `/v1/videos/${VIDEO_ID}/narration`,
      { method: 'POST' },
    );

    expect(response.status).toBe(401);
    expect(queueRevocal).not.toHaveBeenCalled();
  });

  it('queues only the changed scenes and returns the video in processing', async () => {
    const queueRevocal = vi.fn(
      async (_input: QueueRevocalInput): Promise<QueueRevocalResult> => ({
        kind: 'queued',
        video: row({
          status: 'processing',
          step: 'create-vocal',
          revocal: { sceneIdxs: [0, 2] },
        }),
      }),
    );

    const response = await renarrate(appWith(queueRevocal), {
      scenes: [
        { idx: 0, text: '  புதிய வரி  ' },
        { idx: 2, text: 'A new English line.' },
      ],
    });

    expect(response.status).toBe(202);
    expect(queueRevocal).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      videoId: VIDEO_ID,
      edits: [
        { idx: 0, text: 'புதிய வரி' },
        { idx: 2, text: 'A new English line.' },
      ],
    });
    expect(await response.json()).toMatchObject({
      id: VIDEO_ID,
      status: 'processing',
      step: 'create-vocal',
      error: null,
    });
  });

  it('rejects an empty, repeated or blank scene list without touching the queue', async () => {
    const queueRevocal = vi.fn(
      async (_input: QueueRevocalInput): Promise<QueueRevocalResult> => ({
        kind: 'not_found',
      }),
    );
    const app = appWith(queueRevocal);

    const empty = await renarrate(app, { scenes: [] });
    expect(empty.status).toBe(400);
    expect(
      (await empty.json()) as { error: { code: string; field?: string } },
    ).toMatchObject({ error: { code: 'invalid_request', field: 'scenes' } });

    const repeated = await renarrate(app, {
      scenes: [
        { idx: 1, text: 'one' },
        { idx: 1, text: 'two' },
      ],
    });
    expect(repeated.status).toBe(400);

    const blank = await renarrate(app, { scenes: [{ idx: 0, text: '   ' }] });
    expect(blank.status).toBe(400);

    const unknownKey = await renarrate(app, {
      scenes: [{ idx: 0, text: 'x', voice: 'en' }],
    });
    expect(unknownKey.status).toBe(400);

    expect(queueRevocal).not.toHaveBeenCalled();
  });

  it('answers 400 for malformed JSON and a non-UUID id', async () => {
    const queueRevocal = vi.fn(
      async (_input: QueueRevocalInput): Promise<QueueRevocalResult> => ({
        kind: 'not_found',
      }),
    );
    const app = appWith(queueRevocal);

    const badJson = await app.request(`/v1/videos/${VIDEO_ID}/narration`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({
      error: { code: 'invalid_request', message: 'request body must be JSON' },
    });

    const badId = await app.request('/v1/videos/not-a-uuid/narration', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenes: [{ idx: 0, text: 'x' }] }),
    });
    expect(badId.status).toBe(400);
    expect(await badId.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'id must be a UUID',
        field: 'id',
      },
    });

    expect(queueRevocal).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown video or scene', async () => {
    const missingVideo = await renarrate(
      appWith(async () => ({ kind: 'not_found' })),
      { scenes: [{ idx: 0, text: 'x' }] },
    );
    expect(missingVideo.status).toBe(404);
    expect(await missingVideo.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });

    const missingScene = await renarrate(
      appWith(async () => ({ kind: 'scene_not_found', idx: 99 })),
      { scenes: [{ idx: 99, text: 'x' }] },
    );
    expect(missingScene.status).toBe(404);
    expect(await missingScene.json()).toEqual({
      error: { code: 'not_found', message: 'scene 99 not found' },
    });
  });

  it('answers 400 when no submitted text actually changed', async () => {
    const response = await renarrate(
      appWith(async () => ({ kind: 'unchanged' })),
      { scenes: [{ idx: 0, text: 'same text' }] },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'no scene text changed',
        field: 'scenes',
      },
    });
  });

  it('answers 409 for an uploaded voiceover', async () => {
    const response = await renarrate(
      appWith(async () => ({ kind: 'voiceover' })),
      { scenes: [{ idx: 0, text: 'x' }] },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'conflict',
        message: 'video narration is an uploaded voiceover',
      },
    });
  });

  it('answers 409 for a video with no editable narration', async () => {
    const response = await renarrate(
      appWith(async () => ({ kind: 'not_narratable' })),
      { scenes: [{ idx: 0, text: 'x' }] },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'conflict',
        message: 'video has no editable narration',
      },
    });
  });

  it.each([
    ['processing', 'processing'],
    ['rendering', 'rendering'],
    ['failed', 'failed'],
  ] as const)('refuses to re-narrate a %s video', async (status, reported) => {
    const response = await renarrate(
      appWith(async () => ({ kind: 'conflict', status })),
      { scenes: [{ idx: 0, text: 'x' }] },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: `video is ${reported}` },
    });
  });

  it('answers 400 when the edited script no longer fits the request', async () => {
    const response = await renarrate(
      appWith(async () => ({
        kind: 'invalid_request',
        message: 'script is too long',
        field: 'scenes',
      })),
      { scenes: [{ idx: 0, text: 'x' }] },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'script is too long',
        field: 'scenes',
      },
    });
  });
});
