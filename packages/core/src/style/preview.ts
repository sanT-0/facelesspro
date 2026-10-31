/**
 * Preview geometry and timing — docs/04 §4 ("StyleProfile → preview grid + 6 s
 * preview clip → status=ready").
 *
 * Pure by construction: no I/O, no clock, no RNG. The worker turns these
 * numbers into one ffmpeg filter graph, and the tests can therefore prove the
 * two properties that matter without running a binary:
 *
 *   - the grid is 3×3 with integer cell rectangles that fit the canvas;
 *   - the clip is exactly `fps × seconds` frames, split across cells with no
 *     rounding drift (180 frames at 30 fps for 6 s, 20 per cell).
 *
 * The preview is built from *reference frames* until `ImagePort` exists, so the
 * canvas is the reference's aspect (landscape by default, a 9:16 centre crop
 * for the portrait grid). Nothing here assumes the pixels are generated art.
 */

export interface PreviewSize {
  readonly width: number;
  readonly height: number;
}

export interface PreviewRect extends PreviewSize {
  readonly x: number;
  readonly y: number;
}

export interface PreviewGrid {
  readonly canvas: PreviewSize;
  /** Size of one cell, before the frame is letterboxed into it. */
  readonly cell: PreviewSize;
  /** Row-major, starting top-left. */
  readonly cells: readonly PreviewRect[];
  /** Extent actually covered by cells + gutters, excluding the outer margin. */
  readonly width: number;
  readonly height: number;
  /** Where to place the grid on the canvas when it does not divide evenly. */
  readonly offset: { readonly x: number; readonly y: number };
}

export const PREVIEW_COLUMNS = 3;
export const PREVIEW_ROWS = 3;
/** 8 sampled frames + 1 measured-palette card. */
export const PREVIEW_CELLS = PREVIEW_COLUMNS * PREVIEW_ROWS;
export const PREVIEW_FRAME_COUNT = PREVIEW_CELLS - 1;

export const PREVIEW_FPS = 30;
export const PREVIEW_CLIP_SECONDS = 6;
/** 30 fps × 6 s. Frame-exact, not a float duration. */
export const PREVIEW_CLIP_FRAMES = PREVIEW_FPS * PREVIEW_CLIP_SECONDS;

export const PREVIEW_MARGIN = 16;
export const PREVIEW_GUTTER = 8;

export const LANDSCAPE_PREVIEW: PreviewSize = { width: 1280, height: 720 };
export const PORTRAIT_PREVIEW: PreviewSize = { width: 720, height: 1280 };

export interface PreviewGridOptions {
  readonly columns?: number;
  readonly rows?: number;
  readonly margin?: number;
  readonly gutter?: number;
}

