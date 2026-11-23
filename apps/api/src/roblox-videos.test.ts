/**
 * `POST /v1/roblox-videos` — the Roblox Rant create door.
 *
 * A rant is a script plus a gameplay background, so this route only validates
 * the shared contract and hands one normalised body to the injected
 * `submitVideo` transaction. The documented defaults (pitch 140, six words per
 * caption, emoji on) must survive the round trip, because they are what the
 * worker reads.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorBodySchema,
  createVideoResponseSchema,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';
import type { SubmitVideo, SubmitVideoInput } from './video-submit';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const BASE = 'http://api.test';
const WEBHOOK = 'https://hooks.example.com/facelesspro';

function makeApp(submitVideo: SubmitVideo) {
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
    }),
  );
}

async function doPost(
  app: ReturnType<typeof makeApp>,
  payload: unknown,
): Promise<Response> {
  return app.request('/v1/roblox-videos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

async function getErrorBody(response: Response) {
  const text = await response.text();
  if (!text) throw new Error('empty response body');
  return apiErrorBodySchema.parse(JSON.parse(text));
}

function storedRow(input: SubmitVideoInput): VideoRow {
  return {
    id: VIDEO_ID,
    workspace_id: input.workspaceId,
    kind: 'roblox',
    status: 'processing',
    step: 'create-scenes',
    error: null,
    request: { kind: 'roblox', body: input.body.body },
    plan: null,
    redraw: null,
    revocal: null,
    webhook_url: input.body.body.webhookUrl ?? null,
    duration_ms: null,
    video_url: null,
    editor_seen_at: null,
    created_at: '2026-11-23T09:00:00.000Z',
    updated_at: '2026-11-23T09:00:00.000Z',
  };
}

describe('POST /v1/roblox-videos', () => {
  it('answers 401 without a key and never validates or stores anything', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const rawApp = makeApp(submitVideo);

    const response = await rawApp.raw('/v1/roblox-videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: 'this game is broken' }),
    });

    expect(response.status).toBe(401);
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('stores a rant with the documented defaults', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, { script: 'this game is broken' });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(
      createVideoResponseSchema.parse({
        id: VIDEO_ID,
        status: 'processing',
        render: false,
        createdAt: '2026-11-23T09:00:00.000Z',
        editorUrl: `${BASE}/editor?id=${VIDEO_ID}`,
      }),
    );
    expect(submitVideo).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      body: {
        kind: 'roblox',
        body: {
          script: 'this game is broken',
          voicePitch: 140,
          captionWordLimit: 6,
          autoAddEmoji: true,
        },
      },
    });
  });

  it('keeps an explicit voice, pitch, caption limit, emoji flag, background and render', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, {
      script: 'vanakkam makkale',
      voiceId: 'valluvar',
      voicePitch: 165,
      captionWordLimit: 3,
      autoAddEmoji: false,
      backgroundVideoId: 'minecraft-gameplay',
      backgroundVideoStartFrom: 12.5,
      render: { resolution: 1080, frameRate: 30, format: 'standard' },
      webhookUrl: WEBHOOK,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ render: true });
    expect(submitVideo).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      body: {
        kind: 'roblox',
        body: {
          script: 'vanakkam makkale',
          voiceId: 'valluvar',
          voicePitch: 165,
          captionWordLimit: 3,
          autoAddEmoji: false,
          backgroundVideoId: 'minecraft-gameplay',
          backgroundVideoStartFrom: 12.5,
          render: { resolution: 1080, frameRate: 30, format: 'standard' },
          webhookUrl: WEBHOOK,
        },
      },
    });
  });

  it.each([
    ['a missing script', { voicePitch: 140 }, 'script'],
    ['an empty script', { script: '' }, 'script'],
    ['a script over 5,000 characters', { script: 'x'.repeat(5_001) }, 'script'],
    ['a pitch below 50', { script: 'rant', voicePitch: 49 }, 'voicePitch'],
    ['a pitch above 180', { script: 'rant', voicePitch: 181 }, 'voicePitch'],
    ['a caption word limit of 0', { script: 'rant', captionWordLimit: 0 }, 'captionWordLimit'],
    ['a caption word limit of 11', { script: 'rant', captionWordLimit: 11 }, 'captionWordLimit'],
    ['an unknown field', { script: 'rant', imageStyle: 'CINEMATIC' }, 'imageStyle'],
  ])('rejects %s without storing', async (_label, payload, field) => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, payload);

    expect(response.status).toBe(400);
    expect(submitVideo).not.toHaveBeenCalled();
    const body = await getErrorBody(response);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe(field);
  });

  it('rejects a non-object body', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, 'not-an-object');

    expect(response.status).toBe(400);
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, '{not valid json}');

    expect(response.status).toBe(400);
    expect(submitVideo).not.toHaveBeenCalled();
    const body = await getErrorBody(response);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toBe('request body must be JSON');
  });
});
