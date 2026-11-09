/**
 * Outbound webhook delivery (docs/01 §9, docs/07 §3).
 *
 * Delivers `{ event, video }` to the `webhook_url` stored on the video row.
 * Signs the body with HMAC-SHA256 (`t=<ts>,v1=<hex>`), guards against SSRF
 * (no private/loopback IPs), and enforces a 10 s timeout.
 *
 * Retries follow the documented schedule: 30 s, 2 m, 10 m, 30 m, 1 h, 2 h,
 * 4 h, 8 h, 8 h (~24 h total). Unsigned mode is available for compatibility:
 * if `WEBHOOK_SECRET` is unset, the `X-Faceless-Signature` header is omitted.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  video,
  webhookEvent as webhookEventTable,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  WEBHOOK_QUEUE,
  WEBHOOK_QUEUE_OPTIONS,
} from '@facelesspro/queue';
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_MS,
} from '@facelesspro/contracts';

/** HMAC secret for signing. Unset = unsigned mode (compatibility). */
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

/** Minimal structural type for the boss: enough to enqueue delivery jobs.
 * The worker must not import pg-boss directly; `PgBoss` satisfies this shape.
 */
interface WebhookEnqueuer {
  send(
    queue: string,
    data: unknown,
    options: Record<string, unknown>,
  ): Promise<string | null>;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  return (
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host === '[::1]'
  );
}

/** Block private IP ranges (RFC 1918) at delivery time: DNS can change. */
function isPrivateIp(hostname: string): boolean {
  if (isLoopbackHost(hostname)) return true;
  return (
    hostname.startsWith('10.') ||
    hostname.startsWith('172.16.') ||
    hostname.startsWith('172.17.') ||
    hostname.startsWith('172.18.') ||
    hostname.startsWith('172.19.') ||
    hostname.startsWith('172.20.') ||
    hostname.startsWith('172.21.') ||
    hostname.startsWith('172.22.') ||
    hostname.startsWith('172.23.') ||
    hostname.startsWith('172.24.') ||
    hostname.startsWith('172.25.') ||
    hostname.startsWith('172.26.') ||
    hostname.startsWith('172.27.') ||
    hostname.startsWith('172.28.') ||
    hostname.startsWith('172.29.') ||
    hostname.startsWith('172.30.') ||
    hostname.startsWith('172.31.') ||
    hostname.startsWith('192.168.')
  );
}

/** Sign the body: `t=<ts>,v1=<hmac_sha256(secret, t + "." + body)>`. */
function signBody(body: string): { readonly headers: Record<string, string> } {
  const timestamp = Math.trunc(Date.now() / 1000);
  const payload = `${timestamp}.${body}`;
  const digest = createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return {
    headers: {
      'content-type': 'application/json',
      'X-Faceless-Signature': `t=${timestamp},v1=${digest}`,
    },
  };
}

