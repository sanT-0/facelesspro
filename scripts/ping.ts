/**
 * `npm run ping` — the P0 artifact check, made repeatable.
 *
 * Enqueues one `ping` job, then polls pg-boss until the worker has completed it
 * (or the deadline passes). The exit code is the answer: 0 means a worker
 * claimed a job and committed its completion against the real database.
 *
 * Usage:
 *   npm run dev:worker      # in one terminal
 *   npm run ping            # in another
 *   npm run ping -- hello   # optional note, logged by the worker
 */

import { databaseUrl, loadEnv } from '@facelesspro/db';
import { PING_QUEUE, createBoss, enqueuePing, stopBoss } from '@facelesspro/queue';

loadEnv();

const TIMEOUT_MS = 30_000;
const POLL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const boss = await createBoss({
    connectionString: databaseUrl(),
    // A one-shot CLI must not take over maintenance or cron from the worker.
    supervise: false,
    schedule: false,
  });

  try {
    const note = process.argv[2];
    const id = await enqueuePing(boss, note === undefined ? {} : { note });
    if (id === null) {
      throw new Error('pg-boss refused to enqueue the ping');
    }

    console.log(`[ping] enqueued ${id}; waiting for a worker (npm run dev:worker)`);

    const startedAt = Date.now();
    for (;;) {
      const job = await boss.getJobById(PING_QUEUE, id, { includeArchive: true });

      if (job === null) {
        throw new Error(`ping ${id} disappeared from ${PING_QUEUE}`);
      }
      if (job.state === 'completed') {
        console.log(`[ping] completed in ${Date.now() - startedAt} ms`);
        return;
      }
      if (job.state === 'failed' || job.state === 'cancelled') {
        throw new Error(`ping ${id} ended as ${job.state}`);
      }
      if (Date.now() - startedAt > TIMEOUT_MS) {
        throw new Error(
          `ping ${id} still "${job.state}" after ${TIMEOUT_MS} ms — is the worker running?`,
        );
      }

      await sleep(POLL_MS);
    }
  } finally {
    await stopBoss(boss);
  }
}

main().catch((error: unknown) => {
  console.error('[ping] failed', error);
  process.exit(1);
});
