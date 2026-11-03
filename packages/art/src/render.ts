/**
 * ffmpeg composer adapter.
 *
 * The plan (dimensions, frames, filter graph, args) is built by the pure
 * `@facelesspro/core` module; this file only makes directories, spawns ffmpeg
 * and reports what landed on disk. Keeping the split means a failed render
 * says which binary failed and shows ffmpeg's own tail, never a guessed error.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { buildRenderPlan } from '@facelesspro/core';
import type { RenderPlan, RenderPlanInput } from '@facelesspro/core';

export interface RenderResult {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  totalFrames: number;
  bytes: number;
  plan: RenderPlan;
}

const STDERR_TAIL = 16_384;

function ffmpeg(args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [...args], { windowsHide: true });
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > STDERR_TAIL) stderr = stderr.slice(-STDERR_TAIL);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg could not start: ${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with ${code ?? 'signal'}: ${stderr.trim()}`));
        return;
      }
      resolve();
    });
  });
}

/** Render one mp4. Rejects with ffmpeg's own stderr tail on failure. */
export async function renderVideo(input: RenderPlanInput): Promise<RenderResult> {
  const plan = buildRenderPlan(input);
  mkdirSync(dirname(input.outputPath), { recursive: true });

  // A render is CPU-bound; allow generous headroom over real time for 4K.
  const timeoutMs = Math.max(60_000, plan.durationMs * 10);
  await ffmpeg(plan.args, timeoutMs);

  return {
    outputPath: input.outputPath,
    width: plan.width,
    height: plan.height,
    fps: plan.fps,
    durationMs: plan.durationMs,
    totalFrames: plan.totalFrames,
    bytes: statSync(input.outputPath).size,
    plan,
  };
}
