/**
 * `withStep` — the only way a pipeline step touches state.
 *
 * A step is one job for one video. The invariants (docs/03 §4, docs/04 §7):
 *
 *   1. **One commit transaction.** Artifacts + `credit_ledger` rows + the
 *      `status`/`step` cursor + the next job either all happen or none do.
 *      `charge()` and `enqueue()` therefore only exist on `CommitTx`, never on
 *      the outer context.
 *   2. **`(video_id, step)` is the key.** A job for a step the video has already
 *      moved past is dropped (`stale`), not re-run.
 *   3. **A live `job_lock` means someone is on it.** A duplicate job returns
 *      `locked` instead of doing the work twice. A lock older than the TTL is
 *      taken over with `attempt + 1` — the previous holder is assumed dead.
 *   4. **A superseded attempt cannot commit.** The commit re-checks that the
 *      lock still carries *our* attempt, so a worker that was descheduled past
 *      the TTL can only roll back, never overwrite the winner.
 *
 * Network work belongs *between* the claim and the commit, not inside the
 * transaction: a step that holds a connection and a row lock for 90 seconds of
 * TTS is a step that blocks the rest of the pipeline.
 *
 * Failure policy, deliberately explicit:
 *
 *   - `StepFailure(code, message, { retryable: true })` → the lock is released
 *     and the error is rethrown, so pg-boss retries the job. Video state is
 *     untouched: the video is still on this step, which is the resume point.
 *   - any other error → `status = 'failed'`, `error = { code, message }`, the
 *     lock is released, and the result is `failed` (swallowed, so pg-boss does
 *     not retry). Unknown errors are treated as permanent on purpose: a blind
 *     retry of a validation bug just burns provider quota. Adapters must
 *     classify transient failures as retryable.
 *
 * Adapters that know better — a 429, a socket reset — must say so. Silence is
 * an assertion that the failure is deterministic.
 */

import { VIDEO_STEPS } from '@facelesspro/contracts';
import type { CreditAction, ErrorCode, VideoStep } from '@facelesspro/contracts';
import {
  creditLedger,
  jobLock,
  schema as databaseSchema,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import type PgBoss from 'pg-boss';

import { enqueueStep } from './boss';

/** 30 minutes: longer than the slowest documented step (docs/04 §8). */
export const DEFAULT_LOCK_TTL_MS = 30 * 60_000;

type VideoRow = typeof video.$inferSelect;

/**
 * A failure with a public `code`. Thrown by step bodies; `withStep` turns it
 * into video state instead of leaking a stack trace into the API.
 */
export class StepFailure extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { readonly retryable?: boolean; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StepFailure';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Thrown by the commit guard, never by a step body. It has its own class so a
 * step's legitimate `conflict` cannot be mistaken for "another attempt won".
 */
class Superseded extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Superseded';
  }
}

export interface StepDeps {
  readonly db: Database;
  /** The same pool `db` came from; needed for a connection-level transaction. */
  readonly pool: Pool;
  readonly boss: PgBoss;
  readonly lockTtlMs?: number;
}

export interface ChargeInput {
  readonly action: CreditAction;
  /** Billable units — minutes for render, items for images. Rounded to 2dp. */
  readonly units: number;
  readonly unitCost: number;
}

/**
 * The commit handle. Everything here runs inside the one transaction that also
 * deletes the lock, so a throw at any point rolls all of it back.
 */
export interface CommitTx {
  /** Escape hatch for artifacts and video fields (`video_url`, `duration_ms`). */
  readonly db: Database;
  readonly videoId: string;
  readonly attempt: number;
  /** Move the cursor without enqueuing. For branches; `advance()` is the norm. */
  setStep(step: VideoStep | null): Promise<void>;
  /** Move to the next declared step and enqueue it, or complete after `render`. */
  advance(): Promise<void>;
  enqueue(step: VideoStep): Promise<void>;
  /** Write the ledger row and debit the workspace, or throw `insufficient_credits`. */
  charge(input: ChargeInput): Promise<void>;
}

