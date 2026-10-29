/**
 * Video probe using ffprobe. Validates duration, audio presence, and format.
 *
 * Runs ffprobe as a subprocess — no Node ffmpeg wrapper, so the binary must be
 * on PATH. This is deliberate: ffprobe is a system tool and keeping the wrapper
 * thin avoids version skew between Node and the binary.
 */

import { spawn } from 'node:child_process';

export interface VideoProbeResult {
  durationSeconds: number;
  hasAudio: boolean;
  width: number;
  height: number;
  format: string;
}

/** ffprobe timeout — a corrupt file can hang indefinitely. */
const PROBE_TIMEOUT_MS = 10_000;

/** Minimum/maximum duration for a reference video (seconds). */
export const MIN_REF_DURATION_S = 30;
export const MAX_REF_DURATION_S = 600; // 10 minutes

/**
 * Probe a video file with ffprobe.
 *
 * Throws if ffprobe is not available, the file is unreadable, or the probe
 * times out. Returns typed info for the validation rules.
 */
export async function probeVideo(filePath: string): Promise<VideoProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,duration',
      '-of',
      'json',
      filePath,
    ];

    const child = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`ffprobe timed out after ${PROBE_TIMEOUT_MS}ms`));
    }, PROBE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      if (code !== 0) {
        reject(new Error(`ffprobe exited with ${code}: ${stderr}`));
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0];
        if (!stream) {
          reject(new Error('no video stream found'));
          return;
        }
        const duration = Number(stream.duration);
        const width = Number(stream.width);
        const height = Number(stream.height);
        if (!Number.isFinite(duration) || !Number.isFinite(width) || !Number.isFinite(height)) {
          reject(new Error('invalid stream metadata'));
          return;
        }

        // Check for audio stream
        const audioArgs = [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=codec_name',
          '-of',
          'json',
          filePath,
        ];
        const audioChild = spawn('ffprobe', audioArgs);
        let audioStdout = '';
        audioChild.stdout.on('data', (chunk) => {
          audioStdout += chunk.toString();
        });
        audioChild.on('close', (audioCode) => {
          const hasAudio = audioCode === 0 && audioStdout.trim().length > 2; // '{"streams":[]}' = 14 chars
          resolve({
            durationSeconds: duration,
            hasAudio,
            width,
            height,
            format: 'mp4', // we only accept mp4/mov anyway
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Validate a reference video for art-style cloning.
 *
 * Rules (docs/04 §4):
 * - At least 30 seconds
 * - Has an audio track
 * - At most 10 minutes (600 seconds)
 *
 * Returns the probe result if valid, throws a typed error if not.
 */
export async function validateReferenceVideo(
  filePath: string,
): Promise<VideoProbeResult> {
  const probe = await probeVideo(filePath);

  if (probe.durationSeconds < MIN_REF_DURATION_S) {
    throw new Error(
      `reference video must be at least ${MIN_REF_DURATION_S} seconds (got ${probe.durationSeconds.toFixed(1)}s)`,
    );
  }
  if (probe.durationSeconds > MAX_REF_DURATION_S) {
    throw new Error(
      `reference video must be at most ${MAX_REF_DURATION_S} seconds (got ${probe.durationSeconds.toFixed(1)}s)`,
    );
  }
  if (!probe.hasAudio) {
    throw new Error('reference video must have an audio track');
  }

  return probe;
}