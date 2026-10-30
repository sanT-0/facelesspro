import { describe, expect, it, vi, beforeEach } from 'vitest';

import { sampleFrames } from './frame-sampling';
import type { Dirent } from 'node:fs';

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
  rm: vi.fn(async () => {}),
}));

import { spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';

const mockSpawn = vi.mocked(spawn);
const mockReaddir = vi.mocked(readdir);
const mockRm = vi.mocked(rm);

// Use a map of command signatures to responses
const spawnResponses = new Map<string, { stderr: string; exitCode: number; stdout?: string }>();

function resetSpawn() {
  spawnResponses.clear();
  mockSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
    // Match by command type and key args
    let response: { stderr: string; exitCode: number; stdout?: string } | undefined;

    if (cmd === 'ffprobe' && args.includes('-show_entries') && args.includes('stream=duration')) {
      response = spawnResponses.get('ffprobe-duration');
    } else if (cmd === 'ffmpeg' && args.some((a) => a.includes('scdet'))) {
      response = spawnResponses.get('ffmpeg-scene-detection');
    } else if (cmd === 'ffmpeg' && args.includes('-frames:v') && args.includes('1')) {
      response = spawnResponses.get('ffmpeg-extract-frame');
    }

    response = response ?? { stderr: '', exitCode: 0 };

    const listeners: Record<string, Array<(code?: number) => void>> = {};
    const child = {
      stdout: {
        on: vi.fn((event, cb) => {
          if (event === 'data' && response.stdout !== undefined) {
            cb(response.stdout);
          }
        }),
      },
      stderr: {
        on: vi.fn((event, cb) => {
          if (event === 'data' && response.stderr) {
            cb(response.stderr);
          }
        }),
      },
      on: vi.fn((event, cb) => {
        listeners[event] = [cb];
      }),
      kill: vi.fn(),
      emit: (event: string, code?: number) => {
        listeners[event]?.forEach((cb) => cb(code ?? response!.exitCode));
      },
    };
    // Emit close synchronously
    setImmediate(() => child.emit('close'));
    return child as unknown as ReturnType<typeof spawn>;
  });
}

function mockFfmpegSceneDetection(stderr: string = '', exitCode = 0) {
  spawnResponses.set('ffmpeg-scene-detection', { stderr, exitCode });
}

function mockFfmpegExtractFrame(_timestamp: number, exitCode = 0) {
  spawnResponses.set('ffmpeg-extract-frame', { stderr: '', exitCode });
}

function mockFfprobeDuration(stdout: string = '30.0\n', exitCode = 0) {
  spawnResponses.set('ffprobe-duration', { stderr: '', exitCode, stdout });
}

