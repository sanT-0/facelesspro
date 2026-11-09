/**
 * Authentication fixture shared by route tests.
 *
 * Protected routers run the real `withWorkspace()`; this helper supplies only a
 * key row and the matching Bearer header, so each suite exercises the same
 * middleware the server uses. `server.ts` never imports this module.
 */

import type { ApiKeyRow } from '@facelesspro/contracts';
import type { Hono } from 'hono';

import type { AuthDeps } from './auth';

export const TEST_TOKEN = `vp_${'a'.repeat(40)}`;
export const TEST_KEY_ID = '44444444-4444-4444-8444-444444444444';

export function testApiKey(
  workspaceId: string,
  overrides: Partial<ApiKeyRow> = {},
): ApiKeyRow {
  return {
    id: TEST_KEY_ID,
    workspace_id: workspaceId,
    name: 'route test',
    hash: 'a'.repeat(64),
    prefix: `vp_${'a'.repeat(8)}`,
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

/** Auth deps that accept exactly `TEST_TOKEN` for one workspace. */
export function testAuth(workspaceId: string): AuthDeps {
  return {
    authenticateApiKey: async (token) =>
      token === TEST_TOKEN ? testApiKey(workspaceId) : null,
    rateLimit: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
  };
}

export interface TestClient {
  /** Sends the Bearer header unless the test supplied its own `Authorization`. */
  request(input: string, init?: RequestInit): Promise<Response>;
  /** Unwrapped request, for the 401 cases. */
  raw(input: string, init?: RequestInit): Promise<Response>;
}

/**
 * Wrap an app so a suite does not repeat the Authorization header on every
 * request. The header still travels through the real middleware; only the
 * 401 tests use `raw`.
 */
export function testClient(app: Hono): TestClient {
  return {
    async request(input, init = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has('authorization')) {
        headers.set('authorization', `Bearer ${TEST_TOKEN}`);
      }
      return app.request(input, { ...init, headers });
    },
    async raw(input, init) {
      return app.request(input, init);
    },
  };
}
