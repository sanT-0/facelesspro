import { describe, expect, it } from 'vitest';

import {
  apiKeySchema,
  apiKeyTokenSchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
  listApiKeysResponseSchema,
  revokeApiKeyResponseSchema,
} from './api-keys';

const KEY_ID = '0190a0a0-0000-7000-8000-000000000020';
const TOKEN = `vp_${'a'.repeat(40)}`;

const key = {
  id: KEY_ID,
  name: 'CI renderer',
  prefix: 'vp_aaaaaaaa',
  lastUsedAt: null,
  revokedAt: null,
} as const;

describe('api key token', () => {
  it('accepts exactly vp_ plus 40 lowercase hex characters', () => {
    expect(apiKeyTokenSchema.parse(TOKEN)).toBe(TOKEN);
    expect(apiKeyTokenSchema.safeParse(`vp_${'0'.repeat(40)}`).success).toBe(true);
  });

  it.each([
    ['uppercase hex', `vp_${'A'.repeat(40)}`],
    ['too short', `vp_${'a'.repeat(39)}`],
    ['too long', `vp_${'a'.repeat(41)}`],
    ['wrong prefix', `sk_${'a'.repeat(40)}`],
    ['no prefix', 'a'.repeat(40)],
    ['whitespace', ` vp_${'a'.repeat(40)}`],
  ])('rejects %s', (_label, token) => {
    expect(apiKeyTokenSchema.safeParse(token).success).toBe(false);
  });
});

describe('api key wire shapes', () => {
  it('parses a key and keeps the hash out of the shape', () => {
    expect(apiKeySchema.parse(key)).toEqual(key);
    expect(
      apiKeySchema.safeParse({ ...key, hash: 'f'.repeat(64) }).success,
    ).toBe(false);
  });

  it('accepts a revoked key with both timestamps set', () => {
    expect(
      apiKeySchema.parse({
        ...key,
        lastUsedAt: '2026-11-08T09:00:00.000Z',
        revokedAt: '2026-11-08T10:00:00.000Z',
      }),
    ).toMatchObject({
      lastUsedAt: '2026-11-08T09:00:00.000Z',
      revokedAt: '2026-11-08T10:00:00.000Z',
    });
  });

  it('requires an ISO timestamp, not a Date or a bare date', () => {
    expect(
      apiKeySchema.safeParse({ ...key, lastUsedAt: '2026-11-08' }).success,
    ).toBe(false);
    expect(
      apiKeySchema.safeParse({ ...key, lastUsedAt: new Date() }).success,
    ).toBe(false);
  });

  it('trims a create name and rejects blank or over-long names', () => {
    expect(createApiKeyRequestSchema.parse({ name: '  CI renderer  ' })).toEqual({
      name: 'CI renderer',
    });
    expect(createApiKeyRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(
      createApiKeyRequestSchema.safeParse({ name: 'x'.repeat(101) }).success,
    ).toBe(false);
    expect(
      createApiKeyRequestSchema.safeParse({ name: 'ok', extra: true }).success,
    ).toBe(false);
  });

  it('parses the one-time create response', () => {
    expect(createApiKeyResponseSchema.parse({ key: TOKEN, apiKey: key })).toEqual({
      key: TOKEN,
      apiKey: key,
    });
    expect(
      createApiKeyResponseSchema.safeParse({ key: 'not-a-key', apiKey: key }).success,
    ).toBe(false);
  });

  it('parses list and revoke responses', () => {
    expect(listApiKeysResponseSchema.parse({ keys: [key] })).toEqual({ keys: [key] });
    expect(listApiKeysResponseSchema.parse({ keys: [] })).toEqual({ keys: [] });
    expect(
      revokeApiKeyResponseSchema.parse({
        apiKey: { ...key, revokedAt: '2026-11-08T10:00:00.000Z' },
      }).apiKey.revokedAt,
    ).toBe('2026-11-08T10:00:00.000Z');
  });
});
