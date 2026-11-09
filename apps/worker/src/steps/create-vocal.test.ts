import type {
  NarrationPlan,
  SceneRow,
} from '@facelesspro/contracts';
import type { Database } from '@facelesspro/db';
import { StepFailure } from '@facelesspro/queue';
import type { CommitTx, StepContext } from '@facelesspro/queue';
import { describe, expect, it, vi } from 'vitest';

import type { TtsPort, TtsSynthesis } from '../ports/tts';
import { TtsPortError } from '../ports/tts';
import {
  createCreateVocalWork,
  type PersistNarration,
  type PersistNarrationInput,
} from './create-vocal';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const STYLE_ID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-11-05T08:00:00.000Z';
const TAMIL = 'வணக்கம் நண்பர்களே.';
const ENGLISH = 'Today we plan one useful scene.';
const SCRIPT = `${TAMIL} ${ENGLISH}`;

const PAIR = {
  id: 'valluvar',
  ta: 'ta-IN-ValluvarNeural',
  en: 'ta-IN-ValluvarNeural',
  notes: 'one speaker',
};

function sceneRow(idx: number, text: string, startMs: number, endMs: number): SceneRow {
  return {
    id: `0190a0a0-0000-7000-8000-00000000001${idx}`,
    video_id: VIDEO_ID,
    idx,
    text,
    image_asset_id: null,
    motion: {},
    start_ms: startMs,
    end_ms: endMs,
  };
}

function request(
  body: Record<string, unknown> = { artStyleId: STYLE_ID, script: SCRIPT },
): StepContext['video'] {
  return {
    id: VIDEO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'ai-video-v3',
    status: 'processing',
    step: 'create-vocal',
    error: null,
    request: { kind: 'ai-video-v3', body },
    plan: null,
    webhook_url: null,
    duration_ms: null,
    video_url: null,
    editor_seen_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
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
    fireWebhook: vi.fn(async () => {}),
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
    step: 'create-vocal',
    attempt: 1,
    observe,
    transaction,
  };
  return { context, tx, transactionCalls, advance, charge, calls, observe };
}

/** A response whose segments and words exactly match the request. */
function synthesisFor(
  segmentTexts: readonly string[],
  spans: ReadonlyArray<{ startMs: number; durationMs: number }>,
  durationMs: number,
): TtsSynthesis {
  return {
    requestId: 'req-1',
    audio: new Uint8Array([1, 2, 3]),
    mime: 'audio/mpeg',
    durationMs,
    segments: segmentTexts.map((text, index) => ({
      index,
      voice: PAIR.ta,
      text,
      startMs: spans[index]!.startMs,
      durationMs: spans[index]!.durationMs,
      words: [
        {
          text,
          startMs: spans[index]!.startMs,
          endMs: spans[index]!.startMs + spans[index]!.durationMs,
        },
      ],
    })),
  };
}

interface PlannerOutput {
  texts: string[];
  spans: Array<{ startMs: number; durationMs: number }>;
  durationMs: number;
}

function fakeTts(plan?: (request: { segments: { text: string }[] }) => PlannerOutput) {
  const resolvePair = vi.fn(async () => PAIR);
  const synthesize = vi.fn(async (input: { segments: { text: string }[] }) => {
    const output =
      plan?.(input) ??
      {
        texts: input.segments.map((segment) => segment.text),
        spans: input.segments.map((_segment, index) => ({
          startMs: index === 0 ? 0 : 1_500,
          durationMs: index === 0 ? 1_200 : 900,
        })),
        durationMs: 2_400,
      };
    return synthesisFor(output.texts, output.spans, output.durationMs);
  });
  const port: TtsPort = { resolvePair, synthesize };
  return { port, resolvePair, synthesize };
}

function deps(options: {
  tts?: ReturnType<typeof fakeTts>;
  scenes?: SceneRow[];
  persist?: PersistNarration;
  store?: (input: { bytes: Uint8Array }) => Promise<{
    key: string;
    bytes: number;
    mime: string;
  }>;
  defaultPairId?: string;
}) {
  const tts = options.tts ?? fakeTts();
  const persist =
    options.persist ?? vi.fn<PersistNarration>(async () => {});
  const store =
    options.store ??
    vi.fn(async (input: { bytes: Uint8Array }) => ({
      key: 'ws/w/videos/v/audio/narration.mp3',
      bytes: input.bytes.byteLength,
      mime: 'audio/mpeg',
    }));
  const work = createCreateVocalWork({
    tts: tts.port,
    defaultPairId: options.defaultPairId ?? 'valluvar',
    listScenes: async () =>
      options.scenes ?? [sceneRow(0, TAMIL, 0, 1_200), sceneRow(1, ENGLISH, 1_200, 2_400)],
    storeNarration: store,
    persistNarration: persist,
  });
  return { work, tts, persist, store };
}

