import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
 */
export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/**/*.db.test.ts'],
    environment: 'node',
    env: { DB_TESTS: '1' },
    // Real transactions, real queues: a cold pg-boss start is not a unit test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
