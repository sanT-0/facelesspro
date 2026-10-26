/**
 * Connection factory. One place decides how the process reaches Postgres, so
 * the api, the worker, the migration runner and the tests cannot drift.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { schema } from './schema';

/** Matches `.env.example` and the compose file. */
export const DEFAULT_DATABASE_URL =
  'postgresql://faceless:faceless@127.0.0.1:5433/faceless';

export type Database = NodePgDatabase<typeof schema>;

/**
 * Load `.env` when it exists. Node can do this itself, so no dotenv dependency.
 * A missing file is normal (CI, containers, `npm run db:migrate` with real env).
 */
export function loadEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env: environment variables are authoritative.
  }
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  return url === undefined || url.length === 0 ? DEFAULT_DATABASE_URL : url;
}

export function createDb(url = databaseUrl()): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}
