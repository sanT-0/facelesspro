/**
 * Workspace scoping for the video queries, over real Postgres.
 *
 * A video id is a UUID, but knowing it must not cross a workspace boundary. The
 * API route can only pass the workspace resolved from the key, so the select,
 * the guarded render and the retry are all filtered here.
 */

import { randomUUID } from 'node:crypto';

import { createAiVideoV3RequestSchema, scenePlanSchema } from '@facelesspro/contracts';
import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from './client';
import type { Database } from './client';
import { scene, video, workspace } from './schema';
import { beginRecaption, beginRedraw, beginRender, beginRetry, beginRevocal, findVideo } from './videos';

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

  it('beginRevocal moves scene text, request script and plan together', async () => {
    const plan = scenePlanSchema.parse({
      scenes: [
        {
          text: 'வணக்கம் நண்பர்களே.',
          imagePrompt: 'a teacher',
          motion: 'none',
          emphasis: [],
          startMs: 0,
          endMs: 1_200,
        },
        {
          text: 'Today fire!',
          imagePrompt: 'a fire',
          motion: 'none',
          emphasis: [],
          startMs: 1_200,
          endMs: 2_400,
        },
      ],
      adapter: 'heuristic',
      degradedFrom: [],
      totalMs: 2_400,
    });
    await db.update(video).set({ plan }).where(eq(video.id, completedId));
    await db.insert(scene).values([
      {
        video_id: completedId,
        idx: 0,
        text: 'வணக்கம் நண்பர்களே.',
        start_ms: 0,
        end_ms: 1_200,
      },
      { video_id: completedId, idx: 1, text: 'Today fire!', start_ms: 1_200, end_ms: 2_400 },
    ]);

    // Another workspace cannot edit this video's narration.
    expect(
      await beginRevocal(db, {
        workspaceId: strangerId,
        videoId: completedId,
        edits: [{ idx: 0, text: 'வேறு வரி' }],
      }),
    ).toEqual({ kind: 'not_found' });

    // The index must name a stored scene.
    expect(
      await beginRevocal(db, {
        workspaceId: ownerId,
        videoId: completedId,
        edits: [{ idx: 9, text: 'x' }],
      }),
    ).toEqual({ kind: 'scene_not_found', idx: 9 });

    // Re-sending the stored text is not a change and must not charge anyone.
    expect(
      await beginRevocal(db, {
        workspaceId: ownerId,
        videoId: completedId,
        edits: [{ idx: 0, text: '  வணக்கம் நண்பர்களே.  ' }],
      }),
    ).toEqual({ kind: 'unchanged' });

    const queued = await beginRevocal(db, {
      workspaceId: ownerId,
      videoId: completedId,
      edits: [
        { idx: 0, text: '  வேறு வரி  ' },
        { idx: 1, text: 'Today fire!' },
      ],
    });
    expect(queued).toMatchObject({
      kind: 'queued',
      video: {
        status: 'processing',
        step: 'create-vocal',
        error: null,
        revocal: { sceneIdxs: [0] },
      },
    });
    if (queued.kind !== 'queued') throw new Error('expected queued');
    // Only the actually changed scene moved; the untouched one stayed stored.
    expect(createAiVideoV3RequestSchema.parse(queued.video.request.body).script).toBe(
      'வேறு வரி Today fire!',
    );
    const storedScenes = await db
      .select()
      .from(scene)
      .where(eq(scene.video_id, completedId))
      .orderBy(asc(scene.idx));
    expect(storedScenes.map((row) => row.text)).toEqual(['வேறு வரி', 'Today fire!']);
    expect(scenePlanSchema.parse(queued.video.plan).scenes.map((row) => row.text)).toEqual([
      'வேறு வரி',
      'Today fire!',
    ]);

    // Only a completed video is re-narratable.
    expect(
      await beginRevocal(db, {
        workspaceId: ownerId,
        videoId: failedId,
        edits: [{ idx: 0, text: 'x' }],
      }),
    ).toEqual({ kind: 'conflict', status: 'failed' });
  });

  it('beginRecaption replaces the stored caption style on a completed captioned V3', async () => {
    // Another workspace cannot restyle it, even with the UUID.
    expect(
      await beginRecaption(db, {
        workspaceId: strangerId,
        videoId: completedId,
        templateId: 7,
      }),
    ).toEqual({ kind: 'not_found' });

    // A failed video is resumed through retry, not restyled mid-pipeline.
    expect(
      await beginRecaption(db, {
        workspaceId: ownerId,
        videoId: failedId,
        templateId: 7,
      }),
    ).toEqual({ kind: 'conflict', status: 'failed' });

    // Captions off means there is no track to rebuild.
    const off = await db
      .insert(video)
      .values({
        workspace_id: ownerId,
        kind: 'ai-video-v3',
        status: 'completed',
        step: null,
        request: {
          kind: 'ai-video-v3',
          body: { ...request, captions: false },
        },
      })
      .returning({ id: video.id });
    expect(
      await beginRecaption(db, {
        workspaceId: ownerId,
        videoId: off[0]!.id,
        spec: { emoji: true },
      }),
    ).toEqual({ kind: 'no_captions' });

    // A non-V3 video has no caption style in its request to replace.
    const other = await db
      .insert(video)
      .values({
        workspace_id: ownerId,
        kind: 'caption',
        status: 'completed',
        step: null,
        request: {
          kind: 'caption',
          body: { url: 'https://example.com/in.mp4' },
        },
      })
      .returning({ id: video.id });
    expect(
      await beginRecaption(db, { workspaceId: ownerId, videoId: other[0]!.id, templateId: 7 }),
    ).toEqual({ kind: 'no_captions' });

    const queued = await beginRecaption(db, {
      workspaceId: ownerId,
      videoId: completedId,
      templateId: 7,
      spec: { wordLimit: 2, emoji: false },
    });
    expect(queued).toMatchObject({
      kind: 'queued',
      video: {
        status: 'processing',
        step: 'create-captions',
        error: null,
      },
    });
    if (queued.kind !== 'queued') throw new Error('expected queued');
    const body = createAiVideoV3RequestSchema.parse(queued.video.request.body);
    expect(body.captionTemplateId).toBe(7);
    expect(body.captionSpec).toEqual({ wordLimit: 2, emoji: false });
    // The rest of the stored request survives the rewrite, so a later
    // re-narrate still finds the same script and art style.
    expect(body.script).toBe(request.script);
    expect(body.artStyleId).toBe(STYLE_ID);

    // Omitting `spec` clears the override — the template's own spec wins
    // again. Reset to completed so the second call reaches the transition.
    await db
      .update(video)
      .set({ status: 'completed', step: null })
      .where(eq(video.id, completedId));
    const cleared = await beginRecaption(db, {
      workspaceId: ownerId,
      videoId: completedId,
      templateId: 7,
    });
    if (cleared.kind !== 'queued') throw new Error('expected queued');
    const clearedBody = createAiVideoV3RequestSchema.parse(cleared.video.request.body);
    expect(clearedBody.captionTemplateId).toBe(7);
    expect(clearedBody.captionSpec).toBeUndefined();
  });
});
