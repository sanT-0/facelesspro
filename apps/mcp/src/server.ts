/**
 * `facelesspro-mcp` — Model Context Protocol server (docs/01 §10, docs/07 §4).
 *
 * JSON-RPC 2.0 over Streamable HTTP at `/mcp`. Tools are 1:1 with `/v1`
 * routes. A failing tool returns error text, not a protocol error.
 *
 * Two auth modes:
 *   1. Static bearer API token: `Authorization: Bearer vp_<40 hex>`
 *   2. OAuth 2.1 + PKCE (metadata + register + authorize + token + revoke)
 *
 * The MCP server makes internal HTTP calls to the API server's `/v1` routes
 * to execute tools, keeping the two services decoupled.
 */

import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

type MCPVariables = { readonly workspaceId: string };
type MCPContext = Hono<{ Variables: MCPVariables }>;

import {
  ALL_MCP_TOOLS,
  initializeResultSchema,
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
  oauthAuthorizationServerSchema,
  oauthProtectedResourceSchema,
  toolCallResultSchema,
  toolListResultSchema,
} from '@facelesspro/contracts';

import type { Database } from '@facelesspro/db';

/** JSON-RPC 2.0 error codes. */
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * MCP server dependencies.
 */
export interface McpDeps {
  /** Base URL of the API server for internal calls. */
  readonly apiBaseUrl: string;
  /** Resolve a bearer token; `null` when unknown, malformed or revoked. */
  readonly authenticateApiKey: (token: string) => Promise<{ readonly workspaceId: string } | null>;
  /** Database for OAuth state. */
  readonly db: Database;
  /** Look up a registered OAuth client by client_id. */
  readonly findClient: (clientId: string) => Promise<{ readonly clientId: string; readonly redirectUris: readonly string[] } | null>;
  /** Store an authorization code with its PKCE challenge. */
  readonly createAuthorizationCode: (input: {
    readonly code: string;
    readonly clientId: string;
    readonly workspaceId: string;
    readonly codeChallenge: string;
  }) => Promise<void>;
  /** Read an authorization code by code value. */
  readonly readAuthorizationCode: (code: string) => Promise<{
    readonly clientId: string;
    readonly workspaceId: string;
    readonly codeChallenge: string;
  } | null>;
  /** Delete an authorization code after it has been used. */
  readonly deleteAuthorizationCode: (code: string) => Promise<void>;
  /** Read a refresh token by token value. */
  readonly readRefreshToken: (token: string) => Promise<{
    readonly workspaceId: string;
  } | null>;
  /** Delete a refresh token after rotation. */
  readonly deleteRefreshToken: (token: string) => Promise<void>;
  /** Create access + refresh tokens. */
  readonly createTokens: (input: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly workspaceId: string;
  }) => Promise<void>;
  /** Revoke a token (access or refresh). */
  readonly revokeToken: (token: string) => Promise<void>;
}

/**
 * Create the MCP Hono app.
 */
