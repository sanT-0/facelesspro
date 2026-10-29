/**
 * `POST /v1/art-styles` — multipart reference video upload.
 *
 * 1. Parses multipart form: `file` (required), `name?`, `formats?`, `published?`
2. Validates the video with ffprobe (≥30s, has audio, ≤10min)
3. Stores the reference video to disk (temporary, will be processed by worker)
4. Inserts `art_style` row with `status='building'`
5. Returns `202 {id, status: 'building', createdAt}`
 *
 * No worker job is enqueued yet — the build step is P3 follow-up.
 * This endpoint is the upload + validation gate.
 */

import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Hono } from 'hono';

import { createArtStyleResponseSchema, artStyleMetaSchema } from '@facelesspro/contracts';
import { apiError } from '@facelesspro/contracts';
import { validateReferenceVideo } from './video-probe';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const ALLOWED_MIME = ['video/mp4', 'video/quicktime'];
const REF_DIR = process.env.REFERENCE_VIDEO_DIR ?? join(process.cwd(), 'storage', 'references');

interface ArtStyleDeps {
  db: {
    insertArtStyle: (row: {
      id: string;
      workspace_id: string | null;
      name: string;
      published: boolean;
      formats: string[];
      profile: Record<string, unknown>;
      status: 'building';
      created_at: Date;
    }) => Promise<void>;
  };
}

export function createArtStyleRoutes(deps: ArtStyleDeps): Hono {
  const app = new Hono();

  // Ensure reference directory exists
  mkdir(REF_DIR, { recursive: true }).catch(() => {});

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

    // Save file to temporary location for probing
    const tempName = `${randomUUID()}-${file.name}`;
    const tempPath = join(REF_DIR, tempName);

    const arrayBuffer = await file.arrayBuffer();
    await writeFile(tempPath, Buffer.from(arrayBuffer));

    // Probe and validate
    try {
      await validateReferenceVideo(tempPath);
    } catch (error) {
      // Clean up temp file on validation failure
      await import('node:fs/promises').then((fs) => fs.unlink(tempPath).catch(() => {}));
      const message = error instanceof Error ? error.message : 'video validation failed';
      return c.json(apiError('invalid_request', message, 'file'), 400);
    }

    // Create art_style row
    const id = randomUUID();
    const now = new Date();

    await deps.db.insertArtStyle({
      id,
      workspace_id: null, // TODO: get from auth (P6)
      name: metaParsed.data.name ?? `Style ${id.slice(0, 8)}`,
      published: metaParsed.data.published,
      formats: metaParsed.data.formats,
      profile: {}, // Empty until built
      status: 'building',
      created_at: now,
    });

    // TODO: enqueue build job (P3 follow-up)

    const response = createArtStyleResponseSchema.parse({
      id,
      status: 'building',
      createdAt: now.toISOString(),
    });

    return c.json(response, 202);
  });

  return app;
}