/**
 * `POST /v1/roblox-videos` — the Roblox Rant create door.
 *
 * A rant is one script read over a gameplay background, so the route only
 * validates the shared contract and hands one normalised body to the injected
 * `submitVideo` transaction. The documented defaults (pitch 140, six words per
 * caption, emoji on) come from the schema, not from this file, so the api and
 * the worker cannot disagree about them.
 */

import { Hono } from 'hono';

import {
  apiError,
  createRobloxVideoRequestSchema,
  createVideoResponseSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';
import type { SubmitVideo } from './video-submit';

export interface RobloxVideosRouteDeps extends AuthDeps {
  /** Insert the video row and enqueue `create-scenes` in one transaction. */
  readonly submitVideo: SubmitVideo;
  /** Absolute origin that serves `/files/*`, e.g. `http://127.0.0.1:3001`. */
  readonly publicBaseUrl: string;
}

export function createRobloxVideosRoutes(
  deps: RobloxVideosRouteDeps,
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

    const parsed = createRobloxVideoRequestSchema.safeParse(input);
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

    const result = await deps.submitVideo({
      workspaceId: c.get('workspaceId'),
      body: { kind: 'roblox', body },
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