export interface StepContext {
  /** Read-only handle for "what does this video already have?" lookups. */
  readonly db: Database;
  readonly video: VideoRow;
  readonly videoId: string;
  readonly step: VideoStep;
  readonly attempt: number;
  /**
   * Open the commit transaction. Call at most once, after network work, and do
   * all writes through the handle it gives you.
   */
  transaction<T>(fn: (tx: CommitTx) => Promise<T>): Promise<T>;
}

/**
 * `{ reused: true }` means "the work already exists, charge nothing" — the
 * cursor still advances, so a defensive re-run cannot wedge the pipeline.
 * Returning nothing (the normal path) requires exactly one commit.
 */
export type StepWork = void | { readonly reused: true };

export type StepOutcome =
  | 'committed'
  | 'reused'
  | 'stale'
  | 'locked'
  | 'superseded'
  | 'failed'
  | 'missing';

export interface StepResult {
  readonly outcome: StepOutcome;
  readonly attempt?: number;
  /** Present when `locked`: milliseconds until the lock is considered dead. */
  readonly retryAfterMs?: number;
  readonly error?: { readonly code: ErrorCode; readonly message: string };
}

export type StepBody = (ctx: StepContext) => Promise<StepWork>;

/** Next step in the public order, or `null` after `render`. */
export function nextStepOf(step: VideoStep): VideoStep | null {
  const index = VIDEO_STEPS.indexOf(step);
  return index >= 0 && index + 1 < VIDEO_STEPS.length
    ? (VIDEO_STEPS[index + 1] ?? null)
    : null;
}

/**
 * Run one step. Resolves with an outcome; the only rejection is a retryable
 * `StepFailure` (or an infrastructure error while releasing the lock, which is
 * also worth a retry).
 */
export async function withStep(
  deps: StepDeps,
  videoId: string,
  step: VideoStep,
  body: StepBody,
): Promise<StepResult> {
  const claim = await claimStep(deps, videoId, step);

  switch (claim.kind) {
    case 'missing':
      return { outcome: 'missing' };
    case 'stale':
      return { outcome: 'stale' };
    case 'locked':
      return {
        outcome: 'locked',
        attempt: claim.attempt,
        retryAfterMs: claim.retryAfterMs,
      };
    case 'claimed':
      break;
  }

  let committed = false;
  const context: StepContext = {
    db: deps.db,
    video: claim.video,
    videoId: claim.videoId,
    step: claim.step,
    attempt: claim.attempt,
    async transaction(fn) {
      if (committed) {
        throw new StepFailure('internal', `${step} tried to commit twice`);
      }
      committed = true;
      return await commitStep(deps, claim, fn);
    },
  };

  try {
    const work = await body(context);

    if (work?.reused === true) {
      if (committed) {
        throw new StepFailure(
          'internal',
          `${step} reported reused after opening a commit`,
        );
      }
      await commitStep(deps, claim, async (tx) => {
        await tx.advance();
      });
      return { outcome: 'reused', attempt: claim.attempt };
    }

    if (!committed) {
      throw new StepFailure(
        'internal',
        `${step} finished without committing; return { reused: true } if there was nothing to write`,
      );
    }

    return { outcome: 'committed', attempt: claim.attempt };
  } catch (error) {
    return await settleFailure(deps, claim, error);
  }
}

// --- claim ------------------------------------------------------------------

type Claim =
  | { readonly kind: 'missing' }
  | { readonly kind: 'stale' }
  | {
      readonly kind: 'locked';
      readonly attempt: number;
      readonly retryAfterMs: number;
    }
  | {
      readonly kind: 'claimed';
      readonly video: VideoRow;
      readonly videoId: string;
      readonly step: VideoStep;
      readonly attempt: number;
    };

