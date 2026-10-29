import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
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
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    // Integration suites are opt-in (`npm run test:db`, live Postgres).
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.db.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
