/**
 * Deterministic thumbnail planning.
 *
 * Pick a frame one quarter into the completed render: late enough to avoid an
 * opening transition, early enough to represent the video's subject. Cap the
 * long edge at 1280 without upscaling or changing aspect ratio. I/O and ffmpeg
 * stay in `packages/art`.
 *
 * Pure: no I/O, no clock, no network.
 */

export const THUMBNAIL_POSITION = 0.25;
export const THUMBNAIL_MAX_EDGE = 1280;

export interface ThumbnailSourceMeta {
  width: number;
  height: number;
  durationMs: number;
}

export interface ThumbnailPlan {
  timestampMs: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  durationMs: number;
}

function positiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`thumbnail ${name} must be a positive integer (got ${value})`);
  }
}

export function thumbnailDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = THUMBNAIL_MAX_EDGE,
): { width: number; height: number } {
  positiveInteger('width', sourceWidth);
  positiveInteger('height', sourceHeight);
  positiveInteger('maxEdge', maxEdge);

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function thumbnailTimestampMs(durationMs: number): number {
  positiveInteger('durationMs', durationMs);
  return Math.min(
    Math.round(durationMs * THUMBNAIL_POSITION),
    Math.max(0, durationMs - 1),
  );
}

export function buildThumbnailPlan(source: ThumbnailSourceMeta): ThumbnailPlan {
  const dimensions = thumbnailDimensions(source.width, source.height);
  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    durationMs: source.durationMs,
    timestampMs: thumbnailTimestampMs(source.durationMs),
    ...dimensions,
  };
}
