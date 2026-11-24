/**
 * Container entrypoint database setup: apply committed SQL, then seed.
 *
 * Runs before every long-lived service starts, so no service can boot against a
 * stale schema or an unseeded database. Locked and idempotent — see `setup.ts`
 * for why both matter.
 */

import { databaseUrl, loadEnv } from './client';
import { prepareDatabase } from './setup';

async function main(): Promise<void> {
  loadEnv();
  const result = await prepareDatabase({
    connectionString: databaseUrl(),
    onStep: (step) => console.log(`[migrate] ${step}...`),
  });

  console.log(
    `[migrate] ready: ${result.tableCount} tables, ` +
      `${result.migrationsApplied} migrations, ` +
      `${result.seeded.templates} new caption templates`,
  );
}

main().catch((error: unknown) => {
  console.error('[migrate] failed:', error);
  process.exit(1);
});
