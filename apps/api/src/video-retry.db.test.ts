/**
 * `POST /v1/videos/:id/retry` over real Postgres + pg-boss.
 *
 * The hermetic suite pins the wire contract. This drives the route through
 * `beginRetry` + the real enqueue, so "the failed step is the only work
 * re-queued" and "a retry itself writes no ledger row" are observed rather than
 * assumed.
 */

import { randomUUID } from 'node:crypto';

import {
  createAiVideoV3RequestSchema,
  videoResponseSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import {
  createDb,
  creditLedger,
  databaseUrl,
  findVideo,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import {
  createBoss,
  queueFor,
  stopBoss,
} from '@facelesspro/queue';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';
import { createQueueRetry } from './video-queues';

const BASE = 'http://api.test';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';

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

function app(authWorkspaceId = workspaceId) {
  return testClient(createApp({
    probes: { db: async () => {}, queue: async () => {} },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [],
    readVideo: (workspaceId, id) => findVideo(db, workspaceId, id),
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: createQueueRetry(pool, async () => boss),
    ...testAuth(authWorkspaceId),
    createApiKey: async () => {
      throw new Error('api keys are not used in this suite');
    },
    listApiKeys: async () => [],
    revokeApiKey: async () => null,
    publicBaseUrl: BASE,
  }));
}

async function retry(): Promise<Response> {
  return app().request(`/v1/videos/${videoId}/retry`, { method: 'POST' });
}

async function stored() {
  return videoRowSchema.parse(
    (await db.select().from(video).where(eq(video.id, videoId)))[0],
  );
}

describe('POST /v1/videos/:id/retry (Postgres)', () => {
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
    await boss.purgeQueue(queueFor('create-images'));
    await boss.purgeQueue(queueFor('render'));
    const workspaces = await db
      .insert(workspace)
      .values({ name: `video-retry-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'failed',
        step: 'create-images',
        error: { code: 'upstream_failed', message: 'image provider timed out' },
        request: { kind: 'ai-video-v3', body: request },
        duration_ms: 2_400,
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;
  });

  afterEach(async () => {
    await boss.purgeQueue(queueFor('create-images'));
    await boss.purgeQueue(queueFor('render'));
    await db.delete(creditLedger).where(eq(creditLedger.video_id, videoId));
    await db.delete(video).where(eq(video.id, videoId));
    await db.delete(workspace).where(eq(workspace.id, workspaceId));
  });

  it('re-queues only the failed step, clears the error and charges nothing itself', async () => {
    const response = await retry();

    expect(response.status).toBe(202);
    expect(videoResponseSchema.parse(await response.json())).toMatchObject({
      id: videoId,
      status: 'processing',
      step: 'create-images',
      error: null,
      durationMs: 2_400,
    });

    const row = await stored();
    expect(row.status).toBe('processing');
    expect(row.step).toBe('create-images');
    expect(row.error).toBeNull();
    // The stored request is untouched: the retried step replays it.
    expect(row.request.body.render).toEqual(request.render);

    expect(await boss.getQueueSize(queueFor('create-images'))).toBe(1);
    const jobs = await boss.fetch(queueFor('create-images'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ videoId });
    expect(await boss.getQueueSize(queueFor('render'))).toBe(0);

    // A retry is a cursor move, not work: the resumed step owns its charge.
    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(ledger).toHaveLength(0);
  });

  it('returns a failed render to rendering and keeps the previous mp4', async () => {
    const renderKey = `ws/${workspaceId}/videos/${videoId}/render-1080p-30-standard.mp4`;
    await db
      .update(video)
      .set({
        step: 'render',
        video_url: renderKey,
      })
      .where(eq(video.id, videoId));

    const response = await retry();
    expect(response.status).toBe(202);
    expect(videoResponseSchema.parse(await response.json())).toMatchObject({
      status: 'rendering',
      step: 'render',
      error: null,
      videoUrl: `${BASE}/files/${renderKey}`,
    });

    expect((await stored()).status).toBe('rendering');
    expect(await boss.getQueueSize(queueFor('render'))).toBe(1);
    expect(await boss.getQueueSize(queueFor('create-images'))).toBe(0);
  });

  it('refuses a second retry while the resumed run is in flight', async () => {
    expect((await retry()).status).toBe(202);

    const response = await retry();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: 'video is processing' },
    });

    expect((await stored()).step).toBe('create-images');
    expect(await boss.getQueueSize(queueFor('create-images'))).toBe(1);
  });

  it('refuses a completed video and queues nothing', async () => {
    await db
      .update(video)
      .set({ status: 'completed', step: null, error: null })
      .where(eq(video.id, videoId));

    const response = await retry();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: 'video is completed' },
    });
    expect(await boss.getQueueSize(queueFor('create-images'))).toBe(0);
    expect(await boss.getQueueSize(queueFor('render'))).toBe(0);
  });

  it('answers 404 for an unknown id and queues nothing', async () => {
    const response = await app().request(`/v1/videos/${randomUUID()}/retry`, {
      method: 'POST',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'video not found' },
    });
    expect(await boss.getQueueSize(queueFor('create-images'))).toBe(0);
  });

  it('answers 404 for a video in another workspace and queues nothing', async () => {
    const other = await db
      .insert(workspace)
      .values({ name: `video-retry-other-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    const otherId = other[0]!.id;
    try {
      const response = await app(otherId).request(
        `/v1/videos/${videoId}/retry`,
        { method: 'POST' },
      );

      expect(response.status).toBe(404);
      expect(await boss.getQueueSize(queueFor('create-images'))).toBe(0);
      expect((await stored()).status).toBe('failed');
    } finally {
      await db.delete(workspace).where(eq(workspace.id, otherId));
    }
  });
});
