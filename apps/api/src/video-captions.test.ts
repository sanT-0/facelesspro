/**
 * `GET /v1/videos/:id/captions` — the stored cue track as a portable sidecar.
 *
 * The track is the same row `create-captions` persisted, so these tests pin the
 * serialization each format produces and the workspace scoping around it; the
 * exporter itself is already covered in `packages/core`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  captionJsonExportSchema,
  createAiVideoV3RequestSchema,
  type CaptionTrackRow,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const BASE = 'http://api.test';

const TRACK: CaptionTrackRow = {
  video_id: VIDEO_ID,
  template_id: -1,
  cues: [
    {
      startMs: 0,
      endMs: 1_200,
      lines: ['தமிழ் முதல் காட்சி'],
      words: [
        { text: 'தமிழ்', startMs: 0, endMs: 600 },
        { text: 'முதல்', startMs: 600, endMs: 900 },
        { text: 'காட்சி', startMs: 900, endMs: 1_200 },
      ],
    },
  ],
};

function row(size: 'landscape' | 'portrait' = 'landscape'): VideoRow {
  const body = createAiVideoV3RequestSchema.parse({
    artStyleId: STYLE_ID,
    script: 'தமிழ் முதல் காட்சி',
    size,
  });
  return {
    id: VIDEO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'ai-video-v3',
    status: 'processing',
    step: 'render',
    error: null,
    request: { kind: 'ai-video-v3', body },
    plan: null,
    webhook_url: null,
    duration_ms: 1_200,
    video_url: null,
    editor_seen_at: null,
    created_at: '2026-11-05T08:00:00.000Z',
    updated_at: '2026-11-05T08:01:00.000Z',
  };
}

function appWith(options: {
  readonly video?: VideoRow | null;
  readonly track?: CaptionTrackRow | null;
  readonly workspaceId?: string;
} = {}) {
  const readVideo = vi.fn(async () => options.video === undefined ? row() : options.video);
  const readVideoCaptions = vi.fn(async () =>
    options.track === undefined ? TRACK : options.track
  );
  const client = testClient(createApp({
    probes: { db: async () => {}, queue: async () => {} },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [
      {
        id: -1,
        name: 'Tamil',
        spec: { fontFamily: 'Noto Sans Tamil', fontSize: 64 },
      },
    ],
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
    readVideoWordTimings: async () => null,
    readVideoCaptions,
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    queueRedraw: async () => ({ kind: 'not_found' as const }),
    ...testAuth(options.workspaceId ?? WORKSPACE_ID),
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
  }));
  return { client, readVideo, readVideoCaptions };
}

describe('GET /v1/videos/:id/captions', () => {
  it('answers 401 and never reads the video without a key', async () => {
    const { client, readVideo, readVideoCaptions } = appWith();

    const response = await client.raw(`/v1/videos/${VIDEO_ID}/captions`);

    expect(response.status).toBe(401);
    expect(readVideo).not.toHaveBeenCalled();
    expect(readVideoCaptions).not.toHaveBeenCalled();
  });

  it('defaults to SRT with a sidecar content type', async () => {
    const { client } = appWith();

    const response = await client.request(`/v1/videos/${VIDEO_ID}/captions`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-subrip; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'inline; filename="captions.srt"',
    );
    const body = await response.text();
    expect(body).toContain('1\n00:00:00,000 --> 00:00:01,200');
    expect(body).toContain('தமிழ் முதல் காட்சி');
  });

  it('serializes VTT and the versioned JSON document', async () => {
    const { client } = appWith();

    const vtt = await client.request(`/v1/videos/${VIDEO_ID}/captions?format=vtt`);
    expect(vtt.status).toBe(200);
    expect(vtt.headers.get('content-type')).toBe('text/vtt; charset=utf-8');
    expect(await vtt.text()).toContain('00:00:00.000 --> 00:00:01.200');

    const json = await client.request(`/v1/videos/${VIDEO_ID}/captions?format=json`);
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const document = captionJsonExportSchema.parse(await json.json());
    expect(document.durationMs).toBe(1_200);
    expect(document.cues).toHaveLength(1);
    expect(document.cues[0]).toMatchObject({ index: 1, lines: ['தமிழ் முதல் காட்சி'] });
  });

  it('writes ASS on the 1080p landscape canvas with the stored template style', async () => {
    const { client } = appWith();

    const response = await client.request(`/v1/videos/${VIDEO_ID}/captions?format=ass`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/x-ssa; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('PlayResX: 1920');
    expect(body).toContain('PlayResY: 1080');
    expect(body).toContain('Noto Sans Tamil');
  });

  it('flips the ASS canvas for a portrait video', async () => {
    const { client } = appWith({ video: row('portrait') });

    const response = await client.request(`/v1/videos/${VIDEO_ID}/captions?format=ass`);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('PlayResX: 1080');
    expect(body).toContain('PlayResY: 1920');
  });

  it('scopes both reads to the authenticated workspace', async () => {
    const { client, readVideo, readVideoCaptions } = appWith();

    await client.request(`/v1/videos/${VIDEO_ID}/captions`);

    expect(readVideo).toHaveBeenCalledWith(WORKSPACE_ID, VIDEO_ID);
    expect(readVideoCaptions).toHaveBeenCalledWith(WORKSPACE_ID, VIDEO_ID);
  });

  it('rejects an unknown format and a non-UUID id', async () => {
    const { client } = appWith();

    const format = await client.request(`/v1/videos/${VIDEO_ID}/captions?format=txt`);
    expect(format.status).toBe(400);
    expect(await format.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'format must be srt, vtt, ass or json',
        field: 'format',
      },
    });

    const id = await client.request('/v1/videos/not-a-uuid/captions');
    expect(id.status).toBe(400);
    expect(await id.json()).toEqual({
      error: { code: 'invalid_request', message: 'id must be a UUID', field: 'id' },
    });
  });

  it('answers 404 for an unknown video or before captions exist', async () => {
    const missingVideo = await appWith({ video: null })
      .client.request(`/v1/videos/${VIDEO_ID}/captions`);
    expect(missingVideo.status).toBe(404);
    expect(await missingVideo.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });

    const missingTrack = await appWith({ track: null })
      .client.request(`/v1/videos/${VIDEO_ID}/captions`);
    expect(missingTrack.status).toBe(404);
    expect(await missingTrack.json()).toEqual({
      error: { code: 'not_found', message: 'captions not available' },
    });
  });

  it('answers 500 instead of serving an unreadable cue track', async () => {
    const corrupt = { ...TRACK, cues: [] } as unknown as CaptionTrackRow;
    const { client } = appWith({ track: corrupt });

    const response = await client.request(`/v1/videos/${VIDEO_ID}/captions`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'stored caption track is invalid' },
    });
  });
});
