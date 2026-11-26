/**
 * ffmpeg render composer — pure plan builder.
 *
 * Standard renders turn still images into short `zoompan` clips at a fixed
 * fps. Greenscreen renders use a frame-exact `#00FF00` colour source and never
 * read the stills. Both optionally burn ASS captions and mux narration.
 * This module owns every decision (dimensions, cumulative frame rounding, the
 * filter graph, the argument vector) so it can be tested without spawning a
 * process; `packages/art/src/render.ts` is the thin adapter that runs ffmpeg.
 *
 * Determinism: fixed fps, `-fps_mode cfr`, `-map_metadata -1`, bitexact flags and
 * a seeded-by-construction zoompan (an expression of the output frame number,
 * never wall-clock state). Same input → byte-identical argument vector.
 *
 * Pure: no I/O, no clock, no network.
 */

export const RENDER_RESOLUTIONS = [1080, 1440, 2160] as const;
export type RenderResolution = (typeof RENDER_RESOLUTIONS)[number];

export const RENDER_FRAME_RATES = [30, 60] as const;
export type RenderFps = (typeof RENDER_FRAME_RATES)[number];

/** Mirrors `renderFormatSchema` in `packages/contracts/src/common.ts`. */
export const RENDER_FORMATS = ['standard', 'greenscreen'] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];

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
/** Stereo AAC-LC is more widely decoded by desktop/browser players than mono AAC. */
export const DEFAULT_AUDIO_CHANNELS = 2;

export interface RenderScene {
  /** Absolute or relative path to a still image; unused by `greenscreen`. */
  imagePath: string;
  durationMs: number;
  motion: RenderMotion;
}

/**
 * Optional persistent background for the entire video.
 *
 * With a background present every scene still is drawn as a centred card at
 * `BACKGROUND_CARD_SCALE` of the frame, so the backdrop stays visible around
 * it. Without a background the stills stay full-bleed, exactly as before.
 *
 * Provide either `imagePath` (static image) or `videoPath` (video background).
 * For video backgrounds, `videoStartFrom` specifies the start time in seconds.
 */
export interface RenderBackground {
  /** Absolute or relative path to the background image. */
  imagePath?: string;
  /** Absolute or relative path to the background video. */
  videoPath?: string;
  /** Start time in seconds for video background. */
  videoStartFrom?: number;
}

/**
 * Fraction of the frame a scene still occupies when it sits on a background.
 * 0.8 leaves a 10% gutter on every side for the backdrop and the caption band.
 */
export const BACKGROUND_CARD_SCALE = 0.8;

export interface RenderCaptions {
  /** ASS file to burn in. */
  path: string;
  /** Directory containing the bundled fonts. */
  fontsDir: string;
}

/**
 * Optional background music bed.
 *
 * The bed is looped to the narration length and mixed under the voice. With
 * `ducking` it is lowered while speech is present by a sidechain compressor
 * keyed on the narration, so the voice never fights it. These numbers mirror
 * `musicSchema` in `@facelesspro/contracts`; core is dependency-free, so they
 * are repeated here rather than imported.
 */
export interface RenderMusic {
  /** Absolute or relative path to an audio file; any ffmpeg-readable format. */
  path: string;
  /** Bed level relative to the narration master, dB, −30…0. */
  gainDb: number;
  /** Lower the bed under speech. */
  ducking: boolean;
}

export const MUSIC_MIN_GAIN_DB = -30;
export const MUSIC_MAX_GAIN_DB = 0;
/** Sidechain compressor settings used when `ducking` is on. */
export const MUSIC_DUCK_THRESHOLD = 0.05;
export const MUSIC_DUCK_RATIO = 8;
export const MUSIC_DUCK_ATTACK_MS = 20;
export const MUSIC_DUCK_RELEASE_MS = 400;

export interface RenderPlanInput {
  scenes: readonly RenderScene[];
  audioPath: string;
  outputPath: string;
  resolution: RenderResolution;
  fps: RenderFps;
  size: RenderSize;
  format: RenderFormat;
  /** Optional persistent background for the entire video (e.g., quiz background). */
  background?: RenderBackground;
  captions?: RenderCaptions;
  /** Optional music bed mixed under the narration. */
  music?: RenderMusic;
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
  const centreX = "x=iw/2-(iw/zoom/2)";
  const centreY = "y=ih/2-(ih/zoom/2)";
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
  const { scenes, fps, resolution, size, format } = input;

