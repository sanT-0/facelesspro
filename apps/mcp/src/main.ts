/**
 * `facelesspro-mcp` entry point.
 *
 * Starts the MCP server over Streamable HTTP. The server makes internal HTTP
 * calls to the API server's `/v1` routes to execute tools.
 *
 * Auth is delegated to the API: a `vp_` key is only accepted if
 * `GET /v1/workspace` answers with that key's workspace. Both the static
 * bearer path and OAuth consent use this same check, so the MCP server never
 * has its own notion of which tokens are valid.
 */

import { workspaceSchema } from '@facelesspro/contracts';
import { loadEnv } from '@facelesspro/db';
import { serve } from '@hono/node-server';

import { createMcpApp } from './server';
import { MemoryOAuthStore } from './store';

loadEnv();

async function main(): Promise<void> {
  const port = Number(process.env.MCP_PORT ?? 3002);
  const apiBaseUrl =
    process.env.API_BASE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:3001';

  const app = createMcpApp({
    apiBaseUrl,
    authenticateApiKey: async (token) => {
      if (!/^vp_[0-9a-f]{40}$/.test(token)) return null;

      try {
        const response = await fetch(`${apiBaseUrl}/v1/workspace`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return null;

        const parsed = workspaceSchema.safeParse(await response.json());
        if (!parsed.success) return null;
        return { workspaceId: parsed.data.id };
      } catch {
        // API unreachable: fail closed, never invent a workspace.
        return null;
      }
    },
    oauth: new MemoryOAuthStore(),
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
