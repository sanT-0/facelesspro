import { inflateSync } from 'node:zlib';

import { generatedImageSchema } from '@facelesspro/contracts';
import type { ImageGenerationRequest, StyleProfile } from '@facelesspro/contracts';
import { describe, expect, it } from 'vitest';

import {
  PROCEDURAL_IMAGE_CAPABILITIES,
  PROCEDURAL_IMAGE_DIMENSIONS,
  createProceduralImageAdapter,
} from './procedural';

const style: StyleProfile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene, bold geometric shapes',
  palette: {
    hex: ['#14213d', '#fca311', '#e5e5e5', '#ffffff'],
    weights: [0.4, 0.3, 0.2, 0.1],
  },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple background with open edges',
  composition: 'centred subject, medium shot',
  characters: [],
  typography: { present: false },
  negative: 'photo, 3d render, text, watermark, logo, signature',
  seedBase: 1_234_567,
  measured: {
    line: { strokeDensity: 0.04, edgeEnergy: 0.08 },
    tone: {
      saturation: { mean: 0.5, p95: 0.8 },
      contrast: { mean: 0.2, p95: 0.5 },
      brightness: { mean: 0.6, p95: 0.9 },
    },
    aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
    safeArea: { edgeContentRatio: 0.04, margin: 0.08 },
    frameCount: 8,
  },
  source: { adapter: 'heuristic', degradedFrom: [] },
};

const request: ImageGenerationRequest = {
  prompt: 'a freelancer reviewing an invoice at a clean desk',
  negativePrompt: style.negative,
  seed: 42,
  size: 'landscape',
  style,
};

interface ParsedPng {
  readonly width: number;
  readonly height: number;
  readonly raw: Buffer;
}

function parsePng(bytes: Uint8Array): ParsedPng {
  const data = Buffer.from(bytes);
  expect(data.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );

  let offset = 8;
  let width = 0;
  let height = 0;
  const compressed: Buffer[] = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      expect([...body.subarray(8)]).toEqual([8, 2, 0, 0, 0]);
    }
    if (type === 'IDAT') compressed.push(body);
    offset += 12 + length;
    if (type === 'IEND') break;
  }

  return { width, height, raw: inflateSync(Buffer.concat(compressed)) };
}

function rgbColours(parsed: ParsedPng): Set<string> {
  const colours = new Set<string>();
  const stride = parsed.width * 3 + 1;
  for (let y = 0; y < parsed.height; y += 1) {
    const row = y * stride;
    expect(parsed.raw[row]).toBe(0); // PNG filter: none
    for (let x = 0; x < parsed.width; x += 1) {
      const pixel = row + 1 + x * 3;
      colours.add(
        `#${parsed.raw[pixel]!.toString(16).padStart(2, '0')}` +
          `${parsed.raw[pixel + 1]!.toString(16).padStart(2, '0')}` +
          `${parsed.raw[pixel + 2]!.toString(16).padStart(2, '0')}`,
      );
    }
  }
  return colours;
}

describe('procedural image adapter', () => {
  it('declares an offline, seeded, profile-aware 1024px capability', () => {
    expect(PROCEDURAL_IMAGE_CAPABILITIES).toEqual({
      maxSide: 1024,
      sizes: ['landscape', 'portrait'],
      style: 'profile',
      seed: true,
    });
    expect(createProceduralImageAdapter().name).toBe('procedural');
  });

  it('produces a schema-valid landscape PNG with the exact native dimensions', async () => {
    const image = await createProceduralImageAdapter().draw(request);
    const parsed = parsePng(image.bytes);

    expect(generatedImageSchema.parse(image)).toEqual(image);
    expect(image).toMatchObject({
      adapter: 'procedural',
      degradedFrom: [],
      mimeType: 'image/png',
      seed: request.seed,
      ...PROCEDURAL_IMAGE_DIMENSIONS.landscape,
    });
    expect({ width: parsed.width, height: parsed.height }).toEqual(
      PROCEDURAL_IMAGE_DIMENSIONS.landscape,
    );
    expect(parsed.raw).toHaveLength(parsed.height * (parsed.width * 3 + 1));
  });

  it('produces the portrait geometry without stretching the contract', async () => {
    const image = await createProceduralImageAdapter().draw({ ...request, size: 'portrait' });
    const parsed = parsePng(image.bytes);

    expect({ width: image.width, height: image.height }).toEqual(
      PROCEDURAL_IMAGE_DIMENSIONS.portrait,
    );
    expect({ width: parsed.width, height: parsed.height }).toEqual(
      PROCEDURAL_IMAGE_DIMENSIONS.portrait,
    );
  });

  it('is byte-deterministic and changes when either the seed or prompt changes', async () => {
    const adapter = createProceduralImageAdapter();
    const first = await adapter.draw(request);
    const second = await adapter.draw(request);
    const otherSeed = await adapter.draw({ ...request, seed: request.seed + 1 });
    const otherPrompt = await adapter.draw({ ...request, prompt: `${request.prompt}, at sunset` });

    expect(Buffer.from(second.bytes)).toEqual(Buffer.from(first.bytes));
    expect(Buffer.from(otherSeed.bytes)).not.toEqual(Buffer.from(first.bytes));
    expect(Buffer.from(otherPrompt.bytes)).not.toEqual(Buffer.from(first.bytes));
  });

  it('draws only measured palette colours, including the measured ink', async () => {
    const image = await createProceduralImageAdapter().draw(request);
    const colours = rgbColours(parsePng(image.bytes));
    const palette = new Set(style.palette.hex.map((hex) => hex.toLowerCase()));

    expect(colours.size).toBeGreaterThanOrEqual(3);
    expect(colours.has(style.line.color)).toBe(true);
    for (const colour of colours) expect(palette.has(colour)).toBe(true);
  });

  it('validates the request at the adapter boundary', async () => {
    const adapter = createProceduralImageAdapter();
    await expect(adapter.draw({ ...request, seed: 0 })).rejects.toThrow();
    await expect(
      adapter.draw({ ...request, size: 'square' } as unknown as ImageGenerationRequest),
    ).rejects.toThrow();
  });
});
