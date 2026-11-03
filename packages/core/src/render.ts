/**
 * ffmpeg render composer — pure plan builder.
 *
 * Still images become short `zoompan` clips at a fixed fps, are concatenated,
 * optionally have ASS captions burned in, and are muxed with the narration.
 * This module owns every decision (dimensions, cumulative frame rounding, the
 * filter graph, the argument vector) so it can be tested without spawning a
 * process; `packages/art/src/render.ts` is the thin adapter that runs ffmpeg.
 *
 * Determinism: fixed fps, `-vsync cfr`, `-map_metadata -1`, bitexact flags and
 * a seeded-by-construction zoompan (an expression of the output frame number,
 * never wall-clock state). Same input → byte-identical argument vector.
 *
 * Pure: no I/O, no clock, no network.
 */

export const RENDER_RESOLUTIONS = [1080, 1440, 2160] as const;
export type RenderResolution = (typeof RENDER_RESOLUTIONS)[number];

export const RENDER_FRAME_RATES = [30, 60] as const;
export type RenderFps = (typeof RENDER_FRAME_RATES)[number];

export const RENDER_SIZES = ['landscape', 'portrait'] as const;
export type RenderSize = (typeof RENDER_SIZES)[number];

/** Mirrors `SCENE_MOTIONS` in `packages/contracts/src/planner.ts`. */
export const RENDER_MOTIONS = [
  'kenburns-in',
  'kenburns-out',
  'pan-left',
  'pan-right',
  'none',
] as const;
export type RenderMotion = (typeof RENDER_MOTIONS)[number];

export const RENDER_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
] as const;
export type RenderPreset = (typeof RENDER_PRESETS)[number];

/** Mirrors `MAX_SCENES`; the caller's plan already respects it. */
export const MAX_RENDER_SCENES = 120;
export const DEFAULT_AUDIO_BITRATE = '192k';
export const DEFAULT_AUDIO_RATE = 48_000;

export interface RenderScene {
  /** Absolute or relative path to a still image. */
  imagePath: string;
  durationMs: number;
  motion: RenderMotion;
}

export interface RenderCaptions {
  /** ASS file to burn in. */
  path: string;
  /** Directory containing the bundled fonts. */
  fontsDir: string;
}

export interface RenderPlanInput {
  scenes: readonly RenderScene[];
  audioPath: string;
  outputPath: string;
  resolution: RenderResolution;
  fps: RenderFps;
  size: RenderSize;
  captions?: RenderCaptions;
  /** Overrides the ladder default (18 at 1080, 16 at 2K/4K). */
  crf?: number;
  preset?: RenderPreset;
}

export interface RenderPlan {
  args: readonly string[];
  filterGraph: string;
  width: number;
  height: number;
  fps: RenderFps;
  durationMs: number;
  totalFrames: number;
  /** Frames assigned to each scene; the sum is exactly `totalFrames`. */
  sceneFrames: readonly number[];
  outputPath: string;
}

/** The ladder names the short side, so 1080p portrait is 1080×1920. */
export function renderDimensions(
  resolution: RenderResolution,
  size: RenderSize,
): { width: number; height: number } {
  if (!RENDER_RESOLUTIONS.includes(resolution)) {
    throw new Error(`resolution must be one of ${RENDER_RESOLUTIONS.join(', ')}`);
  }
  if (!RENDER_SIZES.includes(size)) {
    throw new Error(`size must be one of ${RENDER_SIZES.join(', ')}`);
  }
  const longSide = Math.round((resolution * 16) / 9);
  return size === 'landscape'
    ? { width: longSide, height: resolution }
    : { width: resolution, height: longSide };
}

/** ffmpeg filter option values treat these as syntax even inside quotes. */
export function escapeFilterPath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'")
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}

function motionFilter(motion: RenderMotion, frames: number): string {
  const centreX = "x='iw/2-(iw/zoom/2)'";
  const centreY = "y='ih/2-(ih/zoom/2)'";
  switch (motion) {
    case 'kenburns-in':
      return `zoompan=z='1+0.10*on/${frames}':${centreX}:${centreY}`;
    case 'kenburns-out':
      return `zoompan=z='1.10-0.10*on/${frames}':${centreX}:${centreY}`;
    case 'pan-left':
      return `zoompan=z='1.08':x='(iw-iw/zoom)*(1-on/${frames})':${centreY}`;
    case 'pan-right':
      return `zoompan=z='1.08':x='(iw-iw/zoom)*on/${frames}':${centreY}`;
    case 'none':
      return "zoompan=z='1':x='0':y='0'";
  }
}

