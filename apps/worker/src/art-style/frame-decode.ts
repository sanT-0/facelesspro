/**
 * Frame → RGB24 bytes.
 *
 * The numeric pass needs pixels, and ffmpeg is already a hard requirement for
 * sampling, so decoding goes through ffmpeg rather than adding a PNG library:
 * `-f rawvideo -pix_fmt rgb24` writes exactly `width * height * 3` bytes to
 * stdout, which is the format `packages/core/src/style` consumes.
 *
 * Frames are scaled down before analysis: a 4K still costs 24 MB of bytes and
 * tells the k-means nothing a 128 px version does not. Small frames are left
 * alone (no upscale), because inventing pixels would change the statistics.
 */

import { spawn } from 'node:child_process';

/** Long-edge ceiling for decoded frames. */
export const DEFAULT_DECODE_MAX_SIZE = 128;

const FFMPEG_TIMEOUT_MS = 60_000;
const FFPROBE_TIMEOUT_MS = 30_000;

export interface FrameSize {
  width: number;
  height: number;
}

export interface DecodedFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface DecodeOptions {
  /** Long-edge ceiling. Default 128. */
  maxSize?: number;
  /** Already-known source size; skips the ffprobe call when supplied. */
  sourceSize?: FrameSize;
}

interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** Spawn a process, collect stdout as bytes and stderr as text, with a timeout. */
export function runProcess(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  stdin?: Uint8Array,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const chunks: Buffer[] = [];
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    if (stdin !== undefined) {
      // ffmpeg may close stdin early after reporting a decode error. Consume
      // EPIPE here and let the close code + stderr remain the useful failure.
      child.stdin.on('error', () => undefined);
      child.stdin.end(Buffer.from(stdin));
    }
    child.on('error', (error) => {
      clearTimeout(timeout);
      if (!timedOut) reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      resolve({ code: code ?? -1, stdout: Buffer.concat(chunks), stderr });
    });
  });
}

/**
 * Target size for analysis: the long edge is capped at `maxSize`, the aspect
 * ratio is preserved, and nothing is ever upscaled. Always >= 1 px per axis.
 */
export function fitWithin(size: FrameSize, maxSize: number): FrameSize {
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new TypeError(`maxSize must be a positive integer, got ${String(maxSize)}`);
  }
  const { width, height } = size;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new TypeError(`invalid frame size ${width}x${height}`);
  }
  const factor = Math.min(1, maxSize / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/** Native size of a PNG (or any single-image file) via ffprobe. */
export async function probeFrameSize(framePath: string): Promise<FrameSize> {
  const { code, stdout, stderr } = await runProcess(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      framePath,
    ],
    FFPROBE_TIMEOUT_MS,
  );
  if (code !== 0) {
    throw new Error(`ffprobe frame size failed with ${code}: ${stderr.trim()}`);
  }
  const [width, height] = stdout
    .toString()
    .trim()
    .split(',')
    .map((part) => Number.parseInt(part, 10));
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`invalid frame size from ffprobe: ${stdout.toString().trim()}`);
  }
  return { width, height };
}

/**
 * Decode one frame to RGB24, scaled to fit `maxSize`.
 *
 * @throws when ffmpeg fails or returns a byte count that does not match the
 *         requested dimensions — a truncated stream must not become statistics.
 */
export async function decodeFrame(
  framePath: string,
  options: DecodeOptions = {},
): Promise<DecodedFrame> {
  const sourceSize = options.sourceSize ?? (await probeFrameSize(framePath));
  const target = fitWithin(sourceSize, options.maxSize ?? DEFAULT_DECODE_MAX_SIZE);
  const expectedBytes = target.width * target.height * 3;

  const { code, stdout, stderr } = await runProcess(
    'ffmpeg',
    [
      '-v', 'error',
      '-i', framePath,
      '-vf', `scale=${target.width}:${target.height}:flags=lanczos`,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-',
    ],
    FFMPEG_TIMEOUT_MS,
  );
  if (code !== 0) {
    throw new Error(`ffmpeg frame decode exited with ${code}: ${stderr.trim()}`);
  }
  if (stdout.length !== expectedBytes) {
    throw new Error(
      `ffmpeg frame decode returned ${stdout.length} bytes, expected ${expectedBytes} ` +
        `for ${target.width}x${target.height}`,
    );
  }
  return {
    data: new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.length),
    width: target.width,
    height: target.height,
  };
}