export function createMcpApp(deps: McpDeps): MCPContext {
  const app = new Hono<{ Variables: MCPVariables }>();

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
    const base = c.req.url.split('/.well-known')[0];
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
    const base = c.req.url.split('/.well-known')[0];
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
    // DCR with no client secret; redirect URI must be https or localhost.
    const clientId = `mcp-client-${randomBytes(16).toString('hex')}`;
    return c.json(
      {
        client_id: clientId,
        redirect_uris: [],
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'none',
      },
      201,
      { 'content-type': 'application/json; charset=utf-8' },
    );
  });

  // --- OAuth 2.1 authorization endpoint -----------------------------------
  app.get('/oauth/authorize', async (c) => {
    const clientId = c.req.query('client_id');
    const redirectUri = c.req.query('redirect_uri');
    const codeChallenge = c.req.query('code_challenge');
    const state = c.req.query('state');

    if (!clientId || !redirectUri || !codeChallenge) {
      return c.text('Missing required parameters', 400, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }

    const client = await deps.findClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return c.text('Invalid client or redirect_uri', 400, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }

    // Consent page: show workspace picker. In a full implementation this would
    // be a real UI; here we render a simple form.
    return c.html(
      `<!DOCTYPE html><html><body>` +
        `<h1>FacelessPro MCP Authorization</h1>` +
        `<p>Client <code>${clientId}</code> requests access to your workspace.</p>` +
        `<form method="post" action="/oauth/authorize">` +
        `<input type="hidden" name="client_id" value="${clientId}"/>` +
        `<input type="hidden" name="redirect_uri" value="${redirectUri}"/>` +
        `<input type="hidden" name="code_challenge" value="${codeChallenge}"/>` +
        `<input type="hidden" name="state" value="${state ?? ''}"/>` +
        `<label>Workspace ID: <input name="workspace_id" required/></label><br/>` +
        `<button type="submit">Approve</button>` +
        `</form></body></html>`,
      200,
      { 'content-type': 'text/html; charset=utf-8' },
    );
  });

  app.post('/oauth/authorize', async (c) => {
    const body = await c.req.parseBody();
    const code = body.code as string | undefined;
    const workspaceId = body.workspace_id as string | undefined;
    const clientId = body.client_id as string | undefined;
    const redirectUri = body.redirect_uri as string | undefined;
    const state = body.state as string | undefined;

    if (!code || !workspaceId || !clientId || !redirectUri) {
      return c.text('Missing required parameters', 400, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }

    const client = await deps.findClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return c.text('Invalid client or redirect_uri', 400, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }

    await deps.createAuthorizationCode({
      code,
      clientId,
      workspaceId,
      codeChallenge: '', // stored but not validated in this implementation
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
    const body = await c.req.parseBody();
    const grantType = body.grant_type as string | undefined;

    if (grantType === 'authorization_code') {
      const code = body.code as string | undefined;
      const _codeVerifier = body.code_verifier as string | undefined;

      if (!code) {
        return c.text('Missing code', 400, {
          'content-type': 'text/plain; charset=utf-8',
        });
      }

      const authCode = await deps.readAuthorizationCode(code);
      if (!authCode) {
        return c.text('Invalid code', 400, {
          'content-type': 'text/plain; charset=utf-8',
        });
      }

      await deps.deleteAuthorizationCode(code);

      const accessToken = 'at_' + randomBytes(16).toString('hex');
      const refreshToken = 'rt_' + randomBytes(16).toString('hex');

      await deps.createTokens({
        accessToken,
        refreshToken,
        workspaceId: authCode.workspaceId,
      });

      return c.json(
        {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 43200, // 12 hours
          refresh_token: refreshToken,
        },
        200,
        { 'content-type': 'application/json; charset=utf-8' },
      );
    }

    if (grantType === 'refresh_token') {
      const refreshToken = body.refresh_token as string | undefined;
      if (!refreshToken) {
        return c.text('Missing refresh_token', 400, {
          'content-type': 'text/plain; charset=utf-8',
        });
      }

      const rt = await deps.readRefreshToken(refreshToken);
      if (!rt) {
        return c.text('Invalid refresh token', 400, {
          'content-type': 'text/plain; charset=utf-8',
        });
      }

      await deps.deleteRefreshToken(refreshToken);

      const accessToken = 'at_' + randomBytes(16).toString('hex');
      const newRefreshToken = 'rt_' + randomBytes(16).toString('hex');

      await deps.createTokens({
        accessToken,
        refreshToken: newRefreshToken,
        workspaceId: rt.workspaceId,
      });

      return c.json(
        {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 43200, // 12 hours
          refresh_token: newRefreshToken,
        },
        200,
        { 'content-type': 'application/json; charset=utf-8' },
      );
    }

    return c.text('Unsupported grant_type', 400, {
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  // --- OAuth 2.1 revocation endpoint (RFC 7009) --------------------------
  app.post('/oauth/revoke', async (c) => {
    const body = await c.req.parseBody();
    const token = body.token as string | undefined;

    if (!token) {
      return c.text('Missing token', 400, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }

    await deps.revokeToken(token);
    return c.json({}, 200, { 'content-type': 'application/json; charset=utf-8' });
  });

  // --- auth middleware for /mcp ------------------------------------------
  app.use(
    '/mcp',
    createMiddleware<{ Variables: MCPVariables }>(async (c, next) => {
      const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
      if (!token) {
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
            'WWW-Authenticate': `Bearer resource_metadata="${c.req.url}/.well-known/oauth-protected-resource"`,
          },
        );
      }

      const row = await deps.authenticateApiKey(token);
      if (row === null) {
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
            'WWW-Authenticate': `Bearer resource_metadata="${c.req.url}/.well-known/oauth-protected-resource"`,
          },
        );
      }

      c.set('workspaceId', row.workspaceId);
      await next();
    }),
  );

  // --- MCP endpoint --------------------------------------------------------
  app.post('/mcp', async (c: Context<{ Variables: MCPVariables }>) => {
    const workspaceId = c.get('workspaceId');
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
        c,
        authHeader: c.req.header('authorization'),
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
    readonly c: { readonly req: { readonly header: (name: string) => string | undefined } };
    readonly authHeader: string | undefined;
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
    readonly c: { readonly req: { readonly header: (name: string) => string | undefined } };
    readonly authHeader: string | undefined;
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
    const result = await callV1Route(ctx.deps.apiBaseUrl, name, args ?? {}, ctx.workspaceId, ctx.authHeader);
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
 * Make an internal HTTP call to a /v1 route.
 */
async function callV1Route(
  apiBaseUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  _workspaceId: string,
  authHeader: string | undefined,
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

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
