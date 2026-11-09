/**
 * `POST /v1/ai-videos-v3` — the create door.
 *
 * The route validates the shared request contract, resolves the art style
 * inside the caller's workspace, and hands one normalised body to the injected
 * submission dependency (row insert + `create-scenes` enqueue in one
 * transaction). Nothing expensive happens here.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorBodySchema,
  createVideoResponseSchema,
  type ArtStyleRow,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import type { SubmitVideo, SubmitVideoInput } from './ai-videos-v3';
import { testAuth, testClient } from './test-auth';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const BASE = 'http://api.test';
const WEBHOOK = 'https://hooks.example.com/facelesspro';

function styleRow(overrides: Partial<ArtStyleRow> = {}): ArtStyleRow {
  return {
    id: STYLE_ID,
    workspace_id: WORKSPACE_ID,
    name: 'Tamil ink',
    published: false,
    formats: ['landscape', 'portrait'],
    profile: {},
    preview_url: 'style.png',
    portrait_preview_url: null,
    sample_video_urls: [],
    status: 'ready',
    created_at: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

function storedRow(input: SubmitVideoInput): VideoRow {
  return {
    id: VIDEO_ID,
    workspace_id: input.workspaceId,
    kind: 'ai-video-v3',
    status: 'processing',
    step: 'create-scenes',
    error: null,
    request: { kind: 'ai-video-v3', body: input.body },
    plan: null,
    webhook_url: input.body.body.webhookUrl ?? null,
    duration_ms: null,
    video_url: null,
    editor_seen_at: null,
    created_at: '2026-11-09T09:00:00.000Z',
    updated_at: '2026-11-09T09:00:00.000Z',
  };
}

function appWith(options: {
  submitVideo?: SubmitVideo;
  readArtStyle?: (workspaceId: string, id: string) => Promise<ArtStyleRow | null>;
} = {}) {
  return testClient(
    createApp({
      probes: { db: async () => {}, queue: async () => {} },
      storageRoot: '.data-test',
      submitArtStyle: async () => {},
      listArtStyles: async () => [],
      readArtStyle: options.readArtStyle ?? (async () => styleRow()),
      listCaptionTemplates: async () => [],
      findWorkspace: async () => null,
      listCreditLogs: async () => [],
      listBalanceLogs: async () => [],
      readVideo: async () => null,
      queueRender: async () => ({ kind: 'not_found' as const }),
      queueRetry: async () => ({ kind: 'not_found' as const }),
      submitVideo:
        options.submitVideo ?? (async (input) => storedRow(input)),
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

function post(
  app: ReturnType<typeof appWith>,
  payload: unknown,
): Promise<Response> {
  return app.request('/v1/ai-videos-v3', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

const scriptBody = {
  artStyleId: STYLE_ID,
  script: 'வணக்கம் நண்பர்களே. Today fire!',
};

async function errorBody(response: Response) {
  return apiErrorBodySchema.parse(await response.json());
}

describe('POST /v1/ai-videos-v3', () => {
  it('answers 401 without a key and never validates or stores anything', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const readArtStyle = vi.fn(async () => styleRow());

    const response = await appWith({ submitVideo, readArtStyle }).raw(
      '/v1/ai-videos-v3',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(scriptBody),
      },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(readArtStyle).not.toHaveBeenCalled();
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without touching the database', async () => {
    const readArtStyle = vi.fn(async () => styleRow());
    const response = await post(appWith({ readArtStyle }), '{not json');

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({
      error: { code: 'invalid_request', message: 'request body must be JSON' },
    });
    expect(readArtStyle).not.toHaveBeenCalled();
  });

  it('rejects an unknown request key and names it', async () => {
    const response = await post(appWith(), {
      ...scriptBody,
      surprise: true,
    });

    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('surprise');
  });

  it('requires exactly one of script and voiceoverUrl', async () => {
    const neither = await post(appWith(), { artStyleId: STYLE_ID });
    expect(neither.status).toBe(400);
    expect((await errorBody(neither)).error.field).toBe('script');

    const both = await post(appWith(), {
      ...scriptBody,
      voiceoverUrl: 'https://cdn.example.com/voice.mp3',
    });
    expect(both.status).toBe(400);
    expect((await errorBody(both)).error.field).toBe('voiceoverUrl');
  });

  it('answers 404 for an art style outside the caller workspace', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const response = await post(
      appWith({
        submitVideo,
        readArtStyle: async () => null,
      }),
      scriptBody,
    );

    expect(response.status).toBe(404);
    expect(await errorBody(response)).toEqual({
      error: { code: 'not_found', message: 'art style not found' },
    });
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('refuses a style that is not ready', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const response = await post(
      appWith({
        submitVideo,
        readArtStyle: async () => styleRow({ status: 'building' }),
      }),
      scriptBody,
    );

    expect(response.status).toBe(409);
    expect(await errorBody(response)).toEqual({
      error: { code: 'conflict', message: 'art style is building' },
    });
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('refuses a style that does not support the requested size', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const response = await post(
      appWith({
        submitVideo,
        readArtStyle: async () => styleRow({ formats: ['landscape'] }),
      }),
      { ...scriptBody, size: 'portrait' },
    );

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({
      error: {
        code: 'invalid_request',
        message: 'art style does not support portrait',
        field: 'artStyleId',
      },
    });
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('refuses a script with no speakable words', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const response = await post(
      appWith({ submitVideo }),
      { artStyleId: STYLE_ID, script: '   ...   ' },
    );

    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.field).toBe('script');
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('stores the normalised body and returns 202 with the create response', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const readArtStyle = vi.fn(async () => styleRow());
    const response = await post(
      appWith({ submitVideo, readArtStyle }),
      scriptBody,
    );

    expect(response.status).toBe(202);
    expect(readArtStyle).toHaveBeenCalledWith(WORKSPACE_ID, STYLE_ID);

    const body = createVideoResponseSchema.parse(await response.json());
    expect(body).toEqual({
      id: VIDEO_ID,
      status: 'processing',
      render: false,
      createdAt: '2026-11-09T09:00:00.000Z',
      editorUrl: `${BASE}/editor?id=${VIDEO_ID}`,
    });

    expect(submitVideo).toHaveBeenCalledOnce();
    const submission = submitVideo.mock.calls[0]![0];
    expect(submission.workspaceId).toBe(WORKSPACE_ID);
    expect(submission.body.body).toEqual({
      artStyleId: STYLE_ID,
      script: scriptBody.script,
      size: 'landscape',
      speed: 'standard',
      voiceStyle: {
        stability: 50,
        similarityBoost: 75,
        style: 0,
        speed: 100,
      },
      captions: false,
      captionTemplateId: -1,
    });
  });

  it('keeps an explicit render request, webhook and portrait script', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const response = await post(
      appWith({ submitVideo }),
      {
        artStyleId: STYLE_ID,
        script: 'ஒரு சிறிய காட்சி.',
        size: 'portrait',
        render: { resolution: 2160, frameRate: 60, format: 'greenscreen' },
        webhookUrl: WEBHOOK,
      },
    );

    expect(response.status).toBe(202);
    const body = createVideoResponseSchema.parse(await response.json());
    expect(body.render).toBe(true);

    const submission = submitVideo.mock.calls[0]![0];
    expect(submission.body.body.render).toEqual({
      resolution: 2160,
      frameRate: 60,
      format: 'greenscreen',
    });
    expect(submission.body.body.webhookUrl).toBe(WEBHOOK);
    expect(submission.body.body.size).toBe('portrait');
  });

  it('accepts a voiceover instead of a script', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const response = await post(
      appWith({ submitVideo }),
      {
        artStyleId: STYLE_ID,
        voiceoverUrl: 'https://cdn.example.com/voice.m4a',
        voiceId: 'valluvar',
      },
    );

    expect(response.status).toBe(202);
    const submission = submitVideo.mock.calls[0]![0];
    expect(submission.body.body.script).toBeUndefined();
    expect(submission.body.body.voiceoverUrl).toBe(
      'https://cdn.example.com/voice.m4a',
    );
  });

  it('rejects an http webhook because the contract is https-only', async () => {
    const response = await post(appWith(), {
      ...scriptBody,
      webhookUrl: 'http://hooks.example.com/facelesspro',
    });

    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.field).toBe('webhookUrl');
  });
});