async function claimStep(
  deps: StepDeps,
  videoId: string,
  step: VideoStep,
): Promise<Claim> {
  const ttl = deps.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;

  return await deps.db.transaction(async (tx) => {
    // Lock order is video → job_lock everywhere (claim and commit), so two
    // workers cannot deadlock on the same pair.
    const rows = await tx
      .select()
      .from(video)
      .where(eq(video.id, videoId))
      .for('update');
    const row = rows[0];
    if (row === undefined) return { kind: 'missing' };

    // The cursor is authoritative: a job for an old step is a duplicate, and a
    // video that already moved on must not be taken back.
    if (row.step !== step) return { kind: 'stale' };

    const lockRows = await tx
      .select({
        attempt: jobLock.attempt,
        started_at: jobLock.started_at,
        // Raw `now()`: `started_at` is mapped to ISO by the column type, this
        // one comes back as Postgres text. Both parse with Date.parse.
        now: sql<string>`now()`,
      })
      .from(jobLock)
      .where(and(eq(jobLock.video_id, videoId), eq(jobLock.step, step)))
      .for('update');
    const lock = lockRows[0];

    if (lock !== undefined) {
      const nowMs = Date.parse(lock.now);
      const expiresAt = Date.parse(lock.started_at) + ttl;
      const live =
        Number.isFinite(nowMs) && Number.isFinite(expiresAt) && expiresAt > nowMs;

      if (live) {
        return {
          kind: 'locked',
          attempt: lock.attempt,
          retryAfterMs: Math.max(0, Math.ceil(expiresAt - nowMs)),
        };
      }

      // An unparseable timestamp is treated as expired on purpose: a corrupt
      // lock row must not wedge the video forever.
    }

    const claimed = await tx
      .insert(jobLock)
      .values({ video_id: videoId, step, attempt: 1 })
      .onConflictDoUpdate({
        target: [jobLock.video_id, jobLock.step],
        set: {
          attempt: sql`${jobLock.attempt} + 1`,
          started_at: sql`now()`,
        },
      })
      .returning({ attempt: jobLock.attempt });

    const attempt = claimed[0]?.attempt;
    if (attempt === undefined) {
      throw new StepFailure('internal', 'job_lock upsert returned no row');
    }

    return { kind: 'claimed', video: row, videoId, step, attempt };
  });
}

// --- commit -----------------------------------------------------------------

type Claimed = Extract<Claim, { kind: 'claimed' }>;

