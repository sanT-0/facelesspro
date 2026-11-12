/**
 * `GET /v1/videos/:id` over real Postgres.
 *
 * The hermetic suite pins the wire contract; this drives the same route through
 * `findVideo`, so the select, the `videoRowSchema` parse and the timestamp
 * normalisation are observed rather than assumed.
 */

import { randomUUID } from 'node:crypto';

import {
  captionJsonExportSchema,
  createAiVideoV3RequestSchema,
  videoResponseSchema,
} from '@facelesspro/contracts';
import {
  asset,
  captionTrack,
  createDb,
  findVideo,
  listVideoScenes,
  narration,
  readVideoCaptions,
  readVideoNarrationKey,
  readVideoVoicePlan,
  readVideoWordTimings,
  scene,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const BASE = 'http://api.test';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';

let db: Database;
let pool: Pool;
let workspaceId: string;
let videoId: string;

const request = createAiVideoV3RequestSchema.parse({
  artStyleId: STYLE_ID,
  script: 'வணக்கம் நண்பர்களே. Today fire!',
  size: 'landscape',
  captions: true,
  render: { resolution: 1080, frameRate: 30, format: 'standard' },
});

function app(authWorkspaceId = workspaceId) {
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
    readVideo: (workspaceId, id) => findVideo(db, workspaceId, id),
    readVideoScenes: (workspaceId, id) => listVideoScenes(db, workspaceId, id),
    readVideoVoicePlan: (workspaceId, id) => readVideoVoicePlan(db, workspaceId, id),
    readVideoCaptions: (workspaceId, id) => readVideoCaptions(db, workspaceId, id),
    readVideoNarrationKey: (workspaceId, id) => readVideoNarrationKey(db, workspaceId, id),
    readVideoWordTimings: (workspaceId, id) => readVideoWordTimings(db, workspaceId, id),
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    ...testAuth(authWorkspaceId),
    createApiKey: async () => {
      throw new Error('api keys are not used in this suite');
    },
    listApiKeys: async () => [],
    revokeApiKey: async () => null,
    submitVideo: async () => {
      throw new Error("ai-videos-v3 is not used in this suite");
    },
    storeFile: async () => ({
      key: "test-key",
      bytes: 0,
      mime: "application/octet-stream",
    }),

    publicBaseUrl: BASE,
  }));
}

describe('GET /v1/videos/:id (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    await db.delete(video).where(eq(video.id, videoId));
    await db.delete(workspace).where(eq(workspace.id, workspaceId));
  });

  it('serves a completed render, its ISO timestamps and a public URL', async () => {
    const workspaces = await db
      .insert(workspace)
      .values({ name: `videos-api-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'completed',
        step: null,
        request: { kind: 'ai-video-v3', body: request },
        duration_ms: 2_400,
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    // The render key needs the generated id, so the row becomes completed here.
    await db
      .update(video)
      .set({
        video_url: `ws/${workspaceId}/videos/${videoId}/render-1080p-30-standard.mp4`,
      })
      .where(eq(video.id, videoId));

    const assets = await db
      .insert(asset)
      .values([
        {
          workspace_id: workspaceId,
          kind: 'image',
          key: `ws/${workspaceId}/images/first.png`,
          mime: 'image/png',
        },
        {
          workspace_id: workspaceId,
          kind: 'audio',
          key: `ws/${workspaceId}/audio/voice.mp3`,
          mime: 'audio/mpeg',
        },
      ])
      .returning({ id: asset.id });
    const imageAssetId = assets[0]!.id;
    const audioAssetId = assets[1]!.id;

    await db.insert(scene).values([
      {
        video_id: videoId,
        idx: 0,
        text: 'தமிழ் முதல் காட்சி',
        image_asset_id: imageAssetId,
        start_ms: 0,
        end_ms: 1_200,
      },
      {
        video_id: videoId,
        idx: 1,
        text: 'இரண்டாவது காட்சி',
        image_asset_id: null,
        start_ms: 1_200,
        end_ms: 2_400,
      },
    ]);

    const voicePlan = {
      script: 'வணக்கம் நண்பர்களே. Today fire!',
      spokenText: 'வணக்கம் நண்பர்களே. Today fire!',
      runs: [
        {
          text: 'வணக்கம் நண்பர்களே.',
          lang: 'ta' as const,
          voice: 'ta-IN-ValluvarNeural',
          script: 'tamil' as const,
        },
        {
          text: 'Today fire!',
          lang: 'en' as const,
          voice: 'en-IN-NeerjaNeural',
          script: 'latin' as const,
        },
      ],
      overrides: [],
      pair: null,
    };
    await db.insert(narration).values({
      video_id: videoId,
      asset_id: audioAssetId,
      duration_ms: 2_400,
      word_timings: [{ text: 'வணக்கம்', start_ms: 0, end_ms: 400 }],
      voice_plan: voicePlan,
    });

    await db.insert(captionTrack).values({
      video_id: videoId,
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
    });

    const response = await app().request(`/v1/videos/${videoId}`);
    expect(response.status).toBe(200);

    const body = videoResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      id: videoId,
      kind: 'ai-video-v3',
      status: 'completed',
      step: null,
      render: true,
      durationMs: 2_400,
      error: null,
      videoUrl: `${BASE}/files/ws/${workspaceId}/videos/${videoId}/render-1080p-30-standard.mp4`,
      editorUrl: `${BASE}/editor?id=${videoId}`,
      narrationUrl: `${BASE}/files/ws/${workspaceId}/audio/voice.mp3`,
      scenes: [
        {
          id: expect.any(String),
          idx: 0,
          text: 'தமிழ் முதல் காட்சி',
          imageUrl: `${BASE}/files/ws/${workspaceId}/images/first.png`,
          startMs: 0,
          endMs: 1_200,
        },
        {
          id: expect.any(String),
          idx: 1,
          text: 'இரண்டாவது காட்சி',
          startMs: 1_200,
          endMs: 2_400,
        },
      ],
      voicePlan,
    });
    expect(body.createdAt.endsWith('Z')).toBe(true);
    expect(body.updatedAt.endsWith('Z')).toBe(true);

    const captions = await app().request(`/v1/videos/${videoId}/captions?format=json`);
    expect(captions.status).toBe(200);
    const document = captionJsonExportSchema.parse(await captions.json());
    expect(document.durationMs).toBe(1_200);
    expect(document.cues[0]?.lines).toEqual(['தமிழ் முதல் காட்சி']);

    const preview = await app().request(
      `/v1/videos/${videoId}/captions/preview`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec: { wordLimit: 2 } }),
      },
    );
    expect(preview.status).toBe(200);
    const previewed = captionJsonExportSchema.parse(await preview.json());
    expect(previewed.cues).toHaveLength(1);
    expect(previewed.cues[0]?.words.map((word) => word.text)).toEqual(['வணக்கம்']);
    expect(previewed.durationMs).toBe(400);

    const missing = await app().request(`/v1/videos/${randomUUID()}`);
    expect(missing.status).toBe(404);
  });

  it('answers 404 for a video owned by another workspace', async () => {
    const workspaces = await db
      .insert(workspace)
      .values({ name: `videos-api-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'ai-video-v3', body: request },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    const other = await db
      .insert(workspace)
      .values({ name: `videos-api-other-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    const otherId = other[0]!.id;
    try {
      const response = await app(otherId).request(`/v1/videos/${videoId}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: 'not_found', message: 'video not found' },
      });
    } finally {
      await db.delete(workspace).where(eq(workspace.id, otherId));
    }
  });
});
