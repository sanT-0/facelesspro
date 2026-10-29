/**
 * Postgres row shapes (docs/03 §3).
 *
 * Snake_case because these are rows, not API bodies: the API converts at the
 * edge, which is the only place casing changes. `jsonb` columns are typed with
 * the same schema the producer used where one exists, so a worker reading a
 * column cannot get a shape the writer would have rejected.
 *
 * Two type choices worth knowing:
 * - `workspace.credits` is nullable: `null` means unlimited (`selfhost`).
 *   JSON has no Infinity and neither does a Postgres integer.
 * - `voice.id` is text, not uuid: engine voice ids (`ta-IN-PallaviNeural`) are
 *   the natural key and must stay stable across re-seeds.
 */

import { z } from 'zod';

import {
  artStyleStatusSchema,
  assetKindSchema,
  balanceKindSchema,
  captionTemplateIdSchema,
  creditActionSchema,
  engineSchema,
  frameRateSchema,
  idSchema,
  isoDateTimeSchema,
  memberRoleSchema,
  planIdSchema,
  renderFormatSchema,
  renderStatusSchema,
  resolutionSchema,
  sizeSchema,
  videoKindSchema,
  videoStatusSchema,
  videoStepSchema,
  voiceIdSchema,
} from './common';
import { captionCueSchema, captionSpecSchema } from './responses';
import { narrationPlanSchema, wordTimingSchema } from './media';

/** Table names in dependency order; migrations and seeds use this list. */
export const DB_TABLES = [
  'workspace',
  'user',
  'member',
  'api_key',
  'credit_ledger',
  'balance_ledger',
  'art_style',
  'voice',
  'caption_tpl',
  'asset',
  'video',
  'scene',
  'narration',
  'caption_track',
  'render',
  'job_lock',
  'webhook_event',
] as const;

const jsonb = z.record(z.string(), z.unknown());

// --- identity ---------------------------------------------------------------

export const workspaceRowSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  plan_id: planIdSchema,
  /** `null` = unlimited (selfhost); a paid plan always has a number. */
  credits: z.number().nullable(),
  balance_cents: z.int(),
  created_at: isoDateTimeSchema,
});
export type WorkspaceRow = z.infer<typeof workspaceRowSchema>;

/** Postgres reserves `user`; Drizzle quotes it. Kept as documented. */
export const userRowSchema = z.strictObject({
  id: idSchema,
  email: z.email(),
  name: z.string().min(1),
  password_hash: z.string().min(1).nullish(),
});
export type UserRow = z.infer<typeof userRowSchema>;

export const memberRowSchema = z.strictObject({
  workspace_id: idSchema,
  user_id: idSchema,
  role: memberRoleSchema,
});
export type MemberRow = z.infer<typeof memberRowSchema>;

export const apiKeyRowSchema = z.strictObject({
  id: idSchema,
  workspace_id: idSchema,
  name: z.string().min(1),
  /** sha256 of the key; the key itself is shown once and never stored. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** The visible `vp_` prefix, for "which key is this" in settings. */
  prefix: z.string().min(1),
  last_used_at: isoDateTimeSchema.nullish(),
  revoked_at: isoDateTimeSchema.nullish(),
});
export type ApiKeyRow = z.infer<typeof apiKeyRowSchema>;

// --- ledgers ----------------------------------------------------------------

export const creditLedgerRowSchema = z.strictObject({
  id: idSchema,
  workspace_id: idSchema,
  video_id: idSchema.nullish(),
  action: creditActionSchema,
  units: z.number().min(0),
  unit_cost: z.number().min(0),
  /** Negative for a charge, positive for a refund. */
  delta: z.number(),
  created_at: isoDateTimeSchema,
});
export type CreditLedgerRow = z.infer<typeof creditLedgerRowSchema>;

export const balanceLedgerRowSchema = z.strictObject({
  id: idSchema,
  workspace_id: idSchema,
  kind: balanceKindSchema,
  amount_cents: z.int(),
  meta: jsonb.nullish(),
  created_at: isoDateTimeSchema,
});
export type BalanceLedgerRow = z.infer<typeof balanceLedgerRowSchema>;

// --- libraries --------------------------------------------------------------

export const artStyleRowSchema = z.strictObject({
  id: idSchema,
  /** `null` = built-in / published globally. */
  workspace_id: idSchema.nullish(),
  name: z.string().min(1),
  published: z.boolean(),
  formats: z.array(sizeSchema).min(1),
  /** StyleProfile document; see docs/04 §4. */
  profile: jsonb,
  preview_url: z.string().nullish(),
  portrait_preview_url: z.string().nullish(),
  sample_video_urls: z.array(z.string()),
  status: artStyleStatusSchema,
  created_at: isoDateTimeSchema,
});
export type ArtStyleRow = z.infer<typeof artStyleRowSchema>;

