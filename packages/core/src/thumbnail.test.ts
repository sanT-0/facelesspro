/** Deterministic thumbnail planning contract (roadmap P4 task 8). */

import { describe, expect, it } from 'vitest';

import {
  THUMBNAIL_POSITION,
  THUMBNAIL_MAX_EDGE,
  buildThumbnailPlan,
  thumbnailDimensions,
  thumbnailTimestampMs,
} from './thumbnail';

describe('thumbnailDimensions', () => {
  it('caps a landscape or portrait long edge at 1280 without distortion', () => {
    expect(thumbnailDimensions(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(thumbnailDimensions(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(thumbnailDimensions(4000, 3000)).toEqual({ width: 1280, height: 960 });
  });

  it('never upscales a small source', () => {
    expect(thumbnailDimensions(640, 360)).toEqual({ width: 640, height: 360 });
    expect(thumbnailDimensions(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('accepts a lower injected edge cap and keeps both dimensions positive', () => {
    expect(thumbnailDimensions(1000, 333, 100)).toEqual({ width: 100, height: 33 });
    expect(thumbnailDimensions(10_000, 1, 1280)).toEqual({ width: 1280, height: 1 });
  });

  it('rejects fractional/non-positive geometry and a bad cap', () => {
    expect(() => thumbnailDimensions(0, 1080)).toThrow(/width/i);
    expect(() => thumbnailDimensions(1920, -1)).toThrow(/height/i);
    expect(() => thumbnailDimensions(1.5, 1)).toThrow(/width/i);
    expect(() => thumbnailDimensions(100, 100, 0)).toThrow(/maxEdge/i);
  });
});

describe('thumbnailTimestampMs', () => {
  it('selects 25% of the final duration', () => {
    expect(THUMBNAIL_POSITION).toBe(0.25);
    expect(thumbnailTimestampMs(4000)).toBe(1000);
    expect(thumbnailTimestampMs(2925)).toBe(731);
  });

  it('clamps inside very short videos and rejects invalid duration', () => {
    expect(thumbnailTimestampMs(1)).toBe(0);
    expect(thumbnailTimestampMs(2)).toBe(1);
    expect(() => thumbnailTimestampMs(0)).toThrow(/duration/i);
    expect(() => thumbnailTimestampMs(1.5)).toThrow(/duration/i);
  });
});

describe('buildThumbnailPlan', () => {
  it('combines source metadata into one immutable extraction decision', () => {
    expect(THUMBNAIL_MAX_EDGE).toBe(1280);
    expect(buildThumbnailPlan({ width: 3840, height: 2160, durationMs: 10_000 })).toEqual({
      sourceWidth: 3840,
      sourceHeight: 2160,
      durationMs: 10_000,
      timestampMs: 2500,
      width: 1280,
      height: 720,
    });
  });

  it('is deterministic and does not mutate metadata', () => {
    const source = { width: 1080, height: 1920, durationMs: 4000 };
    const before = { ...source };
    expect(buildThumbnailPlan(source)).toEqual(buildThumbnailPlan(source));
    expect(source).toEqual(before);
  });
});