export function buildRenderPlan(input: RenderPlanInput): RenderPlan {
  const { scenes, fps, resolution, size } = input;

  if (!RENDER_RESOLUTIONS.includes(resolution)) {
    throw new Error(`resolution must be one of ${RENDER_RESOLUTIONS.join(', ')}`);
  }
  if (!RENDER_FRAME_RATES.includes(fps)) {
    throw new Error(`fps must be one of ${RENDER_FRAME_RATES.join(', ')}`);
  }
  if (!RENDER_SIZES.includes(size)) {
    throw new Error(`size must be one of ${RENDER_SIZES.join(', ')}`);
  }
  if (scenes.length === 0) {
    throw new Error('buildRenderPlan: at least one scene is required');
  }
  if (scenes.length > MAX_RENDER_SCENES) {
    throw new Error(
      `buildRenderPlan: ${scenes.length} scenes exceeds the ${MAX_RENDER_SCENES}-scene limit`,
    );
  }
  for (const [index, scene] of scenes.entries()) {
    if (!Number.isInteger(scene.durationMs) || scene.durationMs <= 0) {
      throw new Error(`scene ${index}: durationMs must be a positive integer`);
    }
    if (!RENDER_MOTIONS.includes(scene.motion)) {
      throw new Error(`scene ${index}: motion must be one of ${RENDER_MOTIONS.join(', ')}`);
    }
    if (Math.round((scene.durationMs * fps) / 1000) < 1) {
      throw new Error(`scene ${index}: duration is shorter than one frame at ${fps} fps`);
    }
  }

  const crf = input.crf ?? (resolution === 1080 ? 18 : 16);
  if (!Number.isInteger(crf) || crf < 1 || crf > 51) {
    throw new Error('crf must be an integer between 1 and 51');
  }
  const preset = input.preset ?? 'medium';
  if (!RENDER_PRESETS.includes(preset)) {
    throw new Error(`preset must be one of ${RENDER_PRESETS.join(', ')}`);
  }

  const { width, height } = renderDimensions(resolution, size);

  // Cumulative rounding assigns every frame exactly once; rounding each scene
  // independently drifts over a long video.
  const sceneFrames: number[] = [];
  let cumulativeMs = 0;
  let previousBoundary = 0;
  for (const [index, scene] of scenes.entries()) {
    cumulativeMs += scene.durationMs;
    const boundary = Math.round((cumulativeMs * fps) / 1000);
    const frames = boundary - previousBoundary;
    if (frames < 1) {
      throw new Error(`scene ${index}: duration is shorter than one frame at ${fps} fps`);
    }
    sceneFrames.push(frames);
    previousBoundary = boundary;
  }
  const totalFrames = previousBoundary;
  const durationMs = cumulativeMs;

  const superWidth = width * 2;
  const superHeight = height * 2;
  const clips = scenes.map((scene, index) => {
    const frames = sceneFrames[index] ?? 0;
    return (
      `[${index}:v]scale=${superWidth}:${superHeight}:force_original_aspect_ratio=increase` +
      `:flags=lanczos,crop=${superWidth}:${superHeight},` +
      `${motionFilter(scene.motion, frames)}:d=${frames}:s=${width}x${height}:fps=${fps}` +
      `,setsar=1[v${index}]`
    );
  });

  const labels = scenes.map((_scene, index) => `[v${index}]`).join('');
  const captions = input.captions;
  const graphParts: string[] = [...clips];
  if (captions === undefined) {
    graphParts.push(`${labels}concat=n=${scenes.length}:v=1:a=0[vout]`);
  } else {
    graphParts.push(`${labels}concat=n=${scenes.length}:v=1:a=0[cat]`);
    graphParts.push(
      `[cat]ass='${escapeFilterPath(captions.path)}':fontsdir='${escapeFilterPath(captions.fontsDir)}'[vout]`,
    );
  }
  const filterGraph = graphParts.join(';');

  const args: string[] = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...scenes.flatMap((scene) => ['-i', scene.imagePath]),
    '-i',
    input.audioPath,
    '-filter_complex',
    filterGraph,
    '-map',
    '[vout]',
    '-map',
    `${scenes.length}:a:0`,
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-fps_mode',
    'cfr',
    '-c:a',
    'aac',
    '-b:a',
    DEFAULT_AUDIO_BITRATE,
    '-ar',
    String(DEFAULT_AUDIO_RATE),
    '-movflags',
    '+faststart',
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:v',
    '+bitexact',
    '-t',
    (durationMs / 1000).toFixed(3),
    input.outputPath,
  ];

  return {
    args,
    filterGraph,
    width,
    height,
    fps,
    durationMs,
    totalFrames,
    sceneFrames,
    outputPath: input.outputPath,
  };
}
