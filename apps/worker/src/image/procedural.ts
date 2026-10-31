/**
 * Offline image floor: measured palette + deterministic geometry → PNG.
 *
 * This is deliberately simple art, not a fake model. Its job is to guarantee
 * that the pipeline always has a valid, on-palette still when every hosted and
 * local model is unavailable. It draws no text, logos or watermarks.
 */

import {
  generatedImageSchema,
  imageCapabilitiesSchema,
  imageGenerationRequestSchema,
} from '@facelesspro/contracts';
import type {
  ImageCapabilities,
  ImageGenerationRequest,
} from '@facelesspro/contracts';

import type { ImagePort } from '../ports/image';
import { IMAGE_NATIVE_DIMENSIONS } from './dimensions';
import { encodeRgbPng } from './png';
import type { Raster } from './png';

export { encodeRgbPng } from './png';
export type { Raster } from './png';

/** Backward-readable name in procedural tests/reports; geometry is shared by image adapters. */
export const PROCEDURAL_IMAGE_DIMENSIONS = IMAGE_NATIVE_DIMENSIONS;

export const PROCEDURAL_IMAGE_CAPABILITIES: ImageCapabilities =
  imageCapabilitiesSchema.parse({
    maxSide: 1024,
    sizes: ['landscape', 'portrait'],
    style: 'profile',
    seed: true,
  });

type Rgb = readonly [red: number, green: number, blue: number];

function parseHex(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(value, 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

function randomSource(seed: number): { next(): number; int(min: number, max: number): number } {
  let state = seed >>> 0 || 0x6d2b79f5;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  return {
    next,
    int(min, max) {
      if (max <= min) return min;
      return min + (next() % (max - min));
    },
  };
}

function setPixel(raster: Raster, x: number, y: number, colour: Rgb): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
  const offset = (y * raster.width + x) * 3;
  raster.pixels[offset] = colour[0];
  raster.pixels[offset + 1] = colour[1];
  raster.pixels[offset + 2] = colour[2];
}

function fill(raster: Raster, colour: Rgb): void {
  for (let offset = 0; offset < raster.pixels.length; offset += 3) {
    raster.pixels[offset] = colour[0];
    raster.pixels[offset + 1] = colour[1];
    raster.pixels[offset + 2] = colour[2];
  }
}

function rectangle(
  raster: Raster,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: Rgb,
): void {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(raster.width, Math.ceil(x + width));
  const bottom = Math.min(raster.height, Math.ceil(y + height));
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      setPixel(raster, column, row, colour);
    }
  }
}

function circle(raster: Raster, centreX: number, centreY: number, radius: number, colour: Rgb): void {
  const left = Math.max(0, Math.floor(centreX - radius));
  const right = Math.min(raster.width - 1, Math.ceil(centreX + radius));
  const top = Math.max(0, Math.floor(centreY - radius));
  const bottom = Math.min(raster.height - 1, Math.ceil(centreY + radius));
  const squared = radius * radius;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x - centreX;
      const dy = y - centreY;
      if (dx * dx + dy * dy <= squared) setPixel(raster, x, y, colour);
    }
  }
}

function outlineFor(weight: ImageGenerationRequest['style']['line']['weight'], shortSide: number): number {
  switch (weight) {
    case 'none':
      return 0;
    case 'thin':
      return Math.max(2, Math.round(shortSide * 0.006));
    case 'medium':
      return Math.max(4, Math.round(shortSide * 0.012));
    case 'thick':
      return Math.max(7, Math.round(shortSide * 0.02));
    case 'unknown':
      return Math.max(3, Math.round(shortSide * 0.008));
  }
}

function differentIndex(index: number, offset: number, count: number): number {
  return count <= 1 ? 0 : (index + offset) % count;
}

