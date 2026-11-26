/**
 * `GET/POST/PATCH/DELETE /v1/workspace/members` — team member management.
 *
 * The router is mounted directly (not through `createApp`) because member
 * management touches no other route: the deps below are the whole surface.
 * `withWorkspace()` is the real middleware, so the `requesterId` these tests
 * assert on comes from the API key exactly as it does in production.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorBodySchema,
  inviteMemberResponseSchema,
  listMembersResponseSchema,
  memberSchema,
  removeMemberResponseSchema,
  updateMemberResponseSchema,
  type MemberRole,
} from '@facelesspro/contracts';

import { createMemberRoutes } from './members';
import type { MemberRouteDeps } from './members';
import { NOW, TEST_TOKEN, testApiKey, testClient, WORKSPACE_ID } from './test-auth';

const BASE = 'http://api.test';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const EDITOR_ID = '33333333-3333-4333-8333-333333333333';
const NEW_ID = '55555555-5555-4555-8555-555555555555';

type Member = {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: MemberRole;
  readonly joinedAt: string;
};

function memberRow(userId: string, role: MemberRole, email = `${role}@example.com`): Member {
  return {
    id: userId,
    workspaceId: WORKSPACE_ID,
    userId,
    email,
    name: role,
    role,
    joinedAt: NOW.toISOString(),
  };
}

/** An API key owned by `userId`; keys minted before the user column have null. */
function authFor(userId: string | null): Pick<MemberRouteDeps, 'authenticateApiKey' | 'rateLimit'> {
  return {
    authenticateApiKey: async (token) =>
      token === TEST_TOKEN ? testApiKey(WORKSPACE_ID, { user_id: userId }) : null,
    rateLimit: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
  };
}

function appWith(
  options: {
    readonly actor?: { userId: string | null; role: MemberRole };
    readonly members?: Member[];
    readonly overrides?: Partial<MemberRouteDeps>;
  } = {},
) {
  const actor = options.actor ?? { userId: OWNER_ID, role: 'owner' };
  const members = options.members ?? [memberRow(actor.userId ?? OWNER_ID, actor.role)];
  const deps: MemberRouteDeps = {
    ...authFor(actor.userId),
    listMembers: async () => members,
    checkSeatLimit: async () => ({ limit: 5, current: members.length, exceeded: false }),
    findUserByEmail: async () => null,
    createUser: async (input) => ({ id: NEW_ID, ...input }),
    addMember: async (_workspaceId, input) =>
      memberRow(input.userId, input.role, 'invited@example.com'),
    updateMemberRole: async (_workspaceId, _requesterId, targetUserId, role) =>
      memberRow(targetUserId, role),
    removeMember: async () => {},
    ...options.overrides,
  };
  return testClient(createMemberRoutes(deps));
}

async function errorBody(response: Response) {
  return apiErrorBodySchema.parse(await response.json());
}

