/**
 * Preview grid + 6 s preview clip — docs/04 §4.
 *
 * Built from the **sampled reference frames**, because `ImagePort` does not
 * exist yet: the grid is a contact sheet of the reference plus a card of the
 * measured palette, and the clip walks the same nine cells. That is the
 * roadmap's artifact ("`preview.png` grid next to real frames"), and it is
 * honest about what has been generated (nothing). The builder only needs an
 * ordered list of image paths, so when generated stills arrive the same
 * function runs over them unchanged.
 *
 * Layout and timing come from `packages/core/src/style/preview.ts`: 3×3,
 * 180 frames at 30 fps, 20 per cell. This module is the ffmpeg half —
 * `runProcess` keeps it a subprocess, never a Node wrapper.
 *
 * No text is drawn on the palette card on purpose: a caption would need a font,
 * a glyph fallback and a wording decision, and none of those belong in a
 * preview whose only job is to show the measured colours. Solid bands, weights
 * as widths.
 */

import {
  PREVIEW_CELLS,
  PREVIEW_FPS,
  PREVIEW_FRAME_COUNT,
  paletteBands,
  previewClipTimeline,
  previewGrid,
  centreCrop,
} from '@facelesspro/core';
import type { PreviewGrid, PreviewRect, PreviewSize } from '@facelesspro/core';

import { ensureParentPath } from './storage';
import { probeFrameSize, runProcess } from './frame-decode';
import { selectVisionFrames } from './vision/frames';

const FFMPEG_TIMEOUT_MS = 5 * 60_000;
const FFPROBE_TIMEOUT_MS = 30_000;

/** A measured palette, shaped for both the card and nothing else. */
export interface PreviewPalette {
  readonly hex: readonly string[];
  readonly weights: readonly number[];
}

export interface PreviewGridRequest {
  /** Exactly `PREVIEW_FRAME_COUNT` (8) sampled frames, in display order. */
  readonly framePaths: readonly string[];
  readonly palette: PreviewPalette;
  /** Drawn as the background and letterbox colour; usually `profile.line.color`. */
  readonly inkColor: string;
  readonly outPath: string;
  readonly canvas?: PreviewSize;
  /** Centre-crop each frame to 9:16 before placing it in the cell. */
  readonly portrait?: boolean;
}

