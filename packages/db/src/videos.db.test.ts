/**
 * Workspace scoping for the video queries, over real Postgres.
 *
 * A video id is a UUID, but knowing it must not cross a workspace boundary. The
 * API route can only pass the workspace resolved from the key, so the select,
 * the guarded render and the retry are all filtered here.
 */

import { randomUUID } from 'node:crypto';

import { createAiVideoV3RequestSchema } from '@facelesspro/contracts';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from './client';
import type { Database } from './client';
import { scene, video, workspace } from './schema';
import { beginRedraw, beginRender, beginRetry, findVideo } from './videos';

const STYLE_ID = '33333333-3333-4333-8333-333333333333';

const request = createAiVideoV3RequestSchema.parse({
  artStyleId: STYLE_ID,
  script: 'வணக்கம் நண்பர்களே. Today fire!',
  size: 'landscape',
  captions: true,
  render: { resolution: 1080, frameRate: 30, format: 'standard' },
});

let db: Database;
let pool: Pool;
let ownerId: string;
let strangerId: string;
let completedId: string;
let failedId: string;

describe('video workspace scoping (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    const owners = await db
      .insert(workspace)
      .values({ name: `db-video-owner-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    ownerId = owners[0]!.id;
    const strangers = await db
      .insert(workspace)
      .values({ name: `db-video-stranger-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    strangerId = strangers[0]!.id;

    const completed = await db
      .insert(video)
      .values({
        workspace_id: ownerId,
        kind: 'ai-video-v3',
        status: 'completed',
        step: null,
        request: { kind: 'ai-video-v3', body: request },
        duration_ms: 2_400,
        video_url: 'ws/render.mp4',
      })
      .returning({ id: video.id });
    completedId = completed[0]!.id;

    const failed = await db
      .insert(video)
      .values({
        workspace_id: ownerId,
        kind: 'ai-video-v3',
        status: 'failed',
        step: 'create-images',
        error: { code: 'upstream_failed', message: 'timeout' },
        request: { kind: 'ai-video-v3', body: request },
      })
      .returning({ id: video.id });
    failedId = failed[0]!.id;
  });

  afterEach(async () => {
    await db.delete(video).where(eq(video.workspace_id, ownerId));
    await db.delete(workspace).where(eq(workspace.id, ownerId));
    await db.delete(workspace).where(eq(workspace.id, strangerId));
  });

  it('findVideo only returns a row to its workspace', async () => {
    expect(await findVideo(db, ownerId, completedId)).toMatchObject({
      id: completedId,
      workspace_id: ownerId,
    });
    expect(await findVideo(db, strangerId, completedId)).toBeNull();
  });

  it('beginRender cannot move another workspace video', async () => {
    const denied = await beginRender(db, {
      workspaceId: strangerId,
      videoId: completedId,
      render: { resolution: 1080, frameRate: 30, format: 'standard' },
    });
    expect(denied).toEqual({ kind: 'not_found' });

    const rows = await db.select().from(video).where(eq(video.id, completedId));
    expect(rows[0]?.status).toBe('completed');

    const allowed = await beginRender(db, {
      workspaceId: ownerId,
      videoId: completedId,
      render: { resolution: 1080, frameRate: 30, format: 'standard' },
    });
    expect(allowed.kind).toBe('queued');
  });

  it('beginRetry cannot resume another workspace video', async () => {
    expect(await beginRetry(db, strangerId, failedId)).toEqual({
      kind: 'not_found',
    });
    const rows = await db.select().from(video).where(eq(video.id, failedId));
    expect(rows[0]?.status).toBe('failed');

    const allowed = await beginRetry(db, ownerId, failedId);
    expect(allowed).toMatchObject({ kind: 'queued', step: 'create-images' });
  });

  it('beginRedraw is workspace-scoped, needs a real scene and only accepts completed', async () => {
    // Another workspace cannot mark a scene of this video, even with its UUID.
    expect(
      await beginRedraw(db, { workspaceId: strangerId, videoId: completedId, sceneIdx: 0 }),
    ).toEqual({ kind: 'not_found' });
    const denied = await db.select().from(video).where(eq(video.id, completedId));
    expect(denied[0]?.status).toBe('completed');
    expect(denied[0]?.redraw).toBeNull();

    // The index must name a stored scene, not just any integer.
    expect(
      await beginRedraw(db, { workspaceId: ownerId, videoId: completedId, sceneIdx: 0 }),
    ).toEqual({ kind: 'scene_not_found' });

    await db.insert(scene).values({
      video_id: completedId,
      idx: 0,
      text: 'வணக்கம் நண்பர்களே.',
      start_ms: 0,
      end_ms: 2_400,
    });

    const queued = await beginRedraw(db, {
      workspaceId: ownerId,
      videoId: completedId,
      sceneIdx: 0,
      prompt: 'warmer light',
    });
    expect(queued).toMatchObject({
      kind: 'queued',
      video: {
        status: 'processing',
        step: 'create-images',
        error: null,
        redraw: { sceneIdx: 0, prompt: 'warmer light' },
      },
    });

    // A failed video is resumed through retry, never by swapping one still.
    expect(
      await beginRedraw(db, { workspaceId: ownerId, videoId: failedId, sceneIdx: 0 }),
    ).toEqual({ kind: 'conflict', status: 'failed' });
  });
});
