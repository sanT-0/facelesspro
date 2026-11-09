/**
 * `/v1/keys` over real Postgres.
 *
 * The hermetic suite pins the wire contract. This proves the properties the
 * contract only describes: the stored value is `sha256(token)` and not the
 * token, a created key actually authenticates, revocation is immediate,
 * idempotent and irreversible, and one workspace cannot see or revoke another's
 * key.
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  apiKeyRowSchema,
  createApiKeyResponseSchema,
  listApiKeysResponseSchema,
  revokeApiKeyResponseSchema,
} from '@facelesspro/contracts';
import {
  apiKey,
  authenticateApiKey,
  createApiKey as createApiKeyRow,
  createDb,
  hashApiKey,
  listApiKeys as listApiKeysRow,
  revokeApiKey as revokeApiKeyRow,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { eq, inArray } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app';

let db: Database;
let pool: Pool;
let workspaceA: string;
let workspaceB: string;
let bootstrap: { key: string; apiKey: { id: string } };

function app() {
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
    authenticateApiKey: (token) => authenticateApiKey(db, token),
    rateLimit: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
    createApiKey: (input) => createApiKeyRow(db, input),
    listApiKeys: (workspaceId) => listApiKeysRow(db, workspaceId),
    revokeApiKey: (workspaceId, id) => revokeApiKeyRow(db, workspaceId, id),
    publicBaseUrl: 'http://api.test',
  });
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function storedKey(id: string) {
  const rows = await db.select().from(apiKey).where(eq(apiKey.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw new Error(`api key ${id} not found`);
  return apiKeyRowSchema.parse(row);
}

describe('/v1/keys (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    workspaceA = randomUUID();
    workspaceB = randomUUID();
    await db.insert(workspace).values([
      { id: workspaceA, name: 'Keys A' },
      { id: workspaceB, name: 'Keys B' },
    ]);
    bootstrap = await createApiKeyRow(db, {
      workspaceId: workspaceA,
      name: 'bootstrap',
    });
  });

  afterEach(async () => {
    await db.delete(workspace).where(inArray(workspace.id, [workspaceA, workspaceB]));
  });

  it('stores sha256 of the key, tells the client once and never lists it', async () => {
    const response = await app().request('/v1/keys', {
      method: 'POST',
      headers: { ...auth(bootstrap.key), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'CI renderer' }),
    });

    expect(response.status).toBe(201);
    const body = createApiKeyResponseSchema.parse(await response.json());
    expect(body.key).toMatch(/^vp_[0-9a-f]{40}$/);
    expect(body.apiKey).toMatchObject({
      name: 'CI renderer',
      prefix: body.key.slice(0, 11),
      lastUsedAt: null,
      revokedAt: null,
    });

    const stored = await storedKey(body.apiKey.id);
    expect(stored.workspace_id).toBe(workspaceA);
    expect(stored.prefix).toBe(body.key.slice(0, 11));
    expect(stored.hash).toBe(createHash('sha256').update(body.key).digest('hex'));
    expect(stored.hash).toBe(hashApiKey(body.key));
    expect(stored.hash).not.toBe(body.key);
    expect(JSON.stringify(body)).not.toContain(stored.hash);
    expect(JSON.stringify(body)).not.toContain(workspaceA);
  });

  it('a created key authenticates and updates last_used_at at most once per throttle window', async () => {
    const created = await createApiKeyRow(db, {
      workspaceId: workspaceA,
      name: 'created',
    });
    expect((await storedKey(created.apiKey.id)).last_used_at).toBeNull();

    const first = await authenticateApiKey(db, created.key);
    expect(first?.workspace_id).toBe(workspaceA);
    expect(first?.last_used_at).toMatch(/T/);

    const second = await authenticateApiKey(db, created.key);
    expect(second?.last_used_at).toBe(first?.last_used_at);

    const unknown = `vp_${'0'.repeat(40)}`;
    expect(await authenticateApiKey(db, unknown)).toBeNull();
    expect(await authenticateApiKey(db, 'not-a-key')).toBeNull();
  });

  it('lists only the caller workspace, active and revoked rows, without hashes', async () => {
    const mine = await createApiKeyRow(db, { workspaceId: workspaceA, name: 'b' });
    const other = await createApiKeyRow(db, { workspaceId: workspaceB, name: 'other' });

    const response = await app().request('/v1/keys', { headers: auth(bootstrap.key) });
    expect(response.status).toBe(200);

    const body = listApiKeysResponseSchema.parse(await response.json());
    expect(body.keys.map((key) => key.id).sort()).toEqual(
      [bootstrap.apiKey.id, mine.apiKey.id].sort(),
    );
    expect(body.keys.map((key) => key.id)).not.toContain(other.apiKey.id);
    expect(JSON.stringify(body)).not.toContain((await storedKey(mine.apiKey.id)).hash);
    expect(body.keys.every((key) => key.revokedAt === null)).toBe(true);
  });

  it('revokes immediately, keeps the first timestamp on repeat, and stays revoked', async () => {
    const admin = await createApiKeyRow(db, { workspaceId: workspaceA, name: 'admin' });

    const first = await app().request(`/v1/keys/${bootstrap.apiKey.id}`, {
      method: 'DELETE',
      headers: auth(admin.key),
    });
    expect(first.status).toBe(200);
    const firstBody = revokeApiKeyResponseSchema.parse(await first.json());
    expect(firstBody.apiKey.revokedAt).toMatch(/T/);

    // The revoked token is already dead, including on the key API itself.
    const denied = await app().request('/v1/keys', { headers: auth(bootstrap.key) });
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toBe('Bearer');
    expect(await authenticateApiKey(db, bootstrap.key)).toBeNull();

    const second = await app().request(`/v1/keys/${bootstrap.apiKey.id}`, {
      method: 'DELETE',
      headers: auth(admin.key),
    });
    expect(second.status).toBe(200);
    const secondBody = revokeApiKeyResponseSchema.parse(await second.json());
    expect(secondBody.apiKey.revokedAt).toBe(firstBody.apiKey.revokedAt);
    expect((await storedKey(bootstrap.apiKey.id)).revoked_at).toBe(
      firstBody.apiKey.revokedAt,
    );

    const listed = listApiKeysResponseSchema.parse(
      await (await app().request('/v1/keys', { headers: auth(admin.key) })).json(),
    );
    expect(listed.keys.find((key) => key.id === bootstrap.apiKey.id)?.revokedAt).toBe(
      firstBody.apiKey.revokedAt,
    );
  });

  it("cannot revoke another workspace's key and reports it as not found", async () => {
    const other = await createApiKeyRow(db, { workspaceId: workspaceB, name: 'other' });

    const response = await app().request(`/v1/keys/${other.apiKey.id}`, {
      method: 'DELETE',
      headers: auth(bootstrap.key),
    });
    expect(response.status).toBe(404);

    const still = await authenticateApiKey(db, other.key);
    expect(still?.workspace_id).toBe(workspaceB);
    expect((await storedKey(other.apiKey.id)).revoked_at).toBeNull();
  });
});
