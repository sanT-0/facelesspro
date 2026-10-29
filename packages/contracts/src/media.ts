/**
 * The boundary between TypeScript and the Python media service.
 *
 * These shapes are implemented twice — zod here, pydantic in
 * `services/media/app/models.py` — so a drift is a real risk. They are kept in
 * one file, mirrored field-for-field, and exercised by a fixture test on both
 * sides. `wordTimingSchema` is the important one: captions depend on
 * `global = run.start + word.local`.
 */

import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';

/** Edge voice ids (`ta-IN-PallaviNeural`), which is all this service speaks. */
export const MEDIA_VOICE_PATTERN = /^[a-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9]+Neural$/;

export const MAX_MEDIA_SEGMENTS = 500;
export const MAX_MEDIA_SEGMENT_CHARS = 5_000;
export const MAX_GAP_MS = 2_000;

export const wordTimingSchema = z.strictObject({
  text: z.string(),
  start_ms: z.int().min(0),
  end_ms: z.int().min(0),
});
export type WordTiming = z.infer<typeof wordTimingSchema>;

export const synthesizeSegmentSchema = z.strictObject({
  text: z.string().min(1).max(MAX_MEDIA_SEGMENT_CHARS),
  voice: z.string().regex(MEDIA_VOICE_PATTERN),
});
export type SynthesizeSegment = z.infer<typeof synthesizeSegmentSchema>;

export const synthesizeRequestSchema = z.strictObject({
  segments: z
    .array(synthesizeSegmentSchema)
    .min(1)
    .max(MAX_MEDIA_SEGMENTS),
  /**
   * Force every join to the same pause. Omitted (the normal case) derives each
   * gap from the punctuation between runs.
   */
  gap_ms: z.int().min(0).max(MAX_GAP_MS).optional(),
});
export type SynthesizeRequest = z.infer<typeof synthesizeRequestSchema>;

/** Boundary classes from `services/media/app/boundaries.py`. */
export const boundarySchema = z.enum([
  'none',
  'comma',
  'clause',
  'sentence',
  'paragraph',
]);
export type Boundary = z.infer<typeof boundarySchema>;

export const segmentResultSchema = z.strictObject({
  index: z.int().min(0),
  voice: z.string(),
  text: z.string(),
  audio_path: z.string(),
  /** Exact position of this run in the master track. */
  start_ms: z.int().min(0),
  duration_ms: z.int().min(0),
  head_trim_ms: z.int().min(0),
  /** Global timings: already rebased by `start_ms`. */
  words: z.array(wordTimingSchema),
});
export type SegmentResult = z.infer<typeof segmentResultSchema>;

export const synthesizeResponseSchema = z.strictObject({
  request_id: z.string().min(1),
  segments: z.array(segmentResultSchema),
  master_path: z.string().min(1),
  total_duration_ms: z.int().min(0),
});
export type SynthesizeResponse = z.infer<typeof synthesizeResponseSchema>;

export const mediaHealthSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
  engine: z.string().min(1),
  cache: z.boolean(),
  time: isoDateTimeSchema,
});
export type MediaHealth = z.infer<typeof mediaHealthSchema>;

export const cacheStatsSchema = z.union([
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({
    enabled: z.literal(true),
    hits: z.int().min(0),
    misses: z.int().min(0),
    writes: z.int().min(0),
    entries: z.int().min(0),
    bytes: z.int().min(0),
    max_bytes: z.int().min(0),
  }),
]);
export type CacheStats = z.infer<typeof cacheStatsSchema>;

/** `master` summary in `timeline.json`. `null` when the program is silent. */
export const masterSummarySchema = z
  .strictObject({
    gain_db: z.number().nullable(),
    limited: z.boolean(),
    input_lufs: z.number().nullable(),
    input_dbtp: z.number().nullable(),
  })
  .nullable();

/**
 * `timeline.json`, written next to `master.wav`. The render service reads it,
 * so it is a contract, not a debug dump.
 */
export const audioTimelineSchema = z.strictObject({
  request_id: z.string().min(1),
  master_path: z.string().min(1),
  master_mp3_path: z.string().min(1),
  total_duration_ms: z.int().min(0),
  segments: z.array(segmentResultSchema),
  gaps_ms: z.array(z.int().min(0)),
  boundaries: z.array(z.union([z.literal('start'), boundarySchema])),
  master: masterSummarySchema,
  created_at: isoDateTimeSchema,
});
export type AudioTimeline = z.infer<typeof audioTimelineSchema>;

// --- narration plan (packages/core output) ----------------------------------

/** Mirrors `NarrationPlan` in `packages/core/src/plan.ts`. */
export const narrationRunSchema = z.strictObject({
  /** What is sent to the engine: Tamil script for Tanglish. */
  text: z.string(),
  lang: z.enum(['ta', 'en']),
  voice: z.string().min(1),
  /** How it was written before transliteration. */
  script: z.enum(['tamil', 'latin', 'tanglish']),
});
export type NarrationRun = z.infer<typeof narrationRunSchema>;

export const overrideSpanSchema = z.strictObject({
  start: z.int().min(0),
  end: z.int().min(0),
  lang: z.enum(['ta', 'en']),
});
export type OverrideSpan = z.infer<typeof overrideSpanSchema>;

export const narrationPlanSchema = z.strictObject({
  script: z.string(),
  spokenText: z.string(),
  runs: z.array(narrationRunSchema),
  overrides: z.array(overrideSpanSchema),
  pair: z.string().nullable(),
});
export type NarrationPlan = z.infer<typeof narrationPlanSchema>;

/** Stored on a video, so a retry replays the exact same narration. */
export const storedNarrationPlanSchema = narrationPlanSchema.extend({
  videoId: idSchema,
  /** Probe result; scene durations are re-derived from this. */
  durationMs: z.int().min(0).optional(),
});
export type StoredNarrationPlan = z.infer<typeof storedNarrationPlanSchema>;