/** Render a deterministic RGB scene. Exported for byte-level regression tests. */
export function renderProceduralRgb(input: ImageGenerationRequest): Raster {
  const request = imageGenerationRequestSchema.parse(input);
  const dimensions = PROCEDURAL_IMAGE_DIMENSIONS[request.size];
  const raster: Raster = {
    ...dimensions,
    pixels: new Uint8Array(dimensions.width * dimensions.height * 3),
  };
  const colours = request.style.palette.hex.map(parseHex);
  const ink = parseHex(request.style.line.color);
  const backgroundIndex = request.style.palette.weights.reduce(
    (best, weight, index, weights) => (weight > weights[best]! ? index : best),
    0,
  );
  const background = colours[backgroundIndex]!;
  const ground = colours[differentIndex(backgroundIndex, 1, colours.length)]!;
  const subject = colours[differentIndex(backgroundIndex, 2, colours.length)]!;
  const accent = colours[differentIndex(backgroundIndex, 3, colours.length)]!;

  const layoutSeed = fnv1a(
    `${request.seed}\u0000${request.style.seedBase}\u0000${request.prompt}\u0000${request.negativePrompt}`,
  );
  const random = randomSource(layoutSeed);
  const shortSide = Math.min(raster.width, raster.height);
  const outline = outlineFor(request.style.line.weight, shortSide);

  fill(raster, background);

  const horizon = Math.round(raster.height * (0.62 + (random.next() % 12) / 100));
  rectangle(raster, 0, horizon, raster.width, raster.height - horizon, ground);

  const sunRadius = Math.round(shortSide * 0.09);
  const sunX = random.int(sunRadius * 2, Math.max(sunRadius * 2 + 1, raster.width - sunRadius * 2));
  const sunY = random.int(sunRadius * 2, Math.max(sunRadius * 2 + 1, horizon - sunRadius * 2));
  if (outline > 0) circle(raster, sunX, sunY, sunRadius + outline, ink);
  circle(raster, sunX, sunY, sunRadius, accent);

  const subjectX = Math.round(raster.width * (0.5 + (random.int(-10, 11) / 100)));
  const headRadius = Math.round(shortSide * 0.105);
  const bodyWidth = Math.round(shortSide * 0.28);
  const bodyHeight = Math.round(shortSide * 0.31);
  const bodyTop = horizon - Math.round(bodyHeight * 0.75);
  if (outline > 0) {
    rectangle(
      raster,
      subjectX - bodyWidth / 2 - outline,
      bodyTop - outline,
      bodyWidth + outline * 2,
      bodyHeight + outline * 2,
      ink,
    );
  }
  rectangle(raster, subjectX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight, subject);
  const headY = bodyTop - Math.round(headRadius * 0.72);
  if (outline > 0) circle(raster, subjectX, headY, headRadius + outline, ink);
  circle(raster, subjectX, headY, headRadius, accent);

  // Prompt/seed fingerprint as geometry, never text. It makes different scenes
  // visibly and byte-wise distinct while remaining inside the measured palette.
  const marker = Math.max(5, Math.round(shortSide * 0.018));
  const gap = Math.max(3, Math.round(marker * 0.45));
  const markerY = raster.height - marker * 3;
  for (let index = 0; index < 16; index += 1) {
    const bit = (layoutSeed >>> (index % 32)) & 1;
    const colour = colours[(index + bit + backgroundIndex) % colours.length]!;
    rectangle(raster, marker + index * (marker + gap), markerY, marker, marker * (bit + 1), colour);
  }

  for (let index = 0; index < 5; index += 1) {
    const radius = random.int(Math.max(4, Math.round(shortSide * 0.012)), Math.max(6, Math.round(shortSide * 0.035)));
    const x = random.int(radius, raster.width - radius);
    const y = random.int(radius, Math.max(radius + 1, horizon - radius));
    circle(raster, x, y, radius, colours[(index + 1) % colours.length]!);
  }

  return raster;
}

export function createProceduralImageAdapter(): ImagePort {
  return {
    name: 'procedural',
    capabilities: PROCEDURAL_IMAGE_CAPABILITIES,
    async draw(input) {
      const request = imageGenerationRequestSchema.parse(input);
      const raster = renderProceduralRgb(request);
      return generatedImageSchema.parse({
        adapter: 'procedural',
        degradedFrom: [],
        mimeType: 'image/png',
        size: request.size,
        width: raster.width,
        height: raster.height,
        seed: request.seed,
        bytes: encodeRgbPng(raster),
      });
    },
  };
}
