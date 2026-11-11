/**
 * Live OAuth gate tests (docs/07 §4.3).
 *
 * These exercise the running Hono app end to end — DCR → consent with a
 * workspace API key → PKCE code exchange → `/mcp` tool call → refresh rotation
 * → revoke — with an in-memory store and a mocked workspace validator. No
 * Postgres, Redis or network is required; only the API forward is stubbed so
 * the `vp_`/`at_` substitution can be asserted.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpApp } from './server';
import { MemoryOAuthStore } from './store';

const WORKSPACE_API_KEY = `vp_${'a'.repeat(40)}`;
const OTHER_API_KEY = `vp_${'b'.repeat(40)}`;
const TEST_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const REDIRECT_URI = 'https://client.example.com/callback';

/** RFC 7636 Appendix B verifier/challenge pair. */
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

type App = ReturnType<typeof createMcpApp>;

interface Harness {
  readonly app: App;
  /** Advance the injected clock by `ms` milliseconds. */
  readonly advance: (ms: number) => void;
}

function harness(): Harness {
  let clock = 1_000;
  const app = createMcpApp({
    apiBaseUrl: 'https://api.example.com',
    oauth: new MemoryOAuthStore({ now: () => clock }),
    authenticateApiKey: async (token) =>
      token === WORKSPACE_API_KEY ? { workspaceId: TEST_WORKSPACE_ID } : null,
    now: () => clock,
  });
  return {
    app,
    advance: (ms) => {
      clock += ms;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function register(
  app: App,
  redirectUris: readonly string[] = [REDIRECT_URI],
): Promise<Response> {
  return app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: redirectUris }),
  });
}

async function newClient(app: App): Promise<string> {
  const res = await register(app);
  expect(res.status).toBe(201);
  return (await json<{ client_id: string }>(res)).client_id;
}

async function consent(
  app: App,
  clientId: string,
  options: {
    readonly apiKey?: string;
    readonly challenge?: string;
    readonly state?: string;
  } = {},
): Promise<Response> {
  const fields: Record<string, string> = {
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: options.challenge ?? CODE_CHALLENGE,
    code_challenge_method: 'S256',
  };
  if (options.apiKey !== undefined) fields.api_key = options.apiKey;
  if (options.state !== undefined) fields.state = options.state;
  return app.request('/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody(fields),
  });
}

async function approvalCode(app: App): Promise<{ code: string; clientId: string }> {
  const clientId = await newClient(app);
  const res = await consent(app, clientId, { apiKey: WORKSPACE_API_KEY, state: 'xyz' });
  expect(res.status).toBe(302);
  const location = res.headers.get('location') ?? '';
  const code = new URL(location).searchParams.get('code');
  if (code === null) throw new Error('approval redirect had no code');
  return { code, clientId };
}

async function exchange(
  app: App,
  code: string,
  options: { readonly verifier?: string; readonly clientId?: string } = {},
): Promise<Response> {
  const fields: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    code_verifier: options.verifier ?? CODE_VERIFIER,
  };
  if (options.clientId !== undefined) fields.client_id = options.clientId;
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody(fields),
  });
}

async function tokenPair(app: App): Promise<{
  readonly access_token: string;
  readonly refresh_token: string;
}> {
  const { code, clientId } = await approvalCode(app);
  const res = await exchange(app, code, { clientId });
  expect(res.status).toBe(200);
  return json(res);
}

async function refresh(app: App, refreshToken: string): Promise<Response> {
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
}

async function revoke(app: App, token: string): Promise<Response> {
  return app.request('/oauth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ token }),
  });
}

/** Call a read-only tool so the route map and auth path both run. */
async function callTool(app: App, token: string): Promise<Response> {
  return app.request('/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_languages', arguments: {} },
    }),
  });
}

