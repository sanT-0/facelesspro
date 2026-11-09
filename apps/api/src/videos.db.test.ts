/**
 * `GET /v1/videos/:id` over real Postgres.
 *
 * The hermetic suite pins the wire contract; this drives the same route through
 * `findVideo`, so the select, the `videoRowSchema` parse and the timestamp
 * normalisation are observed rather than assumed.
 */

import { randomUUID } from 'node:crypto';

import {
  createAiVideoV3RequestSchema,
  videoResponseSchema,
} from '@facelesspro/contracts';
import { createDb, findVideo, video, workspace } from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app';

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

function app() {
  return createApp({
    probes: { db: async () => {}, queue: async () => {} },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [],
    readVideo: (id) => findVideo(db, id),
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    authenticateApiKey: async () => null,
    rateLimit: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
    createApiKey: async () => {
      throw new Error('api keys are not used in this suite');
    },
    listApiKeys: async () => [],
    revokeApiKey: async () => null,
    publicBaseUrl: BASE,
  });
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
    });
    expect(body.createdAt.endsWith('Z')).toBe(true);
    expect(body.updatedAt.endsWith('Z')).toBe(true);

    const missing = await app().request(`/v1/videos/${randomUUID()}`);
    expect(missing.status).toBe(404);
  });
});
