/**
 * Webhook event persistence (docs/01 §9, docs/07 §3).
 *
 * One row per (video, terminal event). A delivery worker polls for due events
 * (`next_at <= now` AND `delivered_at IS NULL`), delivers via HTTP, then marks
 * the row delivered or schedules a retry.
 *
 * The api may not import `drizzle-orm` or `pg` (eslint enforces the boundary),
 * so API-facing queries live here and are injected into routes/workers as plain
 * functions.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import type { WebhookEventRow } from '@facelesspro/contracts';

import type { Database } from './client';
import { webhookEvent } from './schema';

export interface InsertWebhookEventInput {
  readonly videoId: string;
  readonly event: 'completed' | 'failed';
  /** The webhook body: `{ event, video }`. Stored as-is for delivery. */
  readonly payload: Record<string, unknown>;
}

/**
 * Insert one webhook event row. Returns the committed row.
 */
export async function insertWebhookEvent(
  db: Database,
  input: InsertWebhookEventInput,
): Promise<WebhookEventRow> {
  const rows = await db
    .insert(webhookEvent)
    .values({
      video_id: input.videoId,
      event: input.event,
      attempts: 0,
      next_at: sql`now()`,
      payload: input.payload,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('webhook event insert returned no row');
  return row as unknown as WebhookEventRow;
}

/**
 * Find webhook events due for delivery: not yet delivered, next attempt at or
 * before now, and attempts below the maximum.
 */
export async function findDueWebhookEvents(
  db: Database,
): Promise<WebhookEventRow[]> {
  const rows = await db
    .select()
    .from(webhookEvent)
    .where(and(isNull(webhookEvent.delivered_at)))
    .orderBy(webhookEvent.next_at);
  const now = new Date();
  return rows
    .filter(
      (row) => new Date(row.next_at) <= now && row.attempts < 10,
    )
    .map((row) => row as unknown as WebhookEventRow);
}

/** Mark one webhook event as delivered. */
export async function markWebhookDelivered(
  db: Database,
  id: string,
): Promise<void> {
  await db
    .update(webhookEvent)
    .set({ delivered_at: sql`now()` })
    .where(eq(webhookEvent.id, id));
}

/** Increment attempts and set the next attempt time. */
export async function scheduleWebhookRetry(
  db: Database,
  id: string,
  nextAt: string,
): Promise<void> {
  await db
    .update(webhookEvent)
    .set({
      attempts: sql`${webhookEvent.attempts} + 1`,
      next_at: nextAt,
    })
    .where(eq(webhookEvent.id, id));
}
