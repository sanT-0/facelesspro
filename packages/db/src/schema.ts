/**
 * Postgres schema, one table per row shape in `packages/contracts/src/db.ts`.
 *
 * Property names are snake_case on purpose: drizzle's `$inferSelect` then
 * produces exactly the contract's row type, so the api can validate a row with
 * the schema it already has instead of maintaining a mapping. The DB is the one
 * layer where snake_case is the contract, not a leak.
 *
 * The three enums that describe the public state machine are real Postgres
 * enums, built from the same tuples the zod schemas use. Extending them takes a
 * migration — which is the correct friction for names AGENTS.md says must not
 * be renamed casually. Everything else is text + `$type`, so adding a plan or
 * an image style does not require a DDL change.
 */

import type {
  ArtStyleStatus,
  AssetKind,
  BalanceKind,
  CaptionCue,
  CaptionSpec,
  CreditAction,
  Engine,
  NarrationPlan,
  PlanId,
  RenderFormat,
  RenderStatus,
  Size,
  VideoError,
  VideoKind,
  WordTiming,
} from '@facelesspro/contracts';
import {
  MEMBER_ROLES,
  VIDEO_STATUS,
  VIDEO_STEPS,
} from '@facelesspro/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from './timestamp';

// --- shared column builders -------------------------------------------------

/**
 * Timestamps are strings all the way through the database layer (see
 * `timestamp.ts`): they arrive as ISO 8601 UTC, so `$inferSelect` matches the
 * contract row without a conversion step. `.default(sql`now()`)` rather than
 * `.defaultNow()` because a custom column type has no date helpers.
 */
const createdAt = () => timestamptz('created_at').notNull().default(sql`now()`);

const updatedAt = () => timestamptz('updated_at').notNull().default(sql`now()`);

const jsonObject = () => jsonb('meta').$type<Record<string, unknown>>();

// --- public enums -----------------------------------------------------------

export const videoStatusEnum = pgEnum('video_status', VIDEO_STATUS);
export const videoStepEnum = pgEnum('video_step', VIDEO_STEPS);
export const memberRoleEnum = pgEnum('member_role', MEMBER_ROLES);

// --- identity ---------------------------------------------------------------

export const workspace = pgTable('workspace', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  plan_id: text('plan_id').$type<PlanId>().notNull().default('selfhost'),
  /** `null` = unlimited. Never `Infinity`: neither Postgres nor JSON has it. */
  credits: numeric('credits', { precision: 12, scale: 2, mode: 'number' }),
  balance_cents: integer('balance_cents').notNull().default(0),
  created_at: createdAt(),
});

/** A reserved word in Postgres; drizzle quotes every identifier. */
export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  password_hash: text('password_hash'),
});

export const member = pgTable(
  'member',
  {
    workspace_id: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('editor'),
  },
  (table) => [primaryKey({ columns: [table.workspace_id, table.user_id] })],
);

export const apiKey = pgTable(
  'api_key',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspace_id: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** sha256 of the key. The key itself is shown once and never stored. */
    hash: text('hash').notNull(),
    prefix: text('prefix').notNull(),
    last_used_at: timestamptz('last_used_at'),
    revoked_at: timestamptz('revoked_at'),
  },
  (table) => [uniqueIndex('api_key_hash_idx').on(table.hash)],
);

// --- video pipeline ---------------------------------------------------------

export const video = pgTable(
  'video',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspace_id: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<VideoKind>().notNull(),
    status: videoStatusEnum('status').notNull().default('processing'),
    /** Current or last failed step; null once a render completed. */
    step: videoStepEnum('step'),
    error: jsonb('error').$type<VideoError | null>(),
    /** Normalised create request: a retry replays this, not the client body. */
    request: jsonb('request')
      .$type<{ kind: VideoKind; body: Record<string, unknown> }>()
      .notNull(),
    plan: jsonb('plan').$type<Record<string, unknown>>(),
    webhook_url: text('webhook_url'),
    duration_ms: integer('duration_ms'),
    video_url: text('video_url'),
    editor_seen_at: timestamptz('editor_seen_at'),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (table) => [
    index('video_workspace_status_idx').on(table.workspace_id, table.status),
  ],
);

// --- ledgers ----------------------------------------------------------------

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspace_id: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** `set null` so history survives a video deletion. */
    video_id: uuid('video_id').references(() => video.id, {
      onDelete: 'set null',
    }),
    action: text('action').$type<CreditAction>().notNull(),
    units: numeric('units', { precision: 12, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    unit_cost: numeric('unit_cost', { precision: 12, scale: 4, mode: 'number' })
      .notNull()
      .default(0),
    delta: numeric('delta', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    created_at: createdAt(),
  },
  (table) => [
    index('credit_ledger_workspace_created_idx').on(
      table.workspace_id,
      table.created_at,
    ),
  ],
);

export const balanceLedger = pgTable(
  'balance_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspace_id: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<BalanceKind>().notNull(),
    amount_cents: integer('amount_cents').notNull(),
    meta: jsonObject(),
    created_at: createdAt(),
  },
  (table) => [
    index('balance_ledger_workspace_created_idx').on(
      table.workspace_id,
      table.created_at,
    ),
  ],
);

// --- libraries --------------------------------------------------------------