  if (!RENDER_RESOLUTIONS.includes(resolution)) {
    throw new Error(`resolution must be one of ${RENDER_RESOLUTIONS.join(', ')}`);
  }
  if (!RENDER_FRAME_RATES.includes(fps)) {
    throw new Error(`fps must be one of ${RENDER_FRAME_RATES.join(', ')}`);
  }
  if (!RENDER_SIZES.includes(size)) {
    throw new Error(`size must be one of ${RENDER_SIZES.join(', ')}`);
  }
  if (!RENDER_FORMATS.includes(format)) {
    throw new Error(`format must be one of ${RENDER_FORMATS.join(', ')}`);
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
  if (input.music !== undefined) {
    if (input.music.path.length === 0) {
      throw new Error('music.path must be a non-empty file path');
    }
    if (
      !Number.isFinite(input.music.gainDb) ||
      input.music.gainDb < MUSIC_MIN_GAIN_DB ||
      input.music.gainDb > MUSIC_MAX_GAIN_DB
    ) {
      throw new Error(
        `music.gainDb must be between ${MUSIC_MIN_GAIN_DB} and ${MUSIC_MAX_GAIN_DB}`,
      );
    }
    if (typeof input.music.ducking !== 'boolean') {
      throw new Error('music.ducking must be a boolean');
    }
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

  const captions = input.captions;
  const background = input.background;
  const music = input.music;
  const graphParts: string[] = [];
  let imageInputArgs: string[];
  let audioInputIndex: number;

  if (format === 'greenscreen') {
    imageInputArgs = [];
    audioInputIndex = 0;
    const colour =
      `color=c=0x00FF00:s=${width}x${height}:r=${fps},` +
      `trim=end_frame=${totalFrames},setpts=N/(${fps}*TB)`;
    if (captions === undefined) {
      graphParts.push(`${colour}[vout]`);
    } else {
      graphParts.push(`${colour}[cat]`);
      graphParts.push(
        `[cat]ass=${escapeFilterPath(captions.path)}:fontsdir=${escapeFilterPath(captions.fontsDir)}[vout]`,
      );
    }
  } else {
    // Scene images
    imageInputArgs = scenes.flatMap((scene) => ['-i', scene.imagePath]);
    // Background (image or video) if provided
    const hasVideoBackground = background?.videoPath !== undefined;
    if (background) {
      if (hasVideoBackground) {
        // Video background: seek to start time
        const startFrom = background.videoStartFrom ?? 0;
        imageInputArgs.push('-ss', String(startFrom), '-i', background.videoPath!);
      } else {
        // Static image background
        imageInputArgs.push('-i', background.imagePath!);
      }
    }
    // Count actual inputs (each '-i' introduces one input), not array elements.
    // Input options like '-ss' before '-i' add extra array elements but not inputs.
    const inputCount = imageInputArgs.filter((arg) => arg === '-i').length;
    audioInputIndex = inputCount; // Audio is the next input after all image/background inputs

    const superWidth = width * 2;
    const superHeight = height * 2;
    // Even dimensions keep libx264 and the overlay offsets on whole pixels.
    const cardWidth = Math.round((width * BACKGROUND_CARD_SCALE) / 2) * 2;
    const cardHeight = Math.round((height * BACKGROUND_CARD_SCALE) / 2) * 2;

    // Background handling: image (looped) or video (trimmed to video length)
    if (background) {
      const bgIndex = scenes.length;
      const splitLabels = scenes.map((_, index) => `[bgsrc${index}]`).join('');
      if (hasVideoBackground) {
        // Video background: trim to totalFrames and split
        graphParts.push(
          `[${bgIndex}:v]scale=${width}:${height}:flags=lanczos,crop=${width}:${height},setsar=1,` +
            `fps=${fps},trim=end_frame=${totalFrames},` +
            `setpts=N/(${fps}*TB),split=${scenes.length}${splitLabels}`,
        );
      } else {
        // Static image: loop to exact video length and split
        const splitLabels = scenes.map((_, index) => `[bgsrc${index}]`).join('');
        graphParts.push(
          `[${bgIndex}:v]scale=${width}:${height}:flags=lanczos,crop=${width}:${height},setsar=1,` +
            `loop=loop=-1:size=1:start=0,fps=${fps},trim=end_frame=${totalFrames},` +
            `setpts=N/(${fps}*TB),split=${scenes.length}${splitLabels}`,
        );
      }
    }

    // Process each scene
    const sceneLabels: string[] = [];
    let sceneStartFrame = 0;
    for (const [index, scene] of scenes.entries()) {
      const frames = sceneFrames[index] ?? 0;
      const sceneEndFrame = sceneStartFrame + frames;

      // Scale and crop scene image to super-resolution, then apply motion.
      let clip =
        `[${index}:v]scale=${superWidth}:${superHeight}:flags=lanczos,` +
        `crop=${superWidth}:${superHeight},${motionFilter(scene.motion, frames)}` +
        `:d=${frames}:s=${width}x${height}:fps=${fps},setsar=1`;

      if (background) {
        // The scene becomes a centred card on the backdrop segment for this scene.
        clip += `,scale=${cardWidth}:${cardHeight}[card${index}]`;
        graphParts.push(
          `[bgsrc${index}]trim=start_frame=${sceneStartFrame}:end_frame=${sceneEndFrame},` +
            `setpts=PTS-STARTPTS[bg${index}]`,
        );
        graphParts.push(clip);
        clip = `[bg${index}][card${index}]overlay=(W-w)/2:(H-h)/2`;
      }

      const outLabel = `[v${index}]`;
      graphParts.push(clip + outLabel);
      sceneLabels.push(outLabel);
      sceneStartFrame = sceneEndFrame;
    }

    // Concat all scenes
    const labels = sceneLabels.join('');
    if (captions === undefined) {
      graphParts.push(`${labels}concat=n=${scenes.length}:v=1:a=0[vout]`);
    } else {
      graphParts.push(`${labels}concat=n=${scenes.length}:v=1:a=0[cat]`);
      graphParts.push(
        `[cat]ass=${escapeFilterPath(captions.path)}:fontsdir=${escapeFilterPath(captions.fontsDir)}[vout]`,
      );
    }
  }
  // --- audio ----------------------------------------------------------------
  // Without music the narration is mapped straight from its input. With a bed
  // the voice is split into a mix path and a sidechain key, so the compressor
  // lowers only the bed; `normalize=0` keeps the narration at its own level
  // instead of halving it, which is what `amix` would do by default.
  let audioMap = `${audioInputIndex}:a:0`;
  if (music !== undefined) {
    const seconds = (durationMs / 1000).toFixed(3);
    const musicIndex = audioInputIndex + 1;
    const voice =
      `[${audioInputIndex}:a]aresample=${DEFAULT_AUDIO_RATE},` +
      'aformat=sample_fmts=fltp:channel_layouts=stereo';
    const bed =
      `[${musicIndex}:a]atrim=duration=${seconds},asetpts=N/SR/TB,` +
      `aresample=${DEFAULT_AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `volume=${music.gainDb}dB[bed]`;
    if (music.ducking) {
      graphParts.push(`${voice},asplit=2[voice][key]`);
      graphParts.push(bed);
      graphParts.push(
        `[bed][key]sidechaincompress=threshold=${MUSIC_DUCK_THRESHOLD}` +
          `:ratio=${MUSIC_DUCK_RATIO}:attack=${MUSIC_DUCK_ATTACK_MS}` +
          `:release=${MUSIC_DUCK_RELEASE_MS}:makeup=1[ducked]`,
      );
      graphParts.push('[voice][ducked]amix=inputs=2:duration=first:normalize=0[aout]');
    } else {
      graphParts.push(`${voice}[voice]`);
      graphParts.push(bed);
      graphParts.push('[voice][bed]amix=inputs=2:duration=first:normalize=0[aout]');
    }
    audioMap = '[aout]';
  }
  const filterGraph = graphParts.join(';');

  const args: string[] = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...imageInputArgs,
    '-i',
    input.audioPath,
    ...(music === undefined ? [] : ['-stream_loop', '-1', '-i', music.path]),
    '-filter_complex',
    filterGraph,
    '-map',
    '[vout]',
    '-map',
    audioMap,
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
    '-profile:a',
    'aac_low',
    '-b:a',
    DEFAULT_AUDIO_BITRATE,
    '-ar',
    String(DEFAULT_AUDIO_RATE),
    '-ac',
    String(DEFAULT_AUDIO_CHANNELS),
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
