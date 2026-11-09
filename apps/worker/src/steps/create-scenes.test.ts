import type {
  ArtStyleRow,
  ScenePlan,
  StyleProfile,
} from '@facelesspro/contracts';
import { MAX_SCENES } from '@facelesspro/contracts';
import type { Database } from '@facelesspro/db';
import { StepFailure } from '@facelesspro/queue';
import type { CommitTx, StepContext } from '@facelesspro/queue';
import { describe, expect, it, vi } from 'vitest';

import { imagePromptFor } from '../planner/heuristic';
import type { AsrPort, AsrRequest, AsrTranscription } from '../ports/asr';
import { AsrPortError } from '../ports/asr';
import type { VoiceoverDownload } from '../voiceover/download';
import { VoiceoverDownloadError } from '../voiceover/download';
import type { PlanFn } from '../ports/planner';
import { PlannerChainError } from '../planner/chain';
import {
  createCreateScenesWork,
  planStyleFromProfile,
  type PersistVoiceoverInput,
  type StoredVoiceover,
} from './create-scenes';

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
      text: SCRIPT,
      imagePrompt: 'flat vector scene, one useful scene, no text',
      motion: 'kenburns-in',
      emphasis: ['useful'],
      startMs: 0,
      endMs: 4_200,
    },
  ],
  adapter: 'heuristic',
  degradedFrom: [],
  totalMs: 4_200,
};

const VOICEOVER_URL = 'https://cdn.example.com/audio/narration.mp3';
const TAMIL_SENTENCE = 'வணக்கம் நண்பர்களே.';
const ENGLISH_SENTENCE = 'Today we plan one useful scene.';

const TRANSCRIPTION: AsrTranscription = {
  requestId: 'asr-1',
  language: 'ta',
  durationMs: 6_400,
  text: `${TAMIL_SENTENCE} ${ENGLISH_SENTENCE}`,
  segments: [
    {
      text: TAMIL_SENTENCE,
      startMs: 120,
      endMs: 2_400,
      words: [
        { text: 'வணக்கம்', startMs: 120, endMs: 1_100 },
        { text: 'நண்பர்களே.', startMs: 1_200, endMs: 2_400 },
      ],
    },
    {
      text: ENGLISH_SENTENCE,
      startMs: 2_700,
      endMs: 6_000,
      words: [
        { text: 'Today', startMs: 2_700, endMs: 3_200 },
        { text: 'we', startMs: 3_300, endMs: 3_600 },
        { text: 'plan', startMs: 3_700, endMs: 4_100 },
        { text: 'one', startMs: 4_200, endMs: 4_500 },
        { text: 'useful', startMs: 4_600, endMs: 5_200 },
        { text: 'scene.', startMs: 5_300, endMs: 6_000 },
      ],
    },
  ],
};

const VOICEOVER_PLAN: ScenePlan = {
  scenes: [
    {
      text: TAMIL_SENTENCE,
      imagePrompt: imagePromptFor(TAMIL_SENTENCE, planStyleFromProfile(profile)),
      motion: 'kenburns-in',
      emphasis: [],
      startMs: 0,
      endMs: 2_700,
    },
    {
      text: ENGLISH_SENTENCE,
      imagePrompt: imagePromptFor(ENGLISH_SENTENCE, planStyleFromProfile(profile)),
      motion: 'pan-left',
      emphasis: [],
      startMs: 2_700,
      endMs: 6_400,
    },
  ],
  adapter: 'heuristic',
  degradedFrom: [],
  totalMs: 6_400,
};

const STORED_VOICEOVER: StoredVoiceover = {
  key: `ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/audio/narration.mp3`,
  bytes: 4,
  mime: 'audio/mpeg',
};

function voiceoverRequest(): StepContext['video'] {
  return video({ artStyleId: STYLE_ID, voiceoverUrl: VOICEOVER_URL });
}

