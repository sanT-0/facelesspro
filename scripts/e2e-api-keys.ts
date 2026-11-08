/**
 * `npm run e2e:keys` — the P6 API-key artifact check, made repeatable.
 *
 * Needs a running api and a valid bootstrap key:
 *
 *   npm run dev:api
 *   npm run key:create -- --name "local smoke"     # prints vp_...
 *   FACELESS_API_KEY=vp_... npm run e2e:keys
 *
 * The script creates a key through the real HTTP route, reads the stored row to
 * prove it is `sha256(token)` rather than the token, lists it, revokes it twice
 * (same timestamp), and finally shows the revoked token is denied. It never
 * prints a secret or a hash.
 */

import { createHash } from 'node:crypto';

import {
  apiKey,
  authenticateApiKey,
  createDb,
  hashApiKey,
  loadEnv,
} from '@facelesspro/db';
import {
  createApiKeyResponseSchema,
  listApiKeysResponseSchema,
  revokeApiKeyResponseSchema,
} from '@facelesspro/contracts';
import { eq } from 'drizzle-orm';

loadEnv();

const base = (
  process.env.PUBLIC_BASE_URL?.trim() || 'http://127.0.0.1:3001'
).replace(/\/+$/, '');
const token = process.env.FACELESS_API_KEY?.trim();

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  if (token === undefined || token.length === 0) {
    throw new Error(
      'FACELESS_API_KEY is required; mint one with npm run key:create -- --name "local smoke"',
    );
  }

  const { db, pool } = createDb();
  try {
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const name = `e2e ${new Date().toISOString()}`;

    const createResponse = await fetch(`${base}/v1/keys`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name }),
    });
    if (createResponse.status !== 201) {
      throw new Error(
        `POST /v1/keys returned ${createResponse.status}: ${await createResponse.text()}`,
      );
    }
    const created = createApiKeyResponseSchema.parse(await createResponse.json());

    const owner = await authenticateApiKey(db, token);
    expect(owner !== null, 'the bootstrap key does not authenticate');

    const storedRows = await db
      .select()
      .from(apiKey)
      .where(eq(apiKey.id, created.apiKey.id))
      .limit(1);
    const stored = storedRows[0];
    expect(stored !== undefined, 'the created key is missing from Postgres');
    const expectedHash = createHash('sha256').update(created.key).digest('hex');
    expect(stored.hash === expectedHash, 'stored value is not sha256(token)');
    expect(stored.hash === hashApiKey(created.key), 'hash helper disagrees with node crypto');
    expect(stored.hash !== created.key, 'the raw token was stored');
    expect(stored.workspace_id === owner.workspace_id, 'key landed in the wrong workspace');
    expect(stored.prefix === created.apiKey.prefix, 'stored prefix does not match the response');
    expect(stored.last_used_at === null, 'a brand-new key already has last_used_at');

    const listResponse = await fetch(`${base}/v1/keys`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listResponse.status === 200, `GET /v1/keys returned ${listResponse.status}`);
    const listed = listApiKeysResponseSchema.parse(await listResponse.json());
    expect(
      listed.keys.some((key) => key.id === created.apiKey.id),
      'the created key is absent from the list',
    );
    expect(
      !JSON.stringify(listed).includes(created.key),
      'the list leaked a secret',
    );

    const revocations: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await fetch(`${base}/v1/keys/${created.apiKey.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status === 200, `DELETE attempt ${attempt} returned ${response.status}`);
      const body = revokeApiKeyResponseSchema.parse(await response.json());
      expect(body.apiKey.revokedAt !== null, 'revoke response has no revokedAt');
      revocations.push(body.apiKey.revokedAt);
    }
    expect(revocations[0] === revocations[1], 'the second revoke changed revokedAt');

    const denied = await fetch(`${base}/v1/keys`, {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(denied.status === 401, `revoked key returned ${denied.status}`);
    expect(
      denied.headers.get('www-authenticate') === 'Bearer',
      '401 has no WWW-Authenticate: Bearer header',
    );
    expect((await authenticateApiKey(db, created.key)) === null, 'revoked key still authenticates');

    console.log(
      JSON.stringify(
        {
          base,
          name,
          keyId: created.apiKey.id,
          prefix: created.apiKey.prefix,
          storedHashMatchesSha256: true,
          storedRawToken: false,
          workspaceMatchesBootstrap: true,
          listed: listed.keys.length,
          revokedAt: revocations[0],
          secondRevokeSameTimestamp: true,
          revokedTokenStatus: denied.status,
          wwwAuthenticate: denied.headers.get('www-authenticate'),
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
