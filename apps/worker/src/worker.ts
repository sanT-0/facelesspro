/**
 * The worker's job wiring, in one place.
 *
 * Deliberately empty of pipeline steps: `create-scenes` … `render` land in P5
 * together with the ports they call. Until then the worker consumes only the
 * `ping` queue, so a step job that *is* enqueued stays visible in `pgboss.job`
 * as unprocessed work instead of being failed by a handler that does not exist
 * yet. That is the honest failure mode for a skeleton.
 *
 * `startWorker` takes a `JobConsumer`, not a `PgBoss`: the tests below register
 * handlers against a fake, so the wiring is verified without a database.
 */

import { PING_QUEUE } from '@facelesspro/queue';
import type { JobConsumer } from '@facelesspro/queue';

import { consumePings } from './ping';

export type WorkerLog = (line: string) => void;

export interface WorkerDeps {
  readonly boss: JobConsumer;
  /** Injected so tests capture log lines instead of writing to stdout. */
  readonly log?: WorkerLog;
}

export interface WorkerHandle {
  /** Queues this process is consuming; logged at boot and asserted by tests. */
  readonly queues: readonly string[];
  /** Stop consuming, without closing the boss (the caller owns it). */
  stop(): Promise<void>;
}

export async function startWorker(deps: WorkerDeps): Promise<WorkerHandle> {
  const log: WorkerLog = deps.log ?? ((line) => console.log(line));
  const queues: string[] = [PING_QUEUE];

  await consumePings(deps.boss, log);

  return {
    queues,
    async stop() {
      for (const queue of queues) {
        await deps.boss.offWork(queue);
      }
    },
  };
}
