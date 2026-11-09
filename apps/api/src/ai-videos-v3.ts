/**
 * `POST /v1/ai-videos-v3` — the create door.
 *
 * Validates the shared request contract, checks the art style is visible to
 * the caller's workspace, ready, and supports the requested size, then hands
 * the normalised body to the injected `submitVideo` dependency (row insert +
 * `create-scenes` enqueue in one transaction). Nothing expensive happens in
 * the request; the response is the documented create shape.
 */

import { Hono } from 'hono';

import {
  apiError,
  createAiVideoV3RequestSchema,
  createVideoResponseSchema,
  type ArtStyleRow,
  type CreateAiVideoV3RequestParsed,
  type VideoRow,
} from '@facelesspro/contracts';
import { estimateDuration } from '@facelesspro/core';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';

export interface SubmitVideoInput {
  readonly workspaceId: string;
  readonly body: {
    readonly kind: 'ai-video-v3';
    readonly body: CreateAiVideoV3RequestParsed;
  };
}

export type SubmitVideo = (input: SubmitVideoInput) => Promise<VideoRow>;

export interface AiVideosV3RouteDeps extends AuthDeps {
  /** One style by id, scoped to the caller's workspace (published or own). */
  readonly readArtStyle: (
    workspaceId: string,
    id: string,
  ) => Promise<ArtStyleRow | null>;
  /** Insert the video row and enqueue `create-scenes` in one transaction. */
  readonly submitVideo: SubmitVideo;
  /** Absolute origin that serves `/files/*`, e.g. `http://127.0.0.1:3001`. */
  readonly publicBaseUrl: string;
}

export function createAiVideosV3Routes(
  deps: AiVideosV3RouteDeps,
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  const base = deps.publicBaseUrl.replace(/\/+$/, '');
  if (base.length === 0) throw new TypeError('publicBaseUrl is empty');

  // The key resolves the workspace once; every handler below is scoped by it.
  app.use('*', withWorkspace(deps));

  app.post('/', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json(
        apiError('invalid_request', 'request body must be JSON'),
        400,
      );
    }

    const parsed = createAiVideoV3RequestSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      let field: string | undefined;
      if (issue !== undefined && issue.path.length > 0) {
        field = issue.path.join('.');
      } else if (
        issue !== undefined &&
        issue.code === 'unrecognized_keys' &&
        issue.keys !== undefined &&
        issue.keys.length > 0
      ) {
        field = issue.keys[0];
      }
      return c.json(
        apiError('invalid_request', issue?.message ?? 'invalid request', field),
        400,
      );
    }

    const body = parsed.data;
    const workspaceId = c.get('workspaceId');

    // 3. Resolve the art style: visible to this workspace, ready, supports size.
    const style = await deps.readArtStyle(workspaceId, body.artStyleId);
    if (style === null) {
      return c.json(apiError('not_found', 'art style not found'), 404);
    }
    if (style.status !== 'ready') {
      return c.json(
        apiError('conflict', `art style is ${style.status}`),
        409,
      );
    }
    if (!style.formats.includes(body.size)) {
      return c.json(
        apiError(
          'invalid_request',
          `art style does not support ${body.size}`,
          'artStyleId',
        ),
        400,
      );
    }

    // 5. A wordless script has nothing to narrate.
    if (body.script !== undefined && estimateDuration(body.script).words === 0) {
      return c.json(
        apiError('invalid_request', 'script contains no words to speak', 'script'),
        400,
      );
    }

    // 6–7. Insert the row and enqueue create-scenes in one transaction.
    const result = await deps.submitVideo({
      workspaceId,
      body: {
        kind: 'ai-video-v3',
        body: {
          ...body,
          captionTemplateId: body.captionTemplateId ?? -1,
        },
      },
    });

    const response = createVideoResponseSchema.parse({
      id: result.id,
      status: result.status,
      /** Whether this creation asked for an mp4. */
      render: body.render !== undefined,
      createdAt: result.created_at,
      editorUrl: `${base}/editor?id=${result.id}`,
    });

    return c.json(response, 202);
  });

  return app;
}
