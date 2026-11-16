/**
 * `POST /v1/videos/:id/captions/preview` — regroup stored word timings.
 *
 * The preview must agree with the track `create-captions` would write for the
 * same narration, so these tests pin the shared builder, the template/spec
 * override order and the Tamil rule, plus the fact that a preview reads and
 * writes nothing else.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  captionJsonExportSchema,
  createAiVideoV3RequestSchema,
  type CaptionTemplate,
  type VideoRow,
  type WordTiming,
} from '@facelesspro/contracts';
import {
  CAPTION_MAX_CHARS_PER_LINE,
  buildCaptionJsonDocument,
  buildCaptionTrack,
} from '@facelesspro/core';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const BASE = 'http://api.test';

const WORDS: WordTiming[] = [
  { text: 'தமிழ்', start_ms: 0, end_ms: 300 },
  { text: 'முதல்', start_ms: 300, end_ms: 600 },
  { text: 'காட்சி', start_ms: 600, end_ms: 900 },
  { text: 'fire!', start_ms: 900, end_ms: 1_200 },
  { text: 'இரண்டாவது', start_ms: 1_200, end_ms: 1_500 },
  { text: 'காட்சி', start_ms: 1_500, end_ms: 1_800 },
  { text: 'முடிந்தது.', start_ms: 1_800, end_ms: 2_100 },
];

const TEMPLATES: CaptionTemplate[] = [
  {
    id: -1,
    name: 'Built-in',
    spec: { fontFamily: 'Noto Sans Tamil', fontSize: 64 },
  },
  {
    id: 7,
    name: 'One word',
    spec: { wordLimit: 1, maxLines: 1 },
  },
];

function row(size: 'landscape' | 'portrait' = 'landscape'): VideoRow {
  const body = createAiVideoV3RequestSchema.parse({
    artStyleId: STYLE_ID,
    script: 'தமிழ் முதல் காட்சி fire!',
    size,
  });
  return {
    id: VIDEO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'ai-video-v3',
    status: 'processing',
    step: 'create-captions',
    error: null,
    request: { kind: 'ai-video-v3', body },
    plan: null,
    webhook_url: null,
    duration_ms: 2_100,
    video_url: null,
    editor_seen_at: null,
    created_at: '2026-11-05T08:00:00.000Z',
    updated_at: '2026-11-05T08:01:00.000Z',
  };
}

function appWith(options: {
  readonly video?: VideoRow | null;
  readonly words?: readonly WordTiming[] | null;
  readonly videoId?: string;
} = {}) {
  const readVideo = vi.fn(async () => options.video === undefined ? row() : options.video);
  const readVideoWordTimings = vi.fn(async () =>
    options.words === undefined ? WORDS : options.words
  );
  const client = testClient(createApp({
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
    readVideo,
    readVideoScenes: async () => [],
    readVideoVoicePlan: async () => null,
    readVideoNarrationKey: async () => null,
    readVideoWordTimings,
    readVideoCaptions: async () => null,
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    queueRedraw: async () => ({ kind: 'not_found' as const }),
    queueRevocal: async () => ({ kind: 'not_found' as const }),
    queueRecaption: async () => ({ kind: 'not_found' as const }),
    ...testAuth(options.videoId ?? WORKSPACE_ID),
    createApiKey: async () => {
      throw new Error('api keys are not used in this suite');
    },
    listApiKeys: async () => [],
    revokeApiKey: async () => null,
    submitVideo: async () => {
      throw new Error('ai-video-v3 is not used in this suite');
    },
    storeFile: async () => ({
      key: 'test-key',
      bytes: 0,
      mime: 'application/octet-stream',
    }),
    publicBaseUrl: BASE,
  }));
  return { client, readVideo, readVideoWordTimings };
}

function previewRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function expectedDocument(
  words: readonly WordTiming[],
  options: { wordLimit?: number; maxLines?: number; emoji?: boolean } = {},
) {
  return buildCaptionJsonDocument(
    buildCaptionTrack(
      words.map((word) => ({
        text: word.text,
        startMs: word.start_ms,
        endMs: word.end_ms,
      })),
      {
        ...options,
        maxCharsPerLine: CAPTION_MAX_CHARS_PER_LINE.landscape,
      },
    ),
  );
}

describe('POST /v1/videos/:id/captions/preview', () => {
  it('answers 401 and reads nothing without a key', async () => {
    const { client, readVideo, readVideoWordTimings } = appWith();

    const response = await client.raw(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({}),
    );

    expect(response.status).toBe(401);
    expect(readVideo).not.toHaveBeenCalled();
    expect(readVideoWordTimings).not.toHaveBeenCalled();
  });

  it('regroups the stored timings with the built-in template by default', async () => {
    const { client } = appWith();

    const response = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({}),
    );

    expect(response.status).toBe(200);
    const document = captionJsonExportSchema.parse(await response.json());
    expect(document).toEqual(expectedDocument(WORDS));
    // Every spoken word survives in order, Tamil clusters whole.
    expect(document.cues.flatMap((cue) => cue.words.map((word) => word.text))).toEqual(
      WORDS.map((word) => word.text),
    );
  });

  it('merges a template then the request spec, request winning', async () => {
    const { client } = appWith();

    const templateOnly = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({ templateId: 7 }),
    );
    expect(templateOnly.status).toBe(200);
    const byTemplate = captionJsonExportSchema.parse(await templateOnly.json());
    expect(byTemplate.cues.every((cue) => cue.words.length === 1)).toBe(true);

    const overridden = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({ templateId: 7, spec: { wordLimit: 2, maxLines: 2 } }),
    );
    expect(overridden.status).toBe(200);
    const byOverride = captionJsonExportSchema.parse(await overridden.json());
    expect(byOverride.cues.every((cue) => cue.words.length <= 2)).toBe(true);
    expect(byOverride.cues.some((cue) => cue.words.length === 2)).toBe(true);
  });

  it('keeps a Tamil grapheme cluster inside one line when the limit is tight', async () => {
    const { client } = appWith();

    const response = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({ spec: { wordLimit: 2, maxLines: 2 } }),
    );
    expect(response.status).toBe(200);

    const document = captionJsonExportSchema.parse(await response.json());
    const spoken = document.cues.flatMap((cue) =>
      cue.lines.flatMap((line) => line.split(/\s+/)),
    );
    expect(spoken).toEqual(WORDS.map((word) => word.text));
  });

  it('decorates cues only when the spec asks for emoji', async () => {
    const { client } = appWith();

    const plain = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({}),
    );
    const decorated = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({ spec: { emoji: true } }),
    );

    expect(plain.status).toBe(200);
    expect(decorated.status).toBe(200);
    const plainDocument = captionJsonExportSchema.parse(await plain.json());
    const decoratedDocument = captionJsonExportSchema.parse(await decorated.json());

    expect(plainDocument.cues.every((cue) => cue.emoji === undefined)).toBe(true);
    expect(decoratedDocument.cues.some((cue) => cue.emoji === '🔥')).toBe(true);
    // Decoration is presentation, never a rewrite of the spoken text.
    expect(
      decoratedDocument.cues.flatMap((cue) => cue.words.map((word) => word.text)),
    ).toEqual(plainDocument.cues.flatMap((cue) => cue.words.map((word) => word.text)));
    expect(decoratedDocument).toEqual({ ...expectedDocument(WORDS, { emoji: true }) });
  });

  it('scopes both reads to the authenticated workspace', async () => {
    const { client, readVideo, readVideoWordTimings } = appWith();

    await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({}),
    );

    expect(readVideo).toHaveBeenCalledWith(WORKSPACE_ID, VIDEO_ID);
    expect(readVideoWordTimings).toHaveBeenCalledWith(WORKSPACE_ID, VIDEO_ID);
  });

  it('rejects an unknown template and a malformed spec', async () => {
    const { client } = appWith();

    const unknownTemplate = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({ templateId: 99 }),
    );
    expect(unknownTemplate.status).toBe(400);
    expect(await unknownTemplate.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'unknown caption template',
        field: 'templateId',
      },
    });

    const tooManyWords = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({ spec: { wordLimit: 11 } }),
    );
    expect(tooManyWords.status).toBe(400);
    const tooManyWordsBody = (await tooManyWords.json()) as {
      error: { code: string; field?: string };
    };
    expect(tooManyWordsBody.error.code).toBe('invalid_request');
    expect(tooManyWordsBody.error.field).toBe('spec.wordLimit');

    const unknownKey = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({ wordLimit: 2 }),
    );
    expect(unknownKey.status).toBe(400);
    expect(await unknownKey.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'Unrecognized key: "wordLimit"',
        field: 'wordLimit',
      },
    });
  });

  it('answers 400 for a bad body or a non-UUID id', async () => {
    const { client } = appWith();

    const badJson = await client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
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

    const badId = await client.request(
      '/v1/videos/not-a-uuid/captions/preview',
      previewRequest({}),
    );
    expect(badId.status).toBe(400);
    expect(await badId.json()).toEqual({
      error: { code: 'invalid_request', message: 'id must be a UUID', field: 'id' },
    });
  });

  it('answers 404 for an unknown video or before narration exists', async () => {
    const missingVideo = await appWith({ video: null }).client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({}),
    );
    expect(missingVideo.status).toBe(404);
    expect(await missingVideo.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });

    const missingWords = await appWith({ words: null }).client.request(
      `/v1/videos/${VIDEO_ID}/captions/preview`,
      previewRequest({}),
    );
    expect(missingWords.status).toBe(404);
    expect(await missingWords.json()).toEqual({
      error: { code: 'not_found', message: 'captions not available' },
    });
  });
});
