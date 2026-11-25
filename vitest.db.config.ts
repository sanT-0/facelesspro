import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/** `.env` wins, then the documented compose default. */
const fileEnv = loadEnv('test', process.cwd(), '');
const databaseUrl =
  process.env.DATABASE_URL ??
  fileEnv.DATABASE_URL ??
  'postgresql://faceless:faceless@127.0.0.1:5433/faceless';

const alias = {
  '@facelesspro/core': fileURLToPath(
    new URL('./packages/core/src/index.ts', import.meta.url),
  ),
  '@facelesspro/contracts': fileURLToPath(
    new URL('./packages/contracts/src/index.ts', import.meta.url),
  ),
  '@facelesspro/db': fileURLToPath(
    new URL('./packages/db/src/index.ts', import.meta.url),
  ),
  '@facelesspro/queue': fileURLToPath(
    new URL('./packages/queue/src/index.ts', import.meta.url),
  ),
};

/**
 * Integration tests that need a live Postgres (`docker compose up`).
 *
 * Separate from `npm run gate` on purpose: unit tests must run with no network
 * and no services, so a missing database can never be mistaken for a passing
 * gate. `DB_TESTS=1` is what tells a test file it may connect.
 *
 * Loads .env so that LIVE=1 uses the configured provider chains (planner/image/TTS).
 */
export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/**/*.db.test.ts', 'apps/**/*.db.test.ts'],
    environment: 'node',
    env: { DB_TESTS: '1', DATABASE_URL: databaseUrl },
    // Suites isolate application rows by workspace, but pg-boss queue names are
    // global. Parallel files that both purge `create-vocal` can erase the other
    // suite's just-enqueued artifact and turn a good atomic commit into a false
    // failure.
    fileParallelism: false,
    // Real transactions, real queues: a cold pg-boss start is not a unit test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
