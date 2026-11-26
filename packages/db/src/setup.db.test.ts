/**
 * Cold-start database setup over real Postgres.
 *
 * This asserts the two things a fresh clone depends on, both of which were
 * wrong before `setup.ts` existed:
 *
 *  - migrations alone leave an unusable database (no dev workspace, so
 *    `key:create` fails; no caption templates, so `create-captions` has no
 *    default), and
 *  - compose starts four services at once, so an unguarded `migrate()` on an
 *    empty database races on `CREATE TYPE`.
 *
 * Each test creates its own scratch database, so the suite never touches the
 * database the rest of `test:db` uses.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, databaseUrl } from './client';
import { captionTemplate, workspace } from './schema';
import { DEV_WORKSPACE_ID, BUILTIN_CAPTION_TEMPLATES } from './seed';
import { EXPECTED_TABLE_COUNT, prepareDatabase } from './setup';

let admin: Pool;
const scratch: string[] = [];

/** The configured URL, pointed at the maintenance database. */
function adminUrl(): string {
  const url = new URL(databaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}

async function createScratchDatabase(): Promise<string> {
  const name = `setup_test_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  await admin.query(`create database ${name}`);
  scratch.push(name);
  const url = new URL(databaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

async function dropScratchDatabases(): Promise<void> {
  for (const name of scratch) {
    await admin.query(`drop database if exists ${name} with (force)`);
  }
  scratch.length = 0;
}

beforeAll(async () => {
  admin = new Pool({ connectionString: adminUrl(), max: 2 });
});

afterAll(async () => {
  await dropScratchDatabases();
  await admin.end();
});

describe('prepareDatabase (Postgres)', () => {
  it('turns an empty database into a usable one: every table plus the seed', async () => {
    const connectionString = await createScratchDatabase();

    const result = await prepareDatabase({ connectionString });

    expect(result.tableCount).toBe(EXPECTED_TABLE_COUNT);
    // Every journal entry, not just "some": a hand-applied migration that is
    // missing from the journal leaves a fresh clone short a column while the
    // table count still looks right.
    expect(result.migrationsApplied).toBe(5);
    expect(result.seeded.templates).toBe(BUILTIN_CAPTION_TEMPLATES.length);
    expect(result.seeded.workspace).toBe(true);

    // The seed is what makes the first API key mintable, so assert the rows
    // a host would then rely on, not just the counts it returned.
    const { db, pool } = createDb(connectionString);
    try {
      const workspaces = await db.select({ id: workspace.id }).from(workspace);
      expect(workspaces.map((row) => row.id)).toContain(DEV_WORKSPACE_ID);
      const templates = await db.select({ id: captionTemplate.id }).from(captionTemplate);
      expect(templates.length).toBe(BUILTIN_CAPTION_TEMPLATES.length);

      // Columns added by 0004/0005 must exist on a fresh database. Counting
      // tables alone missed exactly this: 0005 was applied by hand and never
      // journalled, so a cold clone had no `video.redraw`/`video.revocal`.
      const columns = await db.execute<{ table_name: string; column_name: string }>(sql`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and (
            (table_name = 'video' and column_name in ('redraw', 'revocal'))
            or (table_name = 'user' and column_name = 'created_at')
            or (table_name = 'api_key' and column_name = 'user_id')
          )
      `);
      expect(
        columns.rows.map((row) => `${row.table_name}.${row.column_name}`).sort(),
      ).toEqual(['api_key.user_id', 'user.created_at', 'video.redraw', 'video.revocal']);
    } finally {
      await pool.end();
    }
  }, 60_000);

  it('is a no-op the second time it runs', async () => {
    const connectionString = await createScratchDatabase();

    const first = await prepareDatabase({ connectionString });
    const second = await prepareDatabase({ connectionString });

    expect(second.tableCount).toBe(first.tableCount);
    expect(second.migrationsApplied).toBe(first.migrationsApplied);
    expect(second.seeded.templates).toBe(0);
    expect(second.seeded.workspace).toBe(false);
  }, 60_000);

  it('serialises four simultaneous cold boots instead of racing on CREATE TYPE', async () => {
    const connectionString = await createScratchDatabase();

    // Compose starts api, worker, render and mcp at the same instant; before
    // the advisory lock this threw `duplicate key ... pg_type_typname_nsp_index`.
    const results = await Promise.all([
      prepareDatabase({ connectionString }),
      prepareDatabase({ connectionString }),
      prepareDatabase({ connectionString }),
      prepareDatabase({ connectionString }),
    ]);

    for (const result of results) {
      expect(result.tableCount).toBe(EXPECTED_TABLE_COUNT);
    }
    // Exactly one boot created the built-ins; the others saw them already there.
    expect(results.filter((result) => result.seeded.templates > 0)).toHaveLength(1);
    expect(results.filter((result) => result.seeded.workspace)).toHaveLength(1);
  }, 120_000);
});
