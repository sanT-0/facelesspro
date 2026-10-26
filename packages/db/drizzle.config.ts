import { defineConfig } from 'drizzle-kit';

/**
 * Run from the repo root:
 *   npm run db:generate   # schema.ts -> packages/db/migrations/*.sql
 *   npm run db:migrate    # apply + seed
 *
 * Generated SQL is committed and reviewed. A schema change is therefore a diff
 * a human can read, not something the app does to a production database.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/db/src/schema.ts',
  out: './packages/db/migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://faceless:faceless@127.0.0.1:5433/faceless',
  },
  strict: true,
  verbose: true,
});
