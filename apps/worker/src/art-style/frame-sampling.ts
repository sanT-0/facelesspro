/**
 * Frame sampling with scene detection for art-style cloning.
 *
 * Runs ffmpeg with scene detection filter to extract key frames at scene changes,
 * plus evenly spaced frames. Saves as PNG for downstream numeric/VLM analysis.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface FrameSample {
  /** Absolute path to the saved PNG. */
  path: string;
  /** Timestamp in seconds from video start. */
  timestampSeconds: number;
  /** Whether this frame came from scene detection or even spacing. */
  source: 'scene' | 'spaced';
  /** Scene change score (0–1), only for scene-sourced frames. */
  score?: number;
}

/** Scene change threshold for ffmpeg's scene filter. 0.3 is a good default. */
const SCENE_THRESHOLD = 0.3;

/** Maximum frames to keep after combining scene + spaced frames. */
const MAX_FRAMES = 24;
/** Minimum frames required (pads with spaced frames if scene detection yields few). */
const MIN_FRAMES = 8;

/** Output directory for frames. */
const FRAMES_ROOT = process.env.FRAMES_DIR ?? join(process.cwd(), 'storage', 'frames');

/** ffmpeg timeout — a corrupt file can hang. */
const FFMPEG_TIMEOUT_MS = 60_000;

/**
 * Run ffmpeg scene detection and return scene change timestamps with scores.
 */
async function detectScenes(videoPath: string): Promise<Array<{ timestamp: number; score: number }>> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-i', videoPath,
      '-filter:v', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      '-f', 'null', '-',
    ];

    const child = spawn('ffmpeg', args);
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg scene detection timed out after ${FFMPEG_TIMEOUT_MS}ms`));
    }, FFMPEG_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      if (code !== 0 && code !== 1) { // ffmpeg returns 1 when filter drops all frames
        reject(new Error(`ffmpeg scene detection exited with ${code}: ${stderr}`));
        return;
      }

      // Parse showinfo output: "pts_time:12.34 ... scene_score:0.56"
      const scenes: Array<{ timestamp: number; score: number }> = [];
      const lines = stderr.split('\n');
      for (const line of lines) {
        const ptsMatch = line.match(/pts_time:([\d.]+)/);
        const scoreMatch = line.match(/scene_score:([\d.]+)/);
        if (ptsMatch && scoreMatch) {
          scenes.push({
            timestamp: parseFloat(ptsMatch[1]!),
            score: parseFloat(scoreMatch[1]!),
          });
        }
      }
      resolve(scenes);
    });
  });
}

/**
 * Extract a single frame at the given timestamp.
 */
async function extractFrame(
  videoPath: string,
  timestampSeconds: number,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-ss', timestampSeconds.toString(),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2', // High quality PNG
      '-y', // Overwrite
      outputPath,
    ];

    const child = spawn('ffmpeg', args);
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg frame extraction timed out after ${FFMPEG_TIMEOUT_MS}ms`));
    }, FFMPEG_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      if (code !== 0) {
        reject(new Error(`ffmpeg frame extraction exited with ${code}: ${stderr}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Get video duration using ffprobe.
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=duration',
      '-of', 'csv=p=0',
      videoPath,
    ];
    const child = spawn('ffprobe', args);
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe duration failed with ${code}`));
        return;
      }
      const duration = parseFloat(stdout.trim());
      if (!Number.isFinite(duration)) {
        reject(new Error('invalid duration from ffprobe'));
        return;
      }
      resolve(duration);
    });
  });
}

/**
 * Sample frames from a reference video.
 *
 * 1. Detect scene changes (threshold 0.3).
 * 2. Extract one frame per scene change.
 * 3. Add 3 evenly spaced frames (25%, 50%, 75%).
 * 4. Deduplicate by timestamp (±1 second).
 * 5. Cap at 24 frames, ensure at least 8.
 * 6. Save as PNG to storage/frames/<artStyleId>/.
 */
export async function sampleFrames(
  artStyleId: string,
  videoPath: string,
): Promise<FrameSample[]> {
  const outputDir = join(FRAMES_ROOT, artStyleId);
  await mkdir(outputDir, { recursive: true });

  // Clean any existing frames for this style
  const existing = await readdir(outputDir).catch(() => []);
  for (const file of existing) {
    await rm(join(outputDir, file)).catch(() => {});
  }

  // Step 1: Scene detection
  const scenes = await detectScenes(videoPath);
  const sceneFrames: FrameSample[] = [];

  // Step 2: Extract frames at scene changes
  for (let i = 0; i < scenes.length; i += 1) {
    const { timestamp, score } = scenes[i]!;
    const frameName = `frame-${i.toString().padStart(3, '0')}-${timestamp.toFixed(2)}s.png`;
    const framePath = join(outputDir, frameName);
    await extractFrame(videoPath, timestamp, framePath);
    sceneFrames.push({ path: framePath, timestampSeconds: timestamp, source: 'scene', score });
  }

  // Step 3: Evenly spaced frames
  const duration = await getVideoDuration(videoPath);
  const spacedTimestamps = [0.25, 0.5, 0.75].map((p) => duration * p);
  const spacedFrames: FrameSample[] = [];

  for (let i = 0; i < spacedTimestamps.length; i += 1) {
    const timestamp = spacedTimestamps[i]!;
    // Deduplicate: skip if within 1s of an existing scene frame
    const isDuplicate = sceneFrames.some((f) => Math.abs(f.timestampSeconds - timestamp) < 1.0);
    if (isDuplicate) continue;

    const frameName = `frame-spaced-${i}-${timestamp.toFixed(2)}s.png`;
    const framePath = join(outputDir, frameName);
    await extractFrame(videoPath, timestamp, framePath);
    spacedFrames.push({ path: framePath, timestampSeconds: timestamp, source: 'spaced' });
  }

  // Step 4: Combine, sort by timestamp, cap
  const allFrames = [...sceneFrames, ...spacedFrames].sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  // Deduplicate any remaining near-duplicates (±1s)
  const deduped: FrameSample[] = [];
  for (const frame of allFrames) {
    const isNear = deduped.some((d) => Math.abs(d.timestampSeconds - frame.timestampSeconds) < 1.0);
    if (!isNear) deduped.push(frame);
  }

  // Step 5: Cap at MAX_FRAMES, ensure MIN_FRAMES
  if (deduped.length > MAX_FRAMES) {
    // Keep highest-scoring scene frames first, then spaced frames
    const sceneOnly = deduped.filter((f) => f.source === 'scene').sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const spacedOnly = deduped.filter((f) => f.source === 'spaced');
    const keepScenes = sceneOnly.slice(0, MAX_FRAMES - spacedOnly.length);
    deduped.length = 0;
    deduped.push(...keepScenes, ...spacedOnly);
    deduped.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  }

  if (deduped.length < MIN_FRAMES) {
    // This shouldn't happen with 3 spaced frames + scene detection, but guard anyway
    throw new Error(`insufficient frames sampled: ${deduped.length} (minimum ${MIN_FRAMES})`);
  }

  return deduped;
}