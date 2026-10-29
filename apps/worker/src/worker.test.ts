import { InvalidJobError, PING_QUEUE } from '@facelesspro/queue';
import type { JobConsumer } from '@facelesspro/queue';
import { describe, expect, it } from 'vitest';

import { startWorker } from './worker';

interface Subscription {
  readonly queue: string;
  readonly options: { readonly batchSize?: number };
  readonly handler: (
    jobs: ReadonlyArray<{ readonly id: string; readonly data: unknown }>,
  ) => Promise<void>;
}

function fakeBoss() {
  const subscriptions: Subscription[] = [];
  const stopped: string[] = [];

  const boss: JobConsumer = {
    async work(queue, options, handler) {
      subscriptions.push({ queue, options, handler });
      return `worker-${subscriptions.length}`;
    },
    async offWork(name) {
      stopped.push(name);
    },
  };

  return { boss, subscriptions, stopped };
}

describe('startWorker', () => {
  it('consumes exactly the ping queue while the pipeline is not built', async () => {
    const { boss, subscriptions } = fakeBoss();
    const log = () => {};

    const worker = await startWorker({ boss, log });

    expect(subscriptions.map((s) => s.queue)).toEqual([PING_QUEUE]);
    expect(worker.queues).toEqual([PING_QUEUE]);
  });

  it('logs a ping and resolves, so pg-boss marks the job completed', async () => {
    const { boss, subscriptions } = fakeBoss();
    const lines: string[] = [];
    await startWorker({ boss, log: (line) => lines.push(line) });

    await subscriptions[0]?.handler([{ id: 'job-1', data: { note: 'hello' } }]);

    expect(lines).toEqual(['[worker] ping job-1: hello']);
  });

  it('logs a bare id when the ping carries no note', async () => {
    const { boss, subscriptions } = fakeBoss();
    const lines: string[] = [];
    await startWorker({ boss, log: (line) => lines.push(line) });

    await subscriptions[0]?.handler([{ id: 'job-2', data: {} }]);

    expect(lines).toEqual(['[worker] ping job-2']);
  });

  it('fails a malformed ping loudly instead of swallowing it', async () => {
    const { boss, subscriptions } = fakeBoss();
    await startWorker({ boss, log: () => {} });

    await expect(
      subscriptions[0]?.handler([{ id: 'job-3', data: { note: 42 } }]),
    ).rejects.toThrow(InvalidJobError);
  });

  it('stops consuming every queue it started, and nothing else', async () => {
    const { boss, stopped } = fakeBoss();
    const worker = await startWorker({ boss, log: () => {} });

    await worker.stop();

    expect(stopped).toEqual([...worker.queues]);
  });
});
