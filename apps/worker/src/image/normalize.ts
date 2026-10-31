/** Provider image bytes → exact-size PNG through the repo's ffmpeg binary. */

import { MAX_IMAGE_OUTPUT_SIDE } from '@facelesspro/contracts';

import { runProcess } from '../art-style/frame-decode';

export interface NormalizeTarget {
  readonly width: number;
  readonly height: number;
}

export type NormalizeImage = (
  bytes: Uint8Array,
  target: NormalizeTarget,
) => Promise<Uint8Array>;

const NORMALIZE_TIMEOUT_MS = 120_000;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

function assertTarget(target: NormalizeTarget): void {
  if (
    !Number.isInteger(target.width) ||
    !Number.isInteger(target.height) ||
    target.width < 1 ||
    target.height < 1 ||
    target.width > MAX_IMAGE_OUTPUT_SIDE ||
    target.height > MAX_IMAGE_OUTPUT_SIDE
  ) {
    throw new TypeError(
      `image target must be positive integers up to ${MAX_IMAGE_OUTPUT_SIDE}, got ` +
        `${target.width}x${target.height}`,
    );
  }
}

/**
 * Decode any ffmpeg-supported provider image, centre-crop to the requested
 * aspect, and emit one RGB PNG. Upscaling is intentional: provider APIs such as
 * Flux Schnell expose no width/height input but our adapter contract does.
 */
export const normalizeImageToPng: NormalizeImage = async (bytes, target) => {
  if (bytes.byteLength === 0) throw new TypeError('cannot normalize an empty provider image');
  assertTarget(target);

  const { code, stdout, stderr } = await runProcess(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      'pipe:0',
      '-vf',
      `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase,` +
        `crop=${target.width}:${target.height},setsar=1,format=rgb24`,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      'pipe:1',
    ],
    NORMALIZE_TIMEOUT_MS,
    bytes,
  );
  if (code !== 0) {
    throw new Error(`ffmpeg image normalization exited with ${code}: ${stderr.trim()}`);
  }
  if (stdout.length === 0) throw new Error('ffmpeg image normalization returned no PNG bytes');
  if (!isPng(stdout)) throw new Error('ffmpeg image normalization output is not a PNG');
  return stdout;
};
