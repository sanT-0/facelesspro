/**
 * Row → wire mapping for a video, shared by `GET /v1/videos/:id` and
 * `POST /v1/videos/:id/render`.
 *
 * The row stores a storage key (`ws/.../render-1080p-30-standard.mp4`); the wire
 * contract wants an absolute public URL, so the key is rewritten through
 * `PUBLIC_BASE_URL` + the api's stable `/files/*` prefix (docs/03 §5, docs/10).
 * An absolute value is passed through untouched, so pointing a deployment at a
 * CDN later changes configuration, not code.
 *
 * Nothing is inferred from timing: a completed video must carry the render key
 * its step wrote, and a failed one keeps `step` because that is the resume
 * point (docs/01 §2). `thumbnailUrl` stays absent until the pipeline stores a
 * video→thumbnail link; the current `render` row links only the mp4.
 */

import { apiErrorBodySchema } from '@facelesspro/contracts';
import type { VideoResponse, VideoRow } from '@facelesspro/contracts';

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/** A row that exists but cannot be published without lying to the client. */
export class UnpublishableVideo extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnpublishableVideo';
  }
}

/**
 * `ws/<ws>/videos/<id>/render-….mp4` → `<base>/files/ws/<ws>/videos/<id>/render-….mp4`.
 * Each segment is encoded because a key may contain dots or dashes but never a
 * slash inside one.
 */
function absoluteFileUrl(value: string, base: string): string {
  if (ABSOLUTE_URL.test(value)) return value;
  if (value.startsWith('/')) return `${base}${value}`;
  return `${base}/files/${value.split('/').map(encodeURIComponent).join('/')}`;
}

function storedRenderKey(row: VideoRow): string | null {
  const key = row.video_url;
  if (key === null || key === undefined || key.trim().length === 0) return null;
  return key;
}

/** docs/07 §2.1: the create request either asked for an mp4 or it did not. */
function renderRequested(row: VideoRow): boolean {
  const value = row.request.body.render;
  return value !== undefined && value !== null;
}

export function toVideoResponse(row: VideoRow, base: string): VideoResponse {
  const key = storedRenderKey(row);
  // Committed behaviour: a completed video has a public, stable `videoUrl`.
  if (row.status === 'completed' && key === null) {
    throw new UnpublishableVideo('completed video has no render');
  }

  const storedError = row.error;
  let error: VideoResponse['error'] = null;
  if (storedError !== null && storedError !== undefined) {
    const parsed = apiErrorBodySchema.shape.error.safeParse(storedError);
    if (!parsed.success) {
      throw new UnpublishableVideo('stored video error is invalid');
    }
    error = parsed.data;
  }

  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    step: row.step ?? null,
    render: renderRequested(row),
    ...(key === null ? {} : { videoUrl: absoluteFileUrl(key, base) }),
    ...(row.duration_ms === null || row.duration_ms === undefined
      ? {}
      : { durationMs: row.duration_ms }),
    error,
    editorUrl: `${base}/editor?id=${encodeURIComponent(row.id)}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
