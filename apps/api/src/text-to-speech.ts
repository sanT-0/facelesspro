/**
 * `POST /v1/text-to-speech` — synthesize speech from text.
 *
 * Calls the injected `synthesizeTts` dependency (which talks to the media
 * service) and returns `{audioUrl, durationMs, voiceId}`.
 */

import { Hono } from 'hono';

import {
  apiError,
  textToSpeechRequestSchema,
  textToSpeechResponseSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';

export interface TtsRouteDeps extends AuthDeps {
  /** Synthesize speech from text via the media service. */
  readonly synthesizeTts: (
    input: {
      readonly text: string;
      readonly voiceId?: string;
      readonly voiceStyle?: unknown;
    },
  ) => Promise<{
    readonly audioUrl: string;
    readonly durationMs: number;
    readonly voiceId: string;
  }>;
}

export function createTtsRoutes(deps: TtsRouteDeps): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();

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

    const parsed = textToSpeechRequestSchema.safeParse(input);
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
        apiError(
          'invalid_request',
          issue?.message ?? 'invalid request',
          field,
        ),
        400,
      );
    }

    const result = await deps.synthesizeTts({
      text: parsed.data.text,
      voiceId: parsed.data.voiceId,
      voiceStyle: parsed.data.voiceStyle,
    });

    const response = textToSpeechResponseSchema.parse({
      audioUrl: result.audioUrl,
      durationMs: result.durationMs,
      voiceId: result.voiceId,
    });

    return c.json(response, 200);
  });

  return app;
}
