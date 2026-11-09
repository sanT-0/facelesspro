/**
 * Bearer authentication for `/v1/*` (docs/07 §1.1).
 *
 * `withWorkspace()` is the only place a token becomes a workspace id. Routes
 * read `c.get('workspaceId')` and never parse a header or touch a key row
 * themselves, so scoping cannot drift handler by handler.
 *
 * A missing, malformed, unknown or revoked key is the same `401 unauthorized`
 * with `WWW-Authenticate: Bearer`. The response deliberately does not say
 * *which* of those it was: that would turn the endpoint into a key oracle.
 */

import type { ApiKeyRow } from '@facelesspro/contracts';
import { apiError } from '@facelesspro/contracts';
import { createMiddleware } from 'hono/factory';

import type { RateLimiter } from './rate-limit';

export interface AuthDeps {
  /** Resolve a bearer token; `null` when unknown, malformed or revoked. */
  readonly authenticateApiKey: (token: string) => Promise<ApiKeyRow | null>;
  /** Per-key and per-workspace fixed windows, checked after authentication. */
  readonly rateLimit: RateLimiter;
}

export interface WorkspaceVariables {
  /** The authenticated key's workspace. The only scoping input routes get. */
  readonly workspaceId: string;
  /** The resolved row, for routes that need the key id or label. */
  readonly apiKey: ApiKeyRow;
}

export type WorkspaceEnv = { Variables: WorkspaceVariables };

/**
 * Extract the credential from an `Authorization` header.
 *
 * The scheme is case-insensitive (RFC 7235); anything that is not a `Bearer`
 * header with a non-empty credential is `null`. Token shape is checked by the
 * resolver, not here, so this function has no opinion about `vp_`.
 */
export function readBearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function withWorkspace(deps: AuthDeps) {
  return createMiddleware<WorkspaceEnv>(async (c, next) => {
    const token = readBearerToken(c.req.header('authorization'));
    if (token === null) {
      return c.json(apiError('unauthorized', 'missing or invalid API key'), 401, {
        'WWW-Authenticate': 'Bearer',
      });
    }

    const row = await deps.authenticateApiKey(token);
    if (row === null) {
      return c.json(apiError('unauthorized', 'missing or invalid API key'), 401, {
        'WWW-Authenticate': 'Bearer',
      });
    }

    const decision = deps.rateLimit.check(row.id, row.workspace_id);
    if (!decision.allowed) {
      return c.json(apiError('rate_limited', 'rate limit exceeded'), 429, {
        'Retry-After': String(decision.retryAfterSeconds),
      });
    }

    c.set('workspaceId', row.workspace_id);
    c.set('apiKey', row);
    await next();
  });
}
