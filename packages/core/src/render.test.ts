/**
 * ffmpeg render composer contract (roadmap P4 task 5).
 *
 * The composer is split in two: this pure module decides dimensions, frame
 * counts, the filter graph and the argument vector; `packages/art` only spawns
 * ffmpeg. That keeps the interesting decisions testable without a process and
 * makes the real-ffmpeg test an integration gate rather than the only test.
 *
 * Hard rules pinned here: one `zoompan` per still, exact cumulative frame
 * rounding (no drift over a long video), no audio in the filter graph, and a
 * deterministic argument vector for the same input.
 */

import { describe, expect, it } from 'vitest';

import {
  RENDER_FRAME_RATES,
  RENDER_MOTIONS,
  RENDER_RESOLUTIONS,
  RENDER_SIZES,
  buildRenderPlan,
  escapeFilterPath,
  renderDimensions,
} from './render';
import type { RenderMotion, RenderPlanInput } from './render';

const scene = (imagePath: string, durationMs: number, motion: RenderMotion = 'none') => ({
  imagePath,
  durationMs,
  motion,
});

function input(overrides: Partial<RenderPlanInput> = {}): RenderPlanInput {
  return {
    scenes: [scene('a.png', 800), scene('b.png', 700)],
    audioPath: 'voice.wav',
    outputPath: 'out.mp4',
    resolution: 1080,
    fps: 30,
    size: 'landscape',
    ...overrides,
  };
}

describe('render vocabulary', () => {
  it('pins the supported resolutions, frame rates, sizes and motions', () => {
    expect(RENDER_RESOLUTIONS).toEqual([1080, 1440, 2160]);
    expect(RENDER_FRAME_RATES).toEqual([30, 60]);
    expect(RENDER_SIZES).toEqual(['landscape', 'portrait']);
    expect(RENDER_MOTIONS).toEqual([
      'kenburns-in',
      'kenburns-out',
      'pan-left',
      'pan-right',
      'none',
    ]);
  });
});

describe('renderDimensions', () => {
  it('maps the ladder to 16:9 landscape output', () => {
    expect(renderDimensions(1080, 'landscape')).toEqual({ width: 1920, height: 1080 });
    expect(renderDimensions(1440, 'landscape')).toEqual({ width: 2560, height: 1440 });
    expect(renderDimensions(2160, 'landscape')).toEqual({ width: 3840, height: 2160 });
  });

  it('maps the ladder to 9:16 portrait output', () => {
    expect(renderDimensions(1080, 'portrait')).toEqual({ width: 1080, height: 1920 });
    expect(renderDimensions(1440, 'portrait')).toEqual({ width: 1440, height: 2560 });
    expect(renderDimensions(2160, 'portrait')).toEqual({ width: 2160, height: 3840 });
  });

  it('rejects an unknown resolution or size', () => {
    expect(() => renderDimensions(720 as 1080, 'landscape')).toThrow(/resolution/i);
    expect(() => renderDimensions(1080, 'square' as 'landscape')).toThrow(/size/i);
  });
});

