/**
 * Real-ffmpeg composer gate.
 *
 * AGENTS.md requires real ffmpeg in render tests. This renders two coloured
 * stills with motion, narration audio and burned-in Tamil captions, then
 * probes the result and samples pixels: a passing digest would prove nothing
 * about timing, so duration/resolution/fps/stream presence and "red then blue"
 * are hard assertions.
 */

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { buildAss, buildCaptionCues } from '@facelesspro/core';

import { renderVideo } from './render';

const TEMP_ROOT = '.data';
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function ffmpeg(args: string[]): Buffer {
  const result = spawnSync('ffmpeg', args, {
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString('utf8'));
  return result.stdout;
}

function probe(path: string): {
  streams: Array<{
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    nb_frames?: string;
    channels?: number;
    duration?: string;
  }>;
  format: { duration: string };
} {
  const result = spawnSync(
    'ffprobe',
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,channels,duration',
      '-show_entries', 'format=duration',
      '-of', 'json',
      path,
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as ReturnType<typeof probe>;
}

function frameAt(path: string, seconds: number): Buffer {
  return ffmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', seconds.toFixed(3),
    '-i', path,
    '-frames:v', '1',
    '-pix_fmt', 'rgb24',
    '-f', 'rawvideo',
    'pipe:1',
  ]);
}

function centrePixel(frame: Buffer, width: number, height: number): [number, number, number] {
  const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3;
  return [frame[offset] ?? 0, frame[offset + 1] ?? 0, frame[offset + 2] ?? 0];
}

