/**
 * The worker's job wiring, in one place.
 *
 * Pipeline handlers are supplied by stable step id. A step without a handler is
 * deliberately not consumed, so work for a later P5 slice stays visible in the
 * queue instead of being falsely completed or failed.
 *
 * `startWorker` takes a `JobConsumer`, not a `PgBoss`: the tests below register
 * handlers against a fake, so the wiring is verified without a database.
 */

import { VIDEO_STEPS } from '@facelesspro/contracts';
import type { ArtStyleBuildJob, VideoStep } from '@facelesspro/contracts';
import {
  ART_STYLE_QUEUE,
  PING_QUEUE,
  consume,
  parseArtStyleJob,
  parseJob,
  queueFor,
} from '@facelesspro/queue';
import type { JobConsumer, StepHandler } from '@facelesspro/queue';

import { consumePings } from './ping';

export type WorkerLog = (line: string) => void;

export interface WorkerDeps {
  readonly boss: JobConsumer;
  /** Injected so tests capture log lines instead of writing to stdout. */
  readonly log?: WorkerLog;
  /** `build-art-style` handler; absent only in wiring tests that do not build styles. */
  readonly artStyle?: (job: ArtStyleBuildJob) => Promise<void>;
  /** Only implemented steps are present; absent queues remain untouched. */
  readonly steps?: Partial<Record<VideoStep, StepHandler>>;
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

  if (deps.artStyle !== undefined) {
    const artStyle = deps.artStyle;
    await consume(deps.boss, ART_STYLE_QUEUE, parseArtStyleJob, async ({ payload }) => {
      await artStyle(payload);
    });
    queues.push(ART_STYLE_QUEUE);
  }

  for (const step of VIDEO_STEPS) {
    const handler = deps.steps?.[step];
    if (handler === undefined) continue;
    const queue = queueFor(step);
    await consume(
      deps.boss,
      queue,
      (data) => parseJob(queue, data),
      async ({ id, payload }) => {
        await handler({ ...payload, jobId: id });
      },
    );
    queues.push(queue);
  }

  return {
    queues,
    async stop() {
      for (const queue of queues) {
        await deps.boss.offWork(queue);
      }
    },
  };
}
