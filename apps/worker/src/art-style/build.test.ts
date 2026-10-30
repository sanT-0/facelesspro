import type {
  ArtStyleBuildJob,
  NumericStyleProfile,
  StyleVision,
} from '@facelesspro/contracts';
import { describe, expect, it, vi } from 'vitest';

import { buildArtStyle } from './build';
import type {
  ArtStyleBuildDeps,
  ArtStyleBuildStore,
  LoadedArtStyle,
  MarkReadyInput,
  PreviewArtifact,
  RenderPreviewsInput,
} from './build';
import { mergeStyleProfile } from './merge';

const job: ArtStyleBuildJob = {
  styleId: '11111111-1111-4111-8111-111111111111',
  referenceKey: 'references/reference.mp4',
};

const numeric: NumericStyleProfile = {
  palette: {
    hex: ['#f1bf4d', '#1a283f', '#fefefe', '#020202', '#e2562d'],
    weights: [0.3751, 0.3613, 0.2083, 0.0414, 0.0139],
  },
  line: { strokeDensity: 0.006, edgeEnergy: 0.007 },
  tone: {
    saturation: { mean: 0.48, p95: 0.5 },
    contrast: { mean: 0.01, p95: 0.02 },
    brightness: { mean: 0.55, p95: 0.63 },
  },
  aspect: { width: 640, height: 360, ratio: 1.7778, orientation: 'landscape' },
  safeArea: { edgeContentRatio: 0.04, margin: 0.08 },
  frameCount: 8,
};

const vision: StyleVision = {
  medium: 'unknown',
  promptPrefix: 'landscape frame, thin outlines, flat colour areas',
  line: { weight: 'thin', texture: 'unknown' },
  shading: 'flat',
  background: 'clean, simple background',
  composition: 'landscape frame, low edge content',
  characters: [],
  typography: { present: false },
  negative: 'photo, 3d render, text',
  adapter: 'heuristic',
  degradedFrom: [],
};

const profile = mergeStyleProfile(numeric, vision);

const frames = Array.from({ length: 8 }, (_unused, index) => `/frames/${index}.png`);

const gridArtifact: PreviewArtifact = {
  kind: 'grid',
  key: `art-styles/${job.styleId}/preview.png`,
  path: `/data/art-styles/${job.styleId}/preview.png`,
  canvas: { width: 1280, height: 720 },
};

const portraitArtifact: PreviewArtifact = {
  kind: 'portrait',
  key: `art-styles/${job.styleId}/preview-portrait.png`,
  path: `/data/art-styles/${job.styleId}/preview-portrait.png`,
  canvas: { width: 720, height: 1280 },
};

const clipArtifact: PreviewArtifact = {
  kind: 'clip',
  key: `art-styles/${job.styleId}/preview.mp4`,
  path: `/data/art-styles/${job.styleId}/preview.mp4`,
  canvas: { width: 1280, height: 720 },
  clip: { fps: 30, frames: 180, seconds: 6 },
};

interface Harness {
  readonly deps: ArtStyleBuildDeps;
  readonly loaded: LoadedArtStyle;
  readonly markReady: ReturnType<typeof vi.fn>;
  readonly markFailed: ReturnType<typeof vi.fn>;
  readonly sample: ReturnType<typeof vi.fn>;
  readonly analyze: ReturnType<typeof vi.fn>;
  readonly describe: ReturnType<typeof vi.fn>;
  readonly renderPreviews: ReturnType<typeof vi.fn>;
  readonly verifyPreviews: ReturnType<typeof vi.fn>;
}

function harness(options: {
  status?: LoadedArtStyle['status'];
  formats?: readonly string[];
  artifacts?: readonly PreviewArtifact[];
  verify?: () => Promise<void>;
} = {}): Harness {
  const loaded: LoadedArtStyle = {
    id: job.styleId,
    formats: options.formats ?? ['landscape'],
    status: options.status ?? 'building',
  };

  const markReady = vi.fn(async (_input: MarkReadyInput) => {});
  const markFailed = vi.fn(async (_input: { styleId: string; message: string }) => {});
  const sample = vi.fn(async (_path: string, _styleId: string) => frames);
  const analyze = vi.fn(async (_paths: readonly string[]) => numeric);
  const describe = vi.fn(async (_request: { framePaths: readonly string[]; numeric: NumericStyleProfile }) => vision);
  const artifacts = options.artifacts ?? [gridArtifact, clipArtifact];
  const renderPreviews = vi.fn(async (_input: RenderPreviewsInput) => artifacts);
  const verifyPreviews = vi.fn(options.verify ?? (async () => {}));

  const store: ArtStyleBuildStore = {
    load: async () => loaded,
    markReady,
    markFailed,
  };

  const deps: ArtStyleBuildDeps = {
    store,
    resolve: (key) => `/data/${key}`,
    sample,
    analyze,
    describe,
    renderPreviews,
    verifyPreviews,
  };

  return {
    deps,
    loaded,
    markReady,
    markFailed,
    sample,
    analyze,
    describe,
    renderPreviews,
    verifyPreviews,
  };
}