/** Stub the outbound API call and record it. */
function stubApi(): Array<{ readonly url: string; readonly init: RequestInit }> {
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ languages: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

// --- DCR --------------------------------------------------------------------

describe('OAuth DCR', () => {
  it('registers and remembers an https redirect URI', async () => {
    const { app } = harness();
    const res = await register(app);
    expect(res.status).toBe(201);
    const body = await json<{ client_id: string; redirect_uris: string[] }>(res);
    expect(body.client_id).toMatch(/^mcp-client-[0-9a-f]{32}$/);
    expect(body.redirect_uris).toEqual([REDIRECT_URI]);
  });

  it('accepts http only on loopback', async () => {
    const { app } = harness();
    const ok = await register(app, ['http://127.0.0.1:33418/callback']);
    expect(ok.status).toBe(201);
    const bad = await register(app, ['http://evil.example.com/callback']);
    expect(bad.status).toBe(400);
    expect((await json<{ error: string }>(bad)).error).toBe('invalid_redirect_uri');
  });

  it('requires at least one redirect URI', async () => {
    const { app } = harness();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('stores multiple redirect URIs', async () => {
    const { app } = harness();
    const res = await register(app, [REDIRECT_URI, 'https://client.example.com/other']);
    expect(res.status).toBe(201);
    expect((await json<{ redirect_uris: string[] }>(res)).redirect_uris).toHaveLength(2);
  });
});

// --- Authorize / consent ----------------------------------------------------

describe('OAuth authorize', () => {
  it('rejects an unknown client', async () => {
    const { app } = harness();
    const query = new URLSearchParams({
      client_id: 'unknown-client',
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
    });
    const res = await app.request(`/oauth/authorize?${query.toString()}`);
    expect(res.status).toBe(400);
  });

  it('rejects an unregistered redirect URI', async () => {
    const { app } = harness();
    const clientId = await newClient(app);
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://attacker.example.com/cb',
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: 'S256',
    });
    const res = await app.request(`/oauth/authorize?${query.toString()}`);
    expect(res.status).toBe(400);
  });

  it('requires PKCE S256', async () => {
    const { app } = harness();
    const clientId = await newClient(app);

    const missing = await app.request(
      `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    );
    expect(missing.status).toBe(400);

    const plain = await app.request(
      `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        REDIRECT_URI,
      )}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=plain`,
    );
    expect(plain.status).toBe(400);
  });

  it('serves a consent form that asks for an API key', async () => {
    const { app } = harness();
    const clientId = await newClient(app);
    const res = await app.request(
      `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        REDIRECT_URI,
      )}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('FacelessPro MCP Authorization');
    expect(body).toContain('name="api_key"');
    expect(body).not.toContain('workspace_id');
  });

  it('rejects consent without an API key', async () => {
    const { app } = harness();
    const clientId = await newClient(app);
    const res = await consent(app, clientId);
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe('access_denied');
  });

  it('rejects consent with an invalid API key', async () => {
    const { app } = harness();
    const clientId = await newClient(app);
    const res = await consent(app, clientId, { apiKey: OTHER_API_KEY });
    expect(res.status).toBe(401);
    expect((await json<{ error: string }>(res)).error).toBe('access_denied');
  });

  it('redirects with a server-generated, single-use code and state', async () => {
    const { app } = harness();
    const { code, clientId } = await approvalCode(app);

    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(code).not.toContain(WORKSPACE_API_KEY);

    expect((await exchange(app, code, { clientId })).status).toBe(200);
    // Second exchange fails: codes are single-use.
    expect((await exchange(app, code, { clientId })).status).toBe(400);
  });
});

// --- Token endpoint ---------------------------------------------------------

