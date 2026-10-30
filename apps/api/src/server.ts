/**
 * `facelesspro-api` entry point: wire the real probes, serve, shut down cleanly.
 *
 * The pool is the same one `@facelesspro/db` gives every process, so the health
 * check tests the connection path the routes will actually use.
 */

import { resolve } from 'node:path';

import { artStyle, createDb, databaseFor, databaseUrl, loadEnv } from '@facelesspro/db';
import {
  checkQueues,
  createBoss,
  enqueueArtStyleBuild,
  stopBoss,
} from '@facelesspro/queue';
import { serve } from '@hono/node-server';

import { createApp } from './app';
import type { ArtStyleSubmission } from './art-styles';

loadEnv();

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3001);
  const queueSchema = process.env.PGBOSS_SCHEMA || undefined;
  const connectionString = databaseUrl();
  const { pool } = createDb(connectionString);
  let bossPromise: ReturnType<typeof createBoss> | undefined;

  // Keep startup lazy: `/health` must still come up as 503 when Postgres is
  // unavailable instead of the whole API process exiting before it can report
  // the failing component. A recovered database gets a fresh initialization
  // attempt because a rejected promise is not cached.
  const producer = (): ReturnType<typeof createBoss> => {
    if (bossPromise === undefined) {
      bossPromise = createBoss({
        connectionString,
        ...(queueSchema === undefined ? {} : { schema: queueSchema }),
        // The worker owns expiry/schedule maintenance. This process only produces.
        supervise: false,
        schedule: false,
      }).catch((error: unknown) => {
        bossPromise = undefined;
        throw error;
      });
    }
    return bossPromise;
  };

  const submitArtStyle = async (submission: ArtStyleSubmission): Promise<void> => {
    const boss = await producer();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const txDb = databaseFor(client);
      await txDb.insert(artStyle).values(submission.row);
      await enqueueArtStyleBuild(boss, submission.job, {
        db: {
          executeSql: async (text, values) => {
            const result = await client.query(text, values);
            return { rows: result.rows };
          },
        },
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const app = createApp({
    probes: {
      db: async () => {
        await pool.query('select 1');
      },
      queue: async () => {
        await checkQueues(pool, queueSchema === undefined ? {} : { schema: queueSchema });
      },
    },
    storageRoot: resolve(process.env.DATA_DIR?.trim() || '.data'),
    submitArtStyle,
  });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`facelesspro-api listening on http://127.0.0.1:${info.port}`);
  });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`[api] ${signal} — closing`);
    server.close();
    const activeBoss = bossPromise;
    if (activeBoss !== undefined) {
      await activeBoss.then(stopBoss).catch(() => undefined);
    }
    await pool.end();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

main().catch((error: unknown) => {
  console.error('[api] fatal', error);
  process.exit(1);
});
