/**
 * `facelesspro-mcp` — Model Context Protocol server (docs/01 §10, docs/07 §4).
 *
 * JSON-RPC 2.0 over Streamable HTTP at `/mcp`. Tools are 1:1 with `/v1`
 * routes. A failing tool returns error text, not a protocol error.
 *
 * Two auth modes:
 *   1. Static bearer API token: `Authorization: Bearer vp_<40 hex>`
 *   2. OAuth 2.1 + PKCE (metadata + register + consent + token + revoke)
 *
 * OAuth never trusts a workspace id supplied by the client. Consent requires a
 * workspace API key, the API validates it, and the resulting tokens remember
 * that key. `/mcp` resolves either credential to the same `{ workspaceId,
 * apiKey }` pair, and tool calls forward the `vp_` key — never an `at_` token —
 * to the API.
 *
 * The MCP server makes internal HTTP calls to the API server's `/v1` routes
 * to execute tools, keeping the two services decoupled.
 */

import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

type MCPVariables = {
  readonly workspaceId: string;
  /** The `vp_` key to forward to the API; set from either auth mode. */
  readonly apiKey: string;
};
type MCPContext = Hono<{ Variables: MCPVariables }>;

import {
  ALL_MCP_TOOLS,
  initializeResultSchema,
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
  oauthAuthorizationServerSchema,
  oauthProtectedResourceSchema,
  oauthRegisterResponseSchema,
  toolCallResultSchema,
  toolListResultSchema,
} from '@facelesspro/contracts';

import type { OAuthStore } from './store';

/** JSON-RPC 2.0 error codes. */
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Authorization code lifetime: 10 minutes. */
const CODE_TTL_MS = 10 * 60 * 1000;
/** Access token lifetime: 12 hours. */
const ACCESS_TTL_SECONDS = 12 * 60 * 60;
/** Refresh token lifetime: 90 days, rotated on every use. */
const REFRESH_TTL_SECONDS = 90 * 24 * 60 * 60;
/** S256 challenges are exactly 43 base64url characters. */
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 code verifier alphabet and length. */
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * MCP server dependencies.
 */
export interface McpDeps {
  /** Base URL of the API server for internal calls. */
  readonly apiBaseUrl: string;
  /**
   * Resolve a workspace API key against the API; `null` when unknown,
   * malformed or revoked. Used for static bearers and at OAuth consent.
   */
  readonly authenticateApiKey: (
    token: string,
  ) => Promise<{ readonly workspaceId: string } | null>;
  /** OAuth clients, codes and token pairs. */
  readonly oauth: OAuthStore;
  /** Injectable clock (Unix epoch ms). Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Create the MCP Hono app.
 */
export function createMcpApp(deps: McpDeps): MCPContext {
  const app = new Hono<{ Variables: MCPVariables }>();
  const now = deps.now ?? Date.now;

  // --- error handler -------------------------------------------------------
  app.onError((err, c) => {
    console.error('[mcp] unhandled error', err);
    return c.json(
      jsonRpcResponseSchema.parse({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR,
          message: 'internal error',
        },
      }),
      500,
      { 'content-type': 'application/json; charset=utf-8' },
    );
  });

  // --- OAuth 2.1 protected resource metadata (RFC 9728) -------------------
  app.get('/.well-known/oauth-protected-resource', (c) => {
    const base = originOf(c);
    return c.json(
      oauthProtectedResourceSchema.parse({
        resource: base,
        authorization_servers: [base],
        scopes_supported: ['read', 'write'],
        bearer_methods_supported: ['header'],
        revocation_methods_supported: ['header'],
        introspection_methods_supported: ['header'],
        code_challenge_methods_supported: ['S256'],
      }),
      200,
      { 'content-type': 'application/json; charset=utf-8' },
    );
  });

