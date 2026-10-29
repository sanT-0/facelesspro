/**
 * `facelesspro-api` entry point: wire the real probes, serve, shut down cleanly.
 *
 * The pool is the same one `@facelesspro/db` gives every process, so the health
 * check tests the connection path the routes will actually use.
 */

import { createDb, loadEnv } from '@facelesspro/db';
import { checkQueues } from '@facelesspro/queue';
import { serve } from '@hono/node-server';
import { artStyle } from '@facelesspro/db';

import { createApp } from './app';

loadEnv();

const port = Number(process.env.PORT ?? 3001);
const { db, pool } = createDb();
const queueSchema = process.env.PGBOSS_SCHEMA || undefined;

const app = createApp({
  probes: {
    db: async () => {
      await pool.query('select 1');
    },
    queue: async () => {
      await checkQueues(pool, queueSchema === undefined ? {} : { schema: queueSchema });
    },
  },
  db: {
    insertArtStyle: async (row) => {
      // created_at has a default of now(), so omit it from the insert
      const { created_at: _createdAt, ...insertRow } = row;
      await db.insert(artStyle).values({
        ...insertRow,
        formats: insertRow.formats as ('landscape' | 'portrait')[],
      });
    },
  },
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`facelesspro-api listening on http://127.0.0.1:${info.port}`);
});

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[api] ${signal} — closing`);
  server.close();
  await pool.end();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
