/**
 * `POST /v1/files` — multipart file upload.
 *
 * Accepts a file, stores it via the injected `storeFile` dependency, and
 * returns `{key, url, bytes, mime}` where `url` is `/files/<key>`.
 *
 * The original filename is never used as a path. Storage keys are generated
 * server-side. The `/files/*` prefix is the api's stable public prefix
 * (docs/10), so a future CDN only changes where that prefix is served from.
 */

import { Hono } from 'hono';

import {
  apiError,
  fileUploadResponseSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export interface FilesRouteDeps extends AuthDeps {
  /** Store an uploaded file and return its key, byte count and mime type. */
  readonly storeFile: (
    file: {
      readonly name: string;
      readonly type: string;
      readonly arrayBuffer: () => Promise<ArrayBuffer>;
    },
  ) => Promise<{
    readonly key: string;
    readonly bytes: number;
    readonly mime: string;
  }>;
  /** Absolute origin that serves `/files/*`, e.g. `http://127.0.0.1:3001`. */
  readonly publicBaseUrl: string;
}

export function createFilesRoutes(deps: FilesRouteDeps): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  const base = deps.publicBaseUrl.replace(/\/+$/, '');
  if (base.length === 0) throw new TypeError('publicBaseUrl is empty');

  app.use('*', withWorkspace(deps));

  app.post('/', async (c) => {
    const formData = await c.req.formData();

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return c.json(apiError('invalid_request', 'file is required', 'file'), 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return c.json(
        apiError('payload_too_large', 'file exceeds 5 MB limit', 'file'),
        413,
      );
    }

    const result = await deps.storeFile({
      name: file.name,
      type: file.type,
      arrayBuffer: file.arrayBuffer.bind(file),
    });

    const response = fileUploadResponseSchema.parse({
      key: result.key,
      url: `${base}/${result.key}`,
      bytes: result.bytes,
      mime: result.mime,
    });

    return c.json(response, 200);
  });

  return app;
}