/** Build the webhook `video` object from a stored row. */
function buildVideoObject(
  row: Record<string, unknown>,
  baseUrl: string,
): Record<string, unknown> {
  const request = row.request as
    | { readonly kind: string; readonly body: Record<string, unknown> }
    | undefined;
  const render = request?.body.render !== undefined;
  const storedUrl = row.video_url as string | null | undefined;
  const videoUrl =
    storedUrl !== null && storedUrl !== undefined
      ? storedUrl.startsWith('http')
        ? storedUrl
        : `${baseUrl}/files/${storedUrl}`
      : undefined;

  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    step: row.step,
    render,
    videoUrl,
    durationMs: row.duration_ms,
    error: row.error,
    editorUrl: `${baseUrl}/editor?id=${row.id}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deliver one webhook event. Returns `true` when the receiver answered 2xx
 * (delivered). Throws on any non-2xx, timeout, DNS or TLS failure so the
 * caller can schedule a retry.
 */
export async function deliverWebhook(
  db: Database,
  eventRow: {
    readonly video_id: string;
    readonly event: 'completed' | 'failed';
    readonly payload: Record<string, unknown>;
  },
): Promise<boolean> {
  // Fetch the video row to build the `video` object.
  const rows = await db
    .select()
    .from(video)
    .where(eq(video.id, eventRow.video_id))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    // Video was deleted; nothing to deliver. Mark as delivered to stop retrying.
    return true;
  }

  const baseUrl =
    process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:3001';

  const videoObj = buildVideoObject(row as Record<string, unknown>, baseUrl);
  const body = JSON.stringify({ event: eventRow.event, video: videoObj });

  const webhookUrl = row.webhook_url as string | null;
  if (!webhookUrl) {
    // No callback URL: nothing to deliver.
    return true;
  }

  const url = new URL(webhookUrl);
  if (url.protocol !== 'https:') {
    throw new Error(`webhookUrl must be https, got ${url.protocol}`);
  }
  if (isPrivateIp(url.hostname)) {
    throw new Error(`webhookUrl points at a private/loopback host: ${url.hostname}`);
  }

  const headers = WEBHOOK_SECRET.length > 0 ? signBody(body).headers : {
    'content-type': 'application/json',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (response.status >= 200 && response.status < 300) {
      return true;
    }
    throw new Error(`webhook returned HTTP ${response.status}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Process one webhook delivery job from the queue. Reads the current attempt
 * count from the `webhook_event` row, delivers, and on failure schedules the
 * next retry using the documented backoff schedule.
 *
 * Returns `true` when the delivery succeeded or should not be retried
 * (max attempts reached, no webhook URL, video deleted).
 */
export async function processWebhookDelivery(
  db: Database,
  boss: WebhookEnqueuer,
  job: {
    readonly videoId: string;
    readonly event: 'completed' | 'failed';
    readonly payload: Record<string, unknown>;
  },
): Promise<boolean> {
  // Read the current attempt count from the webhook_event row.
  const rows = await db
    .select()
    .from(webhookEventTable)
    .where(
      and(
        eq(webhookEventTable.video_id, job.videoId),
        eq(webhookEventTable.event, job.event),
        isNull(webhookEventTable.delivered_at),
      ),
    )
    .orderBy(webhookEventTable.attempts)
    .limit(1);

  const eventRow = rows[0];
  if (eventRow === undefined) {
    // No pending event for this video; nothing to do.
    return true;
  }

  const attempt = eventRow.attempts;

  // If we've exhausted all attempts, stop retrying.
  if (attempt >= WEBHOOK_MAX_ATTEMPTS) {
    return true;
  }

  try {
    const delivered = await deliverWebhook(db, {
      video_id: job.videoId,
      event: job.event,
      payload: job.payload,
    });

    if (delivered) {
      await markWebhookDelivered(db, eventRow.id);
      return true;
    }

    return false;
  } catch (error) {
    // Schedule the next retry using the documented schedule.
    // attempt is 0-based: the first retry (attempt 1) uses schedule[0].
    const scheduleIndex = Math.min(attempt, WEBHOOK_RETRY_SCHEDULE_MS.length - 1);
    const gapMs = WEBHOOK_RETRY_SCHEDULE_MS[scheduleIndex]!;
    const nextAt = new Date(Date.now() + gapMs);

    await scheduleWebhookRetry(db, eventRow.id, nextAt);

    // Re-enqueue for delivery at nextAt.
    await boss.send(WEBHOOK_QUEUE, job, {
      ...WEBHOOK_QUEUE_OPTIONS,
      singletonKey: job.videoId,
      startAfter: nextAt,
    });

    throw error; // let pg-boss know the job failed
  }
}

/**
 * Find webhook events due for delivery. Used by the poll loop as a fallback
 * for events whose jobs were lost.
 */
export async function findDueWebhookEvents(
  db: Database,
): Promise<Array<{
  readonly id: string;
  readonly video_id: string;
  readonly event: 'completed' | 'failed';
  readonly payload: Record<string, unknown>;
}>> {
  const rows = await db
    .select()
    .from(webhookEventTable)
    .where(and(isNull(webhookEventTable.delivered_at)))
    .orderBy(webhookEventTable.next_at);

  const now = new Date();
  return rows
    .filter(
      (row) => new Date(row.next_at) <= now && row.attempts < 10,
    )
    .map((row) => ({
      id: row.id,
      video_id: row.video_id,
      event: row.event,
      payload: row.payload,
    }));
}

/** Mark one webhook event as delivered. */
export async function markWebhookDelivered(
  db: Database,
  id: string,
): Promise<void> {
  await db
    .update(webhookEventTable)
    .set({ delivered_at: sql`now()` })
    .where(eq(webhookEventTable.id, id));
}

/** Increment attempts and set the next attempt time. */
export async function scheduleWebhookRetry(
  db: Database,
  id: string,
  nextAt: Date,
): Promise<void> {
  await db
    .update(webhookEventTable)
    .set({
      attempts: sql`${webhookEventTable.attempts} + 1`,
      next_at: nextAt.toISOString(),
    })
    .where(eq(webhookEventTable.id, id));
}

/**
 * Constant-time comparison for signature verification (used by receivers).
 */
export function verifySignature(
  timestampSeconds: number,
  body: string,
  signature: string,
): boolean {
  const expected = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestampSeconds}.${body}`)
    .digest('hex');
  const provided = signature.split(',').find((part) => part.startsWith('v1='))?.slice(3);
  if (provided === undefined || provided.length !== 64) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
}
