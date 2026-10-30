/**
 * `facelesspro-worker` entry point.
 *
 * One boss, one process, graceful drain on Ctrl-C: finishing the job in hand is
 * cheaper than letting it expire and be re-fetched (every step is idempotent, so
 * both work — one just wastes a minute).
 */

import { createDb, databaseUrl, loadEnv } from '@facelesspro/db';
import { createBoss, stopBoss } from '@facelesspro/queue';

import { startWorker } from './worker';
import { createArtStyleBuildHandler } from './art-style/runtime';

loadEnv();

async function main(): Promise<void> {
  const schema = process.env.PGBOSS_SCHEMA || undefined;
  const boss = await createBoss({
    connectionString: databaseUrl(),
    ...(schema === undefined ? {} : { schema }),
  });

  const { db, pool } = createDb();

  const worker = await startWorker({
    boss,
    artStyle: createArtStyleBuildHandler({ db, env: process.env }),
  });
  console.log(`[worker] consuming ${worker.queues.join(', ')}`);

  let stopping = false;

  async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} — draining`);
    await worker.stop();
    await stopBoss(boss);
    await pool.end();
    process.exit(0);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

main().catch((error: unknown) => {
  console.error('[worker] fatal', error);
  process.exit(1);
});
