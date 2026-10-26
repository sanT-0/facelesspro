/**
 * `withStep` against a real Postgres and a real pg-boss.
 *
 * These are the invariants a unit test cannot prove: locks, row locks, rollback
 * and a job insert that shares the ledger's transaction. Run with
 * `npm run test:db` (needs `docker compose up -d postgres`).
 */

import { randomUUID } from 'node:crypto';

import { videoRowSchema } from '@facelesspro/contracts';
import type { VideoStep } from '@facelesspro/contracts';
import {
  createDb,
  creditLedger,
  databaseUrl,
  jobLock,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import {
  StepFailure,
  createBoss,
  queueFor,
  stopBoss,
  withStep,
} from '@facelesspro/queue';
import type { StepDeps } from '@facelesspro/queue';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const suite = process.env.DB_TESTS === '1' ? describe : describe.skip;

let db: Database;
let pool: Pool;
let boss: PgBoss;
let deps: StepDeps;

let workspaceId: string;
let videoId: string;

const STEPS: readonly VideoStep[] = [
  'create-scenes',
  'create-vocal',
  'create-images',
  'create-captions',
  'render',
];

async function purgeQueues(): Promise<void> {
  for (const step of STEPS) await boss.purgeQueue(queueFor(step));
}

async function queueSize(step: VideoStep): Promise<number> {
  return (await boss.getQueueSize(queueFor(step))) ?? 0;
}

async function makeWorkspace(credits: number | null): Promise<string> {
  const rows = await db
    .insert(workspace)
    .values({ name: `queue-test-${randomUUID()}`, credits })
    .returning({ id: workspace.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('workspace insert returned nothing');
  return id;
}

async function makeVideo(step: VideoStep = 'create-scenes'): Promise<string> {
  const rows = await db
    .insert(video)
    .values({
      workspace_id: workspaceId,
      kind: 'ai-video-v3',
      status: 'processing',
      step,
      request: { kind: 'ai-video-v3', body: { script: 'vanakkam' } },
    })
    .returning({ id: video.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('video insert returned nothing');
  return id;
}

async function readVideo() {
  const rows = await db.select().from(video).where(eq(video.id, videoId));
  const row = rows[0];
  if (row === undefined) throw new Error('video disappeared');
  return row;
}

async function credits(): Promise<number | null> {
  const rows = await db
    .select({ credits: workspace.credits })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  return rows[0]?.credits ?? null;
}

async function ledger() {
  return await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.workspace_id, workspaceId));
}

async function locks() {
  return await db.select().from(jobLock).where(eq(jobLock.video_id, videoId));
}

suite('withStep', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
    boss = await createBoss({
      connectionString: databaseUrl(),
      supervise: false,
      schedule: false,
    });
    deps = { db, pool, boss };
  });

  afterAll(async () => {
    await stopBoss(boss);
    await pool.end();
  });

  beforeEach(async () => {
    await purgeQueues();
    workspaceId = await makeWorkspace(100);
    videoId = await makeVideo();
  });

  afterEach(async () => {
    // One workspace per test: cascades videos, ledger and locks together, so a
    // failure cannot leak rows into the next test.
    await db.delete(workspace).where(eq(workspace.id, workspaceId));
    await purgeQueues();
  });

  it('commits artifacts, ledger, cursor and the next job together', async () => {
    const result = await withStep(deps, videoId, 'create-scenes', async (ctx) => {
      expect(ctx.videoId).toBe(videoId);
      expect(ctx.step).toBe('create-scenes');
      expect(ctx.attempt).toBe(1);

      // Reads outside the commit transaction are allowed and see pre-work state.
      const before = await readVideo();
      expect(before.video_url).toBeNull();

      await ctx.transaction(async (tx) => {
        await tx.db
          .update(video)
          .set({ video_url: 's3://bucket/scenes.json' })
          .where(eq(video.id, videoId));
        await tx.charge({ action: 'image', units: 2, unitCost: 1.5 });
        await tx.advance();
      });
    });

    expect(result).toEqual({ outcome: 'committed', attempt: 1 });

    const row = await readVideo();
    expect(videoRowSchema.parse(row).step).toBe('create-vocal');
    expect(row.status).toBe('processing');
    expect(row.video_url).toBe('s3://bucket/scenes.json');

    expect(await credits()).toBe(97);

    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      video_id: videoId,
      action: 'image',
      units: 2,
      unit_cost: 1.5,
      delta: -3,
    });

    expect(await queueSize('create-vocal')).toBe(1);
    expect(await locks()).toHaveLength(0);
  });

  it('drops a job for a step the video has already left', async () => {
    await db.update(video).set({ step: 'create-vocal' }).where(eq(video.id, videoId));
    const body = vi.fn(async () => undefined);

    const result = await withStep(deps, videoId, 'create-scenes', body);

    expect(result.outcome).toBe('stale');
    expect(body).not.toHaveBeenCalled();
    expect(await locks()).toHaveLength(0);
  });

  it('reports a live lock instead of running the step twice', async () => {
    await db
      .insert(jobLock)
      .values({ video_id: videoId, step: 'create-scenes', attempt: 7 });
    const body = vi.fn(async () => undefined);

    const result = await withStep(deps, videoId, 'create-scenes', body);

    expect(result.outcome).toBe('locked');
    expect(result.attempt).toBe(7);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(30 * 60_000);
    expect(body).not.toHaveBeenCalled();

    const rows = await locks();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempt).toBe(7);
  });

  it('reclaims an expired lock with a new attempt', async () => {
    await db.insert(jobLock).values({
      video_id: videoId,
      step: 'create-scenes',
      attempt: 7,
      started_at: sql`now() - interval '31 minutes'`,
    });

    const result = await withStep(deps, videoId, 'create-scenes', async (ctx) => {
      expect(ctx.attempt).toBe(8);
      await ctx.transaction(async (tx) => {
        await tx.advance();
      });
    });

    expect(result).toEqual({ outcome: 'committed', attempt: 8 });
    expect((await readVideo()).step).toBe('create-vocal');
    expect(await locks()).toHaveLength(0);
  });

  it('marks the video failed, releases the lock and charges nothing', async () => {
    const result = await withStep(deps, videoId, 'create-scenes', async (ctx) => {
      await ctx.transaction(async (tx) => {
        await tx.charge({ action: 'image', units: 2, unitCost: 1.5 });
        throw new StepFailure('upstream_failed', 'image provider returned 500');
      });
    });

    expect(result.outcome).toBe('failed');
    expect(result.error?.code).toBe('upstream_failed');

    const row = await readVideo();
    expect(row.status).toBe('failed');
    expect(row.step).toBe('create-scenes');
    expect(row.error).toEqual({
      code: 'upstream_failed',
      message: 'image provider returned 500',
    });

    expect(await credits()).toBe(100);
    expect(await ledger()).toHaveLength(0);
    expect(await locks()).toHaveLength(0);
    expect(await queueSize('create-vocal')).toBe(0);
  });

  it('rethrows a retryable failure without touching video state', async () => {
    const failure = new StepFailure('rate_limited', 'slow down', {
      retryable: true,
    });

    await expect(
      withStep(deps, videoId, 'create-scenes', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const row = await readVideo();
    expect(row.status).toBe('processing');
    expect(row.step).toBe('create-scenes');
    expect(row.error).toBeNull();

    // The lock is gone, so pg-boss's 30 s retry can claim immediately.
    expect(await locks()).toHaveLength(0);

    // The lock was released, not left to expire, so the retry claims fresh —
    // `attempt` is a fencing token for one lock's lifetime, not a retry count.
    const retry = await withStep(deps, videoId, 'create-scenes', async (ctx) => {
      expect(ctx.attempt).toBe(1);
      await ctx.transaction(async (tx) => {
        await tx.advance();
      });
    });
    expect(retry.outcome).toBe('committed');
  });

  it('rolls back artifacts, the charge and the enqueued job together', async () => {
    const result = await withStep(deps, videoId, 'create-scenes', async (ctx) => {
      await ctx.transaction(async (tx) => {
        await tx.db
          .update(video)
          .set({ video_url: 's3://bucket/leaked.json' })
          .where(eq(video.id, videoId));
        await tx.charge({ action: 'image', units: 1, unitCost: 2 });
        await tx.enqueue('create-vocal');
        throw new StepFailure('upstream_failed', 'boom after enqueue');
      });
    });

    expect(result.outcome).toBe('failed');

    const row = await readVideo();
    expect(row.video_url).toBeNull();
    expect(row.step).toBe('create-scenes');
    expect(row.status).toBe('failed');

    expect(await credits()).toBe(100);
    expect(await ledger()).toHaveLength(0);
    expect(await queueSize('create-vocal')).toBe(0);
    expect(await locks()).toHaveLength(0);
  });

  it('refuses to spend credits the workspace does not have', async () => {
    await db.update(workspace).set({ credits: 1 }).where(eq(workspace.id, workspaceId));

    const result = await withStep(deps, videoId, 'create-scenes', async (ctx) => {
      await ctx.transaction(async (tx) => {
        await tx.charge({ action: 'image', units: 2, unitCost: 1 });
      });
    });

    expect(result.outcome).toBe('failed');
    expect(result.error?.code).toBe('insufficient_credits');
    expect((await readVideo()).status).toBe('failed');
    expect(await credits()).toBe(1);
    expect(await ledger()).toHaveLength(0);
  });

  it('records unlimited usage without inventing a credit balance', async () => {
    await db.update(workspace).set({ credits: null }).where(eq(workspace.id, workspaceId));

    const result = await withStep(deps, videoId, 'create-scenes', async (ctx) => {
      await ctx.transaction(async (tx) => {
        await tx.charge({ action: 'tts', units: 0.5, unitCost: 4 });
        await tx.advance();
      });
    });

    expect(result.outcome).toBe('committed');
    expect(await credits()).toBeNull();
    expect((await ledger())[0]).toMatchObject({ units: 0.5, delta: -2 });
  });

  it('advances without charging when the work already exists', async () => {
    const result = await withStep(deps, videoId, 'create-scenes', async () => ({
      reused: true,
    }));

    expect(result).toEqual({ outcome: 'reused', attempt: 1 });
    expect((await readVideo()).step).toBe('create-vocal');
    expect(await credits()).toBe(100);
    expect(await ledger()).toHaveLength(0);
    expect(await queueSize('create-vocal')).toBe(1);
  });

  it('lets the newer attempt commit and rolls the stale one back', async () => {
    const result = await withStep(deps, videoId, 'create-scenes', async (ctx) => {
      // Another worker took over after the TTL expired.
      await db
        .update(jobLock)
        .set({ attempt: ctx.attempt + 1, started_at: sql`now()` })
        .where(
          and(
            eq(jobLock.video_id, videoId),
            eq(jobLock.step, 'create-scenes'),
          ),
        );

      await ctx.transaction(async (tx) => {
        await tx.charge({ action: 'image', units: 1, unitCost: 1 });
        await tx.advance();
      });
    });

    expect(result.outcome).toBe('superseded');
    expect((await readVideo()).step).toBe('create-scenes');
    expect(await credits()).toBe(100);
    expect(await ledger()).toHaveLength(0);

    // The winner's lock is intact: the loser may not delete it.
    const rows = await locks();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempt).toBe(2);
  });

  it('treats a deleted video as a job to drop, not to retry', async () => {
    const result = await withStep(deps, randomUUID(), 'render', async () => undefined);
    expect(result.outcome).toBe('missing');
  });

  it('fails loudly when a step does work but writes nothing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await withStep(deps, videoId, 'create-scenes', async () => undefined);
      expect(result.outcome).toBe('failed');
      expect(result.error?.code).toBe('internal');
      expect((await readVideo()).status).toBe('failed');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('serialises concurrent jobs for the same video and step', async () => {
    let open!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const bodyStarted = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const first = withStep(deps, videoId, 'create-scenes', async (ctx) => {
      entered();
      await gate;
      await ctx.transaction(async (tx) => {
        await tx.advance();
      });
    });

    await bodyStarted;

    const duplicate = vi.fn(async () => undefined);
    const second = await withStep(deps, videoId, 'create-scenes', duplicate);
    expect(second.outcome).toBe('locked');
    expect(duplicate).not.toHaveBeenCalled();

    open();
    expect((await first).outcome).toBe('committed');
    expect((await readVideo()).step).toBe('create-vocal');
  });
});
