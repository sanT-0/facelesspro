import {
  captionJsonExportSchema,
  type CaptionTemplateRow,
  type NarrationRow,
} from '@facelesspro/contracts';
import type { Database } from '@facelesspro/db';
import { StepFailure } from '@facelesspro/queue';
import type { CommitTx, StepContext } from '@facelesspro/queue';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_CAPTION_TEMPLATE_ID,
  createCreateCaptionsWork,
  type CaptionArtifact,
  type CaptionStoreInput,
  type CompleteProject,
  type PersistCaptions,
  type PersistCaptionsInput,
  type StoreCaptionArtifacts,
} from './create-captions';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const AUDIO_ASSET_ID = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-11-05T08:00:00.000Z';
const SCRIPT = 'வணக்கம் நண்பர்களே. Today fire!';

const template: CaptionTemplateRow = {
  id: -3,
  workspace_id: null,
  name: 'Emoji Pop',
  spec: {
    fontFamily: 'Noto Sans Tamil',
    fontSize: 64,
    wordLimit: 3,
    maxLines: 2,
    uppercase: true,
    emoji: true,
    position: 'center',
    highlightColor: '#FF4D8D',
    outlineColor: '#FFFFFF',
    outlineWidth: 5,
  },
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
    runs: [
      {
        text: 'வணக்கம் நண்பர்களே.',
        lang: 'ta',
        voice: 'ta-IN-ValluvarNeural',
        script: 'tamil',
      },
      {
        text: 'Today fire!',
        lang: 'en',
        voice: 'ta-IN-ValluvarNeural',
        script: 'latin',
      },
    ],
    overrides: [],
    pair: 'valluvar',
  },
};