function assertSize(size: PreviewSize, label: string): void {
  if (
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width < 1 ||
    size.height < 1
  ) {
    throw new TypeError(`${label} must be positive integers, got ${size.width}x${size.height}`);
  }
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer, got ${String(value)}`);
  }
}

/**
 * Cell rectangles for a row-major grid.
 *
 * The cell size is floored, so three 410 px cells plus gutters and margins fit
 * a 1280 px canvas with a 2 px remainder. That remainder is split as an offset
 * rather than stretching a cell — a preview that silently changes aspect is
 * worse than 1 px of uneven border.
 */
export function previewGrid(
  canvas: PreviewSize,
  count: number = PREVIEW_CELLS,
  options: PreviewGridOptions = {},
): PreviewGrid {
  assertSize(canvas, 'preview canvas');

  const columns = options.columns ?? PREVIEW_COLUMNS;
  const rows = options.rows ?? PREVIEW_ROWS;
  const margin = options.margin ?? PREVIEW_MARGIN;
  const gutter = options.gutter ?? PREVIEW_GUTTER;

  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new TypeError(`grid must be at least 1x1, got ${columns}x${rows}`);
  }
  if (!Number.isInteger(count) || count < 1 || count > columns * rows) {
    throw new TypeError(`count must be 1..${columns * rows}, got ${String(count)}`);
  }
  assertNonNegativeInt(margin, 'margin');
  assertNonNegativeInt(gutter, 'gutter');

  const cellWidth = Math.floor(
    (canvas.width - margin * 2 - (columns - 1) * gutter) / columns,
  );
  const cellHeight = Math.floor(
    (canvas.height - margin * 2 - (rows - 1) * gutter) / rows,
  );
  if (cellWidth < 1 || cellHeight < 1) {
    throw new RangeError(
      `canvas ${canvas.width}x${canvas.height} is too small for a ${columns}x${rows} grid`,
    );
  }

  const cells: PreviewRect[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    cells.push({
      x: margin + column * (cellWidth + gutter),
      y: margin + row * (cellHeight + gutter),
      width: cellWidth,
      height: cellHeight,
    });
  }

  const gridWidth =
    margin * 2 + Math.min(count, columns) * cellWidth + Math.max(0, Math.min(count, columns) - 1) * gutter;
  const rowCount = Math.ceil(count / columns);
  const gridHeight =
    margin * 2 + rowCount * cellHeight + Math.max(0, rowCount - 1) * gutter;

  return {
    canvas,
    cell: { width: cellWidth, height: cellHeight },
    cells,
    width: gridWidth,
    height: gridHeight,
    offset: {
      x: Math.floor((canvas.width - gridWidth) / 2),
      y: Math.floor((canvas.height - gridHeight) / 2),
    },
  };
}

/**
 * Integer band widths for the palette card, sized by measured weight.
 *
 * Largest-remainder apportionment: `floor` first, then one pixel each to the
 * bands with the biggest fractional part (ties keep the higher-weight/earlier
 * entry). The result sums to exactly `totalWidth`, so the card has no seam.
 * Zero-weight colours can collapse to 0 px; the builder skips those drawboxes.
 */
export function paletteBands(weights: readonly number[], totalWidth: number): readonly number[] {
  if (weights.length === 0) {
    throw new TypeError('paletteBands needs at least one weight');
  }
  if (!Number.isInteger(totalWidth) || totalWidth < 1) {
    throw new TypeError(`totalWidth must be a positive integer, got ${String(totalWidth)}`);
  }

  const total = weights.reduce((sum, weight) => {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new TypeError(`paletteBands got an invalid weight ${String(weight)}`);
    }
    return sum + weight;
  }, 0);
  if (total <= 0) {
    throw new RangeError('paletteBands needs a positive weight sum');
  }

  const exact = weights.map((weight) => (weight / total) * totalWidth);
  const widths = exact.map((value) => Math.floor(value));

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  const assigned = widths.reduce((sum, width) => sum + width, 0);
  const shortfall = totalWidth - assigned;
  for (let offset = 0; offset < shortfall; offset += 1) {
    const target = byRemainder[offset]!;
    widths[target.index] = widths[target.index]! + 1;
  }

  return widths;
}

export interface PreviewClipTimeline {
  /** Frames each cell is shown, in order. */
  readonly frames: readonly number[];
  readonly totalFrames: number;
  readonly fps: number;
  /** `totalFrames / fps`; exact when the caller passes integer fps/seconds. */
  readonly seconds: number;
}

/**
 * Frame-exact split of the clip across cells.
 *
 * At the default 9 cells × 180 frames this is 20 frames each — no cell is a
 * frame longer, so the clip is 6.000 s, not 5.999 or 6.033. A remainder is
 * spread one frame at a time from the first cell, which is deterministic and
 * visible in the test.
 */
export function previewClipTimeline(
  cellCount: number = PREVIEW_CELLS,
  fps: number = PREVIEW_FPS,
  seconds: number = PREVIEW_CLIP_SECONDS,
): PreviewClipTimeline {
  if (!Number.isInteger(cellCount) || cellCount < 1) {
    throw new TypeError(`cellCount must be a positive integer, got ${String(cellCount)}`);
  }
  if (!Number.isInteger(fps) || fps < 1) {
    throw new TypeError(`fps must be a positive integer, got ${String(fps)}`);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new TypeError(`seconds must be positive, got ${String(seconds)}`);
  }

  const totalFrames = Math.round(fps * seconds);
  if (totalFrames < cellCount) {
    throw new RangeError(
      `${totalFrames} frames cannot show ${cellCount} cells at ${fps} fps`,
    );
  }

  const base = Math.floor(totalFrames / cellCount);
  const remainder = totalFrames % cellCount;
  const frames = Array.from({ length: cellCount }, (_unused, index) =>
    index < remainder ? base + 1 : base,
  );

  return { frames, totalFrames, fps, seconds: totalFrames / fps };
}

/**
 * Centre crop targeting `ratio` (default 9:16), in source pixels.
 *
 * A portrait grid is not a stretched landscape frame: the subject is kept and
 * the sides are cut. If the source is already narrower than the target, the
 * height is cropped instead, so the box never exceeds the source.
 */
export function centreCrop(source: PreviewSize, ratio: number = 9 / 16): PreviewRect {
  assertSize(source, 'crop source');
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new TypeError(`crop ratio must be positive, got ${String(ratio)}`);
  }

  const sourceRatio = source.width / source.height;
  if (sourceRatio > ratio) {
    const width = Math.max(1, Math.round(source.height * ratio));
    return {
      x: Math.floor((source.width - width) / 2),
      y: 0,
      width: Math.min(width, source.width),
      height: source.height,
    };
  }

  const height = Math.max(1, Math.round(source.width / ratio));
  return {
    x: 0,
    y: Math.floor((source.height - height) / 2),
    width: source.width,
    height: Math.min(height, source.height),
  };
}