function voiceoverDeps(options: {
  download?: () => Promise<VoiceoverDownload>;
  transcribe?: () => Promise<AsrTranscription>;
  store?: () => Promise<StoredVoiceover>;
} = {}) {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const downloader = vi.fn(
    options.download ??
      (async () => ({ bytes, mime: 'audio/mpeg', finalUrl: VOICEOVER_URL })),
  );
  const transcribe = vi.fn(
    async (_request: AsrRequest): Promise<AsrTranscription> =>
      options.transcribe ? await options.transcribe() : TRANSCRIPTION,
  );
  const asr: AsrPort = { transcribe };
  const storeVoiceover = vi.fn(options.store ?? (async () => STORED_VOICEOVER));
  const persistVoiceover = vi.fn(
    async (_tx: CommitTx, _input: PersistVoiceoverInput) => {},
  );
  const planPort = planner();
  const findStyle = vi.fn(async () => style);
  const { context, ...rest } = harness(voiceoverRequest());
  const work = createCreateScenesWork({
    planner: planPort,
    asr,
    downloader,
    findStyle,
    storeVoiceover,
    persistVoiceover,
  });

  return {
    work,
    context,
    planPort,
    findStyle,
    downloader,
    transcribe,
    storeVoiceover,
    persistVoiceover,
    bytes,
    ...rest,
  };
}

