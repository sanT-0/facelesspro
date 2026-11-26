/**
 * Workspace member management over real Postgres (P10.4 — Teams).
 *
 * These tests pin the rules the API relies on: seat limits come from the plan,
 * the owner cannot be demoted or removed, and only an owner may change a role
 * while owners and admins may remove members.
 */

import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { PlanId } from '@facelesspro/contracts';

import { createDb } from './client';
import type { Database } from './client';
import {
  addMember,
  checkSeatLimit,
  countMembers,
  findUserByEmail,
  getMemberRole,
  isMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from './members';
import { member, user, workspace } from './schema';

let db: Database;
let pool: Pool;
let workspaceId: string;
const workspaceIds: string[] = [];
const userIds: string[] = [];

async function createUser(email = `member-${randomUUID()}@example.com`): Promise<string> {
  const rows = await db
    .insert(user)
    .values({ email, name: email.split('@')[0]! })
    .returning({ id: user.id });
  const id = rows[0]!.id;
  userIds.push(id);
  return id;
}

async function setupWorkspace(
  planId: PlanId = 'premium',
): Promise<{ ownerId: string }> {
  const rows = await db
    .insert(workspace)
    .values({
      name: `members-${randomUUID()}`,
      plan_id: planId,
      credits: null,
      balance_cents: 0,
    })
    .returning({ id: workspace.id });
  workspaceId = rows[0]!.id;
  workspaceIds.push(workspaceId);

  const ownerId = await createUser();
  await db.insert(member).values({
    workspace_id: workspaceId,
    user_id: ownerId,
    role: 'owner',
  });
  return { ownerId };
}

async function addRaw(userId: string, role: 'owner' | 'admin' | 'editor' | 'viewer') {
  await db.insert(member).values({ workspace_id: workspaceId, user_id: userId, role });
}

beforeAll(async () => {
  const created = createDb();
  db = created.db;
  pool = created.pool;
});

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  if (workspaceIds.length > 0) {
    await db.delete(member).where(inArray(member.workspace_id, workspaceIds));
    await db.delete(workspace).where(inArray(workspace.id, workspaceIds));
    workspaceIds.length = 0;
  }
  if (userIds.length > 0) {
    await db.delete(user).where(inArray(user.id, userIds));
    userIds.length = 0;
  }
});

describe('member reads (Postgres)', () => {
  it('lists members with their name, email and role', async () => {
    const { ownerId } = await setupWorkspace();
    const editorId = await createUser('editor@example.com');
    await addRaw(editorId, 'editor');

    const members = await listMembers(db, workspaceId);
    expect(members).toHaveLength(2);
    const editor = members.find((m) => m.userId === editorId);
    expect(editor).toMatchObject({
      workspaceId,
      email: 'editor@example.com',
      role: 'editor',
    });
    expect(members.find((m) => m.userId === ownerId)?.role).toBe('owner');

    expect(await isMember(db, workspaceId, editorId)).toBe(true);
    expect(await getMemberRole(db, workspaceId, ownerId)).toBe('owner');
    expect(await countMembers(db, workspaceId)).toBe(2);
    expect(await findUserByEmail(db, 'editor@example.com')).toMatchObject({ id: editorId });
    expect(await findUserByEmail(db, 'missing@example.com')).toBeNull();
  });
});

