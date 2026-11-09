/**
 * Webhook event persistence over real Postgres.
 *
 * The `webhook_event` table tracks outbound deliveries: one row per (video,
 * terminal event), with attempt counting and a `next_at` schedule so a
 * delivery worker can poll for due events.
 */

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './client';
import type { Database } from './client';
import { video, webhookEvent as webhookEventTable, workspace } from './schema';
import {
  findDueWebhookEvents,
  insertWebhookEvent,
  markWebhookDelivered,
  scheduleWebhookRetry,
} from './webhooks';

let db: Database;
let pool: Pool;
let workspaceId: string;
let videoId: string;

describe('webhook events (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    await db.delete(video).where(eq(video.id, videoId));
    await db.delete(workspace).where(eq(workspace.id, workspaceId));
  });

  it('inserts a webhook event and finds it as due', async () => {
    const workspaces = await db
      .insert(workspace)
      .values({ name: `webhook-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'ai-video-v3', body: {} },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    const inserted = await insertWebhookEvent(db, {
      videoId,
      event: 'completed',
      payload: { event: 'completed', videoId },
    });

    expect(inserted.id).toBeDefined();
    expect(inserted.video_id).toBe(videoId);
    expect(inserted.event).toBe('completed');
    expect(inserted.attempts).toBe(0);
    expect(inserted.delivered_at).toBeNull();

    const due = await findDueWebhookEvents(db);
    expect(due.some((row) => row.id === inserted.id)).toBe(true);
  });

  it('marks a webhook event as delivered', async () => {
    const workspaces = await db
      .insert(workspace)
      .values({ name: `webhook-deliver-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'ai-video-v3', body: {} },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    const inserted = await insertWebhookEvent(db, {
      videoId,
      event: 'failed',
      payload: { event: 'failed', videoId },
    });

    await markWebhookDelivered(db, inserted.id);

    const due = await findDueWebhookEvents(db);
    expect(due.some((row) => row.id === inserted.id)).toBe(false);

    const rows = await db
      .select()
      .from(webhookEventTable)
      .where(eq(webhookEventTable.id, inserted.id));
    expect(rows[0]!.delivered_at).not.toBeNull();
  });

  it('schedules a retry with incremented attempts', async () => {
    const workspaces = await db
      .insert(workspace)
      .values({ name: `webhook-retry-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'ai-video-v3', body: {} },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    const inserted = await insertWebhookEvent(db, {
      videoId,
      event: 'completed',
      payload: { event: 'completed', videoId },
    });

    const nextAt = new Date(Date.now() + 30_000).toISOString();
    await scheduleWebhookRetry(db, inserted.id, nextAt);

    const rows = await db
      .select()
      .from(webhookEventTable)
      .where(eq(webhookEventTable.id, inserted.id));
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.next_at).not.toBeNull();
    const next = new Date(rows[0]!.next_at!);
    expect(next.getTime()).toBeGreaterThanOrEqual(Date.now() + 29_000);
  });
});
