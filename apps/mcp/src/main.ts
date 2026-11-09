/**
 * `facelesspro-mcp` entry point.
 *
 * Starts the MCP server over Streamable HTTP. The server makes internal HTTP
 * calls to the API server's `/v1` routes to execute tools.
 */

import { createDb, loadEnv } from '@facelesspro/db';
import { serve } from '@hono/node-server';

import { createMcpApp } from './server';

loadEnv();

async function main(): Promise<void> {
  const port = Number(process.env.MCP_PORT ?? 3002);

  const { db } = createDb();

  const app = createMcpApp({
    apiBaseUrl:
      process.env.API_BASE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:3001',
    authenticateApiKey: async (token) => {
      // Static bearer token auth: validate against the API server's keys.
      // In a full implementation, this would call the API server's key
      // validation endpoint. For now, we accept any vp_ token and derive the
      // workspace from a shared secret or a pre-registered mapping.
      if (!token.startsWith('vp_')) return null;
      return { workspaceId: process.env.MCP_WORKSPACE_ID ?? 'default' };
    },
    db,
    findClient: async () => null,
    createAuthorizationCode: async () => {},
    readAuthorizationCode: async () => null,
    deleteAuthorizationCode: async () => {},
    readRefreshToken: async () => null,
    deleteRefreshToken: async () => {},
    createTokens: async () => {},
    revokeToken: async () => {},
  });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[mcp] listening on http://127.0.0.1:${info.port}`);
  });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`[mcp] ${signal} — closing`);
    server.close();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

main().catch((error: unknown) => {
  console.error('[mcp] fatal', error);
  process.exit(1);
});
