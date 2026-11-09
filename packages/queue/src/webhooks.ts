/**
 * `webhook-delivery` — the queue behind outbound webhook delivery.
 *
 * Not a video step: no `video.step` cursor, no `job_lock`, no charge. It is
 * its own pg-boss queue so a slow receiver never blocks the pipeline.
 *
 * `singletonKey: videoId` makes a duplicate enqueue for the same video a
 * no-op while a delivery is still queued or active. The `webhook_event` row
 * (attempts + next_at) is the authoritative guard for delivery state.
 *
 * Retry policy: 10 attempts with the documented backoff schedule (~24 h
 * total), matching docs/01 §9 and docs/07 §3.
 */

import type PgBoss from 'pg-boss';

import { InvalidJobError } from './jobs';
import type { EnqueueOptions } from './boss';

export const WEBHOOK_QUEUE = 'webhook-delivery';

/**
 * First attempt immediately, then these gaps. Nine gaps + the first attempt =
 * the ten attempts documented in the spec (~24 h total).
 */
export const WEBHOOK_QUEUE_OPTIONS = {
  // Retries are handled manually in processWebhookDelivery so we can follow
  // the documented schedule (30 s, 2 m, 10 m, 30 m, 1 h, 2 h, 4 h, 8 h, 8 h)
  // rather than pg-boss's exponential backoff.
  retryLimit: 0,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 23 * 60 * 60,
  retentionSeconds: 2 * 24 * 60 * 60,
} as const satisfies Omit<PgBoss.Queue, 'name'>;

export interface WebhookDeliveryJob {
  readonly videoId: string;
  readonly event: 'completed' | 'failed';
  /** The webhook body payload: `{ event, video }` at delivery time. */
  readonly payload: Record<string, unknown>;
}

/** Parse a job off the queue. A malformed payload is a producer bug. */
export function parseWebhookJob(data: unknown): WebhookDeliveryJob {
  const row = data as { readonly videoId?: unknown; readonly event?: unknown; readonly payload?: unknown };
  if (
    typeof row.videoId !== 'string' ||
    (row.event !== 'completed' && row.event !== 'failed')
  ) {
    throw new InvalidJobError(`invalid ${WEBHOOK_QUEUE} job: missing videoId or event`);
  }
  return {
    videoId: row.videoId,
    event: row.event,
    payload: row.payload as Record<string, unknown>,
  };
}

/**
 * Enqueue one webhook delivery. The job insert goes through the caller's open
 * transaction so the webhook_event row and the delivery job commit together.
 */
export async function enqueueWebhook(
  boss: PgBoss,
  job: WebhookDeliveryJob,
  options: EnqueueOptions = {},
): Promise<string | null> {
  return boss.send(WEBHOOK_QUEUE, job, {
    ...WEBHOOK_QUEUE_OPTIONS,
    singletonKey: job.videoId,
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.startAfter === undefined ? {} : { startAfter: options.startAfter }),
  });
}
