/**
 * Workspace member management (P10.4 — Teams).
 *
 * Endpoints:
 *   GET    /v1/workspace/members        — list members with roles
 *   POST   /v1/workspace/members        — invite a user (by email)
 *   PATCH  /v1/workspace/members/:id    — change role
 *   DELETE /v1/workspace/members/:id    — remove member
 *
 * Seat limits are enforced from the plan (P11 limits).
 * Only owners/admins can manage members; owners cannot be demoted/removed.
 */

import { z } from 'zod';

import { idSchema } from './common';
import { memberRoleSchema } from './common';

export const memberSchema = z.strictObject({
  id: idSchema,
  workspaceId: idSchema,
  userId: idSchema,
  email: z.email(),
  name: z.string().min(1),
  role: memberRoleSchema,
  joinedAt: z.string().datetime(),
});
export type MemberParsed = z.infer<typeof memberSchema>;

export const listMembersResponseSchema = z.strictObject({
  members: z.array(memberSchema),
});
export type ListMembersResponseParsed = z.infer<typeof listMembersResponseSchema>;

export const inviteMemberRequestSchema = z.strictObject({
  email: z.email(),
  role: memberRoleSchema.default('editor'),
});
export type InviteMemberRequestParsed = z.infer<typeof inviteMemberRequestSchema>;

export const inviteMemberResponseSchema = z.strictObject({
  member: memberSchema,
});
export type InviteMemberResponseParsed = z.infer<typeof inviteMemberResponseSchema>;

export const updateMemberRequestSchema = z.strictObject({
  role: memberRoleSchema,
});
export type UpdateMemberRequestParsed = z.infer<typeof updateMemberRequestSchema>;

export const updateMemberResponseSchema = z.strictObject({
  member: memberSchema,
});
export type UpdateMemberResponseParsed = z.infer<typeof updateMemberResponseSchema>;

export const removeMemberResponseSchema = z.strictObject({
  removed: z.literal(true),
});
export type RemoveMemberResponseParsed = z.infer<typeof removeMemberResponseSchema>;