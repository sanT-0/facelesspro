/**
 * `/v1/videos/:id` — the pipeline cursor and its two actions.
 *
 * `GET` answers `videoResponseSchema` (the same object webhooks carry) and
 * rewrites the stored render key through `PUBLIC_BASE_URL` + the api's stable
 * `/files/*` prefix; the row → wire mapping lives in `video-response.ts` so no
 * response can drift from the others.
 *
 * `POST /:id/render` only moves a **completed** video back to `rendering`.
 * Generation that has not finished, or that failed, is a `409`: a failure is
 * resumed with `POST /:id/retry` (docs/01 §2), not by rendering a half-built
 * project.
 *
 * `POST /:id/retry` re-enqueues the step recorded on a `failed` video and
 * clears `error`; a `render` failure returns to `rendering`, every other step
 * to `processing`. Earlier steps are untouched, so their artifacts and charges
 * stay as they were.
 *
 * Every guarded transition and its enqueue share one transaction in the
 * injected queue dependency.
 */

import { Hono } from 'hono';

import {
  apiError,
  idSchema,
  renderRequestSchema,
  videoResponseSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type {
  RenderOptions,
  VideoResponse,
  VideoRow,
  VideoStatus,
  VideoStep,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';
import { toVideoResponse, UnpublishableVideo } from './video-response';

export interface QueueRenderInput {
  /** The authenticated workspace; the guard is scoped to it. */
  readonly workspaceId: string;
  readonly videoId: string;
  /** The profile the render step will read from `video.request.body.render`. */
  readonly render: RenderOptions;
  /** Replaces the stored webhook when present. */
  readonly webhookUrl?: string;
}

export type QueueRenderResult =
  | { readonly kind: 'queued'; readonly video: VideoRow }
  | { readonly kind: 'not_found' }
  /** The video is not in a terminal-generation state; nothing was queued. */
  | { readonly kind: 'conflict'; readonly status: VideoStatus };

export type QueueRender = (input: QueueRenderInput) => Promise<QueueRenderResult>;

export type QueueRetryResult =
  | { readonly kind: 'queued'; readonly video: VideoRow; readonly step: VideoStep }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict'; readonly status: VideoStatus };

export type QueueRetryInput = {
  readonly workspaceId: string;
  readonly videoId: string;
};

export type QueueRetry = (input: QueueRetryInput) => Promise<QueueRetryResult>;

export interface VideoRouteDeps extends AuthDeps {
  /** Any status inside this workspace, so the route can answer 404. */
  readonly readVideo: (
    workspaceId: string,
    id: string,
  ) => Promise<VideoRow | null>;
  /** Guarded render transition + enqueue in one Postgres transaction. */
  readonly queueRender: QueueRender;
  /** Guarded failed-step resume + enqueue in one Postgres transaction. */
  readonly queueRetry: QueueRetry;
  /** Absolute origin that serves `/files/*`, e.g. `http://127.0.0.1:3001`. */
  readonly publicBaseUrl: string;
}

type MappedVideo =
  | { readonly ok: true; readonly body: VideoResponse }
  | { readonly ok: false; readonly message: string };

function mapStoredVideo(stored: VideoRow, base: string): MappedVideo {
  const row = videoRowSchema.safeParse(stored);
  if (!row.success) {
    return { ok: false, message: 'stored video row is invalid' };
  }
  try {
    return { ok: true, body: videoResponseSchema.parse(toVideoResponse(row.data, base)) };
  } catch (failure) {
    if (failure instanceof UnpublishableVideo) {
      return { ok: false, message: failure.message };
    }
    throw failure;
  }
}

/** Parse the body; an empty body means "render with the defaults". */
async function readRenderBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return {};
  return JSON.parse(text) as unknown;
}

export function createVideoRoutes(deps: VideoRouteDeps): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  const base = deps.publicBaseUrl.replace(/\/+$/, '');
  if (base.length === 0) throw new TypeError('publicBaseUrl is empty');

  // The key resolves the workspace once; every handler below is scoped by it.
  app.use('*', withWorkspace(deps));

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) {
      return c.json(apiError('invalid_request', 'id must be a UUID', 'id'), 400);
    }

    const stored = await deps.readVideo(c.get('workspaceId'), id);
    if (stored === null) {
      return c.json(apiError('not_found', 'video not found'), 404);
    }

    const mapped = mapStoredVideo(stored, base);
    if (!mapped.ok) return c.json(apiError('internal', mapped.message), 500);
    return c.json(mapped.body, 200);
  });

  app.post('/:id/render', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) {
      return c.json(apiError('invalid_request', 'id must be a UUID', 'id'), 400);
    }

    let payload: unknown;
    try {
      payload = await readRenderBody(c.req.raw);
    } catch {
      return c.json(apiError('invalid_request', 'request body must be JSON'), 400);
    }

    const parsed = renderRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      let field: string | undefined;
      if (issue !== undefined) {
        if (issue.path.length > 0) {
          field = issue.path.join('.');
        } else if (issue.code === 'unrecognized_keys' && issue.keys.length > 0) {
          // `{unknown: true}` has no path; name the offending key instead.
          field = issue.keys[0];
        }
      }
      return c.json(
        apiError(
          'invalid_request',
          issue?.message ?? 'invalid request',
          field,
        ),
        400,
      );
    }

    const { webhookUrl, ...render } = parsed.data;
    const result = await deps.queueRender({
      workspaceId: c.get('workspaceId'),
      videoId: id,
      render,
      ...(webhookUrl === undefined ? {} : { webhookUrl }),
    });

    switch (result.kind) {
      case 'not_found':
        return c.json(apiError('not_found', 'video not found'), 404);
      case 'conflict':
        return c.json(apiError('conflict', `video is ${result.status}`), 409);
      case 'queued': {
        const mapped = mapStoredVideo(result.video, base);
        if (!mapped.ok) return c.json(apiError('internal', mapped.message), 500);
        return c.json(mapped.body, 202);
      }
    }
  });

  app.post('/:id/retry', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) {
      return c.json(apiError('invalid_request', 'id must be a UUID', 'id'), 400);
    }

    const result = await deps.queueRetry({
      workspaceId: c.get('workspaceId'),
      videoId: id,
    });
    switch (result.kind) {
      case 'not_found':
        return c.json(apiError('not_found', 'video not found'), 404);
      case 'conflict':
        return c.json(apiError('conflict', `video is ${result.status}`), 409);
      case 'queued': {
        const mapped = mapStoredVideo(result.video, base);
        if (!mapped.ok) return c.json(apiError('internal', mapped.message), 500);
        return c.json(mapped.body, 202);
      }
    }
  });

  return app;
}
