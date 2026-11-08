import type {
  ArtStyleRow,
  GeneratedImage,
  ImageGenerationRequest,
  ScenePlan,
  SceneRow,
  StyleProfile,
} from '@facelesspro/contracts';
import { sceneSeedFor } from '@facelesspro/core';
import type { Database } from '@facelesspro/db';
import { StepFailure } from '@facelesspro/queue';
import type { CommitTx, StepContext } from '@facelesspro/queue';
import { describe, expect, it, vi } from 'vitest';

import { ImageChainError } from '../image/chain';
import { IMAGE_NATIVE_DIMENSIONS } from '../image/dimensions';
import type { SceneFrame } from '../image/postprocess';
import {
  createCreateImagesWork,
  framesManifestKey,
  type PersistImages,
  type PersistImagesInput,
  type ProcessScene,
  type StoreFrames,
  type StoreFramesInput,
} from './create-images';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-11-05T08:00:00.000Z';
const SCRIPT = 'வணக்கம் நண்பர்களே. Today we plan one useful scene.';

const profile: StyleProfile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene, thick clean outlines',
  palette: { hex: ['#14213d', '#fca311'], weights: [0.7, 0.3] },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple geometric background',
  composition: 'centred subject with generous safe area',
  characters: [],
  typography: { present: false },
  negative: 'photo, text, watermark',
  seedBase: 1234,
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

const style: ArtStyleRow = {
  id: STYLE_ID,
  workspace_id: WORKSPACE_ID,
  name: 'Test style',
  published: false,
  formats: ['landscape'],
  profile,
  preview_url: null,
  portrait_preview_url: null,
  sample_video_urls: [],
  status: 'ready',
  created_at: NOW,
};

const plan: ScenePlan = {
  scenes: [
    {
      text: 'வணக்கம் நண்பர்களே.',
      imagePrompt: 'flat vector scene, a greeting, palette #14213d #fca311, no text',
      motion: 'kenburns-in',
      emphasis: [],
      startMs: 0,
      endMs: 1_200,
    },
    {
      text: 'Today we plan one useful scene.',
      imagePrompt: 'flat vector scene, a desk by a window, palette #14213d #fca311, no text',
      motion: 'pan-left',
      emphasis: ['useful'],
      startMs: 1_200,
      endMs: 2_400,
    },
  ],
  adapter: 'heuristic',
  degradedFrom: [],
  totalMs: 2_400,
};

