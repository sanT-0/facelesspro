/**
 * `POST /v1/videos/:id/captions` — save a caption style and rebuild.
 *
 * The queue dependency is a fake here: the route validates the body, verifies
 * an explicit template exists, and translates the guarded transition into
 * 202/400/404/409. The transition itself is exercised against real Postgres in
 * `videos.db.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createAiVideoV3RequestSchema,
  type CaptionTemplate,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient, NOW, WORKSPACE_ID } from './test-auth';
import type { QueueRecaptionInput, QueueRecaptionResult } from './videos';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const BASE = 'http://api.test';

const TEMPLATES: CaptionTemplate[] = [
  { id: -1, name: 'Built-in', spec: { fontFamily: 'Noto Sans Tamil' } },
  { id: 7, name: 'One word', spec: { wordLimit: 1 } },
];

const body = createAiVideoV3RequestSchema.parse({
  artStyleId: STYLE_ID,
  script: 'வணக்கம் நண்பர்களே. Today fire!',
  captions: true,
  captionTemplateId: -1,
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
    video_url: 'https://cdn.example.com/v.mp4',
    editor_seen_at: null,
    created_at: '2026-11-05T08:00:00.000Z',
    updated_at: '2026-11-05T08:03:00.000Z',
    ...overrides,
  };
}

function appWith(
  queueRecaption: (input: QueueRecaptionInput) => Promise<QueueRecaptionResult>,
) {
  return testClient(
    createApp({
      probes: { db: async () => {}, queue: async () => {} },
      storageRoot: '.data-test',
      submitArtStyle: async () => {},
      listArtStyles: async () => [],
      readArtStyle: async () => null,
      listCaptionTemplates: async () => TEMPLATES,
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
      topUpBalance: async () => ({ balance: 0, entry: { id: '', kind: 'topup', amountCents: 0, meta: null, createdAt: '' } }),

      readVideo: async () => null,
      readVideoScenes: async () => [],
      readVideoVoicePlan: async () => null,
      readVideoCaptions: async () => null,
      readVideoNarrationKey: async () => null,
      readVideoWordTimings: async () => null,
      queueRender: async () => ({ kind: 'not_found' }),
      queueRetry: async () => ({ kind: 'not_found' }),
      queueRedraw: async () => ({ kind: 'not_found' }),
      queueRevocal: async () => ({ kind: 'not_found' }),
      queueRecaption,
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

function recaption(
  app: ReturnType<typeof appWith>,
  body?: unknown,
): Promise<Response> {
  return app.request(`/v1/videos/${VIDEO_ID}/captions`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
}

describe('POST /v1/videos/:id/captions', () => {
  it('answers 401 without a key and never touches the queue', async () => {
    const queueRecaption = vi.fn(
      async (_input: QueueRecaptionInput): Promise<QueueRecaptionResult> => ({
        kind: 'not_found',
      }),
    );

    const response = await appWith(queueRecaption).raw(
      `/v1/videos/${VIDEO_ID}/captions`,
      { method: 'POST' },
    );

    expect(response.status).toBe(401);
    expect(queueRecaption).not.toHaveBeenCalled();
  });

  it('saves a template plus spec and returns the video in processing', async () => {
    const queueRecaption = vi.fn(
      async (_input: QueueRecaptionInput): Promise<QueueRecaptionResult> => ({
        kind: 'queued',
        video: row({ status: 'processing', step: 'create-captions' }),
      }),
    );

    const response = await recaption(appWith(queueRecaption), {
      templateId: 7,
      spec: { wordLimit: 2, emoji: true },
    });

    expect(response.status).toBe(202);
    expect(queueRecaption).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      videoId: VIDEO_ID,
      templateId: 7,
      spec: { wordLimit: 2, emoji: true },
    });
    expect(await response.json()).toMatchObject({
      id: VIDEO_ID,
      status: 'processing',
      step: 'create-captions',
      error: null,
    });
  });

  it('allows a spec-only change and omits an absent template', async () => {
    const queueRecaption = vi.fn(
      async (_input: QueueRecaptionInput): Promise<QueueRecaptionResult> => ({
        kind: 'queued',
        video: row({ status: 'processing', step: 'create-captions' }),
      }),
    );

    const response = await recaption(appWith(queueRecaption), {
      spec: { emoji: true },
    });

    expect(response.status).toBe(202);
    expect(queueRecaption).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      videoId: VIDEO_ID,
      spec: { emoji: true },
    });
  });

  it('rejects an empty, empty-spec or malformed body without queueing', async () => {
    const queueRecaption = vi.fn(
      async (_input: QueueRecaptionInput): Promise<QueueRecaptionResult> => ({
        kind: 'not_found',
      }),
    );
    const app = appWith(queueRecaption);

    for (const payload of [
      {},
      { spec: {} },
      { templateId: 7, font: 'Lato' },
      { spec: { wordLimit: 11 } },
    ]) {
      const response = await recaption(app, payload);
      expect(response.status).toBe(400);
      expect(
        (await response.json()) as { error: { code: string; field?: string } },
      ).toMatchObject({ error: { code: 'invalid_request' } });
    }

    expect(queueRecaption).not.toHaveBeenCalled();
  });

  it('rejects an unknown template before the transition', async () => {
    const queueRecaption = vi.fn(
      async (_input: QueueRecaptionInput): Promise<QueueRecaptionResult> => ({
        kind: 'not_found',
      }),
    );

    const response = await recaption(appWith(queueRecaption), { templateId: 99 });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'unknown caption template',
        field: 'templateId',
      },
    });
    expect(queueRecaption).not.toHaveBeenCalled();
  });

  it('answers 400 for malformed JSON and a non-UUID id', async () => {
    const queueRecaption = vi.fn(
      async (_input: QueueRecaptionInput): Promise<QueueRecaptionResult> => ({
        kind: 'not_found',
      }),
    );
    const app = appWith(queueRecaption);

    const badJson = await app.request(`/v1/videos/${VIDEO_ID}/captions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({
      error: { code: 'invalid_request', message: 'request body must be JSON' },
    });

    const badId = await app.request('/v1/videos/not-a-uuid/captions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 7 }),
    });
    expect(badId.status).toBe(400);
    expect(await badId.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'id must be a UUID',
        field: 'id',
      },
    });

    expect(queueRecaption).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown video', async () => {
    const response = await recaption(
      appWith(async () => ({ kind: 'not_found' })),
      { templateId: 7 },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });
  });

  it('answers 409 when the video has no captions', async () => {
    const response = await recaption(
      appWith(async () => ({ kind: 'no_captions' })),
      { spec: { emoji: true } },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: 'video has no captions' },
    });
  });

  it.each([
    ['processing', 'processing'],
    ['rendering', 'rendering'],
    ['failed', 'failed'],
  ] as const)('refuses to restyle a %s video', async (status, reported) => {
    const response = await recaption(
      appWith(async () => ({ kind: 'conflict', status })),
      { templateId: 7 },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: `video is ${reported}` },
    });
  });
});
