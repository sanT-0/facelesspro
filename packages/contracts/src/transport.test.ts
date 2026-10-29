import { describe, expect, it } from 'vitest';

import { ERROR_CODES, apiError, statusForError } from './errors';
import {
  audioTimelineSchema,
  cacheStatsSchema,
  mediaHealthSchema,
  narrationPlanSchema,
  synthesizeRequestSchema,
  wordTimingSchema,
} from './media';
import {
  createVideoResponseSchema,
  videoResponseSchema,
} from './responses';
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_MS,
  formatSignatureHeader,
  webhookEventIdSchema,
  webhookEventSchema,
  webhookSignatureSchema,
  webhookSigningPayload,
} from './webhooks';

const VIDEO_ID = '0190a0a0-0000-7000-8000-000000000001';

const video = {
  id: VIDEO_ID,
  kind: 'ai-video-v3',
  status: 'completed',
  step: null,
  render: true,
  videoUrl: 'https://cdn.example.com/ws/videos/v/render.mp4',
  durationMs: 180_000,
  error: null,
  editorUrl: `http://127.0.0.1:3001/editor?id=${VIDEO_ID}`,
  createdAt: '2026-10-26T17:00:00.000Z',
  updatedAt: '2026-10-26T17:01:00.000Z',
};

describe('errors', () => {
  it('maps every code to the documented status', () => {
    expect(statusForError('invalid_request')).toBe(400);
    expect(statusForError('unauthorized')).toBe(401);
    expect(statusForError('insufficient_credits')).toBe(402);
    expect(statusForError('forbidden')).toBe(403);
    expect(statusForError('not_found')).toBe(404);
    expect(statusForError('conflict')).toBe(409);
    expect(statusForError('payload_too_large')).toBe(413);
    expect(statusForError('unprocessable')).toBe(422);
    expect(statusForError('rate_limited')).toBe(429);
    expect(statusForError('upstream_failed')).toBe(502);
    expect(statusForError('internal')).toBe(500);

    // No code may be added without deciding its status.
    expect(ERROR_CODES).toHaveLength(11);
  });

  it('omits field when the failure is not about one input', () => {
    expect(apiError('not_found', 'no such video')).toEqual({
      error: { code: 'not_found', message: 'no such video' },
    });
    expect(apiError('invalid_request', 'required', 'artStyleId')).toEqual({
      error: { code: 'invalid_request', message: 'required', field: 'artStyleId' },
    });
  });
});

describe('video responses', () => {
  it('create responses are the four fields plus id', () => {
    const parsed = createVideoResponseSchema.parse({
      id: VIDEO_ID,
      status: 'processing',
      render: false,
      createdAt: '2026-10-26T17:00:00.000Z',
      editorUrl: `http://127.0.0.1:3001/editor?id=${VIDEO_ID}`,
    });
    expect(parsed.status).toBe('processing');
  });

  it('read responses carry step, urls and the full error envelope', () => {
    expect(videoResponseSchema.parse(video).step).toBeNull();

    const failed = videoResponseSchema.parse({
      ...video,
      status: 'failed',
      step: 'create-images',
      videoUrl: undefined,
      error: { code: 'upstream_failed', message: 'all image adapters failed' },
    });
    expect(failed.error?.code).toBe('upstream_failed');
  });

  it('a video without editorUrl is not a valid response', () => {
    const { editorUrl: _omitted, ...withoutEditor } = video;
    expect(videoResponseSchema.safeParse(withoutEditor).success).toBe(false);
  });
});

describe('webhooks', () => {
  it('the body carries the same video object as GET /v1/videos/:id', () => {
    expect(webhookEventSchema.parse({ event: 'completed', video }).video.id).toBe(
      VIDEO_ID,
    );
    expect(
      webhookEventSchema.safeParse({ event: 'rendering', video }).success,
    ).toBe(false);
  });

  it('ten attempts means nine gaps after the first try', () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(10);
    expect(WEBHOOK_RETRY_SCHEDULE_MS).toHaveLength(9);
    expect(WEBHOOK_RETRY_SCHEDULE_MS[0]).toBe(30_000);
    expect(WEBHOOK_RETRY_SCHEDULE_MS.at(-1)).toBe(8 * 60 * 60_000);

    const ascending = WEBHOOK_RETRY_SCHEDULE_MS.every(
      (delay, index) =>
        index === 0 || delay >= (WEBHOOK_RETRY_SCHEDULE_MS[index - 1] ?? 0),
    );
    expect(ascending).toBe(true);

    const totalHours =
      WEBHOOK_RETRY_SCHEDULE_MS.reduce((sum, delay) => sum + delay, 0) / 3_600_000;
    expect(totalHours).toBeGreaterThan(23);
    expect(totalHours).toBeLessThan(25);
  });

  it('signs `t.body`, not the body alone', () => {
    expect(webhookSigningPayload(1690000000.9, '{"a":1}')).toBe(
      '1690000000.{"a":1}',
    );

    const header = formatSignatureHeader(1690000000, 'b'.repeat(64));
    expect(header).toBe(`t=1690000000,v1=${'b'.repeat(64)}`);
    expect(webhookSignatureSchema.safeParse(header).success).toBe(true);
    expect(webhookSignatureSchema.safeParse('v1=abc').success).toBe(false);
  });

  it('event ids are evt_ prefixed', () => {
    expect(webhookEventIdSchema.safeParse(`evt_${VIDEO_ID}`).success).toBe(true);
    expect(webhookEventIdSchema.safeParse(VIDEO_ID).success).toBe(false);
  });
});

