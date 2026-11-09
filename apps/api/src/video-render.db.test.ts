/**
 * `POST /v1/videos/:id/render` over real Postgres + pg-boss.
 *
 * The hermetic suite pins the wire contract and the guard. This drives the same
 * route through `beginRender` + `enqueueStep`, so the row lock, the request
 * rewrite the render step reads, the webhook persistence and the single queued
 * job are observed rather than assumed.
 */

import { randomUUID } from 'node:crypto';

import {
  createAiVideoV3RequestSchema,
  videoResponseSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import {
  createDb,
  databaseUrl,
  findVideo,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { createBoss, queueFor, stopBoss } from '@facelesspro/queue';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { createQueueRender } from './video-queues';

const BASE = 'http://api.test';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const WEBHOOK = 'https://hooks.example.com/facelesspro';

let db: Database;
let pool: Pool;
let boss: PgBoss;
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
    queueRender: createQueueRender(pool, async () => boss),
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

async function render(payload: Record<string, unknown> = {}): Promise<Response> {
  return app().request(`/v1/videos/${videoId}/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('POST /v1/videos/:id/render (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
    boss = await createBoss({
      connectionString: databaseUrl(),
      supervise: false,
      schedule: false,
    });
  });

  afterAll(async () => {
    await stopBoss(boss);
    await pool.end();
  });

  beforeEach(async () => {
    await boss.purgeQueue(queueFor('render'));
    const workspaces = await db
      .insert(workspace)
      .values({ name: `video-render-${randomUUID()}`, credits: null })
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
        video_url: `ws/${workspaceId}/videos/placeholder/render-1080p-30-standard.mp4`,
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    await db
      .update(video)
      .set({
        video_url: `ws/${workspaceId}/videos/${videoId}/render-1080p-30-standard.mp4`,
      })
      .where(eq(video.id, videoId));
  });

  afterEach(async () => {
    await boss.purgeQueue(queueFor('render'));
    await db.delete(video).where(eq(video.id, videoId));
    await db.delete(workspace).where(eq(workspace.id, workspaceId));
  });

  it('moves the completed video to rendering and queues exactly one job', async () => {
    const response = await render({
      resolution: 2160,
      frameRate: 60,
      format: 'greenscreen',
      webhookUrl: WEBHOOK,
    });

    expect(response.status).toBe(202);
    expect(videoResponseSchema.parse(await response.json())).toMatchObject({
      id: videoId,
      status: 'rendering',
      step: 'render',
      render: true,
      durationMs: 2_400,
      error: null,
      // A re-render keeps the previous MP4 playable until the step replaces it.
      videoUrl: `${BASE}/files/ws/${workspaceId}/videos/${videoId}/render-1080p-30-standard.mp4`,
    });

    const stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.status).toBe('rendering');
    expect(stored.step).toBe('render');
    expect(stored.error).toBeNull();
    expect(stored.webhook_url).toBe(WEBHOOK);
    expect(stored.request.body.render).toEqual({
      resolution: 2160,
      frameRate: 60,
      format: 'greenscreen',
    });
    // Everything else in the stored create request must survive the rewrite.
    expect(stored.request.body.script).toBe(request.script);
    expect(stored.request.body.artStyleId).toBe(STYLE_ID);

    expect(await boss.getQueueSize(queueFor('render'))).toBe(1);
    const jobs = await boss.fetch(queueFor('render'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ videoId });
  });

  it('refuses a second render while the first is in flight', async () => {
    expect((await render({ frameRate: 60 })).status).toBe(202);

    const response = await render({ frameRate: 30 });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: 'video is rendering' },
    });

    // The refused call changed neither the profile nor the queue.
    const stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.request.body.render).toMatchObject({ frameRate: 60 });
    expect(await boss.getQueueSize(queueFor('render'))).toBe(1);
  });

  it('refuses a failed video and leaves its resume step untouched', async () => {
    await db
      .update(video)
      .set({
        status: 'failed',
        step: 'create-images',
        error: { code: 'upstream_failed', message: 'image provider timed out' },
      })
      .where(eq(video.id, videoId));

    const response = await render({});
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: 'video is failed' },
    });

    const stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.status).toBe('failed');
    expect(stored.step).toBe('create-images');
    expect(stored.request.body.render).toEqual({
      resolution: 1080,
      frameRate: 30,
      format: 'standard',
    });
    expect(await boss.getQueueSize(queueFor('render'))).toBe(0);
  });

  it('answers 404 for an unknown id and queues nothing', async () => {
    const response = await app().request(`/v1/videos/${randomUUID()}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });
    expect(await boss.getQueueSize(queueFor('render'))).toBe(0);
  });
});
