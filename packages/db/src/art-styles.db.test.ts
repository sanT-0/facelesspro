/**
 * Workspace visibility for the art-style catalog, over real Postgres.
 *
 * `published` is what makes a style global; an unpublished row belongs to the
 * workspace that uploaded it. Another workspace must not see it in the list or
 * be able to export it by id.
 */

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from './client';
import type { Database } from './client';
import { artStyle, workspace } from './schema';
import { findVisibleArtStyle, listVisibleArtStyles } from './art-styles';

let db: Database;
let pool: Pool;
let ownerId: string;
let strangerId: string;
let globalStyleId: string;
let ownerPrivateId: string;
let strangerPrivateId: string;
let buildingId: string;

const baseStyle = {
  name: 'style',
  formats: ['landscape' as const],
  profile: {},
  status: 'ready' as const,
  preview_url: 'style.png',
};

describe('art-style workspace visibility (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    const owners = await db
      .insert(workspace)
      .values({ name: `db-style-owner-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    ownerId = owners[0]!.id;
    const strangers = await db
      .insert(workspace)
      .values({ name: `db-style-stranger-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    strangerId = strangers[0]!.id;

    const inserted = await db
      .insert(artStyle)
      .values([
        {
          ...baseStyle,
          name: 'global',
          workspace_id: null,
          published: true,
        },
        {
          ...baseStyle,
          name: 'owner private',
          workspace_id: ownerId,
          published: false,
        },
        {
          ...baseStyle,
          name: 'stranger private',
          workspace_id: strangerId,
          published: false,
        },
        {
          ...baseStyle,
          name: 'owner building',
          workspace_id: ownerId,
          published: false,
          status: 'building',
        },
      ])
      .returning({ id: artStyle.id, name: artStyle.name });
    const byName = (name: string) => inserted.find((row) => row.name === name)!.id;
    globalStyleId = byName('global');
    ownerPrivateId = byName('owner private');
    strangerPrivateId = byName('stranger private');
    buildingId = byName('owner building');
  });

  afterEach(async () => {
    await db.delete(artStyle).where(eq(artStyle.workspace_id, ownerId));
    await db.delete(artStyle).where(eq(artStyle.workspace_id, strangerId));
    await db.delete(workspace).where(eq(workspace.id, ownerId));
    await db.delete(workspace).where(eq(workspace.id, strangerId));
  });

  it('lists global styles plus the workspace own ready styles only', async () => {
    const owner = await listVisibleArtStyles(db, ownerId);
    expect(owner.map((row) => row.id).sort()).toEqual(
      [globalStyleId, ownerPrivateId].sort(),
    );

    const stranger = await listVisibleArtStyles(db, strangerId);
    expect(stranger.map((row) => row.id).sort()).toEqual(
      [globalStyleId, strangerPrivateId].sort(),
    );
    expect(stranger.some((row) => row.id === ownerPrivateId)).toBe(false);
    expect(stranger.some((row) => row.id === buildingId)).toBe(false);
  });

  it('exports only a global or own style by id', async () => {
    expect(await findVisibleArtStyle(db, ownerId, globalStyleId)).not.toBeNull();
    expect(await findVisibleArtStyle(db, ownerId, ownerPrivateId)).not.toBeNull();
    expect(await findVisibleArtStyle(db, ownerId, strangerPrivateId)).toBeNull();
    expect(await findVisibleArtStyle(db, strangerId, ownerPrivateId)).toBeNull();
    expect(await findVisibleArtStyle(db, strangerId, globalStyleId)).not.toBeNull();
  });
});
