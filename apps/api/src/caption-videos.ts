/**
 * `POST /v1/caption-videos` — create a video from an uploaded media file.
 *
 * Multipart form with:
 * - `file`: the video/audio file (required)
 * - `templateId`: caption template id (optional)
 * - `render`: JSON render options (optional)
 * - `webhookUrl`: callback URL (optional)
 *
 * Validates the file, stores it, inserts the video row with kind='caption',
 * and enqueues `create-scenes` which will run ASR on the uploaded file.
 */

import { Hono } from 'hono';

import {
  apiError,
  captionVideoMetaSchema,
  captionVideoUrlSchema,
  createVideoResponseSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';
import type { SubmitVideo } from './video-submit';

export type { SubmitVideo, SubmitVideoInput } from './video-submit';

export interface CaptionVideosRouteDeps extends AuthDeps {
  /** Store the uploaded file and return its storage key. */
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
  /** Insert the video row and enqueue `create-scenes` in one transaction. */
  readonly submitVideo: SubmitVideo;
  /** Absolute origin that serves `/files/*`, e.g. `http://127.0.0.1:3001`. */
  readonly publicBaseUrl: string;
}

export function createCaptionVideosRoutes(
  deps: CaptionVideosRouteDeps,
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  const base = deps.publicBaseUrl.replace(/\/+$/, '');
  if (base.length === 0) throw new TypeError('publicBaseUrl is empty');

  app.use('*', withWorkspace(deps));

  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId');

    // Parse multipart form
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json(
        apiError('invalid_request', 'request must be multipart/form-data'),
        400,
      );
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return c.json(
        apiError('invalid_request', 'missing or invalid `file` field', 'file'),
        400,
      );
    }

    // Validate file extension
    const filename = file.name;
    const parsedUrl = captionVideoUrlSchema.safeParse(`https://example.com/${filename}`);
    if (!parsedUrl.success) {
      return c.json(
        apiError('invalid_request', 'file must have a supported video/audio extension', 'file'),
        400,
      );
    }

    // Parse optional JSON fields
    const templateIdStr = formData.get('templateId');
    const renderStr = formData.get('render');
    const webhookUrlStr = formData.get('webhookUrl');

    const metaInput: Record<string, unknown> = {};
    if (templateIdStr !== null) metaInput.templateId = templateIdStr;
    if (renderStr !== null) {
      try {
        metaInput.render = JSON.parse(renderStr as string);
      } catch {
        return c.json(
          apiError('invalid_request', '`render` must be valid JSON', 'render'),
          400,
        );
      }
    }
    if (webhookUrlStr !== null) metaInput.webhookUrl = webhookUrlStr;

    const metaParsed = captionVideoMetaSchema.safeParse(metaInput);
    if (!metaParsed.success) {
      const issue = metaParsed.error.issues[0];
      const field = issue?.path.join('.') ?? undefined;
      return c.json(
        apiError('invalid_request', issue?.message ?? 'invalid metadata', field),
        400,
      );
    }

    // Read file bytes
    const arrayBuffer = await file.arrayBuffer();
    const mime = file.type || 'application/octet-stream';

    // Store the file
    const stored = await deps.storeFile({
      name: filename,
      type: mime,
      arrayBuffer: async () => arrayBuffer,
    });

    // Submit video with kind='caption' — create-scenes will run ASR on this file
    const videoId = await deps.submitVideo({
      workspaceId,
      body: {
        kind: 'caption',
        body: {
          url: stored.key, // storage key, not a URL
          templateId: metaParsed.data.templateId,
          render: metaParsed.data.render,
          webhookUrl: metaParsed.data.webhookUrl,
        },
      },
    });

    return c.json(
      createVideoResponseSchema.parse({
        videoId,
        status: 'processing',
        step: 'create-scenes',
        videoUrl: null,
      }),
      202,
    );
  });

  return app;
}