describe('seat limits (Postgres)', () => {
  it('reports a free workspace full at its single seat', async () => {
    await setupWorkspace('free');

    expect(await checkSeatLimit(db, workspaceId)).toEqual({
      limit: 1,
      current: 1,
      exceeded: true,
    });
  });

  it('refuses to add beyond the plan seats but allows it while a seat is free', async () => {
    const { ownerId } = await setupWorkspace('free');
    const extraId = await createUser();
    await expect(addMember(db, workspaceId, { userId: extraId, role: 'editor' })).rejects.toThrow(
      /seat limit exceeded/,
    );
    expect(await countMembers(db, workspaceId)).toBe(1);
    expect(ownerId).toBeDefined();

    await setupWorkspace('premium'); // three seats
    const invitedId = await createUser();
    const added = await addMember(db, workspaceId, { userId: invitedId, role: 'viewer' });
    expect(added).toMatchObject({ userId: invitedId, role: 'viewer', workspaceId });
    expect(await countMembers(db, workspaceId)).toBe(2);
  });

  it('rejects a duplicate member and an owner invite', async () => {
    const { ownerId } = await setupWorkspace('premium');
    const editorId = await createUser();

    await expect(addMember(db, workspaceId, { userId: ownerId, role: 'editor' })).rejects.toThrow(
      /already a member/,
    );
    await expect(addMember(db, workspaceId, { userId: editorId, role: 'owner' })).rejects.toThrow(
      /cannot assign owner/,
    );
  });
});

describe('role changes (Postgres)', () => {
  it('lets the owner change a role and records it', async () => {
    const { ownerId } = await setupWorkspace();
    const editorId = await createUser();
    await addRaw(editorId, 'editor');

    const updated = await updateMemberRole(db, workspaceId, ownerId, editorId, 'viewer');
    expect(updated.role).toBe('viewer');
    expect(await getMemberRole(db, workspaceId, editorId)).toBe('viewer');
  });

  it('refuses a non-owner, a self-change and the owner role', async () => {
    const { ownerId } = await setupWorkspace();
    const adminId = await createUser();
    const editorId = await createUser();
    const otherOwnerId = await createUser();
    await addRaw(adminId, 'admin');
    await addRaw(editorId, 'editor');
    await addRaw(otherOwnerId, 'owner');

    await expect(
      updateMemberRole(db, workspaceId, adminId, editorId, 'viewer'),
    ).rejects.toThrow(/only owners/);
    await expect(
      updateMemberRole(db, workspaceId, ownerId, ownerId, 'viewer'),
    ).rejects.toThrow(/your own role/);
    await expect(
      updateMemberRole(db, workspaceId, ownerId, otherOwnerId, 'viewer'),
    ).rejects.toThrow(/cannot change owner role/);
    await expect(
      updateMemberRole(db, workspaceId, ownerId, editorId, 'owner'),
    ).rejects.toThrow(/cannot assign owner/);
  });
});

describe('removal (Postgres)', () => {
  it('lets the owner remove an editor and an admin remove an editor', async () => {
    const { ownerId } = await setupWorkspace();
    const adminId = await createUser();
    const editorId = await createUser();
    await addRaw(adminId, 'admin');
    await addRaw(editorId, 'editor');

    await removeMember(db, workspaceId, adminId, editorId);
    expect(await isMember(db, workspaceId, editorId)).toBe(false);

    const secondEditorId = await createUser();
    await addRaw(secondEditorId, 'editor');
    await removeMember(db, workspaceId, ownerId, secondEditorId);
    expect(await isMember(db, workspaceId, secondEditorId)).toBe(false);
  });

  it('refuses editors, admins removing admins, self-removal and the owner', async () => {
    const { ownerId } = await setupWorkspace();
    const adminId = await createUser();
    const otherAdminId = await createUser();
    const editorId = await createUser();
    const viewerId = await createUser();
    const otherOwnerId = await createUser();
    await addRaw(adminId, 'admin');
    await addRaw(otherAdminId, 'admin');
    await addRaw(editorId, 'editor');
    await addRaw(viewerId, 'viewer');
    await addRaw(otherOwnerId, 'owner');

    await expect(removeMember(db, workspaceId, editorId, viewerId)).rejects.toThrow(
      /insufficient permissions/,
    );
    await expect(removeMember(db, workspaceId, adminId, otherAdminId)).rejects.toThrow(
      /admins cannot remove other admins/,
    );
    await expect(removeMember(db, workspaceId, ownerId, ownerId)).rejects.toThrow(
      /yourself/,
    );
    await expect(removeMember(db, workspaceId, ownerId, otherOwnerId)).rejects.toThrow(
      /workspace owner/,
    );
  });
});
