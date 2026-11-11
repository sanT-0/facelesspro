/**
 * MCP OAuth 2.1 flow tests (docs/07 §4.3).
 *
 * These tests exercise the real flow through the Hono app with a memory store:
 * DCR → consent with an API key → code → PKCE token exchange → `/mcp` tool
 * call → refresh rotation → revoke. `fetch` is stubbed, so no network and no
 * API/DB are needed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpApp } from './server';
import { MemoryOAuthStore } from './store';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const API_KEY = `vp_${'a'.repeat(40)}`;
const OTHER_API_KEY = `vp_${'b'.repeat(40)}`;
const REDIRECT_URI = 'https://client.example.com/cb';

/** RFC 7636 Appendix B verifier/challenge pair. */
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function appWith(
  options: {
    readonly now?: () => number;
    readonly keys?: Readonly<Record<string, string>>;
  } = {},
) {
  const keys = options.keys ?? { [API_KEY]: WORKSPACE_ID };
  return createMcpApp({
    apiBaseUrl: 'https://api.example.com',
    oauth: new MemoryOAuthStore({ now: options.now }),
    now: options.now,
    authenticateApiKey: async (token) => {
      const workspaceId = keys[token];
      return workspaceId === undefined ? null : { workspaceId };
    },
  });
}

async function registerClient(
  app: ReturnType<typeof appWith>,
  redirectUris: readonly string[] = [REDIRECT_URI],
): Promise<string> {
  const res = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: redirectUris }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

function authorizationUrl(clientId: string, challenge = CODE_CHALLENGE): string {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
  });
  return `/oauth/authorize?${query.toString()}`;
}

async function approve(
  app: ReturnType<typeof appWith>,
  clientId: string,
  apiKey = API_KEY,
): Promise<Response> {
  return app.request('/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      state: 'xyz',
      api_key: apiKey,
    }).toString(),
  });
}

/** Approve, then return the server-generated code from the redirect. */
async function obtainCode(
  app: ReturnType<typeof appWith>,
  clientId: string,
): Promise<string> {
  const res = await approve(app, clientId);
  expect(res.status).toBe(302);
  const location = res.headers.get('location');
  expect(location).not.toBeNull();
  const url = new URL(location ?? 'https://invalid.example');
  const code = url.searchParams.get('code');
  expect(code).not.toBeNull();
  return code ?? '';
}

async function exchangeCode(
  app: ReturnType<typeof appWith>,
  clientId: string,
  code: string,
  verifier = CODE_VERIFIER,
): Promise<Response> {
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
    }).toString(),
  });
}

async function refresh(app: ReturnType<typeof appWith>, refreshToken: string): Promise<Response> {
  return app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
}

async function revoke(app: ReturnType<typeof appWith>, token: string): Promise<Response> {
  return app.request('/oauth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
}

const TOOL_CALL = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'list_art_styles', arguments: {} },
});

async function callMcp(
  app: ReturnType<typeof appWith>,
  token: string,
): Promise<Response> {
  return app.request('/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: TOOL_CALL,
  });
}

type TokenBody = {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly token_type: string;
  readonly expires_in: number;
};