export interface PreviewClipRequest {
  readonly framePaths: readonly string[];
  readonly palette: PreviewPalette;
  readonly inkColor: string;
  readonly outPath: string;
  readonly canvas?: PreviewSize;
  readonly fps?: number;
  readonly seconds?: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function ffColor(hex: string): string {
  if (!HEX.test(hex)) throw new TypeError(`expected #rrggbb, got ${hex}`);
  return `0x${hex.slice(1).toLowerCase()}`;
}

function assertPalette(palette: PreviewPalette): void {
  if (palette.hex.length === 0) throw new TypeError('preview palette needs at least one colour');
  if (palette.hex.length !== palette.weights.length) {
    throw new TypeError('preview palette needs one weight per colour');
  }
  for (const hex of palette.hex) {
    if (!HEX.test(hex)) throw new TypeError(`expected #rrggbb, got ${hex}`);
  }
}

function assertFrames(framePaths: readonly string[]): void {
  if (framePaths.length !== PREVIEW_FRAME_COUNT) {
    throw new RangeError(
      `preview needs exactly ${PREVIEW_FRAME_COUNT} frames, got ${framePaths.length}`,
    );
  }
}

/** `x_y` layout string for `xstack`, from the pure grid. */
function xstackLayout(grid: PreviewGrid): string {
  return grid.cells.map((cell) => `${cell.x}_${cell.y}`).join('|');
}

function cropFilter(crop: PreviewRect): string {
  return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`;
}

/** Frame chain shared by the grid and the clip; `tail` is trim/format. */
function frameChain(
  index: number,
  cell: PreviewSize,
  ink: string,
  tail: string,
  crop: PreviewRect | null = null,
): string {
  const head = crop === null ? `[${index}:v]` : `[${index}:v]${cropFilter(crop)},`;
  return (
    `${head}scale=${cell.width}:${cell.height}:force_original_aspect_ratio=decrease,` +
    `pad=${cell.width}:${cell.height}:(ow-iw)/2:(oh-ih)/2:color=${ink},` +
    `setsar=1,${tail}[v${index}]`
  );
}

/**
 * The palette card: one cell-wide block split into weighted vertical bands.
 * Zero-width bands (a 0-weight colour) are skipped rather than emitted as a
 * degenerate drawbox.
 */
function paletteChain(
  size: PreviewSize,
  palette: PreviewPalette,
  ink: string,
  rate: number,
  tail: string,
): string {
  const widths = paletteBands(palette.weights, size.width);
  const boxes: string[] = [];
  let x = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const width = widths[index]!;
    if (width > 0) {
      boxes.push(
        `drawbox=x=${x}:y=0:w=${width}:h=${size.height}:` +
          `color=${ffColor(palette.hex[index]!)}:t=fill`,
      );
      x += width;
    }
  }
  return (
    `color=c=${ink}:s=${size.width}x${size.height}:r=${rate},` +
    `${boxes.length > 0 ? `${boxes.join(',')},` : ''}setsar=1,${tail}[v${PREVIEW_CELLS - 1}]`
  );
}

function stackedChain(grid: PreviewGrid, ink: string, tail: string): string {
  const inputs = Array.from({ length: PREVIEW_CELLS }, (_unused, index) => `[v${index}]`).join('');
  return (
    `${inputs}xstack=inputs=${PREVIEW_CELLS}:layout=${xstackLayout(grid)}:fill=${ink}[stacked];` +
    `[stacked]pad=${grid.canvas.width}:${grid.canvas.height}:` +
    `${Math.max(0, grid.offset.x)}:${Math.max(0, grid.offset.y)}:color=${ink},` +
    `${tail}[out]`
  );
}

async function portraitCropFor(framePath: string): Promise<PreviewRect> {
  return centreCrop(await probeFrameSize(framePath));
}

/** Eight evenly-spread frames for the 3×3 grid's non-palette cells. */
export function selectPreviewFrames(framePaths: readonly string[]): string[] {
  const selected = selectVisionFrames(framePaths, PREVIEW_FRAME_COUNT);
  if (selected.length !== PREVIEW_FRAME_COUNT) {
    throw new RangeError(
      `preview needs at least ${PREVIEW_FRAME_COUNT} sampled frames, got ${framePaths.length}`,
    );
  }
  return selected;
}

/**
 * Render the 3×3 contact sheet.
 *
 * @throws when ffmpeg fails; a preview that did not decode must never become
 *         `status=ready` evidence.
 */
export async function buildPreviewGrid(request: PreviewGridRequest): Promise<void> {
  assertFrames(request.framePaths);
  assertPalette(request.palette);
  const ink = ffColor(request.inkColor);

  const grid = previewGrid(request.canvas ?? { width: 1280, height: 720 });
  const crop =
    request.portrait === true ? await portraitCropFor(request.framePaths[0]!) : null;

  const chains = request.framePaths.map((_path, index) =>
    frameChain(index, grid.cell, ink, 'format=rgb24', crop),
  );
  chains.push(paletteChain(grid.cell, request.palette, ink, 1, 'format=rgb24'));

  const graph = `${chains.join(';')};${stackedChain(grid, ink, 'format=rgb24')}`;

  await ensureParentPath(request.outPath);
  const { code, stderr } = await runProcess(
    'ffmpeg',
    [
      '-v', 'error',
      ...request.framePaths.flatMap((path) => ['-i', path]),
      '-filter_complex', graph,
      '-map', '[out]',
      '-frames:v', '1',
      '-update', '1',
      '-y', request.outPath,
    ],
    FFMPEG_TIMEOUT_MS,
  );
  if (code !== 0) {
    throw new Error(`ffmpeg preview grid exited with ${code}: ${stderr.trim()}`);
  }
}

/**
 * Render the silent 6 s clip.
 *
 * Silent because a style has no narration of its own; muxing placeholder audio
 * would be a lie a user could hear. Frame count, not `-t`: `-t` is wall-clock
 * based and lands on 179 or 181 frames under load.
 */
export async function buildPreviewClip(request: PreviewClipRequest): Promise<void> {
  assertFrames(request.framePaths);
  assertPalette(request.palette);
  const ink = ffColor(request.inkColor);

  const canvas = request.canvas ?? { width: 1280, height: 720 };
  const fps = request.fps ?? PREVIEW_FPS;
  const timeline = previewClipTimeline(PREVIEW_CELLS, fps, request.seconds ?? 6);

  const chains = request.framePaths.map((_path, index) =>
    frameChain(
      index,
      canvas,
      ink,
      `format=rgb24,fps=${fps},trim=end_frame=${timeline.frames[index]!},setpts=PTS-STARTPTS`,
    ),
  );
  chains.push(
    paletteChain(
      canvas,
      request.palette,
      ink,
      fps,
      `format=rgb24,fps=${fps},trim=end_frame=${timeline.frames[PREVIEW_CELLS - 1]!},` +
        'setpts=PTS-STARTPTS',
    ),
  );

  const inputs = Array.from(
    { length: PREVIEW_CELLS },
    (_unused, index) => `[v${index}]`,
  ).join('');
  const graph =
    `${chains.join(';')};${inputs}concat=n=${PREVIEW_CELLS}:v=1:a=0,` +
    `format=yuv420p,fps=${fps}[out]`;

  await ensureParentPath(request.outPath);
  const { code, stderr } = await runProcess(
    'ffmpeg',
    [
      '-v', 'error',
      ...request.framePaths.flatMap((path) => [
        '-loop', '1',
        '-framerate', String(fps),
        '-i', path,
      ]),
      '-filter_complex', graph,
      '-map', '[out]',
      '-frames:v', String(timeline.totalFrames),
      '-r', String(fps),
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', request.outPath,
    ],
    FFMPEG_TIMEOUT_MS,
  );
  if (code !== 0) {
    throw new Error(`ffmpeg preview clip exited with ${code}: ${stderr.trim()}`);
  }
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  nb_frames?: string;
  avg_frame_rate?: string;
}

async function probe(path: string, entries: string): Promise<{ streams: ProbeStream[]; duration: number | null }> {
  const { code, stdout, stderr } = await runProcess(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', entries,
      '-of', 'json',
      path,
    ],
    FFPROBE_TIMEOUT_MS,
  );
  if (code !== 0) {
    throw new Error(`ffprobe preview failed with ${code}: ${stderr.trim()}`);
  }

  let parsed: { streams?: unknown; format?: { duration?: unknown } };
  try {
    parsed = JSON.parse(stdout.toString()) as typeof parsed;
  } catch {
    throw new Error(`ffprobe preview returned invalid JSON: ${stdout.toString().slice(0, 200)}`);
  }

  const streams = Array.isArray(parsed.streams)
    ? parsed.streams.filter((stream): stream is ProbeStream => typeof stream === 'object' && stream !== null)
    : [];
  const rawDuration = parsed.format?.duration;
  const duration =
    typeof rawDuration === 'string' || typeof rawDuration === 'number'
      ? Number.parseFloat(String(rawDuration))
      : null;

  return { streams, duration: duration !== null && Number.isFinite(duration) ? duration : null };
}

/**
 * Hard gate for the grid: the file decodes as a PNG at the canvas size.
 *
 * Duration/resolution are hard failures by docs/08; digests are advisory. A
 * 1-byte "preview.png" that a test wrote with `writeFile` must not pass.
 */
export async function verifyPreviewGrid(path: string, canvas: PreviewSize): Promise<void> {
  const { streams } = await probe(
    path,
    'stream=codec_type,codec_name,width,height',
  );
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (video === undefined) throw new Error(`preview grid ${path} has no video stream`);
  if (video.codec_name !== 'png') {
    throw new Error(`preview grid ${path} is ${String(video.codec_name)}, expected png`);
  }
  if (video.width !== canvas.width || video.height !== canvas.height) {
    throw new Error(
      `preview grid ${path} is ${String(video.width)}x${String(video.height)}, ` +
        `expected ${canvas.width}x${canvas.height}`,
    );
  }
}

export interface ClipExpectation {
  readonly canvas: PreviewSize;
  readonly fps: number;
  readonly frames: number;
  readonly seconds: number;
  /** Allowed drift for the container duration; one frame is the ceiling. */
  readonly toleranceSeconds?: number;
}

/**
 * Hard gate for the clip: exactly one video stream, no audio, correct size,
 * frame count (when the container reports it) and duration within one frame.
 */
export async function verifyPreviewClip(path: string, expected: ClipExpectation): Promise<void> {
  const { streams, duration } = await probe(
    path,
    'stream=codec_type,codec_name,width,height,nb_frames,avg_frame_rate:format=duration',
  );

  if (streams.some((stream) => stream.codec_type === 'audio')) {
    throw new Error(`preview clip ${path} has an audio stream; it must be silent`);
  }

  const video = streams.filter((stream) => stream.codec_type === 'video');
  if (video.length !== 1) {
    throw new Error(`preview clip ${path} has ${video.length} video streams, expected 1`);
  }
  const stream = video[0]!;

  if (stream.width !== expected.canvas.width || stream.height !== expected.canvas.height) {
    throw new Error(
      `preview clip ${path} is ${String(stream.width)}x${String(stream.height)}, ` +
        `expected ${expected.canvas.width}x${expected.canvas.height}`,
    );
  }

  if (stream.nb_frames !== undefined && stream.nb_frames !== 'N/A') {
    const frames = Number.parseInt(stream.nb_frames, 10);
    if (frames !== expected.frames) {
      throw new Error(`preview clip ${path} has ${frames} frames, expected ${expected.frames}`);
    }
  }

  const tolerance = expected.toleranceSeconds ?? 1 / expected.fps;
  if (duration === null) {
    throw new Error(`preview clip ${path} reports no duration`);
  }
  if (Math.abs(duration - expected.seconds) > tolerance + 1e-6) {
    throw new Error(
      `preview clip ${path} is ${duration.toFixed(3)} s, expected ${expected.seconds.toFixed(3)} s`,
    );
  }

  if (stream.avg_frame_rate !== undefined && stream.avg_frame_rate !== '0/0') {
    const [numerator, denominator] = stream.avg_frame_rate.split('/').map(Number);
    const rate = numerator !== undefined && denominator ? numerator / denominator : Number.NaN;
    if (Math.abs(rate - expected.fps) > 0.01) {
      throw new Error(`preview clip ${path} is ${String(stream.avg_frame_rate)} fps, expected ${expected.fps}`);
    }
  }
}