describe('GET /v1/workspace/members', () => {
  it('answers 401 without a key', async () => {
    const response = await appWith().raw('/workspace/members');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('lists members with their roles', async () => {
    const listMembers = vi.fn(async () => [
      memberRow(OWNER_ID, 'owner'),
      memberRow(EDITOR_ID, 'editor'),
    ]);
    const response = await appWith({ overrides: { listMembers } }).request(
      `${BASE}/workspace/members`,
    );
    expect(response.status).toBe(200);

    const body = listMembersResponseSchema.parse(await response.json());
    expect(body.members.map((m) => m.role)).toEqual(['owner', 'editor']);
    expect(body.members[1]!.email).toBe('editor@example.com');
    expect(listMembers).toHaveBeenCalledWith(WORKSPACE_ID);
  });
});

describe('POST /v1/workspace/members', () => {
  const invite = (email: string, role?: string) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(role === undefined ? { email } : { email, role }),
  });

  it('refuses an invite from an editor or viewer', async () => {
    for (const role of ['editor', 'viewer'] as const) {
      const addMember = vi.fn(async () => memberRow(NEW_ID, 'editor'));
      const response = await appWith({
        actor: { userId: EDITOR_ID, role },
        overrides: { addMember },
      }).request(`${BASE}/workspace/members`, invite('new@example.com'));
      expect(response.status).toBe(403);
      expect((await errorBody(response)).error.code).toBe('forbidden');
      expect(addMember).not.toHaveBeenCalled();
    }
  });

  it('lets an owner invite an existing user as an editor by default', async () => {
    const findUserByEmail = vi.fn(async () => ({
      id: NEW_ID,
      email: 'new@example.com',
      name: 'New',
    }));
    const addMember = vi.fn(async () => memberRow(NEW_ID, 'editor', 'new@example.com'));
    const response = await appWith({
      members: [memberRow(OWNER_ID, 'owner')],
      overrides: { findUserByEmail, addMember },
    }).request(`${BASE}/workspace/members`, invite('new@example.com'));
    expect(response.status).toBe(201);

    const body = inviteMemberResponseSchema.parse(await response.json());
    expect(memberSchema.parse(body.member).role).toBe('editor');
    expect(addMember).toHaveBeenCalledWith(WORKSPACE_ID, {
      userId: NEW_ID,
      role: 'editor',
    });
  });

  it('lets an admin invite and creates the user when the email is unknown', async () => {
    const createUser = vi.fn(async (input: { email: string; name: string }) => ({
      id: NEW_ID,
      ...input,
    }));
    const response = await appWith({
      actor: { userId: ADMIN_ID, role: 'admin' },
      overrides: { createUser },
    }).request(`${BASE}/workspace/members`, invite('stranger@example.com', 'viewer'));
    expect(response.status).toBe(201);
    expect(createUser).toHaveBeenCalledWith({
      email: 'stranger@example.com',
      name: 'stranger',
    });
  });

  it('rejects an unknown role and a non-email with 400', async () => {
    for (const body of [invite('new@example.com', 'owner'), invite('not-an-email')]) {
      const response = await appWith().request(`${BASE}/workspace/members`, body);
      expect(response.status).toBe(400);
      expect((await errorBody(response)).error.code).toBe('invalid_request');
    }
  });

  it('answers 409 for a user who is already a member', async () => {
    const response = await appWith({
      members: [memberRow(OWNER_ID, 'owner'), memberRow(NEW_ID, 'editor')],
      overrides: {
        findUserByEmail: async () => ({ id: NEW_ID, email: 'new@example.com', name: 'New' }),
      },
    }).request(`${BASE}/workspace/members`, invite('new@example.com'));
    expect(response.status).toBe(409);
    expect((await errorBody(response)).error.code).toBe('conflict');
  });

  it('answers 403 when the plan has no spare seat', async () => {
    const response = await appWith({
      overrides: {
        checkSeatLimit: async () => ({ limit: 1, current: 1, exceeded: true }),
      },
    }).request(`${BASE}/workspace/members`, invite('new@example.com'));
    expect(response.status).toBe(403);
    expect((await errorBody(response)).error.message).toContain('seat limit');
  });
});

describe('PATCH /v1/workspace/members/:id', () => {
  const patch = (role: string) => ({
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });

  it('changes a role as the owner and passes the requester id through', async () => {
    const updateMemberRole = vi.fn(async () => memberRow(EDITOR_ID, 'viewer'));
    const response = await appWith({ overrides: { updateMemberRole } }).request(
      `${BASE}/workspace/members/${EDITOR_ID}`,
      patch('viewer'),
    );
    expect(response.status).toBe(200);

    const body = updateMemberResponseSchema.parse(await response.json());
    expect(body.member.role).toBe('viewer');
    expect(updateMemberRole).toHaveBeenCalledWith(WORKSPACE_ID, OWNER_ID, EDITOR_ID, 'viewer');
  });

  it('rejects an invalid role with 400', async () => {
    const response = await appWith().request(
      `${BASE}/workspace/members/${EDITOR_ID}`,
      patch('superuser'),
    );
    expect(response.status).toBe(400);
  });

  it('maps ownership/permission errors to 403 and a missing member to 404', async () => {
    const forbidden = await appWith({
      overrides: {
        updateMemberRole: async () => {
          throw new Error('only owners can change member roles');
        },
      },
    }).request(`${BASE}/workspace/members/${EDITOR_ID}`, patch('viewer'));
    expect(forbidden.status).toBe(403);

    const missing = await appWith({
      overrides: {
        updateMemberRole: async () => {
          throw new Error('member not found');
        },
      },
    }).request(`${BASE}/workspace/members/${EDITOR_ID}`, patch('viewer'));
    expect(missing.status).toBe(404);
    expect((await errorBody(missing)).error.code).toBe('not_found');
  });
});

describe('DELETE /v1/workspace/members/:id', () => {
  it('removes a member as the owner', async () => {
    const removeMember = vi.fn(async () => {});
    const response = await appWith({ overrides: { removeMember } }).request(
      `${BASE}/workspace/members/${EDITOR_ID}`,
      { method: 'DELETE' },
    );
    expect(response.status).toBe(200);
    expect(removeMemberResponseSchema.parse(await response.json())).toEqual({ removed: true });
    expect(removeMember).toHaveBeenCalledWith(WORKSPACE_ID, OWNER_ID, EDITOR_ID);
  });

  it('maps permission errors to 403 and a missing member to 404', async () => {
    const forbidden = await appWith({
      overrides: {
        removeMember: async () => {
          throw new Error('insufficient permissions to remove members');
        },
      },
    }).request(`${BASE}/workspace/members/${EDITOR_ID}`, { method: 'DELETE' });
    expect(forbidden.status).toBe(403);

    const missing = await appWith({
      overrides: {
        removeMember: async () => {
          throw new Error('member not found');
        },
      },
    }).request(`${BASE}/workspace/members/${EDITOR_ID}`, { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });
});
