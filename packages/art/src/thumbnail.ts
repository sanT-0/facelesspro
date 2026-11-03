/**
 * Atomic PNG thumbnail extraction from a completed render.
 *
 * ffprobe supplies source geometry/duration; pure core chooses the timestamp
 * and output size; ffmpeg writes a `.part` PNG which is verified before it
 * replaces the destination. A retry therefore never treats a truncated image
 * as a completed artifact.
 */

import { spawn } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildThumbnailPlan } from '@facelesspro/core';
import type { ThumbnailPlan, ThumbnailSourceMeta } from '@facelesspro/core';

const PROBE_TIMEOUT_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 60_000;
const STDERR_TAIL = 16_384;
const PNG_SIGNATURE = '89504e470d0a1a0a';

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

function run(
  binary: 'ffmpeg' | 'ffprobe',
  args: readonly string[],
  timeoutMs: number,
): Promise<ProcessOutput> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(binary, [...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`${binary} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > STDERR_TAIL) stderr = stderr.slice(-STDERR_TAIL);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`${binary} could not start: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) {
        reject(new Error(`${binary} exited with ${code ?? 'signal'}: ${stderr.trim()}`));
        return;
      }
      resolveProcess({ stdout, stderr });
    });
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function probeVideo(path: string): Promise<ThumbnailSourceMeta> {
  const result = await run(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      path,
    ],
    PROBE_TIMEOUT_MS,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error('ffprobe returned invalid JSON for thumbnail source');
  }
  const root = record(parsed);
  const streams = root?.streams;
  const stream = Array.isArray(streams) ? record(streams[0]) : null;
  const format = record(root?.format);
  const width = stream?.width;
  const height = stream?.height;
  const duration = format?.duration;
  const durationSeconds =
    typeof duration === 'string' || typeof duration === 'number'
      ? Number(duration)
      : Number.NaN;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new Error('ffprobe returned invalid thumbnail source metadata');
  }
  return {
    width,
    height,
    durationMs: Math.max(1, Math.round(durationSeconds * 1000)),
  };
}

function verifyPng(path: string, plan: ThumbnailPlan): number {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    throw new Error('ffmpeg thumbnail output is not a PNG');
  }
  if (bytes.readUInt32BE(16) !== plan.width || bytes.readUInt32BE(20) !== plan.height) {
    throw new Error('ffmpeg thumbnail output has unexpected dimensions');
  }
  return bytes.length;
}

export interface ThumbnailResult extends ThumbnailPlan {
  outputPath: string;
  bytes: number;
}

/** Extract and atomically publish one deterministic RGB PNG thumbnail. */
export async function extractThumbnail(
  videoPath: string,
  outputPath: string,
): Promise<ThumbnailResult> {
  if (resolve(videoPath) === resolve(outputPath)) {
    throw new Error('thumbnail outputPath must differ from videoPath');
  }
  const source = await probeVideo(videoPath);
  const plan = buildThumbnailPlan(source);
  mkdirSync(dirname(outputPath), { recursive: true });
  const partialPath = `${outputPath}.part`;
  rmSync(partialPath, { force: true });

  try {
    await run(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', (plan.timestampMs / 1000).toFixed(3),
        '-i', videoPath,
        '-map', '0:v:0',
        '-frames:v', '1',
        '-vf', `scale=${plan.width}:${plan.height}:flags=lanczos`,
        '-an',
        '-sn',
        '-dn',
        '-map_metadata', '-1',
        '-pix_fmt', 'rgb24',
        '-c:v', 'png',
        '-f', 'image2',
        partialPath,
      ],
      EXTRACT_TIMEOUT_MS,
    );
    const verifiedBytes = verifyPng(partialPath, plan);
    renameSync(partialPath, outputPath);
    const publishedBytes = statSync(outputPath).size;
    if (publishedBytes !== verifiedBytes) {
      throw new Error('thumbnail size changed while publishing');
    }
    return {
      ...plan,
      outputPath,
      bytes: publishedBytes,
    };
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  }
}
