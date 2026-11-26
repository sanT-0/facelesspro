/**
 * Workspace member management (P10.4 — Teams).
 *
 * Seat limits are enforced from the plan (P11 limits).
 * Invite/remove: owners and admins. Role changes: owner only. The owner can
 * never be demoted or removed, and admins cannot remove other admins.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { Database } from './client';
import { member, user } from './schema';
import { findWorkspace } from './workspaces';
import type { MemberRole } from '@facelesspro/contracts';
import { MEMBER_ROLES } from '@facelesspro/contracts';

export interface MemberEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: MemberRole;
  readonly joinedAt: string;
}

/**
 * List all members of a workspace with their roles, newest users first.
 *
 * `joinedAt` is the user's `created_at`: the `member` row has no timestamp of
 * its own, so this is not strictly "when they joined this workspace".
 */
export async function listMembers(
  db: Database,
  workspaceId: string,
): Promise<MemberEntry[]> {
  const rows = await db
    .select({
      workspace_id: member.workspace_id,
      user_id: member.user_id,
      role: member.role,
      email: user.email,
      name: user.name,
      created_at: user.created_at,
    })
    .from(member)
    .innerJoin(user, eq(member.user_id, user.id))
    .where(eq(member.workspace_id, workspaceId))
    .orderBy(desc(user.created_at));

  return rows.map((row) => ({
    id: row.user_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role as MemberRole,
    joinedAt: row.created_at,
  }));
}

/**
 * Check if a user is already a member of a workspace.
 */
export async function isMember(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ workspace_id: member.workspace_id })
    .from(member)
    .where(and(eq(member.workspace_id, workspaceId), eq(member.user_id, userId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Get a user's role in a workspace.
 */
export async function getMemberRole(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<MemberRole | null> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.workspace_id, workspaceId), eq(member.user_id, userId)))
    .limit(1);
  return (rows[0]?.role as MemberRole) ?? null;
}

/**
 * Count current members in a workspace.
 */
export async function countMembers(
  db: Database,
  workspaceId: string,
): Promise<number> {
  const rows = await db
    .select({ count: sql<string>`count(*)` })
    .from(member)
    .where(eq(member.workspace_id, workspaceId));
  return Number(rows[0]?.count ?? 0);
}

/**
 * Check if adding a member would exceed the seat limit.
 * Returns the seat limit and current count.
 */
export async function checkSeatLimit(
  db: Database,
  workspaceId: string,
): Promise<{ limit: number; current: number; exceeded: boolean }> {
  const ws = await findWorkspace(db, workspaceId);
  if (ws === null) throw new Error('workspace not found');

  const current = await countMembers(db, workspaceId);
  const limit = ws.plan.seats;

  // null seats = unlimited (selfhost)
  if (limit === null) return { limit: -1, current, exceeded: false };

  return { limit, current, exceeded: current >= limit };
}

/**
 * Find a user by email. Returns null if not found.
 */
export async function findUserByEmail(
  db: Database,
  email: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const rows = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create a new user (for invitation flow, the user may not exist yet).
 * In a full implementation, this would send an email with a signup link.
 * For now, we create the user directly with a placeholder password.
 */
export async function createUser(
  db: Database,
  input: { email: string; name: string },
): Promise<{ id: string; email: string; name: string }> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    email: input.email,
    name: input.name,
    password_hash: null, // Will be set when they accept the invitation
  });
  return { id, email: input.email, name: input.name };
}

/**
 * Add a member to a workspace.
 * Enforces seat limits and role constraints.
 */
