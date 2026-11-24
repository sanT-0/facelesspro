/**
 * Container entrypoint migration runner.
 *
 * Unlike `migrate.ts` (the `npm run db:migrate` path, which also seeds and
 * asserts the expected table count), this only applies committed SQL. It runs
 * before every long-lived service starts so no service can boot against a
 * stale schema. Applying the same migrations twice is a no-op.
 */

import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb, loadEnv } from './client';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

async function main(): Promise<void> {
  loadEnv();
  const { db, pool } = createDb();

  try {
    await migrate(db, { migrationsFolder });
    console.log('[migrate] migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] failed:', error);
  process.exit(1);
});
