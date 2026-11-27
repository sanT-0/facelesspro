/**
 * `POST /v1/ai-videos` — the V2 create door.
 *
 * V2's presets live in the worker, so this route only validates the shared
 * contract, refuses a wordless script and hands one normalised body to the
 * injected `submitVideo` transaction.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorBodySchema,
  createVideoResponseSchema,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient, NOW, WORKSPACE_ID } from './test-auth';
import type { SubmitVideo, SubmitVideoInput } from './video-submit';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const BASE = 'http://api.test';
const WEBHOOK = 'https://hooks.example.com/facelesspro';
const SCRIPT = 'வணக்கம் நண்பர்களே. Today fire!';

function storedRow(input: SubmitVideoInput): VideoRow {
  return {
    id: VIDEO_ID,
    workspace_id: input.workspaceId,
    kind: 'ai-video',
    status: 'processing',
    step: 'create-scenes',
    error: null,
    request: { kind: 'ai-video', body: input.body.body },
    plan: null,
    redraw: null,
    revocal: null,
    webhook_url: input.body.body.webhookUrl ?? null,
    duration_ms: null,
    video_url: null,
    editor_seen_at: null,
    created_at: '2026-11-17T09:00:00.000Z',
    updated_at: '2026-11-17T09:00:00.000Z',
  };
}

function appWith(submitVideo: SubmitVideo = async (input) => storedRow(input)) {
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
      listBalanceLogs: async () => [],
      topUpBalance: async () => ({ balance: 0, entry: { id: '', kind: 'topup', amountCents: 0, meta: null, createdAt: '' } }),
      readVideo: async () => null,
      readVideoScenes: async () => [],
      readVideoVoicePlan: async () => null,
      readVideoCaptions: async () => null,
      readVideoNarrationKey: async () => null,
      readVideoWordTimings: async () => null,
      queueRender: async () => ({ kind: 'not_found' as const }),
      queueRetry: async () => ({ kind: 'not_found' as const }),
      queueRedraw: async () => ({ kind: 'not_found' as const }),
      queueRevocal: async () => ({ kind: 'not_found' as const }),
      queueRecaption: async () => ({ kind: 'not_found' as const }),
      submitVideo,
      ...testAuth(WORKSPACE_ID),
      createApiKey: async () => {
        throw new Error('api keys are not used in this suite');
      },
      listApiKeys: async () => [],
      revokeApiKey: async () => null,
      storeFile: async () => ({
        key: 'test-key',
        bytes: 0,
        mime: 'application/octet-stream',
      }),
      listVoices: async () => [],
      listSoundEffects: async () => [],
      listBackgroundVideos: async () => [],
      synthesizeTts: async () => ({
        audioUrl: 'http://api.test/files/tts/abc.mp3',
        durationMs: 5000,
        voiceId: 'edge:ta-IN-ValluvarNeural',
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

function post(
  app: ReturnType<typeof appWith>,
  payload: unknown,
): Promise<Response> {
  return app.request('/v1/ai-videos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

async function errorBody(response: Response) {
  return apiErrorBodySchema.parse(await response.json());
}

describe('POST /v1/ai-videos', () => {
  it('answers 401 without a key and never validates or stores anything', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));

    const response = await appWith(submitVideo).raw('/v1/ai-videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: SCRIPT }),
    });

    expect(response.status).toBe(401);
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('stores a V2 request with the documented defaults', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));

    const response = await post(appWith(submitVideo), { script: SCRIPT });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(
      createVideoResponseSchema.parse({
        id: VIDEO_ID,
        status: 'processing',
        render: false,
        createdAt: '2026-11-17T09:00:00.000Z',
        editorUrl: `${BASE}/editor?id=${VIDEO_ID}`,
      }),
    );
    expect(submitVideo).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      body: {
        kind: 'ai-video',
        body: {
          script: SCRIPT,
          imageStyle: 'CREEPY_COMIC',
          size: 'portrait',
          transition: 'smooth',
          voiceStyle: { stability: 38, similarityBoost: 75, style: 50, speed: 100 },
        },
      },
    });
  });

  it('keeps an explicit style, transition, size, voice and render', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));

    const response = await post(appWith(submitVideo), {
      script: SCRIPT,
      imageStyle: 'CINEMATIC',
      size: 'landscape',
      transition: 'strong-swipe',
      voiceId: 'ta-IN-ValluvarNeural',
      render: { resolution: 1440, frameRate: 60, format: 'standard' },
      webhookUrl: WEBHOOK,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ render: true });
    expect(submitVideo).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      body: {
        kind: 'ai-video',
        body: {
          script: SCRIPT,
          imageStyle: 'CINEMATIC',
          size: 'landscape',
          transition: 'strong-swipe',
          voiceId: 'ta-IN-ValluvarNeural',
          voiceStyle: { stability: 38, similarityBoost: 75, style: 50, speed: 100 },
          render: { resolution: 1440, frameRate: 60, format: 'standard' },
          webhookUrl: WEBHOOK,
        },
      },
    });
  });

  it.each([
    ['an unknown image style', { script: SCRIPT, imageStyle: 'OIL_PAINT' }, 'imageStyle'],
    ['an unknown transition', { script: SCRIPT, transition: 'fade' }, 'transition'],
    ['an unknown key', { script: SCRIPT, artStyleId: 'x' }, 'artStyleId'],
    ['an empty script', { script: '' }, 'script'],
    ['a script above the V2 ceiling', { script: 'a'.repeat(10_001) }, 'script'],
    ['a non-string script', { script: 42 }, 'script'],
  ])('rejects %s without storing', async (_label, payload, field) => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));

    const response = await post(appWith(submitVideo), payload);

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toMatchObject({
      error: { code: 'invalid_request', field },
    });
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('rejects a wordless script and malformed JSON', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = appWith(submitVideo);

    const wordless = await post(app, { script: '   ...   ' });
    expect(wordless.status).toBe(400);
    expect(await errorBody(wordless)).toMatchObject({
      error: {
        code: 'invalid_request',
        message: 'script contains no words to speak',
        field: 'script',
      },
    });

    const malformed = await post(app, '{not json');
    expect(malformed.status).toBe(400);
    expect(await errorBody(malformed)).toEqual({
      error: { code: 'invalid_request', message: 'request body must be JSON' },
    });

    expect(submitVideo).not.toHaveBeenCalled();
  });
});
