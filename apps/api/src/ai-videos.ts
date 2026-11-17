/**
 * `POST /v1/ai-videos` — the V2 create door.
 *
 * V2 has no `artStyleId`: its sixteen `imageStyle` presets are resolved inside
 * the worker, so this route only validates the shared contract, refuses a
 * wordless script, and hands the normalised body to the same `submitVideo`
 * transaction V3 uses (row insert + `create-scenes` enqueue).
 */

import { Hono } from 'hono';

import {
  apiError,
  createAiVideoRequestSchema,
  createVideoResponseSchema,
} from '@facelesspro/contracts';
import { estimateDuration } from '@facelesspro/core';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';
import type { SubmitVideo } from './video-submit';

export interface AiVideosRouteDeps extends AuthDeps {
  /** Insert the video row and enqueue `create-scenes` in one transaction. */
  readonly submitVideo: SubmitVideo;
  /** Absolute origin that serves `/files/*`, e.g. `http://127.0.0.1:3001`. */
  readonly publicBaseUrl: string;
}

export function createAiVideosRoutes(
  deps: AiVideosRouteDeps,
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

    const parsed = createAiVideoRequestSchema.safeParse(input);
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
    if (estimateDuration(body.script).words === 0) {
      return c.json(
        apiError('invalid_request', 'script contains no words to speak', 'script'),
        400,
      );
    }

    const result = await deps.submitVideo({
      workspaceId: c.get('workspaceId'),
      body: { kind: 'ai-video', body },
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
