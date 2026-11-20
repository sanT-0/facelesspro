/**
 * `POST /v1/quiz-videos` — the Quiz video create door.
 *
 * Quiz video has items (questions/comments), an answer template for narration,
 * optional background and question image generation, and uses the quiz-specific
 * image style set. This route validates the contract and submits via the same
 * `submitVideo` transaction as V2/V3.
 */

import { Hono } from 'hono';

import {
  apiError,
  createQuizVideoRequestSchema,
  createVideoResponseSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';
import type { SubmitVideo } from './video-submit';

export interface QuizVideosRouteDeps extends AuthDeps {
  /** Insert the video row and enqueue `create-scenes` in one transaction. */
  readonly submitVideo: SubmitVideo;
  /** Absolute origin that serves `/files/*`, e.g. `http://127.0.0.1:3001`. */
  readonly publicBaseUrl: string;
}

export function createQuizVideosRoutes(
  deps: QuizVideosRouteDeps,
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

    const parsed = createQuizVideoRequestSchema.safeParse(input);
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

    // Validate that at least one question exists (comments don't need answers)
    const hasQuestion = body.items.some((item) => item.type === 'question');
    if (!hasQuestion) {
      return c.json(
        apiError('invalid_request', 'at least one question is required', 'items'),
        400,
      );
    }

    // Validate answerTemplate is provided if there are questions
    if (hasQuestion && body.answerTemplate === undefined) {
      return c.json(
        apiError('invalid_request', 'answerTemplate is required when items contain questions', 'answerTemplate'),
        400,
      );
    }

    // Validate image generation fields
    if (body.generateBackgroundImage && !body.backgroundImagePrompt) {
      return c.json(
        apiError('invalid_request', 'backgroundImagePrompt is required when generateBackgroundImage is true', 'backgroundImagePrompt'),
        400,
      );
    }

    const result = await deps.submitVideo({
      workspaceId: c.get('workspaceId'),
      body: { kind: 'quiz', body },
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