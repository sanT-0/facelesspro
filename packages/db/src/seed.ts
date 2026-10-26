/**
 * Idempotent seed: built-in caption templates (negative ids, parity) and a dev
 * workspace on the `selfhost` plan.
 *
 * Plans are **code**, not rows: docs/03 §3 has no plan table, and the catalogue
 * in docs/01 §8 is a shape with no prices to copy. `workspace.plan_id` is the
 * pointer; whatever resolves it can stay a constant until billing exists.
 */

import { pathToFileURL } from 'node:url';

import type { Database } from './client';
import { captionTemplate, member, user, workspace } from './schema';

/** Fixed ids make the seed re-runnable and keep editor links stable in dev. */
export const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const DEV_USER_ID = '00000000-0000-4000-8000-000000000002';

export const BUILTIN_CAPTION_TEMPLATES = [
  {
    id: -1,
    name: 'Bold Tamil',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 72,
      wordLimit: 4,
      maxLines: 2,
      uppercase: false,
      emoji: false,
      position: 'bottom',
      highlightColor: '#FFD400',
      outlineColor: '#000000',
      outlineWidth: 6,
    },
  },
  {
    id: -2,
    name: 'Clean Sans',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 56,
      wordLimit: 6,
      maxLines: 2,
      uppercase: false,
      emoji: false,
      position: 'bottom',
      outlineColor: '#000000',
      outlineWidth: 4,
    },
  },
  {
    id: -3,
    name: 'Emoji Pop',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 64,
      wordLimit: 3,
      maxLines: 2,
      uppercase: true,
      emoji: true,
      position: 'center',
      highlightColor: '#FF4D8D',
      outlineColor: '#FFFFFF',
      outlineWidth: 5,
    },
  },
] satisfies readonly (typeof captionTemplate.$inferInsert)[];

export interface SeedResult {
  templates: number;
  workspace: boolean;
}

/** Exported so the seed test can validate them against the row contracts. */
export const DEV_WORKSPACE = {
  id: DEV_WORKSPACE_ID,
  name: 'Personal',
  plan_id: 'selfhost',
  credits: null,
  balance_cents: 0,
} satisfies typeof workspace.$inferInsert;

export const DEV_USER = {
  id: DEV_USER_ID,
  email: 'dev@example.com',
  name: 'Dev',
} satisfies typeof user.$inferInsert;

export const DEV_MEMBER = {
  workspace_id: DEV_WORKSPACE_ID,
  user_id: DEV_USER_ID,
  role: 'owner',
} satisfies typeof member.$inferInsert;

export async function seedBuiltins(db: Database): Promise<SeedResult> {
  const templates = await db
    .insert(captionTemplate)
    .values([...BUILTIN_CAPTION_TEMPLATES])
    // Built-ins are immutable: changing a spec means a new id, so an existing
    // row is never overwritten by a later seed.
    .onConflictDoNothing({ target: captionTemplate.id })
    .returning({ id: captionTemplate.id });

  const workspaces = await db
    .insert(workspace)
    .values(DEV_WORKSPACE)
    .onConflictDoNothing({ target: workspace.id })
    .returning({ id: workspace.id });

  await db
    .insert(user)
    .values(DEV_USER)
    .onConflictDoNothing({ target: user.id });

  await db.insert(member).values(DEV_MEMBER).onConflictDoNothing();

  return { templates: templates.length, workspace: workspaces.length > 0 };
}

async function main(): Promise<void> {
  const { createDb, loadEnv } = await import('./client');
  loadEnv();
  const { db, pool } = createDb();
  try {
    const result = await seedBuiltins(db);
    console.log(
      `seed: ${result.templates} new caption templates, ` +
        `workspace ${result.workspace ? 'created' : 'already present'}`,
    );
  } finally {
    await pool.end();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
