/**
 * pg-boss wiring: one queue per step, one worker per queue.
 *
 * Why the queue lives in the same Postgres as the ledger: "mark the step done +
 * write the credit row + enqueue the next step" has to be one transaction. With
 * a separate broker that becomes a saga, and a saga eventually charges twice.
 * pg-boss accepts an open connection (`{ db }`), so `withStep` can enqueue
 * inside the very transaction that writes the ledger — see `step.ts`.
 */

import { VIDEO_STEPS } from '@facelesspro/contracts';
import type { VideoStep } from '@facelesspro/contracts';
import PgBoss from 'pg-boss';

import { jobData, parseJob, queueFor } from './jobs';
import type { StepJob } from './jobs';
import { PING_QUEUE, PING_QUEUE_OPTIONS } from './ping';
import type { PingPayload } from './ping';

/**
 * Queue policy for every pipeline step.
 *
 * - `retryLimit: 2` with exponential backoff. Transient provider failures are
 *   worth two silent retries; a permanent one is already recorded on the video
 *   by `withStep`, so more attempts would only burn free-tier quota.
 * - `expireInSeconds: 3600` must exceed the slowest step (docs/04 §8 puts a
 *   cold `create-vocal` at 3–6 min; render is the long tail). An expired job is
 *   re-fetched by pg-boss, which is safe because every step is idempotent.
 * - `retentionSeconds: 86400` keeps a finished job visible for a day, which is
 *   enough to answer "did it run?" while debugging without growing the table
 *   forever.
 */
export const STEP_QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 60 * 60,
  retentionSeconds: 24 * 60 * 60,
} as const satisfies Omit<PgBoss.Queue, 'name'>;

export interface BossOptions {
  readonly connectionString: string;
  /** pg-boss schema. Defaults to pg-boss's own `pgboss`. */
  readonly schema?: string;
  /** Background maintenance (dead-letter, expired jobs). Off in tests. */
  readonly supervise?: boolean;
  /** Cron scheduling. Off in tests. */
  readonly schedule?: boolean;
}

/**
 * Start pg-boss and make sure every step queue exists.
 *
 * pg-boss migrates its own schema on `start()`, so this is safe to call against
 * a fresh database — but it is *not* a replacement for `npm run db:migrate`,
 * which owns the application tables.
 */
export async function createBoss(options: BossOptions): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    // Passing an explicit `undefined` would override pg-boss's default schema.
    ...(options.schema === undefined ? {} : { schema: options.schema }),
    supervise: options.supervise ?? true,
    schedule: options.schedule ?? true,
  });

  boss.on('error', (error: unknown) => {
    console.error('[queue] pg-boss error', error);
  });

  await boss.start();
  await ensureQueues(boss);
  return boss;
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const step of VIDEO_STEPS) {
    await boss.createQueue(queueFor(step), {
      ...STEP_QUEUE_OPTIONS,
      name: queueFor(step),
    });
  }

  await boss.createQueue(PING_QUEUE, {
    ...PING_QUEUE_OPTIONS,
    name: PING_QUEUE,
  });
}

export interface EnqueueOptions {
  /**
   * An open connection whose transaction should contain this insert. This is
   * the whole point of using Postgres as the broker: `withStep` passes the
   * same client that holds the ledger write.
   */
  readonly db?: PgBoss.Db;
  readonly startAfter?: Date;
}

/**
 * Enqueue one step for one video.
 *
 * `singletonKey: videoId` means a duplicate enqueue while a job for that video
 * is still queued/active is dropped (returns `null`) instead of running the
 * step twice. The `video.step` cursor is the authoritative guard; this is the
 * cheap one that keeps the queue from filling with duplicates.
 */
export async function enqueueStep(
  boss: PgBoss,
  job: StepJob,
  options: EnqueueOptions = {},
): Promise<string | null> {
  return boss.send(queueFor(job.step), jobData(job), {
    ...STEP_QUEUE_OPTIONS,
    singletonKey: job.videoId,
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.startAfter === undefined
      ? {}
      : { startAfter: options.startAfter }),
  });
}

export interface ConsumedJob extends StepJob {
  readonly jobId: string;
}

export type StepHandler = (job: ConsumedJob) => Promise<void>;

/**
 * Insert one `ping` job. The payload/queue policy lives in `ping.ts`, so the
 * smoke test cannot drift from the consumer.
 */
export async function enqueuePing(
  boss: PgBoss,
  payload: PingPayload = {},
): Promise<string | null> {
  return boss.send(PING_QUEUE, payload, { ...PING_QUEUE_OPTIONS });
}

/**
 * The slice of pg-boss a consumer needs. Narrow enough that a test can supply a
 * function: the readiness check and the handler wiring are then testable with no
 * database, and a real `PgBoss` still satisfies it (see `apps/worker`).
 *
 * The payload is `unknown`, not a type parameter: a job that came off a queue is
 * untrusted input, so the only honest type before parsing is `unknown`.
 */
export interface JobConsumer {
  work(
    name: string,
    options: { readonly batchSize?: number },
    handler: (
      jobs: ReadonlyArray<{ readonly id: string; readonly data: unknown }>,
    ) => Promise<void>,
  ): Promise<string>;
  offWork(name: string): Promise<void>;
}

/**
 * Consume one non-step queue.
 *
 * `parse` is the boundary: a payload that does not match fails the job loudly
 * (pg-boss counts the attempt) instead of being skipped, because a payload the
 * producer and consumer disagree about is a bug to surface.
 */
export async function consume<T>(
  boss: JobConsumer,
  queue: string,
  parse: (data: unknown) => T,
  handler: (job: { readonly id: string; readonly payload: T }) => Promise<void>,
  options: { readonly batchSize?: number } = {},
): Promise<string> {
  return boss.work(queue, { batchSize: options.batchSize ?? 1 }, async (jobs) => {
    for (const job of jobs) {
      await handler({ id: job.id, payload: parse(job.data) });
    }
  });
}

/**
 * Run `handler` for every job on a step queue.
 *
 * A malformed payload throws `InvalidJobError`, which fails the job loudly
 * instead of skipping it: a producer/consumer disagreement must never look like
 * a successfully processed video.
 */
export async function consumeStep(
  boss: PgBoss,
  step: VideoStep,
  handler: StepHandler,
  options: { readonly batchSize?: number } = {},
): Promise<string> {
  return boss.work<{ videoId: string }>(
    queueFor(step),
    { batchSize: options.batchSize ?? 1 },
    async (jobs) => {
      for (const job of jobs) {
        const parsed = parseJob(queueFor(step), job.data);
        await handler({ ...parsed, jobId: job.id });
      }
    },
  );
}

export async function stopBoss(boss: PgBoss): Promise<void> {
  await boss.stop({ graceful: true });
}
