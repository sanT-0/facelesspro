/**
 * Chat-skin text must render from the bundled fonts alone.
 *
 * The runtime images ship no system font catalog. When `chatSkinSvgToPng`
 * let resvg fall back to system fonts, every bubble rendered blank in Docker
 * while the step still reported success — a silent wrong artifact. These
 * tests pin the hermetic font configuration and prove glyphs are actually
 * drawn with it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { chatSkinFontOptions, chatSkinSvgToPng, renderChatSkin } from './chat-skin';

const TEMP_ROOT = '.data';
const temporaryDirectories: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(TEMP_ROOT, 'chat-skin-test-'));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Decode a PNG to raw RGBA so pixel-level claims are measured, not assumed. */
function decodeRgba(png: Uint8Array): Buffer {
  const dir = tempDir();
  const input = join(dir, 'in.png');
  writeFileSync(input, png);
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', input, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg could not decode the PNG: ${result.stderr.toString()}`);
  }
  return result.stdout;
}

function differingPixels(a: Buffer, b: Buffer): number {
  expect(a.length).toBe(b.length);
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      differing += 1;
    }
  }
  return differing;
}

const TAMIL_CHAT = {
  template: 'whatsapp',
  characters: [
    { id: 'arun', name: 'அருண்', side: 'left' as const },
    { id: 'bala', name: 'பாலா', side: 'right' as const },
  ],
  messages: [
    { text: 'வணக்கம் நண்பர்களே, எப்படி இருக்கிறீர்கள்?', side: 'left' as const, name: 'அருண்' },
    { text: 'நன்றி, நான் சிறப்பாக இருக்கிறேன்!', side: 'right' as const, name: 'பாலா' },
  ],
  groupName: 'நண்பர்கள்',
};

describe('chat skin font configuration', () => {
  it('is hermetic: bundled font files only, never system fonts', () => {
    const options = chatSkinFontOptions();

    expect(options.loadSystemFonts).toBe(false);
    expect(options.fontFiles.length).toBeGreaterThan(0);
    for (const file of options.fontFiles) {
      expect(existsSync(file), `bundled font missing at ${file}`).toBe(true);
    }
    expect(options.fontFiles.some((file) => file.endsWith('NotoSansTamil-Variable.ttf'))).toBe(true);
    expect(options.defaultFontFamily).toBe('Noto Sans Tamil');
    expect(options.sansSerifFamily).toBe('Noto Sans Tamil');
  });

  it('draws Tamil glyphs with the bundled fonts and no system fallback', async () => {
    const svg = renderChatSkin(TAMIL_CHAT);
    const withFonts = decodeRgba(await chatSkinSvgToPng(svg, 1080, 1920));
    const withoutFonts = decodeRgba(
      await chatSkinSvgToPng(svg, 1080, 1920, { ...chatSkinFontOptions(), fontFiles: [] }),
    );

    // Every pixel that changes when fonts disappear is a glyph. If the
    // converter ever falls back to system fonts this drops to zero on the
    // runtime images, which is exactly the regression this guards.
    expect(differingPixels(withFonts, withoutFonts)).toBeGreaterThan(2_000);
  });

});
