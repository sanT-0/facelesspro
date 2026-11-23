/**
 * `POST /v1/voices/import` — consent-gated voice import.
 *
 * The client provides a voice sample URL (MP3/WAV ≤5 MB, ≤30 s) and
 * explicit consent. The server creates a private voice available only to
 * the importing workspace.
 */

import { Hono } from 'hono';

import {
  apiError,
  voiceImportRequestSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';

export interface VoicesImportRouteDeps extends AuthDeps {
  /** Import a voice from a sample URL for the workspace. */
  readonly importVoice?: (
    workspaceId: string,
    input: { name: string; sampleUrl: string },
  ) => Promise<{
    id: string;
    name: string;
    previewUrl: string;
  }>;
}

export function createVoicesImportRoutes(
  deps: VoicesImportRouteDeps,
): Hono<WorkspaceEnv> {
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

    const parsed = voiceImportRequestSchema.safeParse(input);
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

    const { name, sampleUrl } = parsed.data;

    if (!deps.importVoice) {
      return c.json(
        apiError('unprocessable', 'voice import is not available on this server'),
        501,
      );
    }

    const voice = await deps.importVoice(c.get('workspaceId'), { name, sampleUrl });

    return c.json(
      {
        id: voice.id,
        name: voice.name,
        previewUrl: voice.previewUrl,
        status: 'ready',
        workspaceScoped: true,
      },
      201,
    );
  });

  return app;
}