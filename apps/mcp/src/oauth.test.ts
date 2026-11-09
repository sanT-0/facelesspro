/**
 * MCP OAuth 2.1 flow tests (docs/07 §4.3).
 *
 * Tests the authorize (consent + workspace pick, PKCE S256), token
 * (code → access 12 h + refresh 90 d rotating), and revoke endpoints.
 */

import { describe, expect, it, vi } from 'vitest';

import { createMcpApp } from './server';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = 'mcp-client-test';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8SWWzoEZU6nsNyk';
const AUTHORIZATION_CODE = 'auth-code-test-123';
const ACCESS_TOKEN = 'access-token-test-456';

function appWith(options: {
  authenticateApiKey?: (token: string) => Promise<{ readonly workspaceId: string } | null>;
  findClient?: (clientId: string) => Promise<{ readonly clientId: string; readonly redirectUris: readonly string[] } | null>;
  createAuthorizationCode?: (input: {
    readonly code: string;
    readonly clientId: string;
    readonly workspaceId: string;
    readonly codeChallenge: string;
  }) => Promise<void>;
  readAuthorizationCode?: (code: string) => Promise<{
    readonly clientId: string;
    readonly workspaceId: string;
    readonly codeChallenge: string;
  } | null>;
  deleteAuthorizationCode?: (code: string) => Promise<void>;
  readRefreshToken?: (token: string) => Promise<{
    readonly workspaceId: string;
  } | null>;
  deleteRefreshToken?: (token: string) => Promise<void>;
  createTokens?: (input: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly workspaceId: string;
  }) => Promise<void>;
  revokeToken?: (token: string) => Promise<void>;
} = {}) {
  return createMcpApp({
    apiBaseUrl: 'http://api.example.com',
    authenticateApiKey:
      options.authenticateApiKey ??
      (async () => ({ workspaceId: WORKSPACE_ID })),
    db: undefined as unknown,
    findClient: options.findClient,
    createAuthorizationCode: options.createAuthorizationCode,
    readAuthorizationCode: options.readAuthorizationCode,
    deleteAuthorizationCode: options.deleteAuthorizationCode,
    readRefreshToken: options.readRefreshToken,
    deleteRefreshToken: options.deleteRefreshToken,
    createTokens: options.createTokens,
    revokeToken: options.revokeToken,
  } as never);
}

describe('MCP OAuth 2.1 authorize endpoint', () => {
  it('rejects missing client_id with 400', async () => {
    const app = appWith({});
    const res = await app.request('/oauth/authorize?redirect_uri=https%3A%2F%2Fclient.example.com%2Fcb&code_challenge=' + CODE_CHALLENGE + '&state=xyz');
    expect(res.status).toBe(400);
  });

  it('rejects unknown client_id with 400', async () => {
    const app = appWith({
      findClient: async () => null,
    });
    const res = await app.request('/oauth/authorize?client_id=unknown&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcb&code_challenge=' + CODE_CHALLENGE + '&state=xyz');
    expect(res.status).toBe(400);
  });

  it('returns consent page with workspace picker for valid request', async () => {
    const app = appWith({
      findClient: async () => ({ clientId: CLIENT_ID, redirectUris: ['https://client.example.com/cb'] }),
    });
    const res = await app.request('/oauth/authorize?client_id=' + CLIENT_ID + '&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcb&code_challenge=' + CODE_CHALLENGE + '&state=xyz');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('FacelessPro');
    expect(body).toContain('Approve');
    expect(body).toContain('workspace_id');
  });

  it('rejects POST without code with 400', async () => {
    const app = appWith({});
    const res = await app.request('/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'workspace_id=' + WORKSPACE_ID,
    });
    expect(res.status).toBe(400);
  });

  it('rejects POST without workspace_id with 400', async () => {
    const app = appWith({});
    const res = await app.request('/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'code=' + AUTHORIZATION_CODE,
    });
    expect(res.status).toBe(400);
  });

  it('redirects back with authorization code for valid POST', async () => {
    const createCode = vi.fn(async (): Promise<void> => {});
    const app = appWith({
      findClient: async () => ({ clientId: CLIENT_ID, redirectUris: ['https://client.example.com/cb'] }),
      createAuthorizationCode: createCode,
    });
    const res = await app.request('/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'code=' + AUTHORIZATION_CODE + '&workspace_id=' + WORKSPACE_ID + '&client_id=' + CLIENT_ID + '&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcb&state=xyz',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('code=' + AUTHORIZATION_CODE);
    expect(res.headers.get('location')).toContain('state=xyz');
    expect(createCode).toHaveBeenCalledOnce();
  });
});

describe('MCP OAuth 2.1 token endpoint', () => {
  it('rejects missing code with 400', async () => {
    const app = appWith({});
    const res = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code',
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid code with 400', async () => {
    const app = appWith({
      readAuthorizationCode: async () => null,
    });
    const res = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&code=invalid-code',
    });
    expect(res.status).toBe(400);
  });

  it('returns access + refresh token for valid code', async () => {
    const createTokens = vi.fn(async (): Promise<void> => {});
    const app = appWith({
      readAuthorizationCode: async () => ({
        clientId: CLIENT_ID,
        workspaceId: WORKSPACE_ID,
        codeChallenge: CODE_CHALLENGE,
      }),
      deleteAuthorizationCode: async (): Promise<void> => {},
      createTokens: createTokens,
    });
    const res = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&code=' + AUTHORIZATION_CODE + '&code_verifier=test-verifier',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      readonly access_token: string;
      readonly token_type: string;
      readonly expires_in: number;
      readonly refresh_token: string;
    };
    expect(body.access_token).toBeDefined();
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(43200); // 12 hours
    expect(body.refresh_token).toBeDefined();
    expect(createTokens).toHaveBeenCalledOnce();
  });

  it('rejects refresh token without valid refresh token', async () => {
    const app = appWith({
      readRefreshToken: async () => null,
    });
    const res = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=invalid',
    });
    expect(res.status).toBe(400);
  });

  it('rotates access + refresh token for valid refresh token', async () => {
    const readRefreshToken = vi.fn(async (): Promise<{
      readonly workspaceId: string;
    } | null> => ({
      workspaceId: WORKSPACE_ID,
    }));
    const deleteRefreshToken = vi.fn(async (): Promise<void> => {});
    const createTokens = vi.fn(async (): Promise<void> => {});
    const app = appWith({ readRefreshToken, deleteRefreshToken, createTokens });
    const res = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=rt_valid-token',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      readonly access_token: string;
      readonly token_type: string;
      readonly expires_in: number;
      readonly refresh_token: string;
    };
    expect(body.access_token).toBeDefined();
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(43200);
    expect(body.refresh_token).toBeDefined();
    expect(readRefreshToken).toHaveBeenCalledWith('rt_valid-token');
    expect(deleteRefreshToken).toHaveBeenCalledWith('rt_valid-token');
    expect(createTokens).toHaveBeenCalledOnce();
  });
});

describe('MCP OAuth 2.1 revoke endpoint', () => {
  it('rejects missing token with 400', async () => {
    const app = appWith({});
    const res = await app.request('/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 for valid token revocation', async () => {
    const revokeToken = vi.fn(async (): Promise<void> => {});
    const app = appWith({ revokeToken: revokeToken });
    const res = await app.request('/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=' + ACCESS_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(revokeToken).toHaveBeenCalledOnce();
  });
});
