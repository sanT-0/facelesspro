/**
 * The `ping` consumer — the smallest thing that proves the worker is alive.
 *
 * The handler writes one log line and returns. Its completion row in
 * `pgboss.job` is the artifact: `npm run ping` enqueues a job and waits for
 * exactly that state, so "the worker is running" is a fact about the database
 * rather than about a process the operator forgot to restart.
 */

import { PING_QUEUE, consume, parsePing } from '@facelesspro/queue';
import type { JobConsumer } from '@facelesspro/queue';

export async function consumePings(
  boss: JobConsumer,
  log: (line: string) => void,
): Promise<string> {
  return consume(boss, PING_QUEUE, parsePing, async ({ id, payload }) => {
    log(
      payload.note === undefined
        ? `[worker] ping ${id}`
        : `[worker] ping ${id}: ${payload.note}`,
    );
  });
}
