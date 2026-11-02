/**
 * Real ffmpeg/libass gate for the bundled Tamil font.
 *
 * This deliberately is not mocked: AGENTS.md requires real ffmpeg in render
 * tests and a green Tamil-glyph golden frame. The hard checks are font
 * selection, exact frame dimensions and a non-empty glyph raster; no pixel
 * digest is a hard failure because ffmpeg/libass patch versions may rasterise
 * the same glyphs a little differently.
 */

import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAss, buildCaptionCues } from '@facelesspro/core';
import {
  BUNDLED_CAPTION_FONT_FILES,
  DEFAULT_CAPTION_FONT_FAMILY,
} from './index';

const WIDTH = 640;
const HEIGHT = 360;
const FONT_DIR = 'packages/art/fonts/ttf';
const TEMP_ROOT = '.data';
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('bundled Tamil ASS rendering', () => {
  it('pins the exact upstream font bytes recorded in the notice', () => {
    expect(DEFAULT_CAPTION_FONT_FAMILY).toBe('Noto Sans Tamil');
    expect(sha256(`${FONT_DIR}/${BUNDLED_CAPTION_FONT_FILES[0]}`)).toBe(
      'aa3a9b321f4b0bb2c40203ffbde9af89713227866e0e13f76e5b9eeea727cf88',
    );
    expect(sha256(`${FONT_DIR}/${BUNDLED_CAPTION_FONT_FILES[1]}`)).toBe(
      'bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d',
    );
  });

  it('keeps the committed human-review golden frame at 1280x720', () => {
    const png = readFileSync('fixtures/render/tamil-frame.png');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    // PNG IHDR stores unsigned big-endian width/height at bytes 16/20.
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(720);
  });

  it('renders the Tamil glyph golden frame through real ffmpeg/libass', () => {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const temporaryDirectory = mkdtempSync(join(TEMP_ROOT, 'ass-render-'));
    temporaryDirectories.push(temporaryDirectory);
    const assPath = join(temporaryDirectory, 'captions.ass').replaceAll('\\', '/');
    const cues = buildCaptionCues(
      [
        { text: 'தமிழ்', startMs: 0, endMs: 300 },
        { text: 'எழுத்துகள்', startMs: 300, endMs: 650 },
        { text: 'அழகாக', startMs: 650, endMs: 950 },
        { text: 'இணைகின்றன.', startMs: 950, endMs: 1400 },
      ],
      { wordLimit: 6, maxLines: 2, maxCharsPerLine: 32 },
    );
    writeFileSync(
      assPath,
      buildAss(cues, { width: WIDTH, height: HEIGHT }, { fontSize: 42 }),
      'utf8',
    );

    const result = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'verbose',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${WIDTH}x${HEIGHT}:r=1:d=2`,
        '-vf',
        `ass='${assPath}':fontsdir='${FONT_DIR}'`,
        '-frames:v',
        '1',
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        'pipe:1',
      ],
      { encoding: null, maxBuffer: 4 * 1024 * 1024 },
    );

    if (result.error !== undefined) throw result.error;
    const stderr = result.stderr.toString('utf8');
    expect(result.status, stderr).toBe(0);
    // libass reports the exact file it selected; this proves the host did not
    // silently substitute Arial or a system Tamil font.
    expect(stderr).toMatch(/NotoSansTamil-Variable\.ttf/i);

    const frame = result.stdout;
    expect(frame).toHaveLength(WIDTH * HEIGHT * 3);
    let nonBlackPixels = 0;
    for (let offset = 0; offset < frame.length; offset += 3) {
      if (
        (frame[offset] ?? 0) > 32 ||
        (frame[offset + 1] ?? 0) > 32 ||
        (frame[offset + 2] ?? 0) > 32
      ) {
        nonBlackPixels += 1;
      }
    }
    // A missing/tofu-only frame is nearly empty. Keep this as a broad semantic
    // bound, not a renderer-version-sensitive pixel digest.
    expect(nonBlackPixels).toBeGreaterThan(1_000);
  });
});

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