export const voiceRowSchema = z.strictObject({
  id: voiceIdSchema,
  /** `null` = bundled. */
  workspace_id: idSchema.nullish(),
  engine: engineSchema,
  /** Provider-side id when it differs from ours. */
  external_id: z.string().min(1),
  name: z.string().min(1),
  languages: z.array(z.string().min(2)),
  meta: jsonb,
});
export type VoiceRow = z.infer<typeof voiceRowSchema>;

export const captionTemplateRowSchema = z.strictObject({
  /** Negative = built-in (parity). */
  id: captionTemplateIdSchema,
  /** `null` = built-in. */
  workspace_id: idSchema.nullish(),
  name: z.string().min(1),
  spec: captionSpecSchema,
});
export type CaptionTemplateRow = z.infer<typeof captionTemplateRowSchema>;

export const assetRowSchema = z.strictObject({
  id: idSchema,
  workspace_id: idSchema,
  kind: assetKindSchema,
  /** Storage key, never a user-controlled path. */
  key: z.string().min(1),
  bytes: z.int().min(0),
  mime: z.string().min(1),
  meta: jsonb,
  created_at: isoDateTimeSchema,
});
export type AssetRow = z.infer<typeof assetRowSchema>;

// --- video pipeline ---------------------------------------------------------

/**
 * The normalised create request, stored so a retry or a re-render replays the
 * same input. `kind` selects which `create*RequestSchema` produced `body`.
 */
export const videoRequestRowSchema = z.strictObject({
  kind: videoKindSchema,
  body: jsonb,
});
export type VideoRequestRow = z.infer<typeof videoRequestRowSchema>;

export const videoRowSchema = z.strictObject({
  id: idSchema,
  workspace_id: idSchema,
  kind: videoKindSchema,
  status: videoStatusSchema,
  /** Current (or last failed) step; `null` once a render completed. */
  step: videoStepSchema.nullable(),
  error: jsonb.nullish(),
  request: videoRequestRowSchema,
  plan: jsonb.nullish(),
  webhook_url: z.string().nullish(),
  duration_ms: z.int().min(0).nullish(),
  video_url: z.string().nullish(),
  editor_seen_at: isoDateTimeSchema.nullish(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});
export type VideoRow = z.infer<typeof videoRowSchema>;

export const sceneRowSchema = z.strictObject({
  id: idSchema,
  video_id: idSchema,
  idx: z.int().min(0),
  text: z.string(),
  image_asset_id: idSchema.nullish(),
  motion: jsonb,
  start_ms: z.int().min(0),
  end_ms: z.int().min(0),
});
export type SceneRow = z.infer<typeof sceneRowSchema>;

export const narrationRowSchema = z.strictObject({
  video_id: idSchema,
  asset_id: idSchema,
  duration_ms: z.int().min(0),
  word_timings: z.array(wordTimingSchema),
  voice_plan: narrationPlanSchema,
});
export type NarrationRow = z.infer<typeof narrationRowSchema>;

export const captionTrackRowSchema = z.strictObject({
  video_id: idSchema,
  template_id: z.int(),
  cues: z.array(captionCueSchema),
});
export type CaptionTrackRow = z.infer<typeof captionTrackRowSchema>;

export const renderRowSchema = z.strictObject({
  id: idSchema,
  video_id: idSchema,
  resolution: resolutionSchema,
  fps: frameRateSchema,
  format: renderFormatSchema,
  asset_id: idSchema.nullish(),
  status: renderStatusSchema,
  created_at: isoDateTimeSchema,
});
export type RenderRow = z.infer<typeof renderRowSchema>;

/** Resumability guard. A live lock means "someone is on this step". */
export const jobLockRowSchema = z.strictObject({
  video_id: idSchema,
  step: videoStepSchema,
  attempt: z.int().min(1),
  started_at: isoDateTimeSchema,
});
export type JobLockRow = z.infer<typeof jobLockRowSchema>;

export const webhookEventRowSchema = z.strictObject({
  id: idSchema,
  video_id: idSchema,
  event: z.enum(['completed', 'failed']),
  attempts: z.int().min(0),
  next_at: isoDateTimeSchema,
  delivered_at: isoDateTimeSchema.nullish(),
  payload: jsonb,
});
export type WebhookEventRow = z.infer<typeof webhookEventRowSchema>;