function request(
  body: Record<string, unknown> = { artStyleId: STYLE_ID, script: SCRIPT },
): StepContext['video'] {
  return {
    id: VIDEO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'ai-video-v3',
    status: 'processing',
    step: 'create-images',
    error: null,
    request: { kind: 'ai-video-v3', body },
    plan,
    webhook_url: null,
    duration_ms: 2_400,
    video_url: null,
    editor_seen_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function sceneRows(): SceneRow[] {
  return plan.scenes.map((planned, idx) => ({
    id: `0190a0a0-0000-7000-8000-00000000001${idx}`,
    video_id: VIDEO_ID,
    idx,
    text: planned.text,
    image_asset_id: null,
    motion: { preset: planned.motion, emphasis: planned.emphasis },
    start_ms: planned.startMs,
    end_ms: planned.endMs,
  }));
}

function harness(row: StepContext['video'] = request()) {
  const calls: string[] = [];
  const advance = vi.fn(async () => {
    calls.push('advance');
  });
  const charge = vi.fn(async () => {
    calls.push('charge');
  });
  const tx: CommitTx = {
    db: {} as Database,
    videoId: VIDEO_ID,
    attempt: 1,
    setStep: vi.fn(async () => {}),
    advance,
    enqueue: vi.fn(async () => {}),
    charge,
  };
  const transactionCalls: Array<(commit: CommitTx) => Promise<unknown>> = [];
  const transaction: StepContext['transaction'] = async <T>(
    fn: (commit: CommitTx) => Promise<T>,
  ): Promise<T> => {
    transactionCalls.push(fn);
    calls.push('transaction');
    return await fn(tx);
  };
  const observe = vi.fn();
  const context: StepContext = {
    db: {} as Database,
    video: row,
    videoId: VIDEO_ID,
    step: 'create-images',
    attempt: 1,
    observe,
    transaction,
  };
  return { context, tx, transactionCalls, advance, charge, calls, observe };
}

function histogramFor(idx: number): number[] {
  return Array.from({ length: 64 }, (_value, bin) => (bin === idx ? 1 : 0));
}

function frameFor(
  imageRequest: ImageGenerationRequest,
  idx: number,
  overrides: Partial<SceneFrame> = {},
): SceneFrame {
  const { width, height } = IMAGE_NATIVE_DIMENSIONS[imageRequest.size];
  const image: GeneratedImage = {
    adapter: 'procedural',
    degradedFrom: [],
    mimeType: 'image/png',
    size: imageRequest.size,
    width,
    height,
    seed: imageRequest.seed,
    bytes: Uint8Array.from([137, 80, 78, 71, idx, 1, 2, 3]),
  };
  return {
    image,
    prompt: imageRequest.prompt,
    histogram: histogramFor(idx),
    correction: { deltaE: 2, maxDeltaE: 6 },
    consistency: {
      distance: null,
      outlier: false,
      regenerated: false,
      finalDistance: null,
    },
    ...overrides,
  };
}

interface DepsOptions {
  processScene?: ProcessScene;
  storeFrames?: StoreFrames;
  persistImages?: PersistImages;
  findStyle?: () => Promise<ArtStyleRow | null>;
  scenes?: SceneRow[];
  imageUnitCost?: number;
}

function deps(options: DepsOptions = {}) {
  const calls: string[] = [];
  let drawIndex = 0;
  const processScene =
    options.processScene ??
    vi.fn<ProcessScene>(async (imageRequest, processOptions) => {
      calls.push('process');
      void processOptions;
      return frameFor(imageRequest, drawIndex++);
    });
  const storeFrames =
    options.storeFrames ??
    vi.fn<StoreFrames>(async (input: StoreFramesInput) => {
      calls.push('store');
      return {
        keys: input.frames.map((frame) => frame.key),
        manifestKey: framesManifestKey(input.workspaceId, input.videoId),
      };
    });
  const persistImages =
    options.persistImages ?? vi.fn<PersistImages>(async () => {});
  const findStyle = options.findStyle ?? (async () => style);
  const work = createCreateImagesWork({
    image: { draw: vi.fn() },
    findStyle,
    listScenes: async () => options.scenes ?? sceneRows(),
    processScene,
    storeFrames,
    persistImages,
    imageUnitCost: options.imageUnitCost ?? 0,
  });
  return { work, processScene, storeFrames, persistImages, findStyle, calls };
}

describe('createCreateImagesWork', () => {
  it('builds deterministic style-aware requests, then stores and commits once', async () => {
    const { work, processScene, storeFrames, persistImages, calls: workCalls } = deps();
    const { context, calls, charge, advance } = harness();

    await work(context);

    expect(processScene).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(processScene).mock.calls[0]!;
    const secondCall = vi.mocked(processScene).mock.calls[1]!;
    expect(firstCall[0]).toEqual({
      prompt: plan.scenes[0]!.imagePrompt,
      negativePrompt: 'photo, text, watermark, logo, signature',
      seed: sceneSeedFor(VIDEO_ID, 0),
      size: 'landscape',
      style: profile,
    });
    expect(secondCall[0]?.seed).toBe(sceneSeedFor(VIDEO_ID, 1));
    expect(firstCall[1].referenceHistograms).toEqual([]);
    expect(secondCall[1].referenceHistograms).toEqual([histogramFor(0)]);

    expect([...workCalls, ...calls]).toEqual([
      'process',
      'process',
      'store',
      'transaction',
      'charge',
      'advance',
    ]);

    const storedInput = vi.mocked(storeFrames).mock.calls[0]![0];
    expect(storedInput.frames.map((frame) => frame.key)).toEqual([
      `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/frames/0001.png`,
      `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/frames/0002.png`,
    ]);
    expect(storedInput.manifest).toMatchObject({
      version: 1,
      videoId: VIDEO_ID,
      styleId: STYLE_ID,
      size: 'landscape',
    });
    expect(storedInput.manifest.frames.map((frame) => frame.prompt)).toEqual(
      plan.scenes.map((planned) => planned.imagePrompt),
    );
    expect(storedInput.manifest.frames.map((frame) => frame.seed)).toEqual([
      sceneSeedFor(VIDEO_ID, 0),
      sceneSeedFor(VIDEO_ID, 1),
    ]);
    expect(storedInput.manifest.frames.every((frame) => frame.sha256.length === 64)).toBe(true);

    const persisted = (
      vi.mocked(persistImages).mock.calls[0] as unknown as [CommitTx, PersistImagesInput]
    )[1];
    expect(persisted).toMatchObject({ videoId: VIDEO_ID, workspaceId: WORKSPACE_ID });
    expect(persisted.frames.map((frame) => frame.idx)).toEqual([0, 1]);

    expect(charge).toHaveBeenCalledWith({ action: 'image', units: 1, unitCost: 0 });
    expect(advance).toHaveBeenCalledOnce();
  });

  it('charges ceil(scenes / 20) units at the configured price', async () => {
    const { work } = deps({ imageUnitCost: 2 });
    const firstHarness = harness();

    await work(firstHarness.context);

    expect(firstHarness.charge).toHaveBeenCalledWith({
      action: 'image',
      units: 1,
      unitCost: 2,
    });

    const many: ScenePlan = {
      ...plan,
      totalMs: 21_000,
      scenes: Array.from({ length: 21 }, (_value, idx) => ({
        text: `scene ${idx + 1}`,
        imagePrompt: `flat vector scene ${idx + 1}`,
        motion: 'none' as const,
        emphasis: [],
        startMs: idx * 1_000,
        endMs: (idx + 1) * 1_000,
      })),
    };
    const rows = many.scenes.map((planned, idx) => ({
      ...sceneRows()[0]!,
      id: `0190a0a0-0000-7000-8000-${String(idx).padStart(12, '0')}`,
      idx,
      text: planned.text,
      start_ms: planned.startMs,
      end_ms: planned.endMs,
    }));
    const second = deps({
      scenes: rows,
      imageUnitCost: 2,
    });
    const harnessed = harness({ ...request(), plan: many });

    await second.work(harnessed.context);

    expect(harnessed.charge).toHaveBeenCalledWith({ action: 'image', units: 2, unitCost: 2 });
  });

  it('records the accepted regenerate prompt in the manifest and asset meta', async () => {
    const regenerated = `, same character, same palette as previous scene`;
    const processScene = vi.fn<ProcessScene>(async (imageRequest, processOptions) => {
      void processOptions;
      return frameFor(imageRequest, 0, {
        prompt: `${imageRequest.prompt}${regenerated}`,
        consistency: {
          distance: 0.8,
          outlier: true,
          regenerated: true,
          finalDistance: 0.1,
        },
      });
    });
    const { work, storeFrames, persistImages } = deps({ processScene });
    const { context } = harness();

    await work(context);

    const manifest = vi.mocked(storeFrames).mock.calls[0]![0].manifest;
    expect(manifest.frames[0]?.prompt.endsWith(regenerated)).toBe(true);
    expect(manifest.frames[0]?.consistency).toEqual({
      distance: 0.8,
      outlier: true,
      regenerated: true,
      finalDistance: 0.1,
    });
    const persisted = (
      vi.mocked(persistImages).mock.calls[0] as unknown as [CommitTx, PersistImagesInput]
    )[1];
    expect(persisted.frames[0]?.consistency.regenerated).toBe(true);
  });

  it.each([
    ['missing', null, 'not_found'],
    ['building', { ...style, status: 'building' as const }, 'conflict'],
    ['private to another workspace', { ...style, workspace_id: VIDEO_ID }, 'forbidden'],
    ['wrong orientation', { ...style, formats: ['portrait' as const] }, 'invalid_request'],
  ])('rejects a %s style before drawing', async (_label, found, code) => {
    const { work, processScene, storeFrames } = deps({ findStyle: async () => found });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({ code });
    expect(processScene).not.toHaveBeenCalled();
    expect(storeFrames).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it('rejects a missing or malformed plan before drawing', async () => {
    const missing = harness({ ...request(), plan: null });
    const { work, processScene } = deps();

    await expect(work(missing.context)).rejects.toMatchObject({ code: 'internal' });
    expect(processScene).not.toHaveBeenCalled();

    const malformed = harness({ ...request(), plan: { scenes: [] } });
    await expect(work(malformed.context)).rejects.toMatchObject({ code: 'internal' });
    expect(processScene).not.toHaveBeenCalled();
  });

  it('rejects scene rows that do not match the stored plan', async () => {
    const { work, processScene } = deps({ scenes: sceneRows().slice(0, 1) });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({ code: 'internal' });
    expect(processScene).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it('rejects scene text that has drifted from the stored plan', async () => {
    const rows = sceneRows();
    rows[1] = { ...rows[1]!, text: 'rewritten after planning' };
    const { work, processScene } = deps({ scenes: rows });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({ code: 'internal' });
    expect(processScene).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it.each([
    ['all transient', true],
    ['permanent', false],
  ])('maps an %s image-chain failure without committing', async (_label, retryable) => {
    const processScene = vi.fn<ProcessScene>(async () => {
      throw new ImageChainError([
        { adapter: 'cloudflare', message: '429', retryable },
        { adapter: 'pollinations', message: 'timeout', retryable },
      ]);
    });
    const { work, storeFrames } = deps({ processScene });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable,
    });
    expect(storeFrames).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it('keeps an unknown draw error retryable instead of blaming the user', async () => {
    const processScene = vi.fn<ProcessScene>(async () => {
      throw new Error('socket hang up');
    });
    const { work } = deps({ processScene });
    const { context, transactionCalls } = harness();

    const error = await work(context).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StepFailure);
    expect(error).toMatchObject({ code: 'upstream_failed', retryable: true });
    expect(transactionCalls).toHaveLength(0);
  });

  it('keeps a disk-write failure retryable and commits nothing', async () => {
    const { work } = deps({
      storeFrames: async () => {
        throw new Error('ENOSPC: no space left on device');
      },
    });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({
      code: 'internal',
      retryable: true,
    });
    expect(transactionCalls).toHaveLength(0);
  });
});
