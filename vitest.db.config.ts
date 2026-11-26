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

/** Integration tests that need a live Postgres (`docker compose up`). */
export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/**/*.db.test.ts', 'apps/**/*.db.test.ts'],
    environment: 'node',
    env: { DB_TESTS: '1', DATABASE_URL: databaseUrl, DATA_DIR: '/tmp/faceless-test-data' },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
