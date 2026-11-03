/** `GET /v1/caption-templates` — the slow-changing built-in template library. */

import { createHash } from 'node:crypto';

import { Hono } from 'hono';

import {
  captionTemplateListSchema,
  type CaptionTemplateRow,
} from '@facelesspro/contracts';

export interface CaptionTemplateDeps {
  /** Built-ins today; workspace templates join this list when auth lands. */
  readonly listCaptionTemplates: () => Promise<readonly CaptionTemplateRow[]>;
}

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

export function createCaptionTemplateRoutes(deps: CaptionTemplateDeps): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const rows = await deps.listCaptionTemplates();
    const body = captionTemplateListSchema.parse({
      templates: rows.map((row) => ({
        id: row.id,
        name: row.name,
        spec: row.spec,
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
