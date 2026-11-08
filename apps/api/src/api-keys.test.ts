import {
  createApiKeyResponseSchema,
  listApiKeysResponseSchema,
  revokeApiKeyResponseSchema,
} from '@facelesspro/contracts';
import type { ApiKeyRow } from '@facelesspro/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app';
import { readBearerToken } from './auth';
import type { CreatedApiKey } from './api-keys';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const KEY_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = `vp_${'a'.repeat(40)}`;
const NEW_TOKEN = `vp_${'b'.repeat(40)}`;
const HASH = 'f'.repeat(64);
const REVOKED_AT = '2026-11-08T10:00:00.000Z';

function row(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: KEY_ID,
    workspace_id: WORKSPACE_ID,
    name: 'CI renderer',
    hash: HASH,
    prefix: 'vp_aaaaaaaa',
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function appWith(overrides: {
  authenticateApiKey?: (token: string) => Promise<ApiKeyRow | null>;
  createApiKey?: (input: { workspaceId: string; name: string }) => Promise<CreatedApiKey>;
  listApiKeys?: (workspaceId: string) => Promise<ApiKeyRow[]>;
  revokeApiKey?: (workspaceId: string, id: string) => Promise<ApiKeyRow | null>;
} = {}) {
  return createApp({
    probes: { db: async () => {}, queue: async () => {} },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [],
    readVideo: async () => null,
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    authenticateApiKey:
      overrides.authenticateApiKey ??
      (async (token) => (token === TOKEN ? row() : null)),
    createApiKey:
      overrides.createApiKey ??
      (async () => ({ key: NEW_TOKEN, apiKey: row({ id: MISSING_ID }) })),
    listApiKeys: overrides.listApiKeys ?? (async () => [row()]),
    revokeApiKey:
      overrides.revokeApiKey ??
      (async () => row({ revoked_at: REVOKED_AT })),
    publicBaseUrl: 'http://api.test',
  });
}

function auth(token = TOKEN): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describe('bearer parsing', () => {
  it('accepts a case-insensitive scheme and surrounding whitespace', () => {
    expect(readBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(readBearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(readBearerToken(`  BEARER   ${TOKEN}  `)).toBe(TOKEN);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['no scheme', TOKEN],
    ['basic', `Basic ${TOKEN}`],
    ['empty credential', 'Bearer '],
    ['two credentials', `Bearer ${TOKEN} extra`],
  ])('rejects %s', (_label, header) => {
    expect(readBearerToken(header)).toBeNull();
  });
});

describe('authentication guard', () => {
  it('rejects a missing key with the documented 401 envelope', async () => {
    const app = appWith();
    const response = await app.request('/v1/keys');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'missing or invalid API key' },
    });
  });

  it('rejects an unknown token without calling a mutating dependency', async () => {
    const createApiKey = vi.fn(async () => ({
      key: NEW_TOKEN,
      apiKey: row(),
    }));
    const app = appWith({ createApiKey });

    const response = await app.request('/v1/keys', {
      method: 'POST',
      headers: { ...auth(`vp_${'c'.repeat(40)}`), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'nope' }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(createApiKey).not.toHaveBeenCalled();
  });
});

describe('POST /v1/keys', () => {
  it('returns the secret once, scoped to the authenticated workspace', async () => {
    const createApiKey = vi.fn(async () => ({
      key: NEW_TOKEN,
      apiKey: row({ id: MISSING_ID, name: 'CI renderer', last_used_at: null }),
    }));
    const response = await appWith({ createApiKey }).request('/v1/keys', {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  CI renderer  ' }),
    });

    expect(response.status).toBe(201);
    expect(createApiKey).toHaveBeenCalledTimes(1);
    expect(createApiKey).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      name: 'CI renderer',
    });

    const body = createApiKeyResponseSchema.parse(await response.json());
    expect(body).toEqual({
      key: NEW_TOKEN,
      apiKey: {
        id: MISSING_ID,
        name: 'CI renderer',
        prefix: 'vp_aaaaaaaa',
        lastUsedAt: null,
        revokedAt: null,
      },
    });
    expect(JSON.stringify(body)).not.toContain(HASH);
    expect(JSON.stringify(body)).not.toContain(WORKSPACE_ID);
  });

  it.each([
    ['blank name', { name: '   ' }, 'name'],
    ['missing name', {}, 'name'],
    ['unknown key', { name: 'ok', extra: true }, 'extra'],
    ['wrong type', { name: 42 }, 'name'],
  ])('rejects %s with 400', async (_label, payload, field) => {
    const createApiKey = vi.fn(async () => ({ key: NEW_TOKEN, apiKey: row() }));
    const response = await appWith({ createApiKey }).request('/v1/keys', {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: 'invalid_request', field } });
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before touching the database', async () => {
    const createApiKey = vi.fn(async () => ({ key: NEW_TOKEN, apiKey: row() }));
    const response = await appWith({ createApiKey }).request('/v1/keys', {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: '{',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'invalid_request', message: 'request body must be JSON' },
    });
    expect(createApiKey).not.toHaveBeenCalled();
  });
});

