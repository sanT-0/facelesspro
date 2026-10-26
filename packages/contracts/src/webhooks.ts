/**
 * Outbound webhooks (docs/01 §9, docs/07 §3).
 *
 * The body contains the same `video` object as `GET /v1/videos/:id`; that is a
 * parity requirement, so it is imported rather than redefined. Delivery is
 * at-least-once, so a receiver must dedupe on `X-Faceless-Event-Id`.
 */

import { z } from 'zod';

import { videoResponseSchema } from './responses';

export const WEBHOOK_EVENT_HEADER = 'X-Faceless-Event-Id';
export const WEBHOOK_SIGNATURE_HEADER = 'X-Faceless-Signature';

/** Only terminal transitions are notified. Render finishing fires again. */
export const webhookEventNameSchema = z.enum(['completed', 'failed']);
export type WebhookEventName = z.infer<typeof webhookEventNameSchema>;

export const webhookEventSchema = z.strictObject({
  event: webhookEventNameSchema,
  video: videoResponseSchema,
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const webhookEventIdSchema = z
  .string()
  .regex(/^evt_[0-9a-fA-F-]{36}$/, 'expected evt_<uuid>');

/**
 * First attempt immediately, then these gaps. Nine gaps + the first attempt =
 * the ten attempts documented in the spec (≈24 h total).
 */
export const WEBHOOK_RETRY_SCHEDULE_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
  8 * 60 * 60_000,
] as const;

export const WEBHOOK_MAX_ATTEMPTS = 10;
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** `t=1690000000,v1=<hmac_sha256(secret, t + "." + body)>` */
export const webhookSignatureSchema = z
  .string()
  .regex(/^t=\d{1,12},v1=[0-9a-f]{64}$/);

export function webhookSigningPayload(timestampSeconds: number, body: string): string {
  return `${Math.trunc(timestampSeconds)}.${body}`;
}

export function formatSignatureHeader(
  timestampSeconds: number,
  hexDigest: string,
): string {
  return `t=${Math.trunc(timestampSeconds)},v1=${hexDigest}`;
}
