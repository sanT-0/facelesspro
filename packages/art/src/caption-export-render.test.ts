/** Real-ffmpeg parser gate for generated SRT and WebVTT sidecars. */

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCaptionCues,
  exportCaptions,
  type CaptionExportFormat,
} from '@facelesspro/core';

const TEMP_ROOT = '.data';
const FONT_DIR = 'packages/art/fonts/ttf';
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('caption sidecars (real ffmpeg/libass)', () => {
  it('parses and renders Tamil SRT and WebVTT exports', () => {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const directory = mkdtempSync(join(TEMP_ROOT, 'caption-export-'));
    temporaryDirectories.push(directory);

    const cues = buildCaptionCues(
      [
        { text: 'தமிழ்', startMs: 0, endMs: 500 },
        { text: 'வாழ்க!', startMs: 500, endMs: 1000 },
      ],
      { wordLimit: 4, maxLines: 2, maxCharsPerLine: 24 },
    );

    for (const format of ['srt', 'vtt'] satisfies CaptionExportFormat[]) {
      const exported = exportCaptions(cues, format);
      const sidecar = join(directory, `captions.${exported.extension}`).replaceAll('\\', '/');
      writeFileSync(sidecar, exported.contents, 'utf8');

      const result = spawnSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel', 'verbose',
          '-f', 'lavfi',
          '-i', 'color=c=black:s=640x360:r=2:d=1',
          '-vf', `subtitles='${sidecar}':fontsdir='${FONT_DIR}'`,
          '-ss', '0.5',
          '-frames:v', '1',
          '-pix_fmt', 'rgb24',
          '-f', 'rawvideo',
          'pipe:1',
        ],
        { encoding: null, maxBuffer: 4 * 1024 * 1024 },
      );
      if (result.error !== undefined) throw result.error;
      const stderr = result.stderr.toString('utf8');
      expect(result.status, stderr).toBe(0);
      expect(stderr).toMatch(/NotoSansTamil-Variable\.ttf/i);
      expect(result.stdout).toHaveLength(640 * 360 * 3);

      let nonBlackPixels = 0;
      for (let offset = 0; offset < result.stdout.length; offset += 3) {
        if (
          (result.stdout[offset] ?? 0) > 32 ||
          (result.stdout[offset + 1] ?? 0) > 32 ||
          (result.stdout[offset + 2] ?? 0) > 32
        ) {
          nonBlackPixels += 1;
        }
      }
      expect(nonBlackPixels).toBeGreaterThan(500);
    }
  });
});
