/**
 * `POST /v1/art-styles` — multipart reference video upload.
 *
 * 1. Parses multipart form: `file` (required), `name?`, `formats?`, `published?`
2. Validates the video with ffprobe (≥30s, has audio, ≤10min)
3. Stores the reference video under the shared `DATA_DIR`
4. Atomically inserts the `art_style` row and enqueues `build-art-style`
5. Returns `202 {id, status: 'building', createdAt}`
 *
 * The original filename is never used as a path. The API and worker exchange a
 * validated storage key (`references/<styleId>.<ext>`), not an absolute path.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Hono } from 'hono';

import {
  artStyleExportSchema,
  artStyleListSchema,
  createArtStyleResponseSchema,
  artStyleMetaSchema,
  idSchema,
  styleProfileSchema,
} from '@facelesspro/contracts';
import { apiError } from '@facelesspro/contracts';
import type { ArtStyle, ArtStyleBuildJob, ArtStyleRow } from '@facelesspro/contracts';
import { validateReferenceVideo } from './video-probe';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const ALLOWED_MIME = ['video/mp4', 'video/quicktime'];

export type NewArtStyleRow = Pick<
  ArtStyleRow,
  | 'id'
  | 'workspace_id'
  | 'name'
  | 'published'
  | 'formats'
  | 'profile'
  | 'created_at'
> & { readonly status: 'building' };

/** One durable submission: the row and its queue job commit together. */
export interface ArtStyleSubmission {
  readonly row: NewArtStyleRow;
  readonly job: ArtStyleBuildJob;
}

export interface ArtStyleDeps {
  /** Absolute or cwd-relative disk root shared with the worker. */
  readonly storageRoot: string;
  readonly submitArtStyle: (submission: ArtStyleSubmission) => Promise<void>;
  /** Ready styles only, newest first. */
  readonly listArtStyles: () => Promise<readonly ArtStyleRow[]>;
  /** Any status, so the route can choose 404 vs 409. */
  readonly readArtStyle: (id: string) => Promise<ArtStyleRow | null>;
  readonly now?: () => Date;
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Storage keys are relative (`art-styles/<id>/preview.png`); the wire contract
 * wants a URL or an absolute path. `/files/*` is the api's stable public prefix
 * (docs/10), so a future CDN only changes where that prefix is served from.
 */
function publicFileUrl(value: string): string {
  if (ABSOLUTE_URL.test(value) || value.startsWith('/')) return value;
  return `/files/${value}`;
}

function requirePreview(key: string | null | undefined, styleId: string): string {
  if (key === null || key === undefined || key.trim().length === 0) {
    throw new Error(`ready art style ${styleId} has no preview`);
  }
  return publicFileUrl(key);
}

/** `art_style` row → `GET /v1/art-styles` entry. */
function toCatalogEntry(row: ArtStyleRow): ArtStyle {
  return {
    id: row.id,
    name: row.name,
    published: row.published,
    formats: row.formats,
    previewUrl: requirePreview(row.preview_url, row.id),
    ...(row.portrait_preview_url === null || row.portrait_preview_url === undefined
      ? {}
      : { portraitPreviewUrl: publicFileUrl(row.portrait_preview_url) }),
    sampleVideoUrls: row.sample_video_urls.map(publicFileUrl),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function createArtStyleRoutes(deps: ArtStyleDeps): Hono {
  const app = new Hono();
  const storageRoot = resolve(deps.storageRoot);

  app.post('/', async (c) => {
    // Parse multipart form
    const formData = await c.req.formData();

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return c.json(apiError('invalid_request', 'file is required', 'file'), 400);
    }

    if (!ALLOWED_MIME.includes(file.type)) {
      return c.json(
        apiError('invalid_request', 'file must be MP4 or MOV', 'file'),
        400,
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return c.json(
        apiError('invalid_request', 'file exceeds 500 MB limit', 'file'),
        400,
      );
    }

    // Parse meta fields
    let meta: { name?: string; formats?: string[]; published?: boolean };
    try {
      meta = {
        name: formData.get('name')?.toString(),
        formats: formData.get('formats')
          ? JSON.parse(formData.get('formats')!.toString())
          : undefined,
        published: formData.get('published') === 'true',
      };
    } catch {
      return c.json(
        apiError('invalid_request', 'invalid meta fields', 'formats'),
        400,
      );
    }

    const metaParsed = artStyleMetaSchema.safeParse(meta);
    if (!metaParsed.success) {
      return c.json(
        apiError('invalid_request', metaParsed.error.issues[0]!.message, 'formats'),
        400,
      );
    }

    // The path is server-generated. A client filename may contain traversal,
    // spaces or platform separators and must never cross the process boundary.
    const id = randomUUID();
    const extension = file.type === 'video/quicktime' ? 'mov' : 'mp4';
    const referenceKey = `references/${id}.${extension}`;
    const referenceDir = join(storageRoot, 'references');
    const referencePath = join(referenceDir, `${id}.${extension}`);

    await mkdir(referenceDir, { recursive: true });
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(referencePath, Buffer.from(arrayBuffer));

    // Probe and validate
    try {
      await validateReferenceVideo(referencePath);
    } catch (error) {
      await unlink(referencePath).catch(() => undefined);
      const message = error instanceof Error ? error.message : 'video validation failed';
      return c.json(apiError('invalid_request', message, 'file'), 400);
    }

    const createdAt = (deps.now ?? (() => new Date()))().toISOString();
    await deps.submitArtStyle({
      row: {
        id,
        workspace_id: null, // TODO: get from auth (P6)
        name: metaParsed.data.name ?? `Style ${id.slice(0, 8)}`,
        published: metaParsed.data.published,
        formats: metaParsed.data.formats,
        profile: {}, // Empty until built
        status: 'building',
        created_at: createdAt,
      },
      job: { styleId: id, referenceKey },
    });

    const response = createArtStyleResponseSchema.parse({
      id,
      status: 'building',
      createdAt,
    });

    return c.json(response, 202);
  });

  /**
   * `GET /v1/art-styles` — the library. Parity rule: styles that are not ready
   * are omitted, so every id returned can be used as `artStyleId` today.
   */
  app.get('/', async (c) => {
    const rows = await deps.listArtStyles();
    const body = artStyleListSchema.parse({
      styles: rows.filter((row) => row.status === 'ready').map(toCatalogEntry),
    });
    return c.json(body, 200);
  });

  /**
   * `GET /v1/art-styles/:id/export` — the portable document: metadata plus the
   * exact `StyleProfile` that lives in `art_style.profile`. No row ids, storage
   * keys or timestamps, so the file can be imported on another machine.
   */
  app.get('/:id/export', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) {
      return c.json(apiError('invalid_request', 'id must be a UUID', 'id'), 400);
    }

    const row = await deps.readArtStyle(id);
    if (row === null) {
      return c.json(apiError('not_found', 'art style not found'), 404);
    }
    if (row.status !== 'ready') {
      return c.json(apiError('conflict', `art style is ${row.status}`), 409);
    }

    const profile = styleProfileSchema.safeParse(row.profile);
    if (!profile.success) {
      return c.json(apiError('internal', 'stored art style profile is invalid'), 500);
    }

    const body = artStyleExportSchema.parse({
      version: 1,
      name: row.name,
      formats: row.formats,
      profile: profile.data,
    });
    return c.json(body, 200);
  });

  return app;
}
