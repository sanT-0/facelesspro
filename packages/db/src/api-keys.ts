/**
 * API key queries (docs/07 §1.1, docs/03 §6).
 *
 * The secret exists only in the return value of `createApiKey` and on the CLI's
 * stdout. What reaches Postgres is `sha256(token)`; what reaches a list response
 * is the visible `prefix` plus timestamps. There is no query that returns the
 * token for a stored key because the token is not stored.
 *
 * `authenticateApiKey` is the one resolver behind `withWorkspace()`: it is the
 * only place a bearer token becomes a workspace id.
 */

import { createHash, randomBytes } from 'node:crypto';

import {
  apiKeyRowSchema,
  apiKeyTokenSchema,
} from '@facelesspro/contracts';
import type { ApiKeyRow } from '@facelesspro/contracts';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from './client';
import { apiKey } from './schema';

/** `vp_` plus 20 random bytes as hex. 43 characters in total. */
const TOKEN_BYTES = 20;
const TOKEN_PREFIX = 'vp_';
const VISIBLE_HEX = 8;

/** Rewriting `last_used_at` on every request would make auth a write path. */
export const LAST_USED_THROTTLE_SECONDS = 60;

export interface GeneratedApiKey {
  /** The only copy of the secret. Shown once, then forgotten. */
  readonly key: string;
  readonly hash: string;
  readonly prefix: string;
}

export interface CreatedApiKey {
  readonly key: string;
  readonly apiKey: ApiKeyRow;
}

export interface CreateApiKeyInput {
  readonly workspaceId: string;
  readonly name: string;
}

/** `sha256` as lowercase hex — the same form the unique index stores. */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A fresh token plus its storage fields. Never logs or persists `key`. */
export function generateApiKey(): GeneratedApiKey {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('hex')}`;
  return {
    key: token,
    hash: hashApiKey(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + VISIBLE_HEX),
  };
}

/**
 * Create a workspace-scoped key and return the secret exactly once.
 *
 * The insert stores only the hash and prefix. A token collision would violate
 * the unique `hash` index; 160 random bits make that astronomically unlikely, so
 * a collision is a hard error rather than a silent second key.
 */
export async function createApiKey(
  db: Database,
  input: CreateApiKeyInput,
): Promise<CreatedApiKey> {
  const generated = generateApiKey();
  const rows = await db
    .insert(apiKey)
    .values({
      workspace_id: input.workspaceId,
      name: input.name,
      hash: generated.hash,
      prefix: generated.prefix,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('api key insert returned no row');
  return { key: generated.key, apiKey: apiKeyRowSchema.parse(row) };
}

/** Every key for one workspace, active and revoked, ordered for a stable list. */
export async function listApiKeys(
  db: Database,
  workspaceId: string,
): Promise<ApiKeyRow[]> {
  const rows = await db
    .select()
    .from(apiKey)
    .where(eq(apiKey.workspace_id, workspaceId))
    .orderBy(asc(apiKey.name), asc(apiKey.id));
  return rows.map((row) => apiKeyRowSchema.parse(row));
}

/**
 * Revoke a key, irreversibly and idempotently.
 *
 * `coalesce` keeps the first `revoked_at`, so revoking twice is a no-op that
 * still returns the row. The workspace predicate is what makes another
 * workspace's key indistinguishable from a missing one (`404`).
 */
export async function revokeApiKey(
  db: Database,
  workspaceId: string,
  id: string,
): Promise<ApiKeyRow | null> {
  const rows = await db
    .update(apiKey)
    .set({ revoked_at: sql`coalesce(${apiKey.revoked_at}, now())` })
    .where(and(eq(apiKey.id, id), eq(apiKey.workspace_id, workspaceId)))
    .returning();
  const row = rows[0];
  return row === undefined ? null : apiKeyRowSchema.parse(row);
}

/**
 * Resolve a bearer token to its row, or `null` for unknown / malformed /
 * revoked keys.
 *
 * The lookup is by hash, so the plaintext never reaches a query. `last_used_at`
 * is written at most once per `LAST_USED_THROTTLE_SECONDS`; auth is on every
 * request, and an unconditional update would turn reads into contention on one
 * row. A key revoked between the select and the update stays revoked: the
 * update repeats `revoked_at IS NULL` and falls back to the selected row.
 */
export async function authenticateApiKey(
  db: Database,
  token: string,
): Promise<ApiKeyRow | null> {
  if (!apiKeyTokenSchema.safeParse(token).success) return null;

  const rows = await db
    .select()
    .from(apiKey)
    .where(and(eq(apiKey.hash, hashApiKey(token)), isNull(apiKey.revoked_at)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;

  const touched = await db
    .update(apiKey)
    .set({ last_used_at: sql`now()` })
    .where(
      and(
        eq(apiKey.id, row.id),
        isNull(apiKey.revoked_at),
        or(
          isNull(apiKey.last_used_at),
          lt(
            apiKey.last_used_at,
            sql`now() - interval '${sql.raw(String(LAST_USED_THROTTLE_SECONDS))} seconds'`,
          ),
        ),
      ),
    )
    .returning();

  return apiKeyRowSchema.parse(touched[0] ?? row);
}