describe('buildArtStyle', () => {
  it('runs sample → numeric → vision → merge → previews → verify → ready', async () => {
    const test = harness();

    const result = await buildArtStyle(job, test.deps);

    expect(result).toEqual({ status: 'ready' });
    expect(test.sample).toHaveBeenCalledWith('/data/references/reference.mp4', job.styleId);
    expect(test.analyze).toHaveBeenCalledWith(frames);
    expect(test.describe).toHaveBeenCalledWith({ framePaths: frames, numeric });

    const renderInput = test.renderPreviews.mock.calls[0]![0] as RenderPreviewsInput;
    expect(renderInput.profile).toEqual(profile);
    expect(renderInput.formats).toEqual(['landscape']);
    expect(renderInput.keys).toEqual({
      grid: gridArtifact.key,
      portrait: `art-styles/${job.styleId}/preview-portrait.png`,
      clip: clipArtifact.key,
    });

    expect(test.verifyPreviews).toHaveBeenCalledWith([gridArtifact, clipArtifact]);
    expect(test.markReady).toHaveBeenCalledWith({
      styleId: job.styleId,
      profile,
      previewKey: gridArtifact.key,
    });
    expect(test.markFailed).not.toHaveBeenCalled();
  });

  it('forwards the portrait preview key when the builder produced one', async () => {
    const test = harness({
      formats: ['landscape', 'portrait'],
      artifacts: [gridArtifact, portraitArtifact, clipArtifact],
    });

    await buildArtStyle(job, test.deps);

    expect(test.markReady).toHaveBeenCalledWith({
      styleId: job.styleId,
      profile,
      previewKey: gridArtifact.key,
      portraitPreviewKey: portraitArtifact.key,
    });
  });

  it('does not mark ready when the builder returned no clip', async () => {
    const test = harness({ artifacts: [gridArtifact] });

    const result = await buildArtStyle(job, test.deps);

    expect(result.status).toBe('failed');
    expect(test.markReady).not.toHaveBeenCalled();
    expect(test.markFailed).toHaveBeenCalledWith({
      styleId: job.styleId,
      message: 'preview build did not return both a grid and a clip',
    });
  });

  it('does not mark ready when verification rejects the artifacts', async () => {
    const test = harness({
      verify: async () => {
        throw new Error('preview clip preview.mp4 is 5.900 s, expected 6.000 s');
      },
    });

    const result = await buildArtStyle(job, test.deps);

    expect(result).toEqual({
      status: 'failed',
      message: 'preview clip preview.mp4 is 5.900 s, expected 6.000 s',
    });
    expect(test.markReady).not.toHaveBeenCalled();
  });

  it('marks failed when a stage throws, and never writes a profile', async () => {
    const test = harness();
    test.sample.mockRejectedValueOnce(new Error('ffmpeg scene detection exited with 1'));

    const result = await buildArtStyle(job, test.deps);

    expect(result.status).toBe('failed');
    expect(test.markFailed).toHaveBeenCalledWith({
      styleId: job.styleId,
      message: 'ffmpeg scene detection exited with 1',
    });
    expect(test.markReady).not.toHaveBeenCalled();
  });

  it('leaves an already-ready style alone instead of paying for another build', async () => {
    const test = harness({ status: 'ready' });

    const result = await buildArtStyle(job, test.deps);

    expect(result).toEqual({ status: 'ready' });
    expect(test.sample).not.toHaveBeenCalled();
    expect(test.markReady).not.toHaveBeenCalled();
  });

  it('retries a failed build, because the row is the resume point', async () => {
    const test = harness({ status: 'failed' });

    const result = await buildArtStyle(job, test.deps);

    expect(result.status).toBe('ready');
    expect(test.markReady).toHaveBeenCalledTimes(1);
  });

  it('throws for an unknown style without marking anything failed', async () => {
    const test = harness();
    test.deps.store.load = async () => null;

    await expect(buildArtStyle(job, test.deps)).rejects.toThrow(/not found/);
    expect(test.markFailed).not.toHaveBeenCalled();
  });
});
