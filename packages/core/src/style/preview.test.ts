import { describe, expect, it } from 'vitest';

import {
  LANDSCAPE_PREVIEW,
  PORTRAIT_PREVIEW,
  PREVIEW_CLIP_FRAMES,
  centreCrop,
  paletteBands,
  previewClipTimeline,
  previewGrid,
} from './preview';

describe('previewGrid', () => {
  it('lays out a 3x3 landscape grid with integer cells and a centred offset', () => {
    const grid = previewGrid(LANDSCAPE_PREVIEW);

    expect(grid.cell).toEqual({ width: 410, height: 224 });
    expect(grid.cells).toHaveLength(9);
    expect(grid.cells[0]).toEqual({ x: 16, y: 16, width: 410, height: 224 });
    expect(grid.cells[8]).toEqual({ x: 852, y: 480, width: 410, height: 224 });
    expect(grid.width).toBe(1278);
    expect(grid.height).toBe(720);
    expect(grid.offset).toEqual({ x: 1, y: 0 });
  });

  it('lays out a 3x3 portrait grid that is one pixel taller than the canvas', () => {
    const grid = previewGrid(PORTRAIT_PREVIEW);

    expect(grid.cell).toEqual({ width: 224, height: 410 });
    expect(grid.width).toBe(720);
    expect(grid.height).toBe(1278);
    expect(grid.offset).toEqual({ x: 0, y: 1 });
    expect(grid.cells[8]).toEqual({ x: 480, y: 852, width: 224, height: 410 });
  });

  it('keeps every cell inside the canvas', () => {
    for (const canvas of [LANDSCAPE_PREVIEW, PORTRAIT_PREVIEW]) {
      const grid = previewGrid(canvas);
      for (const cell of grid.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.x + cell.width).toBeLessThanOrEqual(canvas.width);
        expect(cell.y + cell.height).toBeLessThanOrEqual(canvas.height);
      }
    }
  });

  it('supports fewer cells without leaving a stretched cell', () => {
    const grid = previewGrid(LANDSCAPE_PREVIEW, 4);
    expect(grid.cells).toHaveLength(4);
    expect(grid.cell).toEqual({ width: 410, height: 224 });
    expect(grid.width).toBe(1278);
  });

  it('rejects more cells than the grid holds, and a canvas that cannot fit them', () => {
    expect(() => previewGrid(LANDSCAPE_PREVIEW, 10)).toThrow(/count must be 1\.\.9/);
    expect(() => previewGrid(LANDSCAPE_PREVIEW, 0)).toThrow(/count must be 1\.\.9/);
    expect(() => previewGrid({ width: 20, height: 20 })).toThrow(/too small/);
    expect(() => previewGrid({ width: 1280.5, height: 720 })).toThrow(/positive integers/);
  });
});

describe('paletteBands', () => {
  it('sums to the exact card width for a real measured palette', () => {
    const widths = paletteBands([0.3751, 0.3613, 0.2083, 0.0414, 0.0139], 410);

    expect(widths).toEqual([154, 148, 85, 17, 6]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(410);
  });

  it('gives the leftover pixels to the largest remainders, keeping order on ties', () => {
    expect(paletteBands([0.5, 0.5], 3)).toEqual([2, 1]);
    expect(paletteBands([0.5, 0.5], 5)).toEqual([3, 2]);
  });

  it('keeps a dominant colour dominant and a zero-weight colour invisible', () => {
    expect(paletteBands([1], 10)).toEqual([10]);
    expect(paletteBands([0, 1], 4)).toEqual([0, 4]);
  });

  it('rejects an empty palette, a zero total and a bad width', () => {
    expect(() => paletteBands([], 10)).toThrow(/at least one weight/);
    expect(() => paletteBands([0, 0], 10)).toThrow(/positive weight sum/);
    expect(() => paletteBands([1], 0)).toThrow(/positive integer/);
    expect(() => paletteBands([Number.NaN], 10)).toThrow(/invalid weight/);
  });
});

describe('previewClipTimeline', () => {
  it('splits 180 frames evenly across the 9 cells: 20 each, exactly 6.000 s', () => {
    const timeline = previewClipTimeline();

    expect(timeline.frames).toEqual(Array.from({ length: 9 }, () => 20));
    expect(timeline.totalFrames).toBe(PREVIEW_CLIP_FRAMES);
    expect(timeline.totalFrames).toBe(180);
    expect(timeline.seconds).toBe(6);
  });

  it('spreads a remainder one frame at a time without losing a frame', () => {
    const timeline = previewClipTimeline(8, 30, 6);

    expect(timeline.frames).toEqual([23, 23, 23, 23, 22, 22, 22, 22]);
    expect(timeline.frames.reduce((sum, frames) => sum + frames, 0)).toBe(180);
  });

  it('keeps a fractional duration exact at the frame level', () => {
    const timeline = previewClipTimeline(9, 30, 6.5);

    expect(timeline.totalFrames).toBe(195);
    expect(timeline.frames.reduce((sum, frames) => sum + frames, 0)).toBe(195);
    expect(timeline.seconds).toBe(6.5);
  });

  it('rejects a clip too short to show every cell', () => {
    expect(() => previewClipTimeline(9, 30, 0.2)).toThrow(/cannot show 9 cells/);
    expect(() => previewClipTimeline(0)).toThrow(/cellCount/);
    expect(() => previewClipTimeline(9, 0)).toThrow(/fps/);
    expect(() => previewClipTimeline(9, 30, 0)).toThrow(/seconds/);
  });
});

describe('centreCrop', () => {
  it('crops a landscape frame to 9:16 around the centre', () => {
    expect(centreCrop({ width: 1920, height: 1080 })).toEqual({
      x: 656,
      y: 0,
      width: 608,
      height: 1080,
    });
    expect(centreCrop({ width: 640, height: 360 })).toEqual({
      x: 218,
      y: 0,
      width: 203,
      height: 360,
    });
  });

  it('leaves an already-9:16 frame untouched and crops a square', () => {
    expect(centreCrop({ width: 1080, height: 1920 })).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
    });
    expect(centreCrop({ width: 1000, height: 1000 })).toEqual({
      x: 218,
      y: 0,
      width: 563,
      height: 1000,
    });
  });

  it('never exceeds the source and rejects an invalid ratio', () => {
    for (const source of [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 1000, height: 1000 },
      { width: 17, height: 5 },
    ]) {
      const crop = centreCrop(source);
      expect(crop.width).toBeGreaterThan(0);
      expect(crop.height).toBeGreaterThan(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(source.width);
      expect(crop.y + crop.height).toBeLessThanOrEqual(source.height);
    }
    expect(() => centreCrop({ width: 10, height: 10 }, 0)).toThrow(/ratio/);
  });
});