function video(
  body: Record<string, unknown> = {
    artStyleId: STYLE_ID,
    script: SCRIPT,
    captions: true,
    captionTemplateId: template.id,
    render: {},
  },
): StepContext['video'] {
  return {
    id: VIDEO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'ai-video-v3',
    status: 'processing',
    step: 'create-captions',
    error: null,
    request: { kind: 'ai-video-v3', body },
    plan: null,
    webhook_url: null,
    duration_ms: narration.duration_ms,
    video_url: null,
    editor_seen_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function harness(
  row: StepContext['video'] = video(),
  events: string[] = [],
) {
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
    step: 'create-captions',
    attempt: 1,
    observe,
    transaction,
  };
  return { context, tx, transactionCalls, advance, charge, events, observe };
}

interface DepsOptions {
  events?: string[];
  foundTemplate?: CaptionTemplateRow | null;
  storedNarration?: NarrationRow | null;
  store?: StoreCaptionArtifacts;
  persist?: PersistCaptions;
  complete?: CompleteProject;
  unitCost?: number;
}

function deps(options: DepsOptions = {}) {
  const events = options.events ?? [];
  const findTemplate = vi.fn(async () =>
    options.foundTemplate === undefined ? template : options.foundTemplate,
  );
  const loadNarration = vi.fn(async () =>
    options.storedNarration === undefined ? narration : options.storedNarration,
  );
  const store =
    options.store ??
    vi.fn<StoreCaptionArtifacts>(async () => {
      events.push('store');
    });
  const persist =
    options.persist ??
    vi.fn<PersistCaptions>(async () => {
      events.push('persist');
    });
  const complete =
    options.complete ??
    vi.fn<CompleteProject>(async () => {
      events.push('complete');
    });
  const work = createCreateCaptionsWork({
    findTemplate,
    loadNarration,
    storeCaptionArtifacts: store,
    persistCaptions: persist,
    completeProject: complete,
    subtitleUnitCost: options.unitCost ?? 20,
  });
  return { work, findTemplate, loadNarration, store, persist, complete, events };
}

function utf8(artifact: CaptionArtifact): string {
  return new TextDecoder().decode(artifact.bytes);
}

describe('createCreateCaptionsWork', () => {
  it('builds all sidecars from one cue list, stores before one charged commit and advances', async () => {
    const events: string[] = [];
    const { work, findTemplate, loadNarration, store, persist } = deps({ events });
    const { context, charge, advance } = harness(video(), events);

    await work(context);

    expect(findTemplate).toHaveBeenCalledWith(context.db, template.id);
    expect(loadNarration).toHaveBeenCalledWith(context.db, VIDEO_ID);
    expect(events).toEqual(['store', 'transaction', 'persist', 'charge', 'advance']);

    const stored = vi.mocked(store).mock.calls[0]![0];
    expect(stored.workspaceId).toBe(WORKSPACE_ID);
    expect(stored.videoId).toBe(VIDEO_ID);
    expect(stored.artifacts.map((artifact) => artifact.format)).toEqual([
      'srt',
      'vtt',
      'ass',
      'json',
    ]);
    expect(stored.artifacts.map((artifact) => artifact.key)).toEqual([
      `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/captions.srt`,
      `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/captions.vtt`,
      `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/captions.ass`,
      `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/captions.json`,
    ]);

    const ass = utf8(stored.artifacts.find((artifact) => artifact.format === 'ass')!);
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('PlayResY: 1080');
    expect(ass).toContain('Noto Sans Tamil');
    expect(ass).toMatch(/\\k\d+/);
    expect(ass).toContain('{\\fnNoto Emoji}🔥');

    const json = utf8(stored.artifacts.find((artifact) => artifact.format === 'json')!);
    const document = captionJsonExportSchema.parse(JSON.parse(json) as unknown);
    expect(document.cues).toHaveLength(2);
    expect(document.cues[0]?.lines.join(' ')).toBe('வணக்கம் நண்பர்களே.');
    expect(document.cues[1]?.emoji).toBe('🔥');
    expect(document.cues.flatMap((cue) => cue.words).map((word) => word.text)).toEqual([
      'வணக்கம்',
      'நண்பர்களே.',
      'Today',
      'fire!',
    ]);

    const persisted = (
      vi.mocked(persist).mock.calls[0] as unknown as [CommitTx, PersistCaptionsInput]
    )[1];
    expect(persisted.templateId).toBe(template.id);
    expect(persisted.cues).toEqual(document.cues.map(({ index: _index, ...cue }) => cue));
    expect(persisted.artifacts).toEqual(stored.artifacts);

    expect(charge).toHaveBeenCalledWith({
      action: 'subtitles',
      units: 1,
      unitCost: 20,
    });
    expect(advance).toHaveBeenCalledOnce();
  });

  it('uses Bold Tamil as the temporary default until workspace preferences exist', async () => {
    const row = video({ artStyleId: STYLE_ID, script: SCRIPT, captions: true });
    const { work, findTemplate } = deps({ foundTemplate: { ...template, id: -1 } });

    await work(harness(row).context);

    expect(DEFAULT_CAPTION_TEMPLATE_ID).toBe(-1);
    expect(findTemplate).toHaveBeenCalledWith(expect.anything(), -1);
  });

  it('uses a 1080p portrait ASS canvas so later 2K/4K renders can scale the same sidecar', async () => {
    const row = video({
      artStyleId: STYLE_ID,
      script: SCRIPT,
      captions: true,
      captionTemplateId: template.id,
      size: 'portrait',
      render: { resolution: 2160, frameRate: 60, format: 'standard' },
    });
    const { work, store } = deps();

    await work(harness(row).context);

    const input = vi.mocked(store).mock.calls[0]![0];
    const ass = utf8(input.artifacts.find((artifact) => artifact.format === 'ass')!);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
  });

  it('advances without loading narration, writing artifacts or charging when captions are off', async () => {
    const events: string[] = [];
    const row = video({ artStyleId: STYLE_ID, script: SCRIPT, captions: false, render: {} });
    const { work, findTemplate, loadNarration, store, persist } = deps({ events });
    const { context, charge, advance } = harness(row, events);

    await work(context);

    expect(events).toEqual(['transaction', 'advance']);
    expect(findTemplate).not.toHaveBeenCalled();
    expect(loadNarration).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledOnce();
  });

  it('completes an editable project without enqueueing render when render was omitted', async () => {
    const events: string[] = [];
    const row = video({ artStyleId: STYLE_ID, script: SCRIPT, captions: true });
    const { work, complete } = deps({ events, foundTemplate: { ...template, id: -1 } });
    const { context, advance, charge } = harness(row, events);

    await work(context);

    expect(events).toEqual(['store', 'transaction', 'persist', 'charge', 'complete']);
    expect(charge).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    expect(advance).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null, 'not_found'],
    [
      'private to another workspace',
      { ...template, id: 8, workspace_id: STYLE_ID },
      'forbidden',
    ],
  ])('rejects a %s template before loading narration', async (_label, found, code) => {
    const { work, loadNarration, store } = deps({ foundTemplate: found });
    const { context, transactionCalls } = harness(
      video({
        artStyleId: STYLE_ID,
        script: SCRIPT,
        captions: true,
        captionTemplateId: found?.id ?? template.id,
      }),
    );

    await expect(work(context)).rejects.toMatchObject({ code });
    expect(loadNarration).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it('allows a workspace-owned custom template', async () => {
    const custom = { ...template, id: 8, workspace_id: WORKSPACE_ID };
    const row = video({
      artStyleId: STYLE_ID,
      script: SCRIPT,
      captions: true,
      captionTemplateId: custom.id,
    });
    const { work, store } = deps({ foundTemplate: custom });

    await work(harness(row).context);

    expect(store).toHaveBeenCalledOnce();
  });

  it('rejects a missing narration without writing or committing', async () => {
    const { work, store } = deps({ storedNarration: null });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({ code: 'internal' });
    expect(store).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it('rejects a video whose narration duration was not persisted', async () => {
    const { work, store } = deps();
    const { context, transactionCalls } = harness({ ...video(), duration_ms: null });

    await expect(work(context)).rejects.toMatchObject({ code: 'internal' });
    expect(store).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it.each([
    ['no words', { ...narration, word_timings: [] }],
    [
      'overlapping words',
      {
        ...narration,
        word_timings: [
          { text: 'one', start_ms: 0, end_ms: 500 },
          { text: 'two', start_ms: 400, end_ms: 800 },
        ],
      },
    ],
    [
      'a word outside the master',
      {
        ...narration,
        word_timings: [{ text: 'late', start_ms: 2_300, end_ms: 2_500 }],
      },
    ],
  ])('rejects %s before writing or committing', async (_label, storedNarration) => {
    const { work, store } = deps({ storedNarration });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toBeInstanceOf(StepFailure);
    expect(store).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it('preserves a zero-duration engine word when the containing cue has a positive span', async () => {
    const storedNarration: NarrationRow = {
      ...narration,
      word_timings: [
        { text: 'இது', start_ms: 0, end_ms: 0 },
        { text: 'நன்று.', start_ms: 0, end_ms: 500 },
      ],
    };
    const { work, persist } = deps({ storedNarration });

    await work(harness().context);

    const input = (
      vi.mocked(persist).mock.calls[0] as unknown as [CommitTx, PersistCaptionsInput]
    )[1];
    expect(input.cues[0]?.words[0]).toEqual({ text: 'இது', startMs: 0, endMs: 0 });
  });

  it('reports a word too wide for a line as unprocessable without splitting it', async () => {
    const tooWide: NarrationRow = {
      ...narration,
      word_timings: [{ text: 'அ'.repeat(80), start_ms: 0, end_ms: 900 }],
    };
    const { work, store } = deps({ storedNarration: tooWide });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({
      code: 'unprocessable',
      retryable: false,
    });
    expect(store).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it('keeps a disk-write failure retryable and commits nothing', async () => {
    const store: StoreCaptionArtifacts = async (_input: CaptionStoreInput) => {
      throw new Error('ENOSPC: no space left on device');
    };
    const { work, persist } = deps({ store });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({
      code: 'internal',
      retryable: true,
    });
    expect(persist).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });
});