/** Capture and fake the outbound API call made by a tool. */
function stubApi(): Array<{ readonly url: string; readonly init: RequestInit }> {
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ artStyles: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP OAuth dynamic client registration', () => {
  it('registers an https redirect URI and remembers it', async () => {
    const app = appWith();
    const clientId = await registerClient(app);

    const res = await app.request(authorizationUrl(clientId));
    expect(res.status).toBe(200);
  });

  it('accepts http on localhost for native clients', async () => {
    const app = appWith();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:33418/callback'] }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects http redirects that are not loopback', async () => {
    const app = appWith();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example.com/cb'] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_redirect_uri');
  });

  it('rejects missing redirect_uris', async () => {
    const app = appWith();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('MCP OAuth authorize (consent)', () => {
  it('rejects an unknown client', async () => {
    const app = appWith();
    const res = await app.request(authorizationUrl('unknown-client'));
    expect(res.status).toBe(400);
  });

  it('rejects a redirect URI that was not registered', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
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
    const app = appWith();
    const clientId = await registerClient(app);
    const missing = await app.request(
      `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    );
    expect(missing.status).toBe(400);

    const plain = await app.request(authorizationUrl(clientId, 'plain-challenge'));
    expect(plain.status).toBe(400);
  });

  it('serves a consent form that asks for a workspace API key', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const res = await app.request(authorizationUrl(clientId));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('FacelessPro');
    expect(body).toContain('Approve');
    expect(body).toContain('name="api_key"');
    // The client cannot choose a workspace id; only the key identifies one.
    expect(body).not.toContain('workspace_id');
  });

  it('rejects consent without a workspace API key', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const res = await approve(app, clientId, '');
    expect(res.status).toBe(400);
  });

  it('rejects consent with an invalid workspace API key', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const res = await approve(app, clientId, OTHER_API_KEY);
    expect(res.status).toBe(401);
  });

  it('redirects with a server-generated single-use code and echoes state', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const res = await approve(app, clientId);

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('xyz');

    const code = url.searchParams.get('code');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The browser never supplied the code, so it cannot be guessed.
    expect(code).not.toContain(API_KEY);
  });
});

describe('MCP OAuth token endpoint', () => {
  it('rejects a code with the wrong verifier and burns the code', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const code = await obtainCode(app, clientId);

    const wrong = await exchangeCode(app, clientId, code, 'A'.repeat(43));
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe('invalid_grant');

    // Right verifier, same code: it was consumed by the failed attempt.
    const replay = await exchangeCode(app, clientId, code);
    expect(replay.status).toBe(400);
  });

  it('rejects a code issued to another client', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const other = await registerClient(app);
    const code = await obtainCode(app, clientId);

    const res = await exchangeCode(app, other, code);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('returns a 12 h access token and a refresh token for a valid code', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const code = await obtainCode(app, clientId);

    const res = await exchangeCode(app, clientId, code);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TokenBody;

    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(43200);
    expect(body.access_token).toMatch(/^at_[0-9a-f]{64}$/);
    expect(body.refresh_token).toMatch(/^rt_[0-9a-f]{64}$/);
  });

  it('expires authorization codes after 10 minutes', async () => {
    let clock = 1_000;
    const app = appWith({ now: () => clock });
    const clientId = await registerClient(app);
    const code = await obtainCode(app, clientId);

    clock += 10 * 60 * 1000 + 1;
    const res = await exchangeCode(app, clientId, code);
    expect(res.status).toBe(400);
  });

  it('rotates the pair and invalidates the previous session', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const code = await obtainCode(app, clientId);
    const first = (await (await exchangeCode(app, clientId, code)).json()) as TokenBody;

    const refreshed = await refresh(app, first.refresh_token);
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as TokenBody;
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);

    // The old refresh token was consumed, so it cannot be replayed.
    const replay = await refresh(app, first.refresh_token);
    expect(replay.status).toBe(400);
  });

  it('expires access tokens after 12 hours', async () => {
    let clock = 1_000;
    const app = appWith({ now: () => clock });
    const clientId = await registerClient(app);
    const code = await obtainCode(app, clientId);
    const body = (await (await exchangeCode(app, clientId, code)).json()) as TokenBody;

    clock += 12 * 60 * 60 * 1000 + 1;
    const res = await callMcp(app, body.access_token);
    expect(res.status).toBe(401);
  });
});

describe('MCP authorization on /mcp', () => {
  it('forwards the workspace API key behind an OAuth access token', async () => {
    const calls = stubApi();
    const app = appWith();
    const clientId = await registerClient(app);
    const code = await obtainCode(app, clientId);
    const body = (await (await exchangeCode(app, clientId, code)).json()) as TokenBody;

    const res = await callMcp(app, body.access_token);
    expect(res.status).toBe(200);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/art-styles');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    // Never leak the OAuth token to the API.
    expect(headers.Authorization).not.toContain('at_');
  });

  it('rejects an unknown OAuth access token', async () => {
    const app = appWith();
    const res = await callMcp(app, `at_${'0'.repeat(64)}`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate') ?? '').toContain(
      '/.well-known/oauth-protected-resource',
    );
  });

  it('accepts a static workspace key and forwards the same key', async () => {
    const calls = stubApi();
    const app = appWith();

    const res = await callMcp(app, API_KEY);
    expect(res.status).toBe(200);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('rejects a static key the API does not recognise', async () => {
    const app = appWith();
    const res = await callMcp(app, OTHER_API_KEY);
    expect(res.status).toBe(401);
  });

  it('revocation kills both halves of the session', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const code = await obtainCode(app, clientId);
    const body = (await (await exchangeCode(app, clientId, code)).json()) as TokenBody;

    const res = await revoke(app, body.access_token);
    expect(res.status).toBe(200);

    // Access is dead.
    expect((await callMcp(app, body.access_token)).status).toBe(401);
    // So is the refresh token that shared its session.
    expect((await refresh(app, body.refresh_token)).status).toBe(400);
  });

  it('revoking a refresh token also kills its access token', async () => {
    const app = appWith();
    const clientId = await registerClient(app);
    const code = await obtainCode(app, clientId);
    const body = (await (await exchangeCode(app, clientId, code)).json()) as TokenBody;

    expect((await revoke(app, body.refresh_token)).status).toBe(200);
    expect((await callMcp(app, body.access_token)).status).toBe(401);
    expect((await refresh(app, body.refresh_token)).status).toBe(400);
  });
});