describe('createCreateVocalWork', () => {
  it('plans per scene, synthesises once, stores before the commit and advances once', async () => {
    const { work, tts, persist, store } = deps({});
    const { context, calls, advance, charge } = harness();

    await work(context);

    expect(tts.resolvePair).toHaveBeenCalledWith('valluvar');
    expect(tts.synthesize).toHaveBeenCalledOnce();
    const synthesisRequest = tts.synthesize.mock.calls[0]![0];
    expect(synthesisRequest.segments.map((segment) => segment.text)).toEqual([
      'வணக்கம் நண்பர்களே.',
      'Today we plan one useful scene.',
    ]);

    expect(store).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      videoId: VIDEO_ID,
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(calls).toEqual(['transaction', 'charge', 'advance']);

    const input = (
      vi.mocked(persist).mock.calls[0] as unknown as [CommitTx, PersistNarrationInput]
    )[1];
    expect(input.timings).toEqual([
      { idx: 0, startMs: 0, endMs: 1_500 },
      { idx: 1, startMs: 1_500, endMs: 2_400 },
    ]);
    expect(input.voicePlan.script).toBe(SCRIPT);
    expect(input.voicePlan.pair).toBe('valluvar');
    expect(input.voicePlan.runs).toHaveLength(2);
    expect(input.voicePlan.spokenText).toContain('Today we plan one useful scene.');
    expect(input.synthesis.durationMs).toBe(2_400);
    expect(charge).toHaveBeenCalledWith({
      action: 'tts',
      units: [...TAMIL, ...ENGLISH].length,
      unitCost: 0,
    });
    expect(advance).toHaveBeenCalledOnce();
  });

  it('uses the request voiceId as a pair id when supplied', async () => {
    const { work, tts } = deps({});
    const { context } = harness(
      request({ artStyleId: STYLE_ID, script: SCRIPT, voiceId: 'pallavi' }),
    );

    await work(context);

    expect(tts.resolvePair).toHaveBeenCalledWith('pallavi');
  });

  it('advances without synthesising or charging when the narration came from an upload', async () => {
    const { work, tts } = deps({});
    const { context, transactionCalls, advance, charge, observe } = harness(
      request({ artStyleId: STYLE_ID, voiceoverUrl: 'https://example.com/voice.mp3' }),
    );

    await work(context);

    expect(tts.resolvePair).not.toHaveBeenCalled();
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(1);
    expect(advance).toHaveBeenCalledOnce();
    expect(charge).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith({ items: 0 });
  });

  it('rejects a video with no scenes before calling TTS', async () => {
    const { work, tts } = deps({ scenes: [] });
    const { context } = harness();

    await expect(work(context)).rejects.toMatchObject({ code: 'internal' });
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  it('rejects scene text that does not reconstruct the request script', async () => {
    const { work, tts } = deps({
      scenes: [sceneRow(0, 'a different sentence', 0, 1_000)],
    });
    const { context } = harness();

    await expect(work(context)).rejects.toMatchObject({ code: 'internal' });
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown pair', 404, 'invalid_request', false],
    ['bad selector', 422, 'invalid_request', false],
    ['provider down', 503, 'upstream_failed', true],
    ['rate limited', 429, 'upstream_failed', true],
  ])('maps a %s TTS failure to %s', async (_label, status, code, retryable) => {
    const tts = fakeTts();
    tts.resolvePair.mockRejectedValueOnce(
      new TtsPortError('media failed', { status, retryable }),
    );
    const { work } = deps({ tts });
    const { context } = harness();

    await expect(work(context)).rejects.toMatchObject({ code, retryable });
  });

  it('keeps an unknown TTS error retryable instead of blaming the user', async () => {
    const tts = fakeTts();
    tts.synthesize.mockRejectedValueOnce(new Error('socket hang up'));
    const { work } = deps({ tts });
    const { context } = harness();

    const error = await work(context).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StepFailure);
    expect(error).toMatchObject({ code: 'upstream_failed', retryable: true });
  });

  it.each([
    [
      'a different segment count',
      (input: { segments: { text: string }[] }) => ({
        texts: input.segments.map((segment) => segment.text).slice(0, 1),
        spans: [{ startMs: 0, durationMs: 1_000 }],
        durationMs: 1_000,
      }),
    ],
    [
      'a different segment text',
      (input: { segments: { text: string }[] }) => ({
        texts: input.segments.map(() => 'rewritten'),
        spans: input.segments.map((_segment, index) => ({
          startMs: index * 1_000,
          durationMs: 1_000,
        })),
        durationMs: 2_000,
      }),
    ],
    [
      'a zero-length scene span',
      (input: { segments: { text: string }[] }) => ({
        texts: input.segments.map((segment) => segment.text),
        spans: input.segments.map(() => ({ startMs: 0, durationMs: 1_000 })),
        durationMs: 1_000,
      }),
    ],
  ])('rejects %s as a permanent upstream failure', async (_label, plan) => {
    const { work, persist, store } = deps({ tts: fakeTts(plan) });
    const { context, transactionCalls } = harness();

    await expect(work(context)).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: false,
    });
    expect(store).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
  });

  it('keeps a disk-write failure retryable and commits nothing', async () => {
    const { work } = deps({
      store: async () => {
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

  it('stores the exact request script and per-scene runs in the voice plan', async () => {
    const { work, persist } = deps({});
    const { context } = harness();

    await work(context);

    const input = (
      vi.mocked(persist).mock.calls[0] as unknown as [CommitTx, PersistNarrationInput]
    )[1];
    const plan: NarrationPlan = input.voicePlan;
    expect(plan.script).toBe(SCRIPT);
    expect(plan.runs.map((run) => run.lang)).toEqual(['ta', 'en']);
    expect(plan.runs.every((run) => run.voice === PAIR.ta)).toBe(true);
    expect(plan.overrides).toEqual([]);
  });
});
