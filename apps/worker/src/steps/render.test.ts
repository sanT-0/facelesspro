import {
  createAiVideoV3RequestSchema,
  type AssetRow,
  type CaptionTrackRow,
  type NarrationRow,
  type SceneRow,
} from '@facelesspro/contracts';
import {
  buildRenderPlan,
  renderDimensions,
  type RenderPlanInput,
} from '@facelesspro/core';
import type { RenderResult, ThumbnailResult } from '@facelesspro/art';
import type { Database } from '@facelesspro/db';
import { StepFailure } from '@facelesspro/queue';
import type { CommitTx, StepContext } from '@facelesspro/queue';
import { describe, expect, it, vi } from 'vitest';

import { resolveStorageKey } from '../art-style/storage';
import { captionKey } from './create-captions';
import {
  DEFAULT_RENDER_UNIT_COST,
  createCreateRenderWork,
  renderKey,
  thumbnailKey,
  type PersistRenderInput,
  type PersistRender,
} from './render';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const AUDIO_ASSET_ID = '44444444-4444-4444-8444-444444444444';
const IMAGE_ONE_ID = '55555555-5555-4555-8555-555555555555';
const IMAGE_TWO_ID = '66666666-6666-4666-8666-666666666666';
const NOW = '2026-11-05T08:00:00.000Z';
const SCRIPT = 'வணக்கம் நண்பர்களே. Today fire!';
const ROOT = 'D:/faceless-data';
const FONTS = 'D:/faceless-bundle/fonts';

const body = {
  artStyleId: STYLE_ID,
  script: SCRIPT,
  size: 'landscape' as const,
  captions: true,
  captionTemplateId: -1,
  render: { resolution: 1080 as const, frameRate: 30 as const, format: 'standard' as const },
};

const scenes: SceneRow[] = [
  {
    id: '77777777-7777-4777-8777-777777777771',
    video_id: VIDEO_ID,
    idx: 0,
    text: 'வணக்கம் நண்பர்களே.',
    image_asset_id: IMAGE_ONE_ID,
    motion: { preset: 'kenburns-in', emphasis: [] },
    start_ms: 0,
    end_ms: 1_200,
  },
  {
    id: '77777777-7777-4777-8777-777777777772',
    video_id: VIDEO_ID,
    idx: 1,
    text: 'Today fire!',
    image_asset_id: IMAGE_TWO_ID,
    motion: { preset: 'pan-left', emphasis: [] },
    start_ms: 1_200,
    end_ms: 2_400,
  },
];

const images: AssetRow[] = [
  {
    id: IMAGE_ONE_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'image',
    key: `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/frames/0001.png`,
    bytes: 3_818,
    mime: 'image/png',
    meta: {},
    created_at: NOW,
  },
  {
    id: IMAGE_TWO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'image',
    key: `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/frames/0002.png`,
    bytes: 3_900,
    mime: 'image/png',
    meta: {},
    created_at: NOW,
  },
];

const audio: AssetRow = {
  id: AUDIO_ASSET_ID,
  workspace_id: WORKSPACE_ID,
  kind: 'audio',
  key: `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/audio/narration.mp3`,
  bytes: 39_331,
  mime: 'audio/mpeg',
  meta: {},
  created_at: NOW,
};

const narration: NarrationRow = {
  video_id: VIDEO_ID,
  asset_id: AUDIO_ASSET_ID,
  duration_ms: 2_400,
  word_timings: [
    { text: 'வணக்கம்', start_ms: 0, end_ms: 400 },
    { text: 'நண்பர்களே.', start_ms: 400, end_ms: 900 },
    { text: 'Today', start_ms: 1_000, end_ms: 1_300 },
    { text: 'fire!', start_ms: 1_300, end_ms: 1_700 },
  ],
  voice_plan: {
    script: SCRIPT,
    spokenText: SCRIPT,
    runs: [],
    overrides: [],
    pair: 'valluvar',
  },
};

const captionTrack: CaptionTrackRow = {
  video_id: VIDEO_ID,
  template_id: -1,
  cues: [
    {
      lines: ['வணக்கம் நண்பர்களே.'],
      words: [
        { text: 'வணக்கம்', startMs: 0, endMs: 400 },
        { text: 'நண்பர்களே.', startMs: 400, endMs: 900 },
      ],
      startMs: 0,
      endMs: 900,
    },
  ],
};