export async function addMember(
  db: Database,
  workspaceId: string,
  input: { userId: string; role: MemberRole },
): Promise<MemberEntry> {
  // Check seat limit
  const seatCheck = await checkSeatLimit(db, workspaceId);
  if (seatCheck.exceeded) {
    throw new Error(`seat limit exceeded: ${seatCheck.current}/${seatCheck.limit}`);
  }

  // Check if already a member
  const existing = await isMember(db, workspaceId, input.userId);
  if (existing) {
    throw new Error('user is already a member of this workspace');
  }

  // Validate role
  if (!MEMBER_ROLES.includes(input.role)) {
    throw new Error('invalid role');
  }

  // Owner role cannot be assigned via addMember (only one owner per workspace)
  if (input.role === 'owner') {
    throw new Error('cannot assign owner role; transfer ownership instead');
  }

  await db.insert(member).values({
    workspace_id: workspaceId,
    user_id: input.userId,
    role: input.role,
  });

  // Fetch the created member with user details
  const rows = await db
    .select({
      workspace_id: member.workspace_id,
      user_id: member.user_id,
      role: member.role,
      email: user.email,
      name: user.name,
      created_at: user.created_at,
    })
    .from(member)
    .innerJoin(user, eq(member.user_id, user.id))
    .where(and(eq(member.workspace_id, workspaceId), eq(member.user_id, input.userId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error('member not found after creation');

  return {
    id: row.user_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role as MemberRole,
    joinedAt: row.created_at,
  };
}

/**
 * Update a member's role.
 * Cannot change owner's role, and only owners/admins can demote admins.
 */
export async function updateMemberRole(
  db: Database,
  workspaceId: string,
  requesterId: string,
  targetUserId: string,
  newRole: MemberRole,
): Promise<MemberEntry> {
  if (requesterId === targetUserId) {
    throw new Error('cannot change your own role');
  }

  const requesterRole = await getMemberRole(db, workspaceId, requesterId);
  const targetRole = await getMemberRole(db, workspaceId, targetUserId);

  if (requesterRole === null || targetRole === null) {
    throw new Error('member not found');
  }

  // Only owners can change roles
  if (requesterRole !== 'owner') {
    throw new Error('only owners can change member roles');
  }

  // Cannot demote/remove the owner
  if (targetRole === 'owner') {
    throw new Error('cannot change owner role');
  }

  // Cannot promote someone to owner (ownership transfer is separate)
  if (newRole === 'owner') {
    throw new Error('cannot assign owner role; transfer ownership instead');
  }

  // Validate role
  if (!MEMBER_ROLES.includes(newRole)) {
    throw new Error('invalid role');
  }

  await db
    .update(member)
    .set({ role: newRole })
    .where(and(eq(member.workspace_id, workspaceId), eq(member.user_id, targetUserId)));

  // Fetch updated member
  const rows = await db
    .select({
      workspace_id: member.workspace_id,
      user_id: member.user_id,
      role: member.role,
      email: user.email,
      name: user.name,
      created_at: user.created_at,
    })
    .from(member)
    .innerJoin(user, eq(member.user_id, user.id))
    .where(and(eq(member.workspace_id, workspaceId), eq(member.user_id, targetUserId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error('member not found after update');

  return {
    id: row.user_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role as MemberRole,
    joinedAt: row.created_at,
  };
}

/**
 * Remove a member from a workspace.
 * Owners cannot be removed (must transfer ownership first).
 */
export async function removeMember(
  db: Database,
  workspaceId: string,
  requesterId: string,
  targetUserId: string,
): Promise<void> {
  if (requesterId === targetUserId) {
    throw new Error('cannot remove yourself');
  }

  const requesterRole = await getMemberRole(db, workspaceId, requesterId);
  const targetRole = await getMemberRole(db, workspaceId, targetUserId);

  if (requesterRole === null || targetRole === null) {
    throw new Error('member not found');
  }

  // Only owners/admins can remove members
  if (requesterRole === 'viewer' || requesterRole === 'editor') {
    throw new Error('insufficient permissions to remove members');
  }

  // Cannot remove the owner
  if (targetRole === 'owner') {
    throw new Error('cannot remove workspace owner; transfer ownership first');
  }

  // Admins cannot remove other admins (only owners can)
  if (requesterRole === 'admin' && targetRole === 'admin') {
    throw new Error('admins cannot remove other admins');
  }

  await db
    .delete(member)
    .where(and(eq(member.workspace_id, workspaceId), eq(member.user_id, targetUserId)));
}