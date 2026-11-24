/**
 * Chat-skin text must render as shaped outlines, never as SVG `<text>`.
 *
 * resvg gives every Tamil cluster ending in a reordered vowel sign (ே ை ொ ோ
 * ௌ) a zero advance, so `<text>ளே நீ</text>` draws the second word on top of
 * the first. HarfBuzz shapes the same text correctly, so the renderer emits
 * glyph paths. These tests pin that contract: outlines only, and advances that
 * actually move the pen forward.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { chatSkinSvgToPng, renderChatSkin } from './chat-skin';
import { measureText, textToPath } from './text-path';

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

function inkBounds(pixels: Buffer, width: number): { minX: number; maxX: number; count: number } {
  let minX = width;
  let maxX = -1;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const x = (i / 4) % width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    count += 1;
  }
  return { minX, maxX, count };
}

async function renderPaths(svgBody: string, width: number, height: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgBody}</svg>`;
  return decodeRgba(await chatSkinSvgToPng(svg, width, height));
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

describe('chat skin text shaping', () => {
  it('emits glyph paths, never SVG text', () => {
    const svg = renderChatSkin(TAMIL_CHAT);
    expect(svg).not.toMatch(/<text\b/);
    expect(svg).toMatch(/<path\b/);
  });

  it('advances past a reordered Tamil vowel sign instead of overlapping', async () => {
    const size = 40;
    const baseline = 60;
    const short = await renderPaths(textToPath('ளே', { x: 10, y: baseline, fontSize: size, fill: '#000' }).svg, 400, 100);
    const long = await renderPaths(textToPath('ளே நீ', { x: 10, y: baseline, fontSize: size, fill: '#000' }).svg, 400, 100);

    const shortInk = inkBounds(short, 400);
    const longInk = inkBounds(long, 400);

    expect(shortInk.count).toBeGreaterThan(50);
    // `நீ` must start after the space, so the ink box grows by more than a
    // glyph's worth of pixels. The resvg zero-advance bug drew it on top.
    expect(longInk.maxX).toBeGreaterThan(shortInk.maxX + size * 0.8);
    // And the measured advance matches the ink it produced.
    const renderedWidth = shortInk.maxX - shortInk.minX + 1;
    expect(Math.abs(renderedWidth - measureText('ளே', size))).toBeLessThan(size * 0.6);
  });

  it('measures every Tamil cluster with a positive advance', () => {
    for (const cluster of ['ளே', 'வே', 'கை', 'கோ', 'கௌ', 'பொ', 'ஞொ']) {
      expect(measureText(cluster, 40), cluster).toBeGreaterThan(0);
    }
  });
});

describe('chat skin layout', () => {
  it('lays out at phone units and scales through the viewBox', () => {
    const svg = renderChatSkin({ ...TAMIL_CHAT, width: 1080, height: 1920 });
    expect(svg).toMatch(/width="1080" height="1920"/);
    expect(svg).toMatch(/viewBox="0 0 375 666\.66/);
  });

  it('keeps the default 375×667 output in the same units', () => {
    const svg = renderChatSkin(TAMIL_CHAT);
    expect(svg).toMatch(/width="375" height="667"/);
    expect(svg).toMatch(/viewBox="0 0 375 667"/);
  });

  it('resolves the bubble side from characterId when the message has no side', () => {
    const svg = renderChatSkin({
      template: 'whatsapp',
      characters: [{ id: 'bala', name: 'பாலா', side: 'right' }],
      messages: [{ text: 'நன்றி', characterId: 'bala' }],
      width: 1080,
      height: 1920,
    });
    // Bubble rects are the only ones with rounded corners.
    const bubbles = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" rx=/g)];
    expect(bubbles.length).toBe(1);
    const x = Number(bubbles[0]![1]);
    const width = Number(bubbles[0]![2]);
    expect(x + width).toBeCloseTo(375 - 20, 0);
  });
});