async function commitStep<T>(
  deps: StepDeps,
  claim: Claimed,
  fn: (tx: CommitTx) => Promise<T>,
): Promise<T> {
  const client = await deps.pool.connect();
  try {
    await client.query('begin');
    const txDb = drizzle(client, { schema: databaseSchema });

    // Re-check under lock: the claim happened in a different transaction, so
    // another attempt may have taken over (TTL expiry) or advanced the cursor.
    const videoRows = await txDb
      .select({ step: video.step })
      .from(video)
      .where(eq(video.id, claim.videoId))
      .for('update');
    const current = videoRows[0];
    if (current === undefined) throw new Superseded('video disappeared');
    if (current.step !== claim.step) {
      throw new Superseded(`video moved to ${current.step ?? 'done'}`);
    }

    const lockRows = await txDb
      .select({ attempt: jobLock.attempt })
      .from(jobLock)
      .where(
        and(
          eq(jobLock.video_id, claim.videoId),
          eq(jobLock.step, claim.step),
        ),
      )
      .for('update');
    const lock = lockRows[0];
    if (lock === undefined || lock.attempt !== claim.attempt) {
      throw new Superseded('lock belongs to another attempt');
    }

    const result = await fn(commitTx(deps, claim, txDb, client));

    // Scoped by attempt: even in a pathological interleaving this can only
    // remove our own lock.
    await txDb
      .delete(jobLock)
      .where(
        and(
          eq(jobLock.video_id, claim.videoId),
          eq(jobLock.step, claim.step),
          eq(jobLock.attempt, claim.attempt),
        ),
      );

    await client.query('commit');
    return result;
  } catch (error) {
    // A failed `commit` also lands here; rollback reports "no transaction" and
    // that is not the error worth surfacing.
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function commitTx(
  deps: StepDeps,
  claim: Claimed,
  txDb: Database,
  client: PoolClient,
): CommitTx {
  const videoId = claim.videoId;

  const enqueue = async (next: VideoStep): Promise<void> => {
    await enqueueStep(
      deps.boss,
      { videoId, step: next },
      {
        // The insert runs on *this* connection, so it is part of this
        // transaction. This is the reason the queue is Postgres.
        db: {
          executeSql: async (text, values) => {
            const result = await client.query(text, values);
            return { rows: result.rows };
          },
        },
      },
    );
  };

  return {
    db: txDb,
    videoId,
    attempt: claim.attempt,

    async setStep(next) {
      await txDb
        .update(video)
        .set({ step: next, updated_at: sql`now()` })
        .where(eq(video.id, videoId));
    },

    async advance() {
      const next = nextStepOf(claim.step);
      if (next === null) {
        // `render` is the last step: clearing the cursor is what "done" means.
        await txDb
          .update(video)
          .set({ status: 'completed', step: null, updated_at: sql`now()` })
          .where(eq(video.id, videoId));
        return;
      }

      await txDb
        .update(video)
        .set({
          // Entering render is the moment the mp4 is being produced.
          status: next === 'render' ? 'rendering' : 'processing',
          step: next,
          error: null,
          updated_at: sql`now()`,
        })
        .where(eq(video.id, videoId));

      await enqueue(next);
    },

    enqueue,

    async charge(input) {
      await applyCharge(txDb, videoId, claim.video.workspace_id, input);
    },
  };
}

// --- money ------------------------------------------------------------------

/** Postgres `numeric(12,2)` is the contract; round here, not at display time. */
function round2(value: number): number {
  const scaled = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return value < 0 ? -scaled || 0 : scaled;
}

async function applyCharge(
  txDb: Database,
  videoId: string,
  workspaceId: string,
  input: ChargeInput,
): Promise<void> {
  const units = round2(input.units);
  if (!Number.isFinite(units) || units < 0) {
    throw new StepFailure('internal', `invalid charge units: ${input.units}`);
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    throw new StepFailure(
      'internal',
      `invalid unit cost for ${input.action}: ${input.unitCost}`,
    );
  }

  // Nothing to bill and nothing worth recording: a zero row per step would be
  // noise in every selfhost ledger.
  if (units === 0) return;

  const delta = round2(-(units * input.unitCost));

  const rows = await txDb
    .select({ id: workspace.id, credits: workspace.credits })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .for('update');
  const ws = rows[0];
  if (ws === undefined) {
    throw new StepFailure('internal', `workspace ${workspaceId} does not exist`);
  }

  if (ws.credits !== null) {
    const next = round2(ws.credits + delta);
    if (next < 0) {
      throw new StepFailure(
        'insufficient_credits',
        `needs ${Math.abs(delta)} credits, workspace has ${ws.credits}`,
      );
    }
    await txDb
      .update(workspace)
      .set({ credits: next })
      .where(eq(workspace.id, ws.id));
  }

  await txDb.insert(creditLedger).values({
    workspace_id: ws.id,
    video_id: videoId,
    action: input.action,
    units,
    unit_cost: input.unitCost,
    delta,
  });
}

// --- failure ----------------------------------------------------------------

async function settleFailure(
  deps: StepDeps,
  claim: Claimed,
  error: unknown,
): Promise<StepResult> {
  if (error instanceof Superseded) {
    // Someone with a newer attempt owns the lock; leave it exactly as it is.
    return { outcome: 'superseded', attempt: claim.attempt };
  }

  const failure =
    error instanceof StepFailure
      ? error
      : new StepFailure('internal', messageOf(error), { cause: error });

  await releaseLock(deps, claim);

  if (failure.retryable) throw failure;

  if (failure.code === 'internal') {
    // Not rethrown, so this is the only trace a real bug leaves.
    console.error('[queue] step failed', {
      videoId: claim.videoId,
      step: claim.step,
      attempt: claim.attempt,
      error,
    });
  }

  await deps.db
    .update(video)
    .set({
      status: 'failed',
      // Artifacts from earlier steps stay: the step is the resume point.
      error: { code: failure.code, message: failure.message },
      updated_at: sql`now()`,
    })
    .where(eq(video.id, claim.videoId));

  return {
    outcome: 'failed',
    attempt: claim.attempt,
    error: { code: failure.code, message: failure.message },
  };
}

async function releaseLock(deps: StepDeps, claim: Claimed): Promise<void> {
  await deps.db
    .delete(jobLock)
    .where(
      and(
        eq(jobLock.video_id, claim.videoId),
        eq(jobLock.step, claim.step),
        eq(jobLock.attempt, claim.attempt),
      ),
    );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
