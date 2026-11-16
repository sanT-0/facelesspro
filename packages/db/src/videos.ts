/**
 * Read/write queries for the video pipeline.
 *
 * The api may not import `drizzle-orm` or `pg` (eslint enforces the boundary), so
 * API-facing queries live here and are injected into routes as plain functions.
 * The row is parsed through `videoRowSchema` on the way out: a cursor the rest of
 * the system does not understand must not reach a response.
 */

import {
  captionTrackRowSchema,
  createAiVideoV3RequestSchema,
  narrationPlanSchema,
  scenePlanSchema,
  sceneRowSchema,
  videoRowSchema,
  wordTimingSchema,
} from '@facelesspro/contracts';
import type {
  CaptionSpec,
  CaptionTrackRow,
  NarrationPlan,
  RenderOptions,
  SceneRow,
  VideoKind,
  VideoRequestRow,
  VideoRow,
  VideoStatus,
  VideoStep,
  WordTiming,
} from '@facelesspro/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { Database } from './client';
import { asset, captionTrack, narration, scene, video } from './schema';

/**
 * One video by id **inside a workspace**, whatever its status, so the route can
 * answer 404. The workspace is part of the lookup, not a post-fetch check: a
 * foreign id must be indistinguishable from a missing one.
 */
export async function findVideo(
  db: Database,
  workspaceId: string,
  id: string,
): Promise<VideoRow | null> {
  const rows = await db
    .select()
    .from(video)
    .where(and(eq(video.id, id), eq(video.workspace_id, workspaceId)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : videoRowSchema.parse(row);
}

/** One scene plus the storage key of its still, when the image step wrote one. */
export interface VideoSceneArtifact {
  readonly scene: SceneRow;
  readonly imageKey: string | null;
}

/**
 * Scenes for one video inside a workspace, in playback order.
 *
 * The workspace is part of the join rather than a post-fetch check, matching
 * `findVideo`: a foreign video id yields an empty list, never another
 * workspace's scenes.
 */
export async function listVideoScenes(
  db: Database,
  workspaceId: string,
  videoId: string,
): Promise<VideoSceneArtifact[]> {
  const rows = await db
    .select({ scene, imageKey: asset.key })
    .from(scene)
    .innerJoin(video, eq(video.id, scene.video_id))
    .leftJoin(asset, eq(asset.id, scene.image_asset_id))
    .where(and(eq(scene.video_id, videoId), eq(video.workspace_id, workspaceId)))
    .orderBy(scene.idx);

  return rows.map((row) => ({
    scene: sceneRowSchema.parse(row.scene),
    imageKey: row.imageKey ?? null,
  }));
}

/**
 * The stored narration plan (which runs went to Tamil vs English) for one video
 * inside a workspace, or `null` before `create-vocal` has committed.
 */
export async function readVideoVoicePlan(
  db: Database,
  workspaceId: string,
  videoId: string,
): Promise<NarrationPlan | null> {
  const rows = await db
    .select({ voicePlan: narration.voice_plan })
    .from(narration)
    .innerJoin(video, eq(video.id, narration.video_id))
    .where(
      and(eq(narration.video_id, videoId), eq(video.workspace_id, workspaceId)),
    )
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : narrationPlanSchema.parse(row.voicePlan);
}

/**
 * Storage key of one video's narration master, or `null` before
 * `create-vocal` has committed. The key is relative to `DATA_DIR`; the route
 * turns it into `<base>/files/<key>`. Workspace scoping is part of the join so
 * a foreign UUID is indistinguishable from a video without narration.
 */
export async function readVideoNarrationKey(
  db: Database,
  workspaceId: string,
  videoId: string,
): Promise<string | null> {
  const rows = await db
    .select({ key: asset.key })
    .from(narration)
    .innerJoin(video, eq(video.id, narration.video_id))
    .innerJoin(asset, eq(asset.id, narration.asset_id))
    .where(
      and(eq(narration.video_id, videoId), eq(video.workspace_id, workspaceId)),
    )
    .limit(1);

  return rows[0]?.key ?? null;
}

/**
 * The stored narration word timings for one video inside a workspace, or `null`
 * before `create-vocal` has committed. The preview route regroups exactly these
 * words, so a preview cannot disagree with the timings a render used.
 */
export async function readVideoWordTimings(
  db: Database,
  workspaceId: string,
  videoId: string,
): Promise<WordTiming[] | null> {
  const rows = await db
    .select({ timings: narration.word_timings })
    .from(narration)
    .innerJoin(video, eq(video.id, narration.video_id))
    .where(
      and(eq(narration.video_id, videoId), eq(video.workspace_id, workspaceId)),
    )
    .limit(1);

  const timings = rows[0]?.timings;
  return timings === undefined ? null : wordTimingSchema.array().parse(timings);
}

/**
 * The stored caption cue track for one video inside a workspace, or `null`
 * before `create-captions` has committed. One track per video, so the primary
 * key is the video id and there is nothing to order.
 */
export async function readVideoCaptions(
  db: Database,
  workspaceId: string,
  videoId: string,
): Promise<CaptionTrackRow | null> {
  const rows = await db
    .select({ templateId: captionTrack.template_id, cues: captionTrack.cues })
    .from(captionTrack)
    .innerJoin(video, eq(video.id, captionTrack.video_id))
    .where(
      and(eq(captionTrack.video_id, videoId), eq(video.workspace_id, workspaceId)),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  return captionTrackRowSchema.parse({
    video_id: videoId,
    template_id: row.templateId,
    cues: row.cues,
  });
}

export interface InsertVideoInput {
  readonly workspaceId: string;
  readonly kind: VideoKind;
  readonly status: VideoStatus;
  /** The step the first worker job will run. */
  readonly step: VideoStep;
  /** Normalised create request, stored for every later step and retry. */
  readonly request: VideoRequestRow;
  readonly webhookUrl?: string | null;
}

/**
 * Insert one video row and return the committed shape.
 *
 * Must run inside the transaction that also enqueues the first step: a row
 * whose job never landed is a video that looks `processing` forever. Timestamps
 * and the id come from Postgres, so the create response and a later read agree.
 */
export async function insertVideo(
  db: Database,
  input: InsertVideoInput,
): Promise<VideoRow> {
  const rows = await db
    .insert(video)
    .values({
      workspace_id: input.workspaceId,
      kind: input.kind,
      status: input.status,
      step: input.step,
      request: input.request,
      webhook_url: input.webhookUrl ?? null,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('video insert returned no row');
  return videoRowSchema.parse(row);
}

export interface BeginRenderInput {
  /** Scopes the guard; another workspace's id is `not_found`. */
  readonly workspaceId: string;
  readonly videoId: string;
  readonly render: RenderOptions;
  /** A render-call webhook replaces the stored one; omitted keeps it. */
  readonly webhookUrl?: string;
}

export type BeginRenderResult =
  /** The guarded transition landed; the caller must enqueue `render` in this tx. */
  | { readonly kind: 'queued'; readonly video: VideoRow }
  | { readonly kind: 'not_found' }
  /** Generation is not terminal, so the video is not renderable yet. */
  | { readonly kind: 'conflict'; readonly status: VideoStatus };

/**
 * Move a completed video back to `rendering`/`render`, replacing the profile
 * the render step reads from `video.request`.
 *
 * Must run inside the transaction that also enqueues the `render` job: the row
 * lock (`for update`) and the commit are what stop two concurrent render calls
 * from both passing the guard. A re-render keeps the old `video_url` until the
 * step writes the new one, so the client keeps a playable URL meanwhile.
 */
export async function beginRender(
  db: Database,
  input: BeginRenderInput,
): Promise<BeginRenderResult> {
  const rows = await db
    .select()
    .from(video)
    .where(
      and(eq(video.id, input.videoId), eq(video.workspace_id, input.workspaceId)),
    )
    .for('update');
  const row = rows[0];
  if (row === undefined) return { kind: 'not_found' };

  // `failed` is not renderable: retry resumes from `step` (docs/01 §2), and a
  // render started on a half-generated project would race the generation steps.
  if (row.status !== 'completed') return { kind: 'conflict', status: row.status };

  const stored = videoRowSchema.parse(row);
  const updated = await db
    .update(video)
    .set({
      status: 'rendering',
      step: 'render',
      error: null,
      request: {
        ...stored.request,
        body: { ...stored.request.body, render: input.render },
      },
      ...(input.webhookUrl === undefined ? {} : { webhook_url: input.webhookUrl }),
      updated_at: sql`now()`,
    })
    .where(
      and(eq(video.id, input.videoId), eq(video.workspace_id, input.workspaceId)),
    )
    .returning();

  const next = updated[0];
  if (next === undefined) throw new Error('render transition returned no row');
  return { kind: 'queued', video: videoRowSchema.parse(next) };
}

export type BeginRetryResult =
  /** The failed step is the resume point; the caller must enqueue it in this tx. */
  | { readonly kind: 'queued'; readonly video: VideoRow; readonly step: VideoStep }
  | { readonly kind: 'not_found' }
  /** Only `failed` is retryable at all. */
  | { readonly kind: 'conflict'; readonly status: VideoStatus };

/**
 * Resume a failed video at its recorded `step`.
 *
 * The failed step is the only work that re-runs: earlier steps already
 * committed their artifacts and ledger rows, and `withStep` drops a job whose
 * step the cursor has left. The transition writes no ledger row itself — the
 * resumed step charges once, in its own commit. A `render` failure returns to
 * `rendering`; every other step returns to `processing` (docs/01 §2).
 *
 * Must run inside the transaction that enqueues the step: the row lock is what
 * turns a double-click into one accepted retry and one `409`.
 */
export async function beginRetry(
  db: Database,
  workspaceId: string,
  videoId: string,
): Promise<BeginRetryResult> {
  const rows = await db
    .select()
    .from(video)
    .where(and(eq(video.id, videoId), eq(video.workspace_id, workspaceId)))
    .for('update');
  const row = rows[0];
  if (row === undefined) return { kind: 'not_found' };
  if (row.status !== 'failed' || row.step === null) {
    return { kind: 'conflict', status: row.status };
  }

  const step = row.step;
  const updated = await db
    .update(video)
    .set({
      status: step === 'render' ? 'rendering' : 'processing',
      error: null,
      updated_at: sql`now()`,
    })
    .where(and(eq(video.id, videoId), eq(video.workspace_id, workspaceId)))
    .returning();

  const next = updated[0];
  if (next === undefined) throw new Error('retry transition returned no row');
  return { kind: 'queued', video: videoRowSchema.parse(next), step };
}

export interface BeginRedrawInput {
  readonly workspaceId: string;
  readonly videoId: string;
  readonly sceneIdx: number;
  /** A nudge appended to the stored scene prompt. */
  readonly prompt?: string;
}

export type BeginRedrawResult =
  /** The marker is stored; the caller must enqueue `create-images` in this tx. */
  | { readonly kind: 'queued'; readonly video: VideoRow }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'scene_not_found' }
  /** Only a `completed` video is redrawable; in-flight work is not. */
  | { readonly kind: 'conflict'; readonly status: VideoStatus };

/**
 * Queue a one-scene redraw of a completed video.
 *
 * The marker lives on the video row (`video.redraw`) because a job payload is
 * only `{videoId}`. `create-images` regenerates exactly that scene, replaces the
 * still and the manifest entry, then moves straight to `render`; captions and
 * narration are untouched.
 *
 * Must run inside the transaction that enqueues the job: the row lock is what
 * turns two concurrent redraw clicks into one accepted request and one `409`.
 */
export async function beginRedraw(
  db: Database,
  input: BeginRedrawInput,
): Promise<BeginRedrawResult> {
  const rows = await db
    .select()
    .from(video)
    .where(
      and(eq(video.id, input.videoId), eq(video.workspace_id, input.workspaceId)),
    )
    .for('update');
  const row = rows[0];
  if (row === undefined) return { kind: 'not_found' };
  if (row.status !== 'completed') return { kind: 'conflict', status: row.status };

  const sceneRows = await db
    .select({ id: scene.id })
    .from(scene)
    .where(and(eq(scene.video_id, input.videoId), eq(scene.idx, input.sceneIdx)))
    .limit(1);
  if (sceneRows[0] === undefined) return { kind: 'scene_not_found' };

  const updated = await db
    .update(video)
    .set({
      status: 'processing',
      step: 'create-images',
      error: null,
      redraw: {
        sceneIdx: input.sceneIdx,
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      },
      updated_at: sql`now()`,
    })
    .where(
      and(eq(video.id, input.videoId), eq(video.workspace_id, input.workspaceId)),
    )
    .returning();

  const next = updated[0];
  if (next === undefined) throw new Error('redraw transition returned no row');
  return { kind: 'queued', video: videoRowSchema.parse(next) };
}

export interface BeginRevocalInput {
  readonly workspaceId: string;
  readonly videoId: string;
  /** Only the scenes whose text changed; the rest are cache hits. */
  readonly edits: readonly { readonly idx: number; readonly text: string }[];
}

export type BeginRevocalResult =
  /** Scene text, request script and plan are updated; enqueue `create-vocal`. */
  | { readonly kind: 'queued'; readonly video: VideoRow }
  | { readonly kind: 'not_found' }
  /** No scene row has that index. */
  | { readonly kind: 'scene_not_found'; readonly idx: number }
  /** Every submitted text already matches the stored one. */
  | { readonly kind: 'unchanged' }
  /** The narration is an uploaded voiceover, not TTS: text cannot change it. */
  | { readonly kind: 'voiceover' }
  /** The stored video has no editable scene narration (not an AI-video V3 project). */
  | { readonly kind: 'not_narratable' }
  | { readonly kind: 'conflict'; readonly status: VideoStatus }
  /** The edited script no longer fits the stored request (size ceiling). */
  | { readonly kind: 'invalid_request'; readonly message: string; readonly field: string };

/**
 * Replace the text of some scenes and queue `create-vocal`.
 *
 * Three stored facts must move together or the pipeline breaks:
 * - `scene.text` is what the step narrates;
 * - `video.request.body.script` must still equal `concat(scenes.text)`, which
 *   `create-vocal` re-checks before synthesising;
 * - `video.plan.scenes[i].text` must match the scene row, which `create-images`
 *   re-checks before a redraw.
 *
 * The `revocal` marker names the changed scenes so the step charges only their
 * characters. Must run inside the transaction that enqueues the job.
 */
export async function beginRevocal(
  db: Database,
  input: BeginRevocalInput,
): Promise<BeginRevocalResult> {
  const rows = await db
    .select()
    .from(video)
    .where(
      and(eq(video.id, input.videoId), eq(video.workspace_id, input.workspaceId)),
    )
    .for('update');
  const row = rows[0];
  if (row === undefined) return { kind: 'not_found' };
  if (row.status !== 'completed') return { kind: 'conflict', status: row.status };
  if (row.kind !== 'ai-video-v3') return { kind: 'not_narratable' };

  const stored = videoRowSchema.parse(row);
  const request = createAiVideoV3RequestSchema.safeParse(stored.request.body);
  if (!request.success) {
    throw new Error('stored V3 request does not match the request contract');
  }
  if (request.data.voiceoverUrl !== undefined) return { kind: 'voiceover' };

  const sceneRows = await db
    .select()
    .from(scene)
    .where(eq(scene.video_id, input.videoId))
    .orderBy(asc(scene.idx));
  if (sceneRows.length === 0) return { kind: 'not_narratable' };
  sceneRows.forEach((value, index) => {
    if (value.idx !== index) throw new Error(`scene row ${index} has index ${value.idx}`);
  });

  const byIdx = new Map(sceneRows.map((value) => [value.idx, value]));
  const edits = new Map<number, string>();
  for (const edit of input.edits) {
    const target = byIdx.get(edit.idx);
    if (target === undefined) return { kind: 'scene_not_found', idx: edit.idx };
    const text = edit.text.trim();
    if (text !== target.text) edits.set(edit.idx, text);
  }
  if (edits.size === 0) return { kind: 'unchanged' };

  const newTexts = sceneRows.map((value) => edits.get(value.idx) ?? value.text);
  const script = newTexts.join(' ');

  // The edited script must still satisfy the same request contract (size
  // ceiling, non-blank), so a resize that no longer fits is a 400, not a 500
  // inside the worker.
  const nextRequest = createAiVideoV3RequestSchema.safeParse({
    ...request.data,
    script,
  });
  if (!nextRequest.success) {
    const issue = nextRequest.error.issues[0];
    return {
      kind: 'invalid_request',
      message: issue?.message ?? 'edited script is not valid',
      field: 'scenes',
    };
  }

  const parsedPlan = scenePlanSchema.safeParse(stored.plan);
  if (!parsedPlan.success || parsedPlan.data.scenes.length !== sceneRows.length) {
    throw new Error('stored plan does not match the stored scenes');
  }
  const nextPlan = scenePlanSchema.parse({
    ...parsedPlan.data,
    scenes: parsedPlan.data.scenes.map((planned, index) => {
      const text = newTexts[index];
      if (text === undefined) throw new Error(`plan has no scene ${index}`);
      return edits.has(index) ? { ...planned, text } : planned;
    }),
  });

  for (const [idx, text] of edits) {
    await db
      .update(scene)
      .set({ text })
      .where(and(eq(scene.video_id, input.videoId), eq(scene.idx, idx)));
  }

  const updated = await db
    .update(video)
    .set({
      status: 'processing',
      step: 'create-vocal',
      error: null,
      request: { kind: stored.request.kind, body: nextRequest.data },
      plan: nextPlan,
      revocal: { sceneIdxs: [...edits.keys()].sort((a, b) => a - b) },
      updated_at: sql`now()`,
    })
    .where(
      and(eq(video.id, input.videoId), eq(video.workspace_id, input.workspaceId)),
    )
    .returning();

  const next = updated[0];
  if (next === undefined) throw new Error('revocal transition returned no row');
  return { kind: 'queued', video: videoRowSchema.parse(next) };
}

export interface BeginRecaptionInput {
  readonly workspaceId: string;
  readonly videoId: string;
  /** Replaces the request's `captionTemplateId`; absent keeps the current one. */
  readonly templateId?: number;
  /** Replaces the request's `captionSpec`; absent clears the override. */
  readonly spec?: CaptionSpec;
}

export type BeginRecaptionResult =
  /** The stored request carries the new style; enqueue `create-captions`. */
  | { readonly kind: 'queued'; readonly video: VideoRow }
  | { readonly kind: 'not_found' }
  /** Captions are off, or the stored video is not an AI-video V3 project. */
  | { readonly kind: 'no_captions' }
  /** Only a completed video can change its caption style. */
  | { readonly kind: 'conflict'; readonly status: VideoStatus };

/**
 * Save a caption style on the stored request and queue `create-captions`.
 *
 * The style lives in `video.request.body` next to `captions` and
 * `captionTemplateId`, so a later re-narrate (which rewrites `script` and
 * spreads the rest of the body) cannot lose it. The step merges
 * `captionSpec` over the template's own spec, and `render` burns the ASS the
 * step regenerated, so the choice reaches the MP4 without touching audio or
 * artwork.
 *
 * `templateId`/`spec` are replacements, not patches: omitting `spec` clears
 * the stored override. Must run inside the transaction that enqueues the job.
 */
export async function beginRecaption(
  db: Database,
  input: BeginRecaptionInput,
): Promise<BeginRecaptionResult> {
  const rows = await db
    .select()
    .from(video)
    .where(
      and(eq(video.id, input.videoId), eq(video.workspace_id, input.workspaceId)),
    )
    .for('update');
  const row = rows[0];
  if (row === undefined) return { kind: 'not_found' };
  if (row.status !== 'completed') return { kind: 'conflict', status: row.status };
  if (row.kind !== 'ai-video-v3') return { kind: 'no_captions' };

  const stored = videoRowSchema.parse(row);
  const request = createAiVideoV3RequestSchema.safeParse(stored.request.body);
  if (!request.success) {
    throw new Error('stored V3 request does not match the request contract');
  }
  if (!request.data.captions) return { kind: 'no_captions' };

  const body: Record<string, unknown> = { ...request.data };
  if (input.templateId !== undefined) body.captionTemplateId = input.templateId;
  if (input.spec === undefined) {
    delete body.captionSpec;
  } else {
    body.captionSpec = input.spec;
  }
  const next = createAiVideoV3RequestSchema.parse(body);

  const updated = await db
    .update(video)
    .set({
      status: 'processing',
      step: 'create-captions',
      error: null,
      request: { kind: stored.request.kind, body: next },
      updated_at: sql`now()`,
    })
    .where(
      and(eq(video.id, input.videoId), eq(video.workspace_id, input.workspaceId)),
    )
    .returning();

  const nextRow = updated[0];
  if (nextRow === undefined) throw new Error('recaption transition returned no row');
  return { kind: 'queued', video: videoRowSchema.parse(nextRow) };
}
