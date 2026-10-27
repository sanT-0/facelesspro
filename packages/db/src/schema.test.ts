import type {
  CaptionTemplateRow,
  NarrationRow,
  SceneRow,
  VideoRow,
  WorkspaceRow,
} from '@facelesspro/contracts';
import {
  DB_TABLES,
  MEMBER_ROLES,
  VIDEO_STATUS,
  VIDEO_STEPS,
  apiKeyRowSchema,
  artStyleRowSchema,
  assetRowSchema,
  balanceLedgerRowSchema,
  captionTemplateRowSchema,
  captionTrackRowSchema,
  creditLedgerRowSchema,
  jobLockRowSchema,
  memberRowSchema,
  narrationRowSchema,
  renderRowSchema,
  sceneRowSchema,
  userRowSchema,
  videoRowSchema,
  voiceRowSchema,
  webhookEventRowSchema,
  workspaceRowSchema,
} from '@facelesspro/contracts';
import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_CAPTION_TEMPLATES,
  DEV_MEMBER,
  DEV_USER,
  DEV_WORKSPACE,
} from './seed';
import {
  captionTemplate,
  narration,
  scene,
  schema,
  video,
  videoStatusEnum,
  videoStepEnum,
  workspace,
} from './schema';
import { memberRoleEnum } from './schema';

const NOW = '2026-10-26T17:00:00.000Z';

type RowLike = { shape: Record<string, unknown> };

/**
 * Compile-time drift guards: if drizzle's inferred select type stops matching
 * the contract row, this file fails to build, before any query runs.
 */
type Assert<T extends true> = T;
type _Workspace = Assert<
  typeof workspace.$inferSelect extends WorkspaceRow ? true : false
>;
type _Video = Assert<typeof video.$inferSelect extends VideoRow ? true : false>;
type _Scene = Assert<typeof scene.$inferSelect extends SceneRow ? true : false>;
type _Narration = Assert<
  typeof narration.$inferSelect extends NarrationRow ? true : false
>;
type _CaptionTemplate = Assert<
  typeof captionTemplate.$inferSelect extends CaptionTemplateRow ? true : false
>;

describe('schema ↔ contracts', () => {
  const tables = new Map<string, PgTable>(
    Object.values(schema).map((table) => [getTableName(table), table as PgTable]),
  );

  const rows: Record<string, RowLike> = {
    workspace: workspaceRowSchema,
    user: userRowSchema,
    member: memberRowSchema,
    api_key: apiKeyRowSchema,
    credit_ledger: creditLedgerRowSchema,
    balance_ledger: balanceLedgerRowSchema,
    art_style: artStyleRowSchema,
    voice: voiceRowSchema,
    caption_tpl: captionTemplateRowSchema,
    asset: assetRowSchema,
    video: videoRowSchema,
    scene: sceneRowSchema,
    narration: narrationRowSchema,
    caption_track: captionTrackRowSchema,
    render: renderRowSchema,
    job_lock: jobLockRowSchema,
    webhook_event: webhookEventRowSchema,
  };

  it('defines exactly the documented tables', () => {
    expect(DB_TABLES).toHaveLength(17);
    expect(tables.size).toBe(DB_TABLES.length);
    for (const name of DB_TABLES) {
      expect(tables.has(name), `missing table ${name}`).toBe(true);
    }
  });

  it('uses the same column names as the row schemas', () => {
    for (const name of DB_TABLES) {
      const table = tables.get(name);
      const row = rows[name];
      expect(table, `missing table ${name}`).toBeDefined();
      expect(row, `missing row schema for ${name}`).toBeDefined();
      if (table === undefined || row === undefined) continue;

      expect(
        Object.keys(getTableColumns(table)).sort(),
        `columns of ${name}`,
      ).toEqual(Object.keys(row.shape).sort());
    }
  });

  it('builds the public enums from the contract tuples', () => {
    expect(videoStatusEnum.enumValues).toEqual([...VIDEO_STATUS]);
    expect(videoStepEnum.enumValues).toEqual([...VIDEO_STEPS]);
    expect(memberRoleEnum.enumValues).toEqual([...MEMBER_ROLES]);
  });

  it('keeps the nullable-vs-required choices the API depends on', () => {
    expect(getTableColumns(workspace).credits.notNull).toBe(false);

    const id = getTableColumns(captionTemplate).id;
    expect(id.primary).toBe(true);
    expect(id.columnType).toBe('PgInteger');
  });
});

describe('seed data', () => {
  it('built-in templates are valid rows with negative, unique ids', () => {
    const ids = BUILTIN_CAPTION_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toBeLessThan(0);

    for (const template of BUILTIN_CAPTION_TEMPLATES) {
      expect(
        captionTemplateRowSchema.parse({ ...template, workspace_id: null }).name,
      ).toBe(template.name);
    }
  });

  it('the dev workspace uses the unlimited selfhost plan', () => {
    const row = workspaceRowSchema.parse({ ...DEV_WORKSPACE, created_at: NOW });
    expect(row.plan_id).toBe('selfhost');
    expect(row.credits).toBeNull();
  });

  it('the dev owner is a valid user/member pair', () => {
    expect(userRowSchema.parse(DEV_USER).email).toBe('dev@example.com');
    expect(memberRowSchema.parse(DEV_MEMBER).role).toBe('owner');
  });
});