describe('OAuth token', () => {
  it('rejects an unsupported grant type', async () => {
    const { app } = harness();
    const res = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({ grant_type: 'client_credentials' }),
    });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe('unsupported_grant_type');
  });

  it('issues a 12 h access token and a refresh token', async () => {
    const { app } = harness();
    const { code, clientId } = await approvalCode(app);
    const res = await exchange(app, code, { clientId });
    expect(res.status).toBe(200);
    const body = await json<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    }>(res);
    expect(body.access_token).toMatch(/^at_[0-9a-f]{64}$/);
    expect(body.refresh_token).toMatch(/^rt_[0-9a-f]{64}$/);
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(43200);
  });

  it('rejects a wrong verifier and burns the code', async () => {
    const { app } = harness();
    const { code, clientId } = await approvalCode(app);

    const wrong = await exchange(app, code, { verifier: 'A'.repeat(43), clientId });
    expect(wrong.status).toBe(400);
    expect((await json<{ error: string }>(wrong)).error).toBe('invalid_grant');

    // Correct verifier cannot rescue a consumed code.
    expect((await exchange(app, code, { clientId })).status).toBe(400);
  });

  it('rejects a code presented by another client', async () => {
    const { app } = harness();
    const { code } = await approvalCode(app);
    const otherClient = await newClient(app);
    expect((await exchange(app, code, { clientId: otherClient })).status).toBe(400);
  });

  it('expires authorization codes after 10 minutes', async () => {
    const { app, advance } = harness();
    const { code, clientId } = await approvalCode(app);
    advance(10 * 60 * 1000 + 1);
    expect((await exchange(app, code, { clientId })).status).toBe(400);
  });

  it('expires access tokens after 12 hours', async () => {
    const { app, advance } = harness();
    const pair = await tokenPair(app);
    advance(12 * 60 * 60 * 1000 + 1);
    expect((await callTool(app, pair.access_token)).status).toBe(401);
  });

  it('rotates the pair and consumes the old refresh token', async () => {
    const { app } = harness();
    const first = await tokenPair(app);

    const rotated = await refresh(app, first.refresh_token);
    expect(rotated.status).toBe(200);
    const second = await json<{ access_token: string; refresh_token: string }>(rotated);
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);

    expect((await refresh(app, first.refresh_token)).status).toBe(400);
  });
});

// --- Revocation -------------------------------------------------------------

describe('OAuth revoke', () => {
  it('requires a token', async () => {
    const { app } = harness();
    const res = await app.request('/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(400);
  });

  it('accepts an unknown token without revealing anything', async () => {
    const { app } = harness();
    expect((await revoke(app, 'not-a-real-token')).status).toBe(200);
  });

  it('kills the access token', async () => {
    const { app } = harness();
    const pair = await tokenPair(app);
    expect((await revoke(app, pair.access_token)).status).toBe(200);
    expect((await callTool(app, pair.access_token)).status).toBe(401);
  });

  it('kills both halves when a refresh token is revoked', async () => {
    const { app } = harness();
    const pair = await tokenPair(app);
    expect((await revoke(app, pair.refresh_token)).status).toBe(200);
    expect((await refresh(app, pair.refresh_token)).status).toBe(400);
    expect((await callTool(app, pair.access_token)).status).toBe(401);
  });

  it('kills both halves when an access token is revoked', async () => {
    const { app } = harness();
    const pair = await tokenPair(app);
    expect((await revoke(app, pair.access_token)).status).toBe(200);
    expect((await refresh(app, pair.refresh_token)).status).toBe(400);
  });
});

// --- /mcp auth --------------------------------------------------------------

describe('MCP authorization', () => {
  it('forwards the workspace key behind an OAuth token, never the at_ token', async () => {
    const calls = stubApi();
    const { app } = harness();
    const pair = await tokenPair(app);

    const res = await callTool(app, pair.access_token);
    expect(res.status).toBe(200);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/workspace');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${WORKSPACE_API_KEY}`);
    expect(headers.Authorization).not.toContain('at_');
  });

  it('rejects an unknown OAuth token with a resource_metadata hint', async () => {
    const { app } = harness();
    const res = await callTool(app, `at_${'0'.repeat(64)}`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate') ?? '').toContain(
      '/.well-known/oauth-protected-resource',
    );
    const body = await json<{ error: { message: string } }>(res);
    expect(body.error.message).toBe('missing or invalid API key');
  });

  it('accepts a static workspace key', async () => {
    const calls = stubApi();
    const { app } = harness();
    const res = await callTool(app, WORKSPACE_API_KEY);
    expect(res.status).toBe(200);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${WORKSPACE_API_KEY}`);
  });

  it('rejects a static key the API does not recognise', async () => {
    const { app } = harness();
    expect((await callTool(app, OTHER_API_KEY)).status).toBe(401);
  });
});
