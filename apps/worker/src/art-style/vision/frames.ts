/**
 * Frames for the vision adapter: pick a bounded spread, downscale, base64.
 *
 * Two cost decisions live here rather than in each adapter:
 * - **6 frames maximum.** A description barely changes between frames 7 and 24,
 *   but the token bill does. The selection is evenly spaced and always includes
 *   the first and last frame, so every scene in the reference is represented.
 * - **384 px long edge.** Enough to read line weight and typography, small
 *   enough to keep a six-image request cheap. Never upscaled, for the same
 *   reason the numeric pass never upscales.
 *
 * JPEG at `-q:v 4`: the description does not need lossless pixels, and PNG
 * base64 of six frames is several megabytes.
 */

import type { VisionFrame } from './types';

import { fitWithin, probeFrameSize, runProcess } from '../frame-decode';

/** Frames sent to a VLM per request. */
export const VISION_MAX_FRAMES = 6;
/** Long-edge ceiling for a VLM frame. */
export const VISION_MAX_SIZE = 384;

const FFMPEG_TIMEOUT_MS = 60_000;
const JPEG_QUALITY = '4';

/**
 * Evenly spaced subset, first and last included.
 *
 * @throws TypeError on an empty list or a non-positive cap — both are bugs in
 *         the caller, not a reference video with too few frames.
 */
export function selectVisionFrames(
  framePaths: readonly string[],
  maxFrames: number = VISION_MAX_FRAMES,
): string[] {
  if (!Number.isInteger(maxFrames) || maxFrames < 1) {
    throw new TypeError(`maxFrames must be a positive integer, got ${String(maxFrames)}`);
  }
  if (framePaths.length === 0) {
    throw new TypeError('selectVisionFrames needs at least one frame');
  }
  if (framePaths.length <= maxFrames) return [...framePaths];

  if (maxFrames === 1) {
    return [framePaths[Math.floor((framePaths.length - 1) / 2)]!];
  }

  const selected: string[] = [];
  for (let index = 0; index < maxFrames; index += 1) {
    const sourceIndex = Math.round((index * (framePaths.length - 1)) / (maxFrames - 1));
    const path = framePaths[sourceIndex]!;
    if (!selected.includes(path)) selected.push(path);
  }
  return selected;
}

/**
 * Downscale one frame to JPEG and return it as base64.
 *
 * @throws when ffprobe or ffmpeg fails, or ffmpeg returns no bytes.
 */
export async function encodeVisionFrame(framePath: string): Promise<VisionFrame> {
  const sourceSize = await probeFrameSize(framePath);
  const target = fitWithin(sourceSize, VISION_MAX_SIZE);

  const { code, stdout, stderr } = await runProcess(
    'ffmpeg',
    [
      '-v', 'error',
      '-i', framePath,
      '-vf', `scale=${target.width}:${target.height}:flags=lanczos`,
      '-frames:v', '1',
      '-q:v', JPEG_QUALITY,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-',
    ],
    FFMPEG_TIMEOUT_MS,
  );
  if (code !== 0) {
    throw new Error(`ffmpeg vision encode exited with ${code}: ${stderr.trim()}`);
  }
  if (stdout.length === 0) {
    throw new Error('ffmpeg vision encode returned no bytes');
  }
  return {
    path: framePath,
    mimeType: 'image/jpeg',
    data: stdout.toString('base64'),
  };
}

/** Select, downscale and encode the frames for one vision request. */
export async function loadVisionFrames(
  framePaths: readonly string[],
  options: { maxFrames?: number } = {},
): Promise<VisionFrame[]> {
  const selected = selectVisionFrames(framePaths, options.maxFrames ?? VISION_MAX_FRAMES);
  const frames: VisionFrame[] = [];
  // Sequential on purpose: six ffmpeg processes at once on a small VM is a
  // memory spike for no wall-clock gain.
  for (const path of selected) {
    frames.push(await encodeVisionFrame(path));
  }
  return frames;
}
