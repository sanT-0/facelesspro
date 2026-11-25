/**
 * Job telemetry reads over real Postgres.
 *
 * The grouped query is the part a unit test cannot cover: the join that scopes
 * events to a workspace, and the `created_at` window.
 */

import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './client';
import type { Database } from './client';
import { summariseJobs } from './job-events';
import { jobEvent, video, workspace } from './schema';

let db: Database;
let pool: Pool;
let workspaceIds: string[] = [];
let videoIds: string[] = [];

async function createWorkspaceVideo(): Promise<{ workspaceId: string; videoId: string }> {
  const ws = await db
    .insert(workspace)
    .values({
      name: `job-health-${randomUUID()}`,
      plan_id: 'selfhost',
      credits: null,
      balance_cents: 0,
    })
    .returning({ id: workspace.id });
  const workspaceId = ws[0]!.id;
  workspaceIds.push(workspaceId);

  const created = await db
    .insert(video)
    .values({
      workspace_id: workspaceId,
      kind: 'ai-video-v3',
      status: 'processing',
      step: 'render',
      request: {
        kind: 'ai-video-v3',
        body: { artStyleId: 1, script: 'gate', render: {} },
      },
    })
    .returning({ id: video.id });
  const videoId = created[0]!.id;
  videoIds.push(videoId);

  return { workspaceId, videoId };
}

describe('summariseJobs (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (videoIds.length > 0) {
      await db.delete(jobEvent).where(inArray(jobEvent.video_id, videoIds));
      await db.delete(video).where(inArray(video.id, videoIds));
    }
    if (workspaceIds.length > 0) {
      await db.delete(workspace).where(inArray(workspace.id, workspaceIds));
    }
    workspaceIds = [];
    videoIds = [];
  });

  it('counts this window only, scoped to the requested workspace', async () => {
    const mine = await createWorkspaceVideo();
    const other = await createWorkspaceVideo();
    const now = new Date();
    const recent = new Date(now.getTime() - 5 * 60_000);
    const old = new Date(now.getTime() - 3 * 60 * 60_000);

    await db.insert(jobEvent).values([
      {
        video_id: mine.videoId,
        step: 'render',
        attempt: 1,
        outcome: 'committed',
        duration_ms: 1_000,
        created_at: recent.toISOString(),
      },
      {
        video_id: mine.videoId,
        step: 'render',
        attempt: 1,
        outcome: 'failed',
        duration_ms: 1_500,
        created_at: recent.toISOString(),
      },
      {
        video_id: mine.videoId,
        step: 'create-vocal',
        attempt: 1,
        outcome: 'retryable',
        duration_ms: 10,
        created_at: old.toISOString(),
      },
      {
        video_id: other.videoId,
        step: 'render',
        attempt: 1,
        outcome: 'failed',
        duration_ms: 900,
        created_at: recent.toISOString(),
      },
    ]);

    const report = await summariseJobs(db, {
      since: new Date(now.getTime() - 60 * 60_000),
      windowMinutes: 60,
      workspaceId: mine.workspaceId,
      threshold: 0.5,
    });

    expect(report).toMatchObject({
      windowMinutes: 60,
      threshold: 0.5,
      events: 2,
      succeeded: 1,
      failed: 1,
      retryable: 0,
      failureRate: 0.5,
      status: 'ok',
    });
    expect(report.steps.find((step) => step.step === 'render')).toMatchObject({
      events: 2,
      succeeded: 1,
      failed: 1,
    });

    // The same data is `degraded` once the threshold is below its rate.
    const strict = await summariseJobs(db, {
      since: new Date(now.getTime() - 60 * 60_000),
      windowMinutes: 60,
      workspaceId: mine.workspaceId,
      threshold: 0.1,
    });
    expect(strict.status).toBe('degraded');
  });

  it('covers the whole install when no workspace is given', async () => {
    const mine = await createWorkspaceVideo();
    const other = await createWorkspaceVideo();
    const recent = new Date(Date.now() - 60_000);

    await db.insert(jobEvent).values([
      {
        video_id: mine.videoId,
        step: 'render',
        attempt: 1,
        outcome: 'committed',
        duration_ms: 1_000,
        created_at: recent.toISOString(),
      },
      {
        video_id: other.videoId,
        step: 'render',
        attempt: 1,
        outcome: 'failed',
        duration_ms: 1_000,
        created_at: recent.toISOString(),
      },
    ]);

    const report = await summariseJobs(db, {
      since: new Date(Date.now() - 60 * 60_000),
      windowMinutes: 60,
      threshold: 0.1,
    });

    // Other suites use the same database, so assert a floor rather than equality.
    expect(report.failed).toBeGreaterThanOrEqual(1);
    expect(report.succeeded).toBeGreaterThanOrEqual(1);
    expect(report.steps.find((step) => step.step === 'render')?.events).toBeGreaterThanOrEqual(2);
  });
});
