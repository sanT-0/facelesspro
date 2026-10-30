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

import { createArtStyleResponseSchema, artStyleMetaSchema } from '@facelesspro/contracts';
import { apiError } from '@facelesspro/contracts';
import type { ArtStyleBuildJob, ArtStyleRow } from '@facelesspro/contracts';
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
  readonly now?: () => Date;
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

  return app;
}
