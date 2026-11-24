/**
 * `npm run db:migrate` — apply committed SQL, then seed.
 *
 * The seed runs after the migration runner because built-ins are part of a
 * usable database: a clean clone should be able to create a video without any
 * extra step. Both halves are idempotent, so running this twice is a no-op.
 *
 * The same work happens on container boot (`migrate-on-boot.ts`); both call
 * `prepareDatabase` so the two paths cannot drift. This one is the host script
 * and additionally treats a table-count mismatch as schema drift.
 */

import { loadEnv } from './client';
import { EXPECTED_TABLE_COUNT, prepareDatabase } from './setup';

async function main(): Promise<void> {
  loadEnv();
  const result = await prepareDatabase({
    onStep: (step) => console.log(`db: ${step}...`),
  });

  console.log(
    `db: ${result.tableCount} tables, ` +
      `${result.migrationsApplied} migrations applied, ` +
      `${result.seeded.templates} new caption templates`,
  );
  if (result.tableCount !== EXPECTED_TABLE_COUNT) {
    throw new Error(
      `expected ${EXPECTED_TABLE_COUNT} tables, found ${result.tableCount} — schema drift`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
