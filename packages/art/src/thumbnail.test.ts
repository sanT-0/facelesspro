/** Mandatory real-ffmpeg gate for thumbnail extraction. */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { extractThumbnail } from './thumbnail';

const TEMP_ROOT = '.data';
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function ffmpeg(args: string[]): void {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
}

describe('extractThumbnail (real ffmpeg)', () => {
  it('extracts the 25% frame, downscales to 1280 and is byte-idempotent', async () => {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const directory = mkdtempSync(join(TEMP_ROOT, 'thumbnail-'));
    temporaryDirectories.push(directory);
    const video = join(directory, 'source.mp4');
    const output = join(directory, 'nested', 'thumbnail.png');

    // First 0.5 s red, remaining 3.5 s blue. The selected 1.0 s frame must be
    // blue, proving this is the 25% decision rather than frame zero.
    ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:r=30:d=0.5',
      '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:r=30:d=3.5',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', video,
    ]);

    const first = await extractThumbnail(video, output);
    expect(first).toMatchObject({
      outputPath: output,
      width: 1280,
      height: 720,
      timestampMs: 1000,
      sourceWidth: 1920,
      sourceHeight: 1080,
      durationMs: 4000,
    });
    expect(first.bytes).toBeGreaterThan(1_000);

    const png = readFileSync(output);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(720);

    // Decode one RGB frame and inspect its centre. H.264/YUV rounding means
    // "blue" is a broad channel assertion, not an exact byte.
    const decoded = spawnSync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-i', output,
        '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
      ],
      { encoding: null, maxBuffer: 4 * 1024 * 1024 },
    );
    if (decoded.error !== undefined) throw decoded.error;
    expect(decoded.status, decoded.stderr.toString('utf8')).toBe(0);
    const offset = (Math.floor(720 / 2) * 1280 + Math.floor(1280 / 2)) * 3;
    expect(decoded.stdout[offset + 2] ?? 0).toBeGreaterThan((decoded.stdout[offset] ?? 0) + 100);

    const firstBytes = readFileSync(output);
    const second = await extractThumbnail(video, output);
    expect(second.bytes).toBe(first.bytes);
    expect(readFileSync(output)).toEqual(firstBytes);
    expect(readdirSync(join(directory, 'nested'))).toEqual(['thumbnail.png']);
    expect(existsSync(`${output}.part`)).toBe(false);
    expect(existsSync(video)).toBe(true);
  }, 120_000);

  it('surfaces a missing source and removes a partial output', async () => {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const directory = mkdtempSync(join(TEMP_ROOT, 'thumbnail-error-'));
    temporaryDirectories.push(directory);
    const output = join(directory, 'thumbnail.png');

    await expect(
      extractThumbnail(join(directory, 'missing.mp4'), output),
    ).rejects.toThrow(/ffprobe/i);
    expect(existsSync(output)).toBe(false);
    expect(existsSync(`${output}.part`)).toBe(false);
  });
});
