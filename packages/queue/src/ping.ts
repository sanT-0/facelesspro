/**
 * The `ping` queue — a deliberately trivial job that proves the worker can
 * claim, run and complete something against a real database.
 *
 * It is **not** a pipeline step: `video.step` stays the closed set in
 * `@facelesspro/contracts`, and adding a smoke-test value there would change a
 * public contract for an operator's convenience. So `ping` is its own queue
 * with its own (tiny) payload, and `expectedQueueNames()` lists both.
 *
 * Retries are off: a ping that fails is a wiring problem, and retrying it twice
 * would only blur the diagnostic. `retentionSeconds` keeps the completed row
 * visible for a day, which is what the docs/09 artifact check looks at.
 */

import PgBoss from 'pg-boss';
import { z } from 'zod';

import { InvalidJobError } from './jobs';

export const PING_QUEUE = 'ping';

export const PING_QUEUE_OPTIONS = {
  retryLimit: 0,
  expireInSeconds: 60,
  retentionSeconds: 24 * 60 * 60,
} as const satisfies Omit<PgBoss.Queue, 'name'>;

export const pingPayloadSchema = z.strictObject({
  /** Free text that must survive the round-trip; handy for correlation. */
  note: z.string().trim().min(1).max(200).optional(),
});
export type PingPayload = z.infer<typeof pingPayloadSchema>;

export function parsePing(data: unknown): PingPayload {
  const parsed = pingPayloadSchema.safeParse(data);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) =>
        issue.path.length === 0
          ? issue.message
          : `${issue.path.join('.')}: ${issue.message}`,
      )
      .join('; ');
    throw new InvalidJobError(`invalid ping payload: ${detail}`);
  }
  return parsed.data;
}