export const artStyle = pgTable('art_style', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** `null` = built-in / published globally. */
  workspace_id: uuid('workspace_id').references(() => workspace.id, {
    onDelete: 'cascade',
  }),
  name: text('name').notNull(),
  published: boolean('published').notNull().default(false),
  formats: text('formats').array().$type<Size[]>().notNull().default([]),
  /** StyleProfile document; see docs/04 §4. */
  profile: jsonb('profile').$type<Record<string, unknown>>().notNull(),
  preview_url: text('preview_url'),
  portrait_preview_url: text('portrait_preview_url'),
  sample_video_urls: text('sample_video_urls').array().notNull().default([]),
  status: text('status').$type<ArtStyleStatus>().notNull().default('building'),
  created_at: createdAt(),
});

export const voice = pgTable('voice', {
  /** Engine id (`ta-IN-PallaviNeural`) is the natural key. */
  id: text('id').primaryKey(),
  workspace_id: uuid('workspace_id').references(() => workspace.id, {
    onDelete: 'cascade',
  }),
  engine: text('engine').$type<Engine>().notNull(),
  external_id: text('external_id').notNull(),
  name: text('name').notNull(),
  languages: text('languages').array().notNull().default([]),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
});

export const captionTemplate = pgTable('caption_tpl', {
  /** Negative = built-in (parity); 0 is never valid. */
  id: integer('id').primaryKey(),
  /** `null` = built-in. */
  workspace_id: uuid('workspace_id').references(() => workspace.id, {
    onDelete: 'cascade',
  }),
  name: text('name').notNull(),
  spec: jsonb('spec').$type<CaptionSpec>().notNull(),
});

export const asset = pgTable(
  'asset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspace_id: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AssetKind>().notNull(),
    /** Storage key, never a user-controlled path. */
    key: text('key').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    mime: text('mime').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    created_at: createdAt(),
  },
  (table) => [index('asset_workspace_kind_idx').on(table.workspace_id, table.kind)],
);

// --- per-video artifacts ----------------------------------------------------

export const scene = pgTable(
  'scene',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    video_id: uuid('video_id')
      .notNull()
      .references(() => video.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    text: text('text').notNull(),
    image_asset_id: uuid('image_asset_id').references(() => asset.id, {
      onDelete: 'set null',
    }),
    motion: jsonb('motion')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    start_ms: integer('start_ms').notNull(),
    end_ms: integer('end_ms').notNull(),
  },
  (table) => [
    uniqueIndex('scene_video_idx_unique').on(table.video_id, table.idx),
  ],
);

export const narration = pgTable('narration', {
  video_id: uuid('video_id')
    .primaryKey()
    .references(() => video.id, { onDelete: 'cascade' }),
  asset_id: uuid('asset_id')
    .notNull()
    .references(() => asset.id, { onDelete: 'restrict' }),
  duration_ms: integer('duration_ms').notNull(),
  word_timings: jsonb('word_timings').$type<WordTiming[]>().notNull(),
  voice_plan: jsonb('voice_plan').$type<NarrationPlan>().notNull(),
});

export const captionTrack = pgTable('caption_track', {
  video_id: uuid('video_id')
    .primaryKey()
    .references(() => video.id, { onDelete: 'cascade' }),
  template_id: integer('template_id').notNull(),
  cues: jsonb('cues').$type<CaptionCue[]>().notNull(),
});

export const render = pgTable(
  'render',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    video_id: uuid('video_id')
      .notNull()
      .references(() => video.id, { onDelete: 'cascade' }),
    resolution: integer('resolution').notNull(),
    fps: integer('fps').notNull(),
    format: text('format').$type<RenderFormat>().notNull().default('standard'),
    asset_id: uuid('asset_id').references(() => asset.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<RenderStatus>().notNull().default('queued'),
    created_at: createdAt(),
  },
  (table) => [index('render_video_idx').on(table.video_id)],
);

// --- resumability and delivery ---------------------------------------------

/** A live lock means "someone is on this step"; expiry means requeue. */
export const jobLock = pgTable(
  'job_lock',
  {
    video_id: uuid('video_id')
      .notNull()
      .references(() => video.id, { onDelete: 'cascade' }),
    step: videoStepEnum('step').notNull(),
    attempt: integer('attempt').notNull().default(1),
    started_at: timestamptz('started_at').notNull().default(sql`now()`),
  },
  (table) => [primaryKey({ columns: [table.video_id, table.step] })],
);

export const webhookEvent = pgTable(
  'webhook_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    video_id: uuid('video_id')
      .notNull()
      .references(() => video.id, { onDelete: 'cascade' }),
    event: text('event').$type<'completed' | 'failed'>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    next_at: timestamptz('next_at').notNull().default(sql`now()`),
    delivered_at: timestamptz('delivered_at'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index('webhook_event_due_idx').on(table.delivered_at, table.next_at),
  ],
);

/** Everything the api/worker need, for `drizzle(pool, { schema })`. */
export const schema = {
  workspace,
  user,
  member,
  apiKey,
  video,
  creditLedger,
  balanceLedger,
  artStyle,
  voice,
  captionTemplate,
  asset,
  scene,
  narration,
  captionTrack,
  render,
  jobLock,
  webhookEvent,
};