describe('sampleFrames', () => {
  const artStyleId = '550e8400-e29b-41d4-a716-446655440000';
  const videoPath = '/fake/path/reference.mp4';

  beforeEach(() => {
    vi.clearAllMocks();
    resetSpawn();
    mockReaddir.mockResolvedValue([]);
    mockRm.mockResolvedValue(undefined);
  });

  it('detects scenes and extracts frames', async () => {
    // 5 scenes at positions that won't overlap with spaced frames (7.5, 15, 22.5)
    mockFfmpegSceneDetection(`
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 45, lavfi.scd.time: 1.23
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 78, lavfi.scd.time: 4.67
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 52, lavfi.scd.time: 9.34
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 61, lavfi.scd.time: 18.67
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 68, lavfi.scd.time: 25.34
`);
    mockFfmpegExtractFrame(1.23);
    mockFfmpegExtractFrame(4.67);
    mockFfmpegExtractFrame(9.34);
    mockFfmpegExtractFrame(18.67);
    mockFfmpegExtractFrame(25.34);
    // Spaced frames at 25%, 50%, 75% of 30s = 7.5, 15, 22.5
    mockFfmpegExtractFrame(7.5);
    mockFfmpegExtractFrame(15);
    mockFfmpegExtractFrame(22.5);
    mockFfprobeDuration('30.0\n');

    const frames = await sampleFrames(artStyleId, videoPath);

    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames[0]!.source).toBe('scene');
    expect(frames[0]!.timestampSeconds).toBeCloseTo(1.23, 1);
    expect(frames[0]!.score).toBeCloseTo(0.45, 2);
  });

  it('adds evenly spaced frames when scene detection yields few frames', async () => {
    // Scene frames at positions that won't overlap with spaced frames (15, 30, 45)
    mockFfmpegSceneDetection(`
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 50, lavfi.scd.time: 3.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 60, lavfi.scd.time: 9.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 55, lavfi.scd.time: 21.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 65, lavfi.scd.time: 27.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 70, lavfi.scd.time: 39.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 75, lavfi.scd.time: 51.0
`);
    // 6 scene frames + 3 spaced = 9 frames (spaced at 15, 30, 45 won't overlap)
    mockFfmpegExtractFrame(3);
    mockFfmpegExtractFrame(9);
    mockFfmpegExtractFrame(21);
    mockFfmpegExtractFrame(27);
    mockFfmpegExtractFrame(39);
    mockFfmpegExtractFrame(51);
    mockFfmpegExtractFrame(15); // spaced at 25% of 60s
    mockFfmpegExtractFrame(30); // spaced at 50%
    mockFfmpegExtractFrame(45); // spaced at 75%
    mockFfprobeDuration('60.0\n');

    const frames = await sampleFrames(artStyleId, videoPath);

    const sources = frames.map((f) => f.source);
    expect(sources).toContain('scene');
    expect(sources).toContain('spaced');
  });

  it('deduplicates frames within 1 second', async () => {
    // 6 scenes + 3 spaced = 9 frames, with one dedup = 8 frames
    mockFfmpegSceneDetection(`
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 50, lavfi.scd.time: 2.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 60, lavfi.scd.time: 6.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 55, lavfi.scd.time: 10.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 65, lavfi.scd.time: 14.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 70, lavfi.scd.time: 18.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 75, lavfi.scd.time: 22.0
`);
    // 6 scene frames at 2, 6, 10, 14, 18, 22
    // 3 spaced frames at 10 (deduped with scene), 20, 30
    mockFfmpegExtractFrame(2);
    mockFfmpegExtractFrame(6);
    mockFfmpegExtractFrame(10);
    mockFfmpegExtractFrame(14);
    mockFfmpegExtractFrame(18);
    mockFfmpegExtractFrame(22);
    mockFfmpegExtractFrame(10); // spaced at 10s (deduped)
    mockFfmpegExtractFrame(20);
    mockFfmpegExtractFrame(30);
    mockFfprobeDuration('40.0\n');

    const frames = await sampleFrames(artStyleId, videoPath);

    expect(frames.length).toBe(8); // 6 scenes + 2 spaced (one deduped)
    const nearTen = frames.filter((f) => Math.abs(f.timestampSeconds - 10) < 1);
    expect(nearTen.length).toBe(1);
  });

  it('caps at 24 frames, preferring highest-scoring scene frames', async () => {
    const sceneStderr = Array.from({ length: 25 }, (_, i) => {
      const score = (0.3 + (i % 7) * 0.1) * 100;
      return `[Parsed_scdet_0 @ 0x...] lavfi.scd.score: ${score.toFixed(1)}, lavfi.scd.time: ${i * 2}`;
    }).join('\n');
    mockFfmpegSceneDetection(sceneStderr);

    for (let i = 0; i < 25; i += 1) mockFfmpegExtractFrame(i * 2);
    mockFfmpegExtractFrame(15); // spaced 25% of 60s
    mockFfmpegExtractFrame(30); // spaced 50%
    mockFfmpegExtractFrame(45); // spaced 75%
    mockFfprobeDuration('60.0\n');

    const frames = await sampleFrames(artStyleId, videoPath);

    expect(frames.length).toBeLessThanOrEqual(24);
    const sceneFrames = frames.filter((f) => f.source === 'scene');
    // The kept scene frames should be the highest-scoring ones
    const scores = sceneFrames.map((f) => f.score ?? 0);
    // max score from pattern 0.3 + (i % 7) * 0.1 = 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, repeat
    expect(Math.max(...scores)).toBeCloseTo(0.9, 5);
    // Should have kept ~21 scene frames (24 - 3 spaced, but deduplication may vary)
    expect(sceneFrames.length).toBeGreaterThanOrEqual(20);
    expect(sceneFrames.length).toBeLessThanOrEqual(22);
  });

  it('pads to eight frames when a reference has only a few cuts', async () => {
    // Three cuts in a 40 s reference: 3 scene frames + 3 spaced = 6, so two
    // more must be spaced in rather than rejecting a valid upload.
    mockFfmpegSceneDetection(`
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 40, lavfi.scd.time: 5.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 55, lavfi.scd.time: 15.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 62, lavfi.scd.time: 25.0
`);
    mockFfprobeDuration('40.0\n');

    const frames = await sampleFrames(artStyleId, videoPath);

    expect(frames.length).toBe(8);
    expect(frames.some((frame) => frame.source === 'spaced')).toBe(true);
    expect(frames.at(-1)!.timestampSeconds).toBeLessThanOrEqual(40);
  });

  it('throws when fewer than 8 frames total', async () => {
    mockFfmpegSceneDetection(''); // no scenes
    // Spaced frames at 25%, 50%, 75% of 5s = 1.25, 2.5, 3.75
    mockFfmpegExtractFrame(1.25);
    mockFfmpegExtractFrame(2.5);
    mockFfmpegExtractFrame(3.75);
    mockFfprobeDuration('5.0\n');

    await expect(sampleFrames(artStyleId, videoPath)).rejects.toThrow(/insufficient frames/);
  });

  it('handles ffmpeg scene detection errors', async () => {
    mockFfmpegSceneDetection('ffmpeg error', 2); // exit code 2 = error

    await expect(sampleFrames(artStyleId, videoPath)).rejects.toThrow(/exited with 2/);
  });

  it('handles ffprobe errors', async () => {
    mockFfmpegSceneDetection(''); // scene detection succeeds (no scenes)
    mockFfmpegExtractFrame(1.25);
    mockFfmpegExtractFrame(2.5);
    mockFfmpegExtractFrame(3.75);
    mockFfprobeDuration('invalid', 1); // ffprobe fails with exit code 1

    await expect(sampleFrames(artStyleId, videoPath)).rejects.toThrow(/ffprobe duration failed with 1/);
  });

  it('cleans existing frames before sampling', async () => {
    mockReaddir.mockResolvedValue(['old-frame.png', 'another.png'] as unknown as Dirent<NonSharedBuffer>[]);
    mockFfmpegSceneDetection(`
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 50, lavfi.scd.time: 2.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 60, lavfi.scd.time: 6.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 55, lavfi.scd.time: 10.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 65, lavfi.scd.time: 14.0
[Parsed_scdet_0 @ 0x...] lavfi.scd.score: 70, lavfi.scd.time: 18.0
`); // 5 scenes, well spaced
    // 5 scene frames + 3 spaced = 8 frames (spaced at 7.5, 15, 22.5 won't overlap)
    for (let i = 0; i < 8; i += 1) mockFfmpegExtractFrame(i * 3);
    mockFfprobeDuration('30.0\n');

    await sampleFrames(artStyleId, videoPath);

    expect(mockRm).toHaveBeenCalledTimes(2);
  });
});