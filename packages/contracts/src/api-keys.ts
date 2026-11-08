/**
 * API keys (docs/07 §1.1).
 *
 * The token is generated once, shown once and never stored: the database keeps
 * `sha256(token)` only. These schemas describe the public wire surface, so the
 * hash has no schema here and can never be serialised by accident. The row
 * shape (`apiKeyRowSchema`) lives in `db.ts` alongside the other tables.
 *
 * A key is scoped to exactly one workspace. `prefix` is the first 11 characters
 * (`vp_` + 8 hex) and exists so Settings can say *which* key a row is without
 * ever having the secret.
 */

import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';

/** `vp_` + 40 lowercase hex characters. Bump the length only with a migration. */
export const apiKeyTokenSchema = z.string().regex(/^vp_[0-9a-f]{40}$/);
export type ApiKeyToken = z.infer<typeof apiKeyTokenSchema>;

/** The visible part of a key: `vp_` plus the first 8 hex characters. */
export const apiKeyPrefixSchema = z.string().regex(/^vp_[0-9a-f]{8}$/);
export type ApiKeyPrefix = z.infer<typeof apiKeyPrefixSchema>;

/** `sha256` hex as stored in `api_key.hash`. */
export const apiKeyHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export type ApiKeyHash = z.infer<typeof apiKeyHashSchema>;

export const apiKeySchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  prefix: apiKeyPrefixSchema,
  /** `null` until the key is first used; throttled so auth stays read-mostly. */
  lastUsedAt: isoDateTimeSchema.nullable(),
  /** `null` while active; set once and never cleared (revocation is final). */
  revokedAt: isoDateTimeSchema.nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const createApiKeyRequestSchema = z.strictObject({
  /** Human label in Settings, e.g. "CI renderer". */
  name: z.string().trim().min(1).max(100),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

/** The only response that ever contains the secret. */
export const createApiKeyResponseSchema = z.strictObject({
  key: apiKeyTokenSchema,
  apiKey: apiKeySchema,
});
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;

export const listApiKeysResponseSchema = z.strictObject({
  keys: z.array(apiKeySchema),
});
export type ListApiKeysResponse = z.infer<typeof listApiKeysResponseSchema>;

export const revokeApiKeyResponseSchema = z.strictObject({
  apiKey: apiKeySchema,
});
export type RevokeApiKeyResponse = z.infer<typeof revokeApiKeyResponseSchema>;