  // --- OAuth 2.1 authorization server metadata (RFC 8414) ----------------
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const base = originOf(c);
    return c.json(
      oauthAuthorizationServerSchema.parse({
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        revocation_endpoint: `${base}/oauth/revoke`,
      }),
      200,
      { 'content-type': 'application/json; charset=utf-8' },
    );
  });

  // --- OAuth 2.1 dynamic client registration (RFC 7591) ------------------
  app.post('/oauth/register', async (c) => {
    // DCR with no client secret. Redirect URIs must be https or localhost;
    // they are stored, never echoed back unregistered.
    const raw = await c.req.json().catch(() => undefined);
    const parsed = z
      .object({
        redirect_uris: z.array(z.string()).min(1).max(10),
        client_name: z.string().max(200).optional(),
      })
      .safeParse(raw);

    if (!parsed.success) {
      return oauthError(c, 400, 'invalid_client_metadata', 'redirect_uris is required');
    }

    for (const uri of parsed.data.redirect_uris) {
      if (!isAllowedRedirectUri(uri)) {
        return oauthError(
          c,
          400,
          'invalid_redirect_uri',
          'redirect_uri must be https or http on localhost',
        );
      }
    }

    const clientId = `mcp-client-${randomBytes(16).toString('hex')}`;
    await deps.oauth.registerClient({
      clientId,
      redirectUris: parsed.data.redirect_uris,
    });

    return c.json(
      oauthRegisterResponseSchema.parse({
        client_id: clientId,
        redirect_uris: parsed.data.redirect_uris,
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'none',
      }),
      201,
      { 'content-type': 'application/json; charset=utf-8' },
    );
  });

  // --- OAuth 2.1 authorization endpoint -----------------------------------
  app.get('/oauth/authorize', async (c) => {
    const clientId = c.req.query('client_id');
    const redirectUri = c.req.query('redirect_uri');
    const codeChallenge = c.req.query('code_challenge');
    const method = c.req.query('code_challenge_method') ?? 'S256';
    const state = c.req.query('state');

    if (!clientId || !redirectUri || !codeChallenge) {
      return oauthError(c, 400, 'invalid_request', 'missing required parameters');
    }
    if (method !== 'S256' || !PKCE_CHALLENGE.test(codeChallenge)) {
      return oauthError(c, 400, 'invalid_request', 'PKCE S256 is required');
    }

    const client = await deps.oauth.findClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return oauthError(c, 400, 'invalid_request', 'unknown client or redirect_uri');
    }

    // Consent: the user proves workspace access with an API key. There is no
    // workspace picker because the key *is* the workspace identity.
    return c.html(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>FacelessPro MCP Authorization</title></head><body>` +
        `<h1>FacelessPro MCP Authorization</h1>` +
        `<p>Client <code>${escapeHtml(clientId)}</code> requests access to your workspace.</p>` +
        `<form method="post" action="/oauth/authorize">` +
        `<input type="hidden" name="client_id" value="${escapeHtml(clientId)}"/>` +
        `<input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}"/>` +
        `<input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}"/>` +
        `<input type="hidden" name="state" value="${escapeHtml(state ?? '')}"/>` +
        `<label>Workspace API key: <input name="api_key" type="password" autocomplete="off" required/></label><br/>` +
        `<button type="submit">Approve</button>` +
        `</form></body></html>`,
      200,
      { 'content-type': 'text/html; charset=utf-8' },
    );
  });

  app.post('/oauth/authorize', async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const clientId = formString(body, 'client_id');
    const redirectUri = formString(body, 'redirect_uri');
    const codeChallenge = formString(body, 'code_challenge');
    const state = formString(body, 'state');
    const apiKey = formString(body, 'api_key');

    if (!clientId || !redirectUri || !codeChallenge) {
      return oauthError(c, 400, 'invalid_request', 'missing required parameters');
    }
    if (!PKCE_CHALLENGE.test(codeChallenge)) {
      return oauthError(c, 400, 'invalid_request', 'PKCE S256 is required');
    }

    const client = await deps.oauth.findClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return oauthError(c, 400, 'invalid_request', 'unknown client or redirect_uri');
    }

    if (!apiKey) {
      return oauthError(c, 400, 'access_denied', 'a workspace API key is required');
    }

    // The API decides whether this key is real and which workspace it owns.
    // Nothing the browser submitted is trusted as a workspace identity.
    const identity = await deps.authenticateApiKey(apiKey);
    if (identity === null) {
      return oauthError(c, 401, 'access_denied', 'invalid workspace API key');
    }

    // Server-generated, single-use, short-lived.
    const code = randomBytes(32).toString('base64url');
    await deps.oauth.createAuthorizationCode({
      code,
      clientId,
      redirectUri,
      workspaceId: identity.workspaceId,
      apiKey,
      codeChallenge,
      expiresAt: now() + CODE_TTL_MS,
    });

    const redirectUrl =
      redirectUri +
      '?code=' +
      encodeURIComponent(code) +
      (state ? '&state=' + encodeURIComponent(state) : '');

    return c.redirect(redirectUrl, 302);
  });

  // --- OAuth 2.1 token endpoint ------------------------------------------
  app.post('/oauth/token', async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const grantType = formString(body, 'grant_type');

    if (grantType === 'authorization_code') {
      const code = formString(body, 'code');
      const codeVerifier = formString(body, 'code_verifier');
      const clientId = formString(body, 'client_id');

      if (!code || !codeVerifier) {
        return oauthError(c, 400, 'invalid_request', 'code and code_verifier are required');
      }

      // Consume first: a failed PKCE check still burns the code, so guessing
      // the verifier cannot be retried against the same code.
      const authCode = await deps.oauth.consumeAuthorizationCode(code);
      if (!authCode) {
        return oauthError(c, 400, 'invalid_grant', 'invalid or expired code');
      }
      if (clientId !== undefined && clientId !== authCode.clientId) {
        return oauthError(c, 400, 'invalid_grant', 'code was issued to another client');
      }
      if (!pkceMatches(codeVerifier, authCode.codeChallenge)) {
        return oauthError(c, 400, 'invalid_grant', 'code_verifier does not match code_challenge');
      }

      const tokens = issueTokens();
      await deps.oauth.createTokens({
        ...tokens,
        sessionId: randomBytes(16).toString('hex'),
        workspaceId: authCode.workspaceId,
        apiKey: authCode.apiKey,
        accessExpiresAt: now() + ACCESS_TTL_SECONDS * 1000,
        refreshExpiresAt: now() + REFRESH_TTL_SECONDS * 1000,
      });

      return tokenResponse(tokens.accessToken, tokens.refreshToken);
    }

    if (grantType === 'refresh_token') {
      const refreshToken = formString(body, 'refresh_token');
      if (!refreshToken) {
        return oauthError(c, 400, 'invalid_request', 'refresh_token is required');
      }

      const rotated = await deps.oauth.consumeRefreshToken(refreshToken);
      if (!rotated) {
        return oauthError(c, 400, 'invalid_grant', 'invalid or expired refresh token');
      }

      // Rotation replaces the whole session: the old access token dies too.
      await deps.oauth.revokeSession(rotated.sessionId);

      const tokens = issueTokens();
      await deps.oauth.createTokens({
        ...tokens,
        sessionId: randomBytes(16).toString('hex'),
        workspaceId: rotated.workspaceId,
        apiKey: rotated.apiKey,
        accessExpiresAt: now() + ACCESS_TTL_SECONDS * 1000,
        refreshExpiresAt: now() + REFRESH_TTL_SECONDS * 1000,
      });

      return tokenResponse(tokens.accessToken, tokens.refreshToken);
    }

    return oauthError(c, 400, 'unsupported_grant_type', 'unsupported grant_type');
  });

  // --- OAuth 2.1 revocation endpoint (RFC 7009) --------------------------
  app.post('/oauth/revoke', async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const token = formString(body, 'token');

    if (!token) {
      return oauthError(c, 400, 'invalid_request', 'token is required');
    }

    // RFC 7009: unknown tokens are a success, not an oracle.
    await deps.oauth.revokeToken(token);
    return c.json({}, 200, { 'content-type': 'application/json; charset=utf-8' });
  });

  // --- auth middleware for /mcp ------------------------------------------
  app.use(
    '/mcp',
    createMiddleware<{ Variables: MCPVariables }>(async (c, next) => {
      const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');

      let identity: { readonly workspaceId: string; readonly apiKey: string } | null = null;

      if (token) {
        if (token.startsWith('at_')) {
          // OAuth access token: the API key behind it is what gets forwarded.
          const row = await deps.oauth.readAccessToken(token);
          identity = row
            ? { workspaceId: row.workspaceId, apiKey: row.apiKey }
            : null;
        } else {
          // Static bearer: the key itself is the credential.
          const row = await deps.authenticateApiKey(token);
          identity = row ? { workspaceId: row.workspaceId, apiKey: token } : null;
        }
      }

      if (identity === null) {
        return c.json(
          jsonRpcResponseSchema.parse({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: JSON_RPC_ERRORS.INVALID_REQUEST,
              message: 'missing or invalid API key',
            },
          }),
          401,
          {
            'content-type': 'application/json; charset=utf-8',
            'WWW-Authenticate': `Bearer resource_metadata="${originOf(c)}/.well-known/oauth-protected-resource"`,
          },
        );
      }

      c.set('workspaceId', identity.workspaceId);
      c.set('apiKey', identity.apiKey);
      await next();
    }),
  );

  // --- MCP endpoint --------------------------------------------------------
  app.post('/mcp', async (c: Context<{ Variables: MCPVariables }>) => {
    const workspaceId = c.get('workspaceId');
    const apiKey = c.get('apiKey');
    const acceptSse =
      c.req.header('accept')?.includes('text/event-stream') ?? false;

    const sendResponse = async (
      response: unknown,
      status: 200 | 400 | 500,
    ): Promise<Response> => {
      if (acceptSse) {
        const data = JSON.stringify(response);
        return new Response(`event: message\ndata: ${data}\n\n`, {
          status,
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
        });
      }
      return c.json(response, status, {
        'content-type': 'application/json; charset=utf-8',
      });
    };

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return sendResponse(
        jsonRpcResponseSchema.parse({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: JSON_RPC_ERRORS.PARSE_ERROR,
            message: 'Parse error',
          },
        }),
        400,
      );
    }

    const parsed = jsonRpcRequestSchema.safeParse(body);
    if (!parsed.success) {
      return sendResponse(
        jsonRpcResponseSchema.parse({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: JSON_RPC_ERRORS.INVALID_REQUEST,
            message: 'Invalid request',
          },
        }),
        400,
      );
    }

    const { id, method, params } = parsed.data;

    try {
      const result = await handleMethod(method, params, {
        workspaceId,
        deps,
        apiKey,
      });
      return sendResponse(
        jsonRpcResponseSchema.parse({ jsonrpc: '2.0', id, result }),
        200,
      );
    } catch (err) {
      const isMcperror =
        err && typeof err === 'object' && 'code' in err && 'message' in err;
      if (isMcperror) {
        return sendResponse(
          jsonRpcResponseSchema.parse({
            jsonrpc: '2.0',
            id,
            error: {
              code: (err as { readonly code: number }).code,
              message: (err as { readonly message: string }).message,
            },
          }),
          200,
        );
      }
      throw err;
    }
  });

  return app;
}