describe('GET /v1/keys', () => {
  it('lists the workspace keys without the hash or a stored token', async () => {
    const listApiKeys = vi.fn(async () => [
      row(),
      row({
        id: MISSING_ID,
        name: 'Old key',
        last_used_at: '2026-11-08T09:00:00.000Z',
        revoked_at: REVOKED_AT,
      }),
    ]);
    const response = await appWith({ listApiKeys }).request('/v1/keys', {
      headers: auth(),
    });

    expect(response.status).toBe(200);
    expect(listApiKeys).toHaveBeenCalledTimes(1);
    expect(listApiKeys).toHaveBeenCalledWith(WORKSPACE_ID);

    const body = listApiKeysResponseSchema.parse(await response.json());
    expect(body.keys).toEqual([
      {
        id: KEY_ID,
        name: 'CI renderer',
        prefix: 'vp_aaaaaaaa',
        lastUsedAt: null,
        revokedAt: null,
      },
      {
        id: MISSING_ID,
        name: 'Old key',
        prefix: 'vp_aaaaaaaa',
        lastUsedAt: '2026-11-08T09:00:00.000Z',
        revokedAt: REVOKED_AT,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(HASH);
  });
});

describe('DELETE /v1/keys/:id', () => {
  it('revokes the key in the authenticated workspace', async () => {
    const revokeApiKey = vi.fn(async () => row({ revoked_at: REVOKED_AT }));
    const response = await appWith({ revokeApiKey }).request(`/v1/keys/${KEY_ID}`, {
      method: 'DELETE',
      headers: auth(),
    });

    expect(response.status).toBe(200);
    expect(revokeApiKey).toHaveBeenCalledTimes(1);
    expect(revokeApiKey).toHaveBeenCalledWith(WORKSPACE_ID, KEY_ID);
    expect(revokeApiKeyResponseSchema.parse(await response.json())).toEqual({
      apiKey: {
        id: KEY_ID,
        name: 'CI renderer',
        prefix: 'vp_aaaaaaaa',
        lastUsedAt: null,
        revokedAt: REVOKED_AT,
      },
    });
  });

  it('is idempotent: a second revoke keeps the first timestamp', async () => {
    const revokeApiKey = vi.fn(async () => row({ revoked_at: REVOKED_AT }));
    const app = appWith({ revokeApiKey });

    const first = await app.request(`/v1/keys/${KEY_ID}`, {
      method: 'DELETE',
      headers: auth(),
    });
    const second = await app.request(`/v1/keys/${KEY_ID}`, {
      method: 'DELETE',
      headers: auth(),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(revokeApiKey).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-UUID id without touching the database', async () => {
    const revokeApiKey = vi.fn(async () => null);
    const response = await appWith({ revokeApiKey }).request('/v1/keys/not-a-uuid', {
      method: 'DELETE',
      headers: auth(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_request', field: 'id' },
    });
    expect(revokeApiKey).not.toHaveBeenCalled();
  });

  it('answers 404 for a key outside this workspace', async () => {
    const revokeApiKey = vi.fn(async () => null);
    const response = await appWith({ revokeApiKey }).request(`/v1/keys/${MISSING_ID}`, {
      method: 'DELETE',
      headers: auth(),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'api key not found' },
    });
  });
});
