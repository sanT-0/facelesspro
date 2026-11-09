/**
 * `GET /v1/sound-effects` — built-in sound effect library.
 *
 * Returns ETag and Cache-Control headers for slow-changing library data.
 */

import { createHash } from 'node:crypto';

import { Hono } from 'hono';

import { soundEffectListSchema } from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';

function contentEtag(json: string): string {
  return `"${createHash('sha256').update(json).digest('hex')}"`;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate === etag || candidate === `W/${etag}`);
}

export interface SoundEffectsRouteDeps extends AuthDeps {
  readonly listSoundEffects: () => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly durationMs?: number;
    readonly tags?: readonly string[];
  }>>;
}

export function createSoundEffectsRoutes(
  deps: SoundEffectsRouteDeps,
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();

  app.use('*', withWorkspace(deps));

  app.get('/', async (c) => {
    const rows = await deps.listSoundEffects();
    const body = soundEffectListSchema.parse({
      soundEffects: rows.map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        ...(row.durationMs !== undefined ? { durationMs: row.durationMs } : {}),
        ...(row.tags !== undefined ? { tags: row.tags } : {}),
      })),
    });
    const json = JSON.stringify(body);
    const etag = contentEtag(json);

    c.header('Cache-Control', 'private, max-age=300');
    c.header('ETag', etag);
    if (etagMatches(c.req.header('If-None-Match'), etag)) {
      return c.body(null, 304);
    }
    return c.json(body, 200);
  });

  return app;
}
