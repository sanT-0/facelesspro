/**
 * One definition of "the database is ready": committed SQL applied and the
 * built-ins seeded.
 *
 * Both callers share it so they cannot drift:
 *
 *  - `migrate.ts` — the `npm run db:migrate` path on a host.
 *  - `migrate-on-boot.ts` — the container entrypoint, run by every service.
 *
 * Two things here are not incidental:
 *
 * **The advisory lock.** Compose starts api, worker, render and mcp at the same
 * instant, so on a *fresh* database all four call `migrate()` together and race
 * to `CREATE TYPE`. Observed on a cold clone: three services won, the api hit
 * `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`
 * and only recovered because `restart: unless-stopped` gave it a second attempt.
 * A session-level advisory lock serialises the boot instead; Postgres releases
 * it automatically if a process dies holding it.
 *
 * **The seed.** Migrations alone leave a database that cannot be used: no dev
 * workspace (so `key:create` fails with `workspace ... does not exist`) and no
 * caption templates (so `create-captions` has no default). It is idempotent, so
 * running it on every boot is a no-op after the first.
 */

import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb, databaseFor } from './client';
import type { Database } from './client';
import { seedBuiltins } from './seed';
import type { SeedResult } from './seed';

/** Resolved from this module so neither caller can point at the wrong folder. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Stable, arbitrary `pg_advisory_lock` key. Every process that may migrate uses
 * the same number; changing it would let an old and a new deployment migrate at
 * the same time, which is the race this exists to prevent.
 */
const MIGRATION_LOCK_KEY = 8_227_331_001;

/** The schema this repository ships; `db:migrate` treats a mismatch as drift. */
export const EXPECTED_TABLE_COUNT = 18;

export interface DatabaseSetup {
  readonly seeded: SeedResult;
  /** Rows in `drizzle.__drizzle_migrations` after the run. */
  readonly migrationsApplied: number;
  /** Base tables in the `public` schema after the run. */
  readonly tableCount: number;
}

export interface PrepareOptions {
  /** Defaults to `DATABASE_URL`, then the documented compose default. */
  readonly connectionString?: string;
  /** Called for each stage; keeps the two callers' log wording their own. */
  readonly onStep?: (step: 'migrating' | 'seeding') => void;
}

async function countSetupProgress(db: Database): Promise<{
  migrationsApplied: number;
  tableCount: number;
}> {
  const tables = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `);
  const versions = await db.execute<{ count: string }>(sql`
    select count(*)::text as count from drizzle.__drizzle_migrations
  `);
  return {
    migrationsApplied: Number(versions.rows[0]?.count ?? 0),
    tableCount: Number(tables.rows[0]?.count ?? 0),
  };
}

/**
 * Apply migrations and seed built-ins, serialised against other boots.
 *
 * The lock is taken on one checked-out connection and the whole run uses that
 * same connection: a session-level advisory lock belongs to a session, so
 * letting `migrate()` borrow a different pool member would release nothing.
 */
export async function prepareDatabase(options: PrepareOptions = {}): Promise<DatabaseSetup> {
  const { pool } = createDb(options.connectionString);
  const client = await pool.connect();

  try {
    await client.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    const db = databaseFor(client);

    options.onStep?.('migrating');
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    options.onStep?.('seeding');
    const seeded = await seedBuiltins(db);

    return { seeded, ...(await countSetupProgress(db)) };
  } finally {
    // Unlock before release; the release alone would also do it, but an
    // explicit unlock keeps the intent readable in a stack trace.
    await client
      .query('select pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
    await pool.end();
  }
}
