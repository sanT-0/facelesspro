/**
 * `GET /v1/background-videos` — built-in background video library.
 *
 * Returns ETag and Cache-Control headers for slow-changing library data.
 */

import { createHash } from 'node:crypto';

import { Hono } from 'hono';

import { backgroundVideoListSchema } from '@facelesspro/contracts';

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

export interface BackgroundVideosRouteDeps extends AuthDeps {
  readonly listBackgroundVideos: () => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly durationMs?: number;
    readonly thumbnailUrl?: string;
    readonly tags?: readonly string[];
  }>>;
}

export function createBackgroundVideosRoutes(
  deps: BackgroundVideosRouteDeps,
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();

  app.use('*', withWorkspace(deps));

  app.get('/', async (c) => {
    const rows = await deps.listBackgroundVideos();
    const body = backgroundVideoListSchema.parse({
      backgroundVideos: rows.map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        ...(row.durationMs !== undefined ? { durationMs: row.durationMs } : {}),
        ...(row.thumbnailUrl !== undefined ? { thumbnailUrl: row.thumbnailUrl } : {}),
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
