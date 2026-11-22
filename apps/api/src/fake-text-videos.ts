/**
 * `POST /v1/fake-text-videos` — the Fake Text video create door.
 *
 * Fake Text video has conversations with characters, messages, chat templates,
 * and optional background video. Uses per-character voices for TTS.
 * This route validates the contract and submits via the same `submitVideo`
 * transaction as V2/V3/Quiz.
 */

import { Hono } from 'hono';

import {
  apiError,
  createFakeTextVideoRequestSchema,
  createVideoResponseSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';
import type { SubmitVideo } from './video-submit';

export interface FakeTextVideosRouteDeps extends AuthDeps {
  /** Insert the video row and enqueue `create-scenes` in one transaction. */
  readonly submitVideo: SubmitVideo;
  /** Absolute origin that serves `/files/*`, e.g. `http://127.0.0.1:3001`. */
  readonly publicBaseUrl: string;
}

export function createFakeTextVideosRoutes(
  deps: FakeTextVideosRouteDeps,
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

    const parsed = createFakeTextVideoRequestSchema.safeParse(input);
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

    // Validate message cap (already done by schema, but double-check)
    const totalMessages = body.conversations.reduce(
      (sum, conversation) => sum + conversation.messages.length,
      0,
    );
    if (totalMessages > 1000) {
      return c.json(
        apiError(
          'invalid_request',
          'at most 1000 messages across all conversations',
          'conversations',
        ),
        400,
      );
    }

    const result = await deps.submitVideo({
      workspaceId: c.get('workspaceId'),
      body: { kind: 'fake-text', body },
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