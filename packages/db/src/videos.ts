/**
 * Read/write queries for the video pipeline.
 *
 * The api may not import `drizzle-orm` or `pg` (eslint enforces the boundary), so
 * API-facing queries live here and are injected into routes as plain functions.
 * The row is parsed through `videoRowSchema` on the way out: a cursor the rest of
 * the system does not understand must not reach a response.
 */

import { videoRowSchema } from '@facelesspro/contracts';
import type {
  RenderOptions,
  VideoRow,
  VideoStatus,
  VideoStep,
} from '@facelesspro/contracts';
import { and, eq, sql } from 'drizzle-orm';

import type { Database } from './client';
import { video } from './schema';

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