function video(overrides: Record<string, unknown> = {}): StepContext['video'] {
  const parsed = createAiVideoV3RequestSchema.parse({ ...body, ...overrides });
  return {
    id: VIDEO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'ai-video-v3',
    status: 'rendering',
    step: 'render',
    error: null,
    request: { kind: 'ai-video-v3', body: parsed },
    plan: null,
    webhook_url: null,
    duration_ms: 2_400,
    video_url: null,
    editor_seen_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function harness(row: StepContext['video'] = video(), events: string[] = []) {
  const advance = vi.fn(async () => {
    events.push('advance');
  });
  const charge = vi.fn(async () => {
    events.push('charge');
  });
  const tx: CommitTx = {
    db: {} as Database,
    videoId: VIDEO_ID,
    attempt: 1,
    setStep: vi.fn(async () => {}),
    advance,
    enqueue: vi.fn(async () => {}),
    charge,
    fireWebhook: vi.fn(async () => {}),
  };
  const transactionCalls: Array<(commit: CommitTx) => Promise<unknown>> = [];
  const transaction: StepContext['transaction'] = async <T>(
    fn: (commit: CommitTx) => Promise<T>,
  ): Promise<T> => {
    transactionCalls.push(fn);
    events.push('transaction');
    return await fn(tx);
  };
  const observe = vi.fn();
  const context: StepContext = {
    db: {} as Database,
    video: row,
    videoId: VIDEO_ID,
    step: 'render',
    attempt: 1,
    observe,
    transaction,
  };
  return { context, tx, transactionCalls, advance, charge, events, observe };
}

interface DepsOptions {
  events?: string[];
  sceneRows?: SceneRow[];
  assetRows?: AssetRow[];
  narrationRow?: NarrationRow | null;
  captionRow?: CaptionTrackRow | null;
  renderVideo?: (input: RenderPlanInput) => Promise<RenderResult>;
  thumbnail?: (videoPath: string, outputPath: string) => Promise<ThumbnailResult>;
  persist?: PersistRender;
  renderUnitCost?: number;
}

function deps(options: DepsOptions = {}) {
  const events = options.events ?? [];
  const renderVideo =
    options.renderVideo ??
    (async (input: RenderPlanInput): Promise<RenderResult> => {
      const plan = buildRenderPlan(input);
      events.push('render');
      return {
        outputPath: input.outputPath,
        width: plan.width,
        height: plan.height,
        fps: plan.fps,
        durationMs: plan.durationMs,
        totalFrames: plan.totalFrames,
        bytes: 9_000,
        plan,
      };
    });
  const thumbnail =
    options.thumbnail ??
    (async (videoPath: string, outputPath: string): Promise<ThumbnailResult> => {
      events.push('thumbnail');
      return {
        outputPath,
        timestampMs: 600,
        width: 1_280,
        height: 720,
        sourceWidth: 1_920,
        sourceHeight: 1_080,
        durationMs: 2_400,
        bytes: 4_321,
      };
    });
  const persist = vi.fn(
    options.persist ??
      (async (_tx: CommitTx, _input: PersistRenderInput): Promise<void> => {
        events.push('persist');
      }),
  );
  const work = createCreateRenderWork({
    loadScenes: vi.fn(async () => options.sceneRows ?? scenes),
    loadAssets: vi.fn(async () => options.assetRows ?? [...images, audio]),
    loadNarration: vi.fn(async () =>
      options.narrationRow === undefined ? narration : options.narrationRow,
    ),
    loadCaptionTrack: vi.fn(async () =>
      options.captionRow === undefined ? captionTrack : options.captionRow,
    ),
    renderVideo: vi.fn(renderVideo),
    extractThumbnail: vi.fn(thumbnail),
    persistRender: persist,
    storageRoot: () => ROOT,
    fontsDir: FONTS,
    renderUnitCost: options.renderUnitCost ?? DEFAULT_RENDER_UNIT_COST,
  });
  return { work, persist, renderVideo, thumbnail, events };
}

describe('createCreateRenderWork', () => {
  it('renders the stored timeline, extracts a thumbnail and commits one completed render', async () => {
    const events: string[] = [];
    const { work, persist } = deps({ events });
    const { context } = harness(video(), events);

    await work(context);

    expect(events).toEqual(['render', 'thumbnail', 'transaction', 'persist', 'charge', 'advance']);

    const call = vi.mocked(persist).mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      resolution: 1_080,
      fps: 30,
      format: 'standard',
      durationMs: 2_400,
    });
  });

  it('passes the stored scene order, image paths, spans, motions and audio to the plan', async () => {
    const renderInputs: RenderPlanInput[] = [];
    const workWithSpy = createCreateRenderWork({
      loadScenes: async () => scenes,
      loadAssets: async () => [...images, audio],
      loadNarration: async () => narration,
      loadCaptionTrack: async () => captionTrack,
      renderVideo: async (input) => {
        renderInputs.push(input);
        const plan = buildRenderPlan(input);
        return {
          outputPath: input.outputPath,
          width: plan.width,
          height: plan.height,
          fps: plan.fps,
          durationMs: plan.durationMs,
          totalFrames: plan.totalFrames,
          bytes: 1,
          plan,
        };
      },
      extractThumbnail: async (_videoPath, outputPath) => ({
        outputPath,
        timestampMs: 600,
        width: 1_280,
        height: 720,
        sourceWidth: 1_920,
        sourceHeight: 1_080,
        durationMs: 2_400,
        bytes: 1,
      }),
      persistRender: async () => {},
      storageRoot: () => ROOT,
      fontsDir: FONTS,
    });

    await workWithSpy(harness().context);

    const input = renderInputs[0];
    expect(input).toBeDefined();
    expect(input!.scenes).toEqual([
      {
        imagePath: resolveStorageKey(ROOT, images[0]!.key),
        durationMs: 1_200,
        motion: 'kenburns-in',
      },
      {
        imagePath: resolveStorageKey(ROOT, images[1]!.key),
        durationMs: 1_200,
        motion: 'pan-left',
      },
    ]);
    expect(input!.audioPath).toBe(resolveStorageKey(ROOT, audio.key));
    expect(input!.outputPath).toBe(
      resolveStorageKey(ROOT, renderKey(WORKSPACE_ID, VIDEO_ID, 1_080, 30, 'standard')),
    );
    expect(input!.resolution).toBe(1_080);
    expect(input!.fps).toBe(30);
    expect(input!.size).toBe('landscape');
    expect(input!.format).toBe('standard');
    expect(input!.captions).toEqual({
      path: resolveStorageKey(ROOT, captionKey(WORKSPACE_ID, VIDEO_ID, 'ass')),
      fontsDir: FONTS,
    });
  });

  it('persists both assets, the render row, video_url and the duration in the one commit', async () => {
    const events: string[] = [];
    const captured: PersistRenderInput[] = [];
    const { work } = deps({
      events,
      persist: async (_tx, input) => {
        events.push('persist');
        captured.push(input);
      },
    });
    const { context, charge } = harness(video(), events);

    await work(context);

    expect(captured[0]).toEqual({
      workspaceId: WORKSPACE_ID,
      videoId: VIDEO_ID,
      resolution: 1_080,
      fps: 30,
      format: 'standard',
      durationMs: 2_400,
      render: {
        key: renderKey(WORKSPACE_ID, VIDEO_ID, 1_080, 30, 'standard'),
        bytes: 9_000,
        width: 1_920,
        height: 1_080,
        fps: 30,
        frames: 72,
      },
      thumbnail: {
        key: thumbnailKey(WORKSPACE_ID, VIDEO_ID, 1_080, 30, 'standard'),
        bytes: 4_321,
        width: 1_280,
        height: 720,
      },
    });
    expect(charge).toHaveBeenCalledWith({ action: 'render', units: 0.04, unitCost: 10 });
  });

  it('uses the portrait 4K greenscreen plan and doubles the 60 fps unit cost', async () => {
    const events: string[] = [];
    const inputs: RenderPlanInput[] = [];
    const captured: PersistRenderInput[] = [];
    const { work } = deps({
      events,
      renderVideo: async (input) => {
        events.push('render');
        inputs.push(input);
        const plan = buildRenderPlan(input);
        return {
          outputPath: input.outputPath,
          width: plan.width,
          height: plan.height,
          fps: plan.fps,
          durationMs: plan.durationMs,
          totalFrames: plan.totalFrames,
          bytes: 12_000,
          plan,
        };
      },
      persist: async (_tx, input) => {
        events.push('persist');
        captured.push(input);
      },
    });
    const row = video({
      size: 'portrait',
      render: { resolution: 2160, frameRate: 60, format: 'greenscreen' },
    });
    const { context, charge, advance } = harness(row, events);

    await work(context);

    const expected = renderDimensions(2_160, 'portrait');
    expect(inputs[0]).toMatchObject({
      resolution: 2_160,
      fps: 60,
      size: 'portrait',
      format: 'greenscreen',
    });
    expect(captured[0]?.render).toMatchObject({
      width: expected.width,
      height: expected.height,
      fps: 60,
      frames: 144,
    });
    expect(charge).toHaveBeenCalledWith({ action: 'render', units: 0.04, unitCost: 20 });
    expect(advance).toHaveBeenCalledOnce();
  });

  it('honours an explicit render unit-cost override', async () => {
    const { work } = deps({ renderUnitCost: 7 });
    const { context, charge } = harness();

    await work(context);

    expect(charge).toHaveBeenCalledWith({ action: 'render', units: 0.04, unitCost: 7 });
  });

  it('omits captions from the plan when the video has no caption track', async () => {
    const inputs: RenderPlanInput[] = [];
    const { work } = deps({
      captionRow: null,
      renderVideo: async (input) => {
        inputs.push(input);
        const plan = buildRenderPlan(input);
        return {
          outputPath: input.outputPath,
          width: plan.width,
          height: plan.height,
          fps: plan.fps,
          durationMs: plan.durationMs,
          totalFrames: plan.totalFrames,
          bytes: 1,
          plan,
        };
      },
    });

    await work(harness().context);

    expect(inputs[0]?.captions).toBeUndefined();
  });

  it('refuses to render when the stored request never asked for a render', async () => {
    const { work } = deps();
    const row = video();
    const withoutRender = {
      ...row,
      request: {
        kind: 'ai-video-v3' as const,
        body: createAiVideoV3RequestSchema.parse({
          artStyleId: STYLE_ID,
          script: SCRIPT,
          captions: true,
        }),
      },
    };
    const { context, transactionCalls } = harness(withoutRender);

    await expect(work(context)).rejects.toMatchObject({ code: 'internal' });
    expect(transactionCalls).toHaveLength(0);
  });

  it.each([
    ['no scenes', { sceneRows: [] }],
    [
      'a scene out of order',
      { sceneRows: [scenes[1]!, { ...scenes[0]!, idx: 0, id: scenes[1]!.id }] },
    ],
    [
      'a gap between spans',
      { sceneRows: [scenes[0]!, { ...scenes[1]!, start_ms: 1_300 }] },
    ],
    [
      'a final span that misses the master',
      { sceneRows: [scenes[0]!, { ...scenes[1]!, end_ms: 2_300 }] },
    ],
    [
      'a missing image asset',
      { assetRows: [audio] },
    ],
    [
      'an image asset of the wrong kind',
      { assetRows: [{ ...images[0]!, kind: 'upload' as const }, images[1]!, audio] },
    ],
    ['a missing narration row', { narrationRow: null }],
    [
      'a missing narration asset',
      { assetRows: [...images] },
    ],
    [
      'a motion the renderer does not implement',
      { sceneRows: [{ ...scenes[0]!, motion: { preset: 'spin' } }, scenes[1]!] },
    ],
  ])('rejects %s before running ffmpeg', async (_label, options) => {
    const { work } = deps(options as DepsOptions);
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({ code: 'internal' });
    expect(transactionCalls).toHaveLength(0);
  });

  it('keeps an ffmpeg failure retryable and commits nothing', async () => {
    const { work } = deps({
      renderVideo: async () => {
        throw new Error('ffmpeg exited with 1: Conversion failed!');
      },
    });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: true,
    });
    expect(transactionCalls).toHaveLength(0);
  });

  it('keeps a thumbnail failure retryable and commits nothing', async () => {
    const { work } = deps({
      thumbnail: async () => {
        throw new Error('ffprobe returned invalid JSON for thumbnail source');
      },
    });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: true,
    });
    expect(transactionCalls).toHaveLength(0);
  });

  it('rejects an encoder result that does not match the requested profile', async () => {
    const { work } = deps({
      renderVideo: async (input) => {
        const plan = buildRenderPlan(input);
        return {
          outputPath: input.outputPath,
          width: 1_280,
          height: plan.height,
          fps: plan.fps,
          durationMs: plan.durationMs,
          totalFrames: plan.totalFrames,
          bytes: 9_000,
          plan,
        };
      },
    });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({ code: 'internal' });
    expect(transactionCalls).toHaveLength(0);
  });

  it('rejects a stored video whose duration was never persisted', async () => {
    const { work } = deps();
    const { context, transactionCalls } = harness({ ...video(), duration_ms: null });

    await expect(work(context)).rejects.toBeInstanceOf(StepFailure);
    expect(transactionCalls).toHaveLength(0);
  });
});
