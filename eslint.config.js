/**
 * Lint = the rules AGENTS.md states in prose, made executable.
 *
 * Two jobs, in order of importance:
 *
 *   1. **Boundaries.** `packages/core` is pure (relative imports only, no clock,
 *      no randomness), `contracts` may only depend on zod, and nobody reaches
 *      into another package's `src/` — the barrel is the public surface.
 *   2. **Hygiene.** The typescript-eslint recommended set, which is where
 *      `no-explicit-any` and unused-code checks live.
 *
 * There is deliberately no formatting rule here: the repo has no formatter and
 * adding one would rewrite every file. Lint is about correctness and direction
 * of dependencies, not commas.
 *
 * Flat config, ESM (the root package is `"type": "module"`). ESLint 10 +
 * typescript-eslint 8; no type-aware linting, so `npm run lint` stays in
 * seconds and needs no project build.
 */

import tseslint from 'typescript-eslint';

const WORKSPACE = '@facelesspro/*';

/** Import only through the package barrel; deep paths are implementation. */
const NO_DEEP_IMPORTS = {
  group: [`${WORKSPACE}/src/*`, `${WORKSPACE}/dist/*`],
  message: 'Import the package barrel (@facelesspro/name), not a deep path.',
};

/** Packages may not depend on an app. */
const NO_APP_IMPORTS = {
  group: ['@facelesspro/api', '@facelesspro/api/*', '@facelesspro/worker', '@facelesspro/worker/*'],
  message: 'A package may not import an app. Dependencies point inward.',
};

function restrictedImports(patterns) {
  return ['error', { patterns: [NO_DEEP_IMPORTS, NO_APP_IMPORTS, ...patterns] }];
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.data/**',
      '**/coverage/**',
      'packages/db/migrations/**',
      // Generated artifacts, Python service, committed fixtures: not linted here.
      'samples/**',
      'services/**',
      'fixtures/**',
    ],
  },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // AGENTS.md: "No `any` in new code; `unknown` + a zod parse."
      '@typescript-eslint/no-explicit-any': 'error',
      // `require()` in an ESM repo is always a mistake.
      '@typescript-eslint/no-require-imports': 'error',
    },
  },

  {
    // `packages/core` is pure: no I/O, no network, no clock, no deps.
    //
    // The package has no runtime dependencies at all, so the import rule lists
    // the things that would *silently* work anyway: node built-ins, a vendor
    // that another package happens to install, and our own packages. The globals
    // rules below are the part that cannot be caught later by `tsc`.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports([
        {
          group: [
            '@facelesspro/*',
            'node:*',
            'fs',
            'fs/*',
            'path',
            'url',
            'child_process',
            'zod',
            'pg',
            'pg-boss',
            'drizzle-orm',
            'drizzle-orm/*',
            'hono',
            '@hono/*',
            'dotenv',
            'vitest',
            'fast-check',
          ],
          message:
            'packages/core is dependency-free: import only relative files from this package.',
        },
      ]),
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'core takes time as an argument; never reads the clock.' },
        { name: 'process', message: 'core has no environment.' },
        { name: 'fetch', message: 'core does no I/O.' },
        { name: 'setTimeout', message: 'core does not schedule work.' },
        { name: 'setInterval', message: 'core does not schedule work.' },
        { name: 'crypto', message: 'core is deterministic; ids and salts are arguments.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'core is deterministic; randomness is an argument.' },
        { object: 'performance', property: 'now', message: 'core takes time as an argument.' },
      ],
    },
  },

  {
    // Contracts are shapes: zod and relative modules, nothing else.
    files: ['packages/contracts/src/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports([
        {
          group: [
            '@facelesspro/*',
            'node:*',
            'pg',
            'pg-boss',
            'drizzle-orm',
            'drizzle-orm/*',
            'hono',
            '@hono/*',
            'dotenv',
            'vitest',
            'fast-check',
          ],
          message: 'packages/contracts may import zod and its own modules only.',
        },
      ]),
    },
  },

  {
    // The data layer owns drizzle + pg.
    files: ['packages/db/src/**/*.ts', 'packages/db/drizzle.config.ts'],
    rules: {
      'no-restricted-imports': restrictedImports([
        {
          group: ['@facelesspro/core', '@facelesspro/queue', 'pg-boss', 'hono', '@hono/*', '**/apps/**'],
          message: 'packages/db is the data layer: it may not depend on the pipeline or an app.',
        },
      ]),
    },
  },

  {
    // The queue owns pg-boss; everything else goes through it.
    files: ['packages/queue/src/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports([
        {
          group: ['@facelesspro/core', 'hono', '@hono/*', '**/apps/**'],
          message: 'packages/queue may depend on contracts + db, not on core or an app.',
        },
      ]),
    },
  },

  {
    // The api talks to Postgres and pg-boss through the packages, never directly.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports([
        {
          group: ['pg-boss', 'drizzle-orm', 'drizzle-orm/*', 'pg', 'pg/*'],
          message:
            'Import @facelesspro/db or @facelesspro/queue instead: the api must not know the vendor.',
        },
      ]),
    },
  },

  {
    // The worker may query through db/drizzle, but the broker is queue's job.
    files: ['apps/worker/src/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports([
        {
          group: ['pg-boss', 'pg', 'pg/*'],
          message: 'Consume jobs through @facelesspro/queue: the worker must not know the broker.',
        },
      ]),
    },
  },

  {
    // Tests load fixtures with fs and build fixtures with whatever they need.
    files: ['**/*.test.ts', '**/*.db.test.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
);