describe('renderVideo (real ffmpeg)', () => {
  it('composes stills, audio and burned captions at the requested profile', async () => {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const directory = mkdtempSync(join(TEMP_ROOT, 'render-'));
    temporaryDirectories.push(directory);

    const red = join(directory, 'red.png');
    const blue = join(directory, 'blue.png');
    const audio = join(directory, 'voice.wav');
    // Absolute paths exercise Windows drive-colon escaping and Unix roots in
    // the real filter parser, not only in the pure escaping unit test.
    const ass = resolve(directory, 'captions.ass');
    const output = join(directory, 'out.mp4');
    const repeatOutput = join(directory, 'repeat.mp4');

    ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=1:d=1',
      '-frames:v', '1', red,
    ]);
    ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=1:d=1',
      '-frames:v', '1', blue,
    ]);
    ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5',
      '-c:a', 'pcm_s16le', audio,
    ]);

    const cues = buildCaptionCues(
      [
        { text: 'தமிழ்', startMs: 0, endMs: 700 },
        { text: 'வணக்கம்.', startMs: 700, endMs: 1500 },
      ],
      { wordLimit: 4, maxLines: 2, maxCharsPerLine: 30 },
    );
    writeFileSync(
      ass,
      buildAss(cues, { width: 1920, height: 1080 }, { fontSize: 64 }),
      'utf8',
    );

    const result = await renderVideo({
      scenes: [
        { imagePath: red, durationMs: 800, motion: 'kenburns-in' },
        { imagePath: blue, durationMs: 700, motion: 'none' },
      ],
      audioPath: audio,
      outputPath: output,
      resolution: 1080,
      fps: 30,
      size: 'landscape',
      format: 'standard',
      captions: { path: ass, fontsDir: resolve('packages/art/fonts/ttf') },
    });

    expect(result.outputPath).toBe(output);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.fps).toBe(30);
    expect(result.totalFrames).toBe(45);
    expect(result.bytes).toBeGreaterThan(10_000);

    const info = probe(output);
    const video = info.streams.find((stream) => stream.codec_type === 'video');
    const sound = info.streams.find((stream) => stream.codec_type === 'audio');
    expect(video?.codec_name).toBe('h264');
    expect(video?.width).toBe(1920);
    expect(video?.height).toBe(1080);
    expect(video?.r_frame_rate).toBe('30/1');
    expect(video?.nb_frames).toBe('45');
    expect(sound?.codec_name).toBe('aac');
    expect(sound?.channels).toBe(2);
    expect(Math.abs(Number(info.format.duration) * 1000 - 1500)).toBeLessThanOrEqual(100);

    const early = centrePixel(frameAt(output, 0.2), 1920, 1080);
    const late = centrePixel(frameAt(output, 1.2), 1920, 1080);
    expect(early[0]).toBeGreaterThan(early[2] + 80); // red scene
    expect(late[2]).toBeGreaterThan(late[0] + 80); // blue scene

    // Yellow caption pixels in the bottom quarter prove the ASS was burned,
    // not merely carried as a sidecar.
    const captionFrame = frameAt(output, 0.5);
    let captionPixels = 0;
    for (let row = 810; row < 1080; row += 1) {
      for (let column = 0; column < 1920; column += 1) {
        const offset = (row * 1920 + column) * 3;
        const redPixel = captionFrame[offset] ?? 0;
        const greenPixel = captionFrame[offset + 1] ?? 0;
        if (redPixel > 150 && greenPixel > 100) captionPixels += 1;
      }
    }
    expect(captionPixels).toBeGreaterThan(500);

    // The output path is not metadata. With fixed fps, frame expressions and
    // bitexact flags, a second render from the same inputs is byte-identical.
    await renderVideo({
      scenes: [
        { imagePath: red, durationMs: 800, motion: 'kenburns-in' },
        { imagePath: blue, durationMs: 700, motion: 'none' },
      ],
      audioPath: audio,
      outputPath: repeatOutput,
      resolution: 1080,
      fps: 30,
      size: 'landscape',
      format: 'standard',
      captions: { path: ass, fontsDir: resolve('packages/art/fonts/ttf') },
    });
    expect(readFileSync(repeatOutput)).toEqual(readFileSync(output));
  }, 120_000);

  it('renders captioned 4K portrait greenscreen at 60 fps without reading scene stills', async () => {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const directory = mkdtempSync(join(TEMP_ROOT, 'render-green-'));
    temporaryDirectories.push(directory);

    const audio = join(directory, 'voice.wav');
    const ass = resolve(directory, 'captions.ass');
    const output = join(directory, 'green.mp4');
    ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1',
      '-c:a', 'pcm_s16le', audio,
    ]);
    const cues = buildCaptionCues(
      [{ text: 'தமிழ்!', startMs: 0, endMs: 100 }],
      { wordLimit: 2, maxLines: 1, maxCharsPerLine: 20 },
    );
    writeFileSync(
      ass,
      buildAss(cues, { width: 2160, height: 3840 }, { fontSize: 160 }),
      'utf8',
    );

    const result = await renderVideo({
      scenes: [
        {
          imagePath: join(directory, 'deliberately-missing.png'),
          durationMs: 100,
          motion: 'kenburns-in',
        },
      ],
      audioPath: audio,
      outputPath: output,
      resolution: 2160,
      fps: 60,
      size: 'portrait',
      format: 'greenscreen',
      captions: { path: ass, fontsDir: resolve('packages/art/fonts/ttf') },
    });

    expect(result.width).toBe(2160);
    expect(result.height).toBe(3840);
    expect(result.fps).toBe(60);
    expect(result.totalFrames).toBe(6);

    const info = probe(output);
    const video = info.streams.find((stream) => stream.codec_type === 'video');
    const sound = info.streams.find((stream) => stream.codec_type === 'audio');
    expect(video?.width).toBe(2160);
    expect(video?.height).toBe(3840);
    expect(video?.r_frame_rate).toBe('60/1');
    expect(video?.nb_frames).toBe('6');
    expect(sound?.codec_name).toBe('aac');
    expect(sound?.channels).toBe(2);
    expect(Math.abs(Number(info.format.duration) * 1000 - 100)).toBeLessThanOrEqual(100);

    const frame = frameAt(output, 0.05);
    const centre = centrePixel(frame, 2160, 3840);
    expect(centre[1]).toBeGreaterThan(200);
    expect(centre[0]).toBeLessThan(40);
    expect(centre[2]).toBeLessThan(40);

    // The deliberately missing still proves the variant uses a generated
    // colour source. Bright caption pixels prove overlays remain on top.
    let captionPixels = 0;
    for (let row = 2880; row < 3840; row += 1) {
      for (let column = 0; column < 2160; column += 1) {
        const offset = (row * 2160 + column) * 3;
        const redPixel = frame[offset] ?? 0;
        const greenPixel = frame[offset + 1] ?? 0;
        if (redPixel > 120 && greenPixel > 120) captionPixels += 1;
      }
    }
    expect(captionPixels).toBeGreaterThan(1_000);
  }, 120_000);

  it('rejects a missing still with ffmpeg stderr, not a silent empty video', async () => {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const directory = mkdtempSync(join(TEMP_ROOT, 'render-error-'));
    temporaryDirectories.push(directory);

    await expect(
      renderVideo({
        scenes: [{ imagePath: join(directory, 'missing.png'), durationMs: 500, motion: 'none' }],
        audioPath: join(directory, 'missing.wav'),
        outputPath: join(directory, 'out.mp4'),
        resolution: 1080,
        fps: 30,
        size: 'landscape',
        format: 'standard',
      }),
    ).rejects.toThrow(/ffmpeg/i);
  }, 60_000);
});
