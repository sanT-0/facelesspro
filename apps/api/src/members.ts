/**
 * `GET /v1/workspace/members` — list members with roles
 * `POST /v1/workspace/members` — invite a user (by email)
 * `PATCH /v1/workspace/members/:id` — change role
 * `DELETE /v1/workspace/members/:id` — remove member
 *
 * Seat limits enforced from plan (P11 limits).
 * Invite/remove: owners and admins. Role changes: owner only. The owner can
 * never be demoted or removed, and admins cannot remove other admins.
 */

import { Hono } from 'hono';

import {
  inviteMemberRequestSchema,
  inviteMemberResponseSchema,
  listMembersResponseSchema,
  removeMemberResponseSchema,
  updateMemberRequestSchema,
  updateMemberResponseSchema,
  type InviteMemberRequestParsed,
} from '@facelesspro/contracts';
import { apiError } from '@facelesspro/contracts';
import type { MemberRole } from '@facelesspro/contracts';
import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';

export interface MemberRouteDeps extends AuthDeps {
  /** List members of a workspace. */
  readonly listMembers: (workspaceId: string) => Promise<Array<{
    readonly id: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly email: string;
    readonly name: string;
    readonly role: MemberRole;
    readonly joinedAt: string;
  }>>;
  /** Check seat limit for a workspace. */
  readonly checkSeatLimit: (workspaceId: string) => Promise<{
    readonly limit: number;
    readonly current: number;
    readonly exceeded: boolean;
  }>;
  /** Find user by email. */
  readonly findUserByEmail: (email: string) => Promise<{
    readonly id: string;
    readonly email: string;
    readonly name: string;
  } | null>;
  /** Create a new user (for invitation). */
  readonly createUser: (input: { email: string; name: string }) => Promise<{
    readonly id: string;
    readonly email: string;
    readonly name: string;
  }>;
  /** Add a member to a workspace. */
  readonly addMember: (workspaceId: string, input: { userId: string; role: MemberRole }) => Promise<{
    readonly id: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly email: string;
    readonly name: string;
    readonly role: MemberRole;
    readonly joinedAt: string;
  }>;
  /** Update a member's role. */
  readonly updateMemberRole: (workspaceId: string, requesterId: string, targetUserId: string, newRole: MemberRole) => Promise<{
    readonly id: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly email: string;
    readonly name: string;
    readonly role: MemberRole;
    readonly joinedAt: string;
  }>;
  /** Remove a member from a workspace. */
  readonly removeMember: (workspaceId: string, requesterId: string, targetUserId: string) => Promise<void>;
}

export function createMemberRoutes(deps: MemberRouteDeps): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();

  app.use('*', withWorkspace(deps));

  // GET /v1/workspace/members
  app.get('/workspace/members', async (c) => {
    const workspaceId = c.get('workspaceId');
    const members = await deps.listMembers(workspaceId);
    const body = listMembersResponseSchema.parse({ members });
    return c.json(body, 200);
  });

  // POST /v1/workspace/members
  app.post('/workspace/members', async (c) => {
    const workspaceId = c.get('workspaceId');
    const requesterId = c.get('userId') ?? '';

    // Any key scoped to the workspace can read the list, but inviting is a
    // management action. Keys minted before `api_key.user_id` existed cannot
    // prove a role, so they are refused rather than treated as the owner.
    const members = await deps.listMembers(workspaceId);
    const requester = members.find((m) => m.userId === requesterId);
    if (
      requester === undefined ||
      (requester.role !== 'owner' && requester.role !== 'admin')
    ) {
      return c.json(
        apiError('forbidden', 'only owners and admins can invite members'),
        403,
      );
    }

    const payload = await c.req.json();
    const parsed = inviteMemberRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json(
        apiError('invalid_request', 'Invalid invite payload', issue?.path.join('.') ?? undefined),
        400,
      );
    }

    // TypeScript doesn't narrow parsed.data after the success check.
    // Use a type assertion on the property access.
    const email = (parsed.data as InviteMemberRequestParsed).email;
    const role = (parsed.data as InviteMemberRequestParsed).role;

    // Check seat limit
    const seatCheck = await deps.checkSeatLimit(workspaceId);
    if (seatCheck.exceeded) {
      return c.json(
        apiError('forbidden', `seat limit exceeded: ${seatCheck.current}/${seatCheck.limit}`),
        403,
      );
    }

    // Cannot invite as owner
    if (role === 'owner') {
      return c.json(
        apiError('invalid_request', 'cannot invite as owner; transfer ownership instead'),
        400,
      );
    }

    // Find or create user
    let user = await deps.findUserByEmail(email);
    if (user === null) {
      const userName = ((email as string).split('@')[0]) as string;
      user = await deps.createUser({ email, name: userName });
    }

    // Check if already a member. The list was read before user creation, so it
    // is only used for users that already existed.
    const existing = members.find((m) => m.userId === user!.id);
    if (existing) {
      return c.json(
        apiError('conflict', 'user is already a member of this workspace'),
        409,
      );
    }

    // Add member
    const member = await deps.addMember(workspaceId, { userId: user.id, role });

    const body = inviteMemberResponseSchema.parse({ member });
    return c.json(body, 201);
  });

  // PATCH /v1/workspace/members/:id
  app.patch('/workspace/members/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    const requesterId: string = c.get('userId') ?? '';
    const targetUserId = c.req.param('id');

    const payload = await c.req.json();
    const parsed = updateMemberRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json(
        apiError('invalid_request', 'Invalid role update', issue?.path.join('.') ?? undefined),
        400,
      );
    }

    const { role } = parsed.data;

    try {
      const member = await deps.updateMemberRole(workspaceId, requesterId, targetUserId, role);
      const body = updateMemberResponseSchema.parse({ member });
      return c.json(body, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to update role';
      const code = message.includes('owner') || message.includes('permissions')
        ? 'forbidden'
        : message.includes('not found')
        ? 'not_found'
        : 'invalid_request';
      return c.json(apiError(code, message), code === 'forbidden' ? 403 : code === 'not_found' ? 404 : 400);
    }
  });

  // DELETE /v1/workspace/members/:id
  app.delete('/workspace/members/:id', async (c) => {
    const workspaceId = c.get('workspaceId');
    const requesterId: string = c.get('userId') ?? '';
    const targetUserId = c.req.param('id');

    try {
      await deps.removeMember(workspaceId, requesterId, targetUserId);
      const body = removeMemberResponseSchema.parse({ removed: true });
      return c.json(body, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to remove member';
      const code = message.includes('owner') || message.includes('permissions')
        ? 'forbidden'
        : message.includes('not found')
        ? 'not_found'
        : 'invalid_request';
      return c.json(apiError(code, message), code === 'forbidden' ? 403 : code === 'not_found' ? 404 : 400);
    }
  });

  return app;
}