describe('buildRenderPlan', () => {
  it('assigns every frame exactly once with cumulative rounding', () => {
    const plan = buildRenderPlan(input());
    expect(plan.sceneFrames).toEqual([24, 21]);
    expect(plan.totalFrames).toBe(45);
    expect(plan.durationMs).toBe(1500);

    // Three awkward durations: rounding each scene independently would drift.
    const awkward = buildRenderPlan(
      input({
        fps: 60,
        scenes: [scene('a.png', 333), scene('b.png', 333), scene('c.png', 334)],
      }),
    );
    expect(awkward.totalFrames).toBe(60);
    expect(awkward.sceneFrames.reduce((sum, frames) => sum + frames, 0)).toBe(60);
    for (const frames of awkward.sceneFrames) expect(frames).toBeGreaterThan(0);
  });

  it('builds one centred zoompan per still, then concatenates', () => {
    const plan = buildRenderPlan(
      input({ scenes: [scene('a.png', 800, 'kenburns-in'), scene('b.png', 700)] }),
    );
    expect(plan.filterGraph).toContain(
      "[0:v]scale=3840:2160:force_original_aspect_ratio=increase:flags=lanczos,crop=3840:2160,zoompan=z='1+0.10*on/24':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=24:s=1920x1080:fps=30,setsar=1[v0]",
    );
    expect(plan.filterGraph).toContain(
      "[1:v]scale=3840:2160:force_original_aspect_ratio=increase:flags=lanczos,crop=3840:2160,zoompan=z='1':x='0':y='0':d=21:s=1920x1080:fps=30,setsar=1[v1]",
    );
    expect(plan.filterGraph).toContain('[v0][v1]concat=n=2:v=1:a=0[vout]');
  });

  it('pins each motion expression', () => {
    const graphFor = (motion: 'kenburns-out' | 'pan-left' | 'pan-right') =>
      buildRenderPlan(input({ scenes: [scene('a.png', 1000, motion)] })).filterGraph;

    expect(graphFor('kenburns-out')).toContain("z='1.10-0.10*on/30'");
    expect(graphFor('pan-left')).toContain("z='1.08':x='(iw-iw/zoom)*(1-on/30)'");
    expect(graphFor('pan-right')).toContain("z='1.08':x='(iw-iw/zoom)*on/30'");
  });

  it('burns ASS only when a caption path and fonts directory are provided', () => {
    const plain = buildRenderPlan(input());
    expect(plain.filterGraph).not.toContain('ass=');

    const captioned = buildRenderPlan(
      input({ captions: { path: 'subs/captions.ass', fontsDir: 'fonts/ttf' } }),
    );
    expect(captioned.filterGraph).toContain(
      "[v0][v1]concat=n=2:v=1:a=0[cat];[cat]ass='subs/captions.ass':fontsdir='fonts/ttf'[vout]",
    );
  });

  it('one input per still, then narration audio; audio never enters the graph', () => {
    const plan = buildRenderPlan(input());
    expect(plan.args.slice(0, 9)).toEqual([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'a.png',
      '-i',
      'b.png',
      '-i',
    ]);
    expect(plan.args[9]).toBe('voice.wav');
    expect(plan.args).toContain('2:a:0');
    expect(plan.filterGraph).not.toContain('voice.wav');
  });

  it('encodes h264/aac with ladder-specific CRF and faststart', () => {
    const hd = buildRenderPlan(input());
    expect(hd.args).toEqual(
      expect.arrayContaining([
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-fps_mode', 'cfr',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-map_metadata', '-1',
        '-t', '1.500',
      ]),
    );
    expect(hd.args.at(-1)).toBe('out.mp4');

    expect(buildRenderPlan(input({ resolution: 1440 })).args).toEqual(
      expect.arrayContaining(['-crf', '16']),
    );
    expect(buildRenderPlan(input({ resolution: 2160 })).args).toEqual(
      expect.arrayContaining(['-crf', '16']),
    );
  });

  it('honours a caller CRF and preset override', () => {
    const plan = buildRenderPlan(input({ crf: 20, preset: 'slow' }));
    expect(plan.args).toEqual(expect.arrayContaining(['-crf', '20', '-preset', 'slow']));
  });

  it('is deterministic for the same input', () => {
    const first = buildRenderPlan(input({ captions: { path: 'c.ass', fontsDir: 'f' } }));
    const second = buildRenderPlan(input({ captions: { path: 'c.ass', fontsDir: 'f' } }));
    expect(second.args).toEqual(first.args);
    expect(second.filterGraph).toBe(first.filterGraph);
  });

  it('rejects impossible timelines loudly', () => {
    expect(() => buildRenderPlan(input({ scenes: [] }))).toThrow(/scene/i);
    expect(() => buildRenderPlan(input({ scenes: [scene('a.png', 0)] }))).toThrow(/duration/i);
    expect(() =>
      buildRenderPlan(input({ scenes: [scene('a.png', 1)] })),
    ).toThrow(/short/i);
    expect(() =>
      buildRenderPlan(input({ scenes: Array.from({ length: 121 }, (_, index) => scene(`${index}.png`, 1000)) })),
    ).toThrow(/120/);
    expect(() => buildRenderPlan(input({ fps: 24 as 30 }))).toThrow(/fps/i);
    expect(() => buildRenderPlan(input({ resolution: 720 as 1080 }))).toThrow(/resolution/i);
    expect(() => buildRenderPlan(input({ size: 'square' as 'landscape' }))).toThrow(/size/i);
    expect(() => buildRenderPlan(input({ crf: 0 }))).toThrow(/crf/i);
  });
});

describe('escapeFilterPath', () => {
  it('normalises separators and escapes filter option metacharacters', () => {
    expect(escapeFilterPath('C:\\work\\subs.ass')).toBe('C\\:/work/subs.ass');
    expect(escapeFilterPath('a:b,c[d];e.ass')).toBe('a\\:b\\,c\\[d\\]\\;e.ass');
    expect(escapeFilterPath("it's.ass")).toBe("it\\'s.ass");
  });
});