function video(
  body: Record<string, unknown> = { artStyleId: STYLE_ID, script: SCRIPT },
): StepContext['video'] {
  return {
    id: VIDEO_ID,
    workspace_id: WORKSPACE_ID,
    kind: 'ai-video-v3',
    status: 'processing',
    step: 'create-scenes',
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

function harness(row: StepContext['video'] = video()) {
  const advance = vi.fn(async () => {});
  const tx: CommitTx = {
    db: {} as Database,
    videoId: VIDEO_ID,
    attempt: 1,
    setStep: vi.fn(async () => {}),
    advance,
    enqueue: vi.fn(async () => {}),
    charge: vi.fn(async () => {}),
    fireWebhook: vi.fn(async () => {}),
  };
  const transactionCalls: Array<(commit: CommitTx) => Promise<unknown>> = [];
  const transaction: StepContext['transaction'] = async <T>(
    fn: (commit: CommitTx) => Promise<T>,
  ): Promise<T> => {
    transactionCalls.push(fn);
    return await fn(tx);
  };
  const observe = vi.fn();
  const context: StepContext = {
    db: {} as Database,
    video: row,
    videoId: VIDEO_ID,
    step: 'create-scenes',
    attempt: 1,
    observe,
    transaction,
  };
  return { context, tx, transactionCalls, advance, observe };
}

function planner(result: ScenePlan = plan): PlanFn {
  return { plan: vi.fn(async () => result) };
}

describe('planStyleFromProfile', () => {
  it('maps the stored profile into deterministic planner clauses', () => {
    expect(planStyleFromProfile(profile)).toEqual({
      prefix: 'flat vector scene, thick clean outlines',
      suffix:
        'palette #14213d #fca311, line colour #14213d, simple geometric background, centred subject with generous safe area',
      negative: 'photo, text, watermark, logo, signature',
    });
  });

  it('does not duplicate required negative terms already present', () => {
    expect(
      planStyleFromProfile({ ...profile, negative: 'PHOTO, logo, signature, text, watermark' })
        .negative,
    ).toBe('PHOTO, logo, signature, text, watermark');
  });
});

describe('createCreateScenesWork', () => {
  it('plans outside the commit, then persists and advances once', async () => {
    const calls: string[] = [];
    const planPort: PlanFn = {
      plan: vi.fn(async (request) => {
        calls.push('plan');
        expect(request).toEqual({ script: SCRIPT, style: planStyleFromProfile(profile) });
        return plan;
      }),
    };
    const findStyle = vi.fn(async () => style);
    const persistPlan = vi.fn(async (_tx: CommitTx, videoId: string, value: ScenePlan) => {
      calls.push('persist');
      expect(videoId).toBe(VIDEO_ID);
      expect(value).toEqual(plan);
    });
    const { context, transactionCalls, advance, observe } = harness();

    await createCreateScenesWork({ planner: planPort, findStyle, persistPlan })(context);

    expect(findStyle).toHaveBeenCalledWith(context.db, STYLE_ID);
    expect(calls).toEqual(['plan', 'persist']);
    expect(transactionCalls).toHaveLength(1);
    expect(advance).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledWith({
      adapter: 'heuristic',
      items: 1,
      degradedFrom: undefined,
    });
  });

  it.each([
    ['missing', null, 'not_found'],
    ['building', { ...style, status: 'building' as const }, 'conflict'],
    ['private to another workspace', { ...style, workspace_id: VIDEO_ID }, 'forbidden'],
    ['wrong orientation', { ...style, formats: ['portrait' as const] }, 'invalid_request'],
  ])('rejects a %s style before planning', async (_label, found, code) => {
    const planPort = planner();
    const persistPlan = vi.fn(async () => {});
    const { context, transactionCalls } = harness();
    const work = createCreateScenesWork({
      planner: planPort,
      findStyle: async () => found,
      persistPlan,
    });

    await expect(work(context)).rejects.toMatchObject({ code });
    expect(planPort.plan).not.toHaveBeenCalled();
    expect(transactionCalls).toHaveLength(0);
    expect(persistPlan).not.toHaveBeenCalled();
  });

  it('allows a published style owned by another workspace', async () => {
    const planPort = planner();
    const { context } = harness();
    const persistPlan = vi.fn(async () => {});

    await createCreateScenesWork({
      planner: planPort,
      findStyle: async () => ({ ...style, workspace_id: VIDEO_ID, published: true }),
      persistPlan,
    })(context);

    expect(planPort.plan).toHaveBeenCalledOnce();
  });

  it('turns a downloaded voiceover into ASR-bounded scenes without planning or TTS', async () => {
    const test = voiceoverDeps();

    await test.work(test.context);

    expect(test.planPort.plan).not.toHaveBeenCalled();
    expect(test.downloader).toHaveBeenCalledWith(VOICEOVER_URL);
    expect(test.transcribe).toHaveBeenCalledWith({
      audio: test.bytes,
      mime: 'audio/mpeg',
    });
    expect(test.storeVoiceover).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      videoId: VIDEO_ID,
      bytes: test.bytes,
      mime: 'audio/mpeg',
    });
    expect(test.persistVoiceover).toHaveBeenCalledOnce();
    const persisted = test.persistVoiceover.mock.calls[0]?.[1];
    expect(persisted?.plan).toEqual(VOICEOVER_PLAN);
    expect(persisted?.transcription).toEqual(TRANSCRIPTION);
    expect(persisted?.stored).toEqual(STORED_VOICEOVER);
    expect(test.transactionCalls).toHaveLength(1);
    expect(test.advance).toHaveBeenCalledOnce();
    expect(test.observe).toHaveBeenCalledWith({
      adapter: 'heuristic',
      items: 2,
      bytes: 4,
      degradedFrom: undefined,
    });
  });

  it('maps download guardrail failures to the documented error codes', async () => {
    const cases = [
      [
        'invalid_request',
        false,
        new VoiceoverDownloadError('not https', {
          code: 'invalid_request',
          retryable: false,
        }),
      ],
      [
        'payload_too_large',
        false,
        new VoiceoverDownloadError('too big', {
          code: 'payload_too_large',
          retryable: false,
        }),
      ],
      [
        'upstream_failed',
        true,
        new VoiceoverDownloadError('reset', {
          code: 'upstream_failed',
          retryable: true,
        }),
      ],
    ] as const;

    for (const [code, retryable, error] of cases) {
      const test = voiceoverDeps({ download: async () => Promise.reject(error) });
      await expect(test.work(test.context)).rejects.toMatchObject({ code, retryable });
      expect(test.transcribe).not.toHaveBeenCalled();
      expect(test.storeVoiceover).not.toHaveBeenCalled();
      expect(test.transactionCalls).toHaveLength(0);
    }
  });

  it.each([
    [422, 'invalid_request', false],
    [413, 'payload_too_large', false],
    [502, 'upstream_failed', false],
    [503, 'upstream_failed', true],
  ])('maps ASR HTTP %i to %s (retryable=%s)', async (status, code, retryable) => {
    const test = voiceoverDeps({
      transcribe: async () =>
        Promise.reject(
          new AsrPortError(`asr ${status}`, {
            status,
            retryable: status === 503,
          }),
        ),
    });

    await expect(test.work(test.context)).rejects.toMatchObject({ code, retryable });
    expect(test.storeVoiceover).not.toHaveBeenCalled();
    expect(test.transactionCalls).toHaveLength(0);
  });

  it('rejects a transcript whose segments do not advance', async () => {
    const [first, second] = TRANSCRIPTION.segments;
    const test = voiceoverDeps({
      transcribe: async () => ({
        ...TRANSCRIPTION,
        segments: [first!, { ...second!, startMs: 100 }],
      }),
    });

    await expect(test.work(test.context)).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: false,
    });
    expect(test.storeVoiceover).not.toHaveBeenCalled();
    expect(test.transactionCalls).toHaveLength(0);
  });

  it('rejects a transcript whose word timings overlap', async () => {
    const [first] = TRANSCRIPTION.segments;
    const test = voiceoverDeps({
      transcribe: async () => ({
        ...TRANSCRIPTION,
        segments: [
          {
            ...first!,
            words: [
              { text: 'வணக்கம்', startMs: 120, endMs: 1_100 },
              { text: 'நண்பர்களே.', startMs: 1_000, endMs: 2_400 },
            ],
          },
        ],
      }),
    });

    await expect(test.work(test.context)).rejects.toMatchObject({
      code: 'upstream_failed',
      retryable: false,
    });
    expect(test.storeVoiceover).not.toHaveBeenCalled();
  });

  it('merges a long transcript down to the scene cap without inventing cuts', async () => {
    const segmentCount = MAX_SCENES + 10;
    const segments = Array.from({ length: segmentCount }, (_unused, index) => ({
      text: `sentence ${index + 1}.`,
      startMs: index * 100,
      endMs: (index + 1) * 100,
      words: [
        {
          text: `sentence${index + 1}`,
          startMs: index * 100,
          endMs: (index + 1) * 100,
        },
      ],
    }));
    const transcript: AsrTranscription = {
      requestId: 'asr-long',
      language: 'en',
      durationMs: segmentCount * 100,
      text: segments.map((segment) => segment.text).join(' '),
      segments,
    };
    const test = voiceoverDeps({ transcribe: async () => transcript });

    await test.work(test.context);

    const persisted = test.persistVoiceover.mock.calls[0]?.[1];
    const scenes = persisted!.plan.scenes;
    expect(scenes).toHaveLength(MAX_SCENES);
    expect(scenes[0]?.startMs).toBe(0);
    expect(scenes.at(-1)?.endMs).toBe(transcript.durationMs);
    for (let index = 1; index < scenes.length; index += 1) {
      expect(scenes[index]?.startMs).toBe(scenes[index - 1]?.endMs);
    }
    expect(scenes.map((scene) => scene.text).join(' ')).toBe(transcript.text);
  });

  it('keeps a disk write retryable and never opens the commit', async () => {
    const test = voiceoverDeps({
      store: async () => Promise.reject(new Error('disk full')),
    });

    await expect(test.work(test.context)).rejects.toMatchObject({
      code: 'internal',
      retryable: true,
    });
    expect(test.transactionCalls).toHaveLength(0);
  });

  it('rejects a plan that does not reconstruct the normalized script', async () => {
    const planPort = planner({
      ...plan,
      scenes: [{ ...plan.scenes[0]!, text: 'Today we dropped the Tamil sentence.' }],
    });
    const { context, transactionCalls } = harness();

    await expect(
      createCreateScenesWork({
        planner: planPort,
        findStyle: async () => style,
        persistPlan: async () => {},
      })(context),
    ).rejects.toMatchObject({ code: 'upstream_failed', retryable: false });
    expect(transactionCalls).toHaveLength(0);
  });

  it('preserves all-transient planner failure as a retryable step failure', async () => {
    const planPort: PlanFn = {
      plan: vi.fn(async () => {
        throw new PlannerChainError([
          { adapter: 'cloudflare', message: '429', retryable: true },
          { adapter: 'groq', message: 'timeout', retryable: true },
        ]);
      }),
    };
    const { context, transactionCalls } = harness();

    const error = await createCreateScenesWork({
      planner: planPort,
      findStyle: async () => style,
      persistPlan: async () => {},
    })(context).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StepFailure);
    expect(error).toMatchObject({ code: 'upstream_failed', retryable: true });
    expect(transactionCalls).toHaveLength(0);
  });

  it('treats a malformed stored request as an internal contract failure', async () => {
    const planPort = planner();
    const { context } = harness(video({ script: SCRIPT }));

    await expect(
      createCreateScenesWork({
        planner: planPort,
        findStyle: async () => style,
        persistPlan: async () => {},
      })(context),
    ).rejects.toMatchObject({ code: 'internal' });
    expect(planPort.plan).not.toHaveBeenCalled();
  });
});
