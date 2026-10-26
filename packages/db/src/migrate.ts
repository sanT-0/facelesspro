/**
 * `npm run db:migrate` — apply committed SQL, then seed.
 *
 * The seed runs after the migration runner because built-ins are part of a
 * usable database: a clean clone should be able to create a video without any
 * extra step. Both halves are idempotent, so running this twice is a no-op.
 */

import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb, loadEnv } from './client';
import { seedBuiltins } from './seed';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

async function main(): Promise<void> {
  loadEnv();
  const { db, pool } = createDb();

  try {
    await migrate(db, { migrationsFolder });
    const result = await seedBuiltins(db);

    const tables = await pool.query<{ count: string }>(
      "select count(*)::text as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );
    const versions = await pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );

    console.log(
      `db: ${tables.rows[0]?.count ?? '?'} tables, ` +
        `${versions.rows[0]?.count ?? '?'} migrations applied, ` +
        `${result.templates} new caption templates`,
    );
    if (tables.rows[0]?.count !== '17') {
      throw new Error(
        `expected 17 tables, found ${tables.rows[0]?.count ?? '0'} — schema drift`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