/**
 * Handle a JSON-RPC method call.
 */
async function handleMethod(
  method: string,
  params: Record<string, unknown> | undefined,
  ctx: {
    readonly workspaceId: string;
    readonly deps: McpDeps;
    readonly apiKey: string;
  },
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return initializeResultSchema.parse({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'facelesspro-mcp', version: '0.1.0' },
      });

    case 'tools/list':
      return toolListResultSchema.parse({
        tools: ALL_MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case 'tools/call':
      return await handleToolCall(ctx, params);

    default:
      const error: { readonly code: number; readonly message: string } = {
        code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        message: `Method not found: ${method}`,
      };
      throw error;
  }
}

/**
 * Handle a tools/call request. Returns error text (not a protocol error)
 * so the assistant can correct its arguments and retry.
 */
async function handleToolCall(
  ctx: {
    readonly workspaceId: string;
    readonly deps: McpDeps;
    readonly apiKey: string;
  },
  params: Record<string, unknown> | undefined,
): Promise<unknown> {
  const callParams = z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  }).safeParse(params);

  if (!callParams.success) {
    return toolCallResultSchema.parse({
      content: [{ type: 'text', text: 'Invalid tool call parameters' }],
      isError: true,
    });
  }

  const { name, arguments: args } = callParams.data;

  // Find the tool definition
  const tool = ALL_MCP_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return toolCallResultSchema.parse({
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    });
  }

  // Route to the appropriate /v1 endpoint via internal HTTP
  try {
    const result = await callV1Route(ctx.deps.apiBaseUrl, name, args ?? {}, ctx.apiKey);
    return toolCallResultSchema.parse({
      content: [{ type: 'text', text: JSON.stringify(result) }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolCallResultSchema.parse({
      content: [{ type: 'text', text: `Tool error: ${message}` }],
      isError: true,
    });
  }
}

/**
 * Make an internal HTTP call to a /v1 route with the workspace's `vp_` key.
 */
async function callV1Route(
  apiBaseUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  apiKey: string,
): Promise<unknown> {
  type RouteEntry = {
    readonly method: string;
    readonly path: string | ((args: Record<string, unknown>) => string);
  };

  // Map tool names to /v1 routes
  const routeMap: Record<string, RouteEntry> = {
    create_ai_video_v3: { method: 'POST', path: '/v1/ai-videos-v3' },
    create_ai_video: { method: 'POST', path: '/v1/ai-videos' },
    create_quiz_video: { method: 'POST', path: '/v1/quiz-videos' },
    create_roblox_video: { method: 'POST', path: '/v1/roblox-videos' },
    create_fake_text_video: { method: 'POST', path: '/v1/fake-text-videos' },
    create_caption_video: { method: 'POST', path: '/v1/caption-videos' },
    create_fake_text_screenshot: { method: 'POST', path: '/v1/fake-text-screenshot' },
    read: {
      method: 'GET',
      path: (args: Record<string, unknown>) => {
        const id = args.id as string | undefined;
        return id ? `/v1/videos/${id}` : '';
      },
    },
    render_video: {
      method: 'POST',
      path: (args: Record<string, unknown>) => {
        const id = args.id as string | undefined;
        return id ? `/v1/videos/${id}/render` : '';
      },
    },
    upload_file: { method: 'POST', path: '/v1/files' },
    list_voices: { method: 'GET', path: '/v1/voices' },
    list_sound_effects: { method: 'GET', path: '/v1/sound-effects' },
    list_background_videos: { method: 'GET', path: '/v1/background-videos' },
    text_to_speech: { method: 'POST', path: '/v1/text-to-speech' },
    list_caption_templates: { method: 'GET', path: '/v1/caption-templates' },
    list_art_styles: { method: 'GET', path: '/v1/art-styles' },
    get_workspace: { method: 'GET', path: '/v1/workspace' },
    list_credit_logs: { method: 'GET', path: '/v1/credit-logs' },
    list_balance_logs: { method: 'GET', path: '/v1/balance-logs' },
    plan_video: { method: 'POST', path: '/v1/videos/plan' },
    preview_script_split: { method: 'POST', path: '/v1/videos/plan' },
    list_languages: { method: 'GET', path: '/v1/workspace' },
  };

  const route = routeMap[toolName];
  if (!route) {
    throw new Error(`No route mapped for tool: ${toolName}`);
  }

  const path =
    typeof route.path === 'function' ? route.path(args) : route.path;
  if (!path) {
    throw new Error(`Missing required argument for tool: ${toolName}`);
  }

  const url = `${apiBaseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (route.method === 'GET') {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    return response.json();
  } else {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    return response.json();
  }
}

/** Origin of the current request, used for metadata URLs. */
function originOf(c: Context): string {
  return new URL(c.req.url).origin;
}

/** OAuth 2.0 error response (RFC 6749 §5.2). */
function oauthError(
  c: Context<{ Variables: MCPVariables }>,
  status: 400 | 401,
  error: string,
  description: string,
): Response {
  return c.json(
    { error, error_description: description },
    status,
    { 'content-type': 'application/json; charset=utf-8' },
  );
}

/** Read a non-empty string form field; `undefined` for anything else. */
function formString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Redirect URIs: https anywhere, or http only on loopback. */
function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash !== '') return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]'
  );
}

/** Issue an access/refresh pair. Session id and expiry are set by the caller. */
function issueTokens(): { readonly accessToken: string; readonly refreshToken: string } {
  return {
    accessToken: `at_${randomBytes(32).toString('hex')}`,
    refreshToken: `rt_${randomBytes(32).toString('hex')}`,
  };
}

function tokenResponse(accessToken: string, refreshToken: string): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refreshToken,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
  );
}

/**
 * PKCE S256 check. Uses a constant-time compare so the challenge cannot be
 * recovered byte by byte from timing.
 */
function pkceMatches(codeVerifier: string, codeChallenge: string): boolean {
  if (!PKCE_VERIFIER.test(codeVerifier)) return false;
  const computed = createHash('sha256').update(codeVerifier).digest();
  let expected: Buffer;
  try {
    expected = Buffer.from(codeChallenge, 'base64url');
  } catch {
    return false;
  }
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
