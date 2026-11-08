/**
 * `/v1/keys` — create, list and revoke the caller's workspace keys.
 *
 * The secret is returned exactly once by `POST /v1/keys`; every later response
 * carries only `prefix` and timestamps. Revocation is final and idempotent:
 * the first call sets `revokedAt`, a second call returns the same timestamp and
 * `200` instead of inventing a `409`.
 *
 * The whole router sits behind `withWorkspace()`. Minting the *first* key is
 * the CLI's job (`npm run key:create`) because this endpoint already needs a
 * key to be reachable.
 */

import { Hono } from 'hono';

import {
  apiError,
  apiKeyRowSchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
  idSchema,
  listApiKeysResponseSchema,
  revokeApiKeyResponseSchema,
} from '@facelesspro/contracts';
import type {
  ApiKey,
  ApiKeyRow,
  CreateApiKeyResponse,
  ListApiKeysResponse,
  RevokeApiKeyResponse,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';

export interface CreateApiKeyInput {
  readonly workspaceId: string;
  readonly name: string;
}

export interface CreatedApiKey {
  readonly key: string;
  readonly apiKey: ApiKeyRow;
}

export interface ApiKeyRouteDeps extends AuthDeps {
  readonly createApiKey: (input: CreateApiKeyInput) => Promise<CreatedApiKey>;
  readonly listApiKeys: (workspaceId: string) => Promise<ApiKeyRow[]>;
  /** `null` when the id does not belong to this workspace. */
  readonly revokeApiKey: (workspaceId: string, id: string) => Promise<ApiKeyRow | null>;
}

/** Row → wire. The hash is not part of this mapping and cannot leak. */
function toApiKey(row: ApiKeyRow): ApiKey {
  const parsed = apiKeyRowSchema.parse(row);
  return {
    id: parsed.id,
    name: parsed.name,
    prefix: parsed.prefix,
    lastUsedAt: parsed.last_used_at ?? null,
    revokedAt: parsed.revoked_at ?? null,
  };
}

/** Zod issue → the `field` a client can highlight, matching the other routes. */
function issueField(issue: {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly keys?: readonly string[];
}): string | undefined {
  if (issue.path.length > 0) return issue.path.map(String).join('.');
  if (issue.code === 'unrecognized_keys' && issue.keys !== undefined) {
    return issue.keys[0];
  }
  return undefined;
}

export function createApiKeyRoutes(deps: ApiKeyRouteDeps): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  app.use('*', withWorkspace(deps));

  app.post('/', async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(apiError('invalid_request', 'request body must be JSON'), 400);
    }

    const parsed = createApiKeyRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json(
        apiError(
          'invalid_request',
          issue?.message ?? 'invalid request',
          issue === undefined ? undefined : issueField(issue),
        ),
        400,
      );
    }

    const created = await deps.createApiKey({
      workspaceId: c.get('workspaceId'),
      name: parsed.data.name,
    });
    const body: CreateApiKeyResponse = createApiKeyResponseSchema.parse({
      key: created.key,
      apiKey: toApiKey(created.apiKey),
    });
    return c.json(body, 201);
  });

  app.get('/', async (c) => {
    const rows = await deps.listApiKeys(c.get('workspaceId'));
    const body: ListApiKeysResponse = listApiKeysResponseSchema.parse({
      keys: rows.map(toApiKey),
    });
    return c.json(body, 200);
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!idSchema.safeParse(id).success) {
      return c.json(apiError('invalid_request', 'id must be a UUID', 'id'), 400);
    }

    const row = await deps.revokeApiKey(c.get('workspaceId'), id);
    if (row === null) return c.json(apiError('not_found', 'api key not found'), 404);

    const body: RevokeApiKeyResponse = revokeApiKeyResponseSchema.parse({
      apiKey: toApiKey(row),
    });
    return c.json(body, 200);
  });

  return app;
}