describe('media service contract', () => {
  it('validates a synthesize request the way the pydantic model does', () => {
    const parsed = synthesizeRequestSchema.parse({
      segments: [{ text: 'vanakkam', voice: 'ta-IN-PallaviNeural' }],
    });
    expect(parsed.gap_ms).toBeUndefined();

    for (const voice of ['Pallavi', 'ta-IN-pallavi', 'ta-IN-Pallavi']) {
      expect(
        synthesizeRequestSchema.safeParse({ segments: [{ text: 'x', voice }] }).success,
      ).toBe(false);
    }

    expect(synthesizeRequestSchema.safeParse({ segments: [] }).success).toBe(false);
    expect(
      synthesizeRequestSchema.safeParse({
        segments: [{ text: 'x', voice: 'en-IN-NeerjaNeural' }],
        gap_ms: 2_001,
      }).success,
    ).toBe(false);
  });

  it('rejects a negative word timing', () => {
    expect(
      wordTimingSchema.safeParse({ text: 'x', start_ms: -1, end_ms: 10 }).success,
    ).toBe(false);
  });

  it('parses the Python timeline, including +00:00 timestamps', () => {
    const timeline = audioTimelineSchema.parse({
      request_id: 'r1',
      master_path: '/data/tts/r1/master.wav',
      master_mp3_path: '/data/tts/r1/master.mp3',
      total_duration_ms: 2_966,
      segments: [
        {
          index: 0,
          voice: 'ta-IN-PallaviNeural',
          text: 'வணக்கம்',
          audio_path: '/data/tts/r1/run-000.wav',
          start_ms: 0,
          duration_ms: 2_966,
          head_trim_ms: 150,
          words: [{ text: 'வணக்கம்', start_ms: 0, end_ms: 900 }],
        },
      ],
      gaps_ms: [0],
      boundaries: ['start'],
      master: {
        gain_db: 0.08,
        limited: false,
        input_lufs: -16.28,
        input_dbtp: -1.84,
      },
      created_at: '2026-10-26T17:00:00.123456+00:00',
    });

    expect(timeline.boundaries).toEqual(['start']);
    expect(timeline.segments[0]?.words[0]?.end_ms).toBe(900);
  });

  it('media health reports the engine and the cache flag', () => {
    expect(
      mediaHealthSchema.safeParse({
        status: 'ok',
        service: 'facelesspro-media',
        version: '0.1.0',
        engine: 'EdgeTTSEngine',
        cache: true,
        time: '2026-10-26T17:00:00.123456+00:00',
      }).success,
    ).toBe(true);
  });

  it('cache stats switch shape when disabled', () => {
    expect(cacheStatsSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(
      cacheStatsSchema.safeParse({
        enabled: true,
        hits: 1,
        misses: 1,
        writes: 1,
        entries: 1,
        bytes: 19_940,
        max_bytes: 2_147_483_648,
      }).success,
    ).toBe(true);
    expect(cacheStatsSchema.safeParse({ enabled: true, hits: 1 }).success).toBe(false);
  });

  it('narration plans keep the run-level lang/voice/script triple', () => {
    const plan = narrationPlanSchema.parse({
      script: 'vanakkam machan',
      spokenText: 'வணக்கம் machan',
      runs: [
        { text: 'வணக்கம்', lang: 'ta', voice: 'ta-IN-ValluvarNeural', script: 'tanglish' },
        { text: 'machan', lang: 'en', voice: 'ta-IN-ValluvarNeural', script: 'latin' },
      ],
      overrides: [],
      pair: 'valluvar',
    });

    expect(plan.runs.map((run) => run.lang)).toEqual(['ta', 'en']);
    expect(plan.pair).toBe('valluvar');
  });
});
