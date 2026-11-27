/**
 * `POST /v1/balance/topup` — add credits to the authenticated workspace.
 *
 * Accepts `amountCents` (positive integer) and optional `meta` object.
 * Returns the new credit balance and the ledger entry.
 * Selfhost workspaces (creditsPerMonth === null) still accept topups for
 * accounting purposes; the balance is tracked but not enforced.
 */

import { Hono } from 'hono';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';
import { topupRequestSchema, topupResponseSchema } from '@facelesspro/contracts';

export interface BalanceRouteDeps extends AuthDeps {
  readonly topUpBalance: (
    workspaceId: string,
    amountCents: number,
    meta: Record<string, unknown> | null,
  ) => Promise<{ balance: number | null; entry: { id: string; kind: string; amountCents: number; meta: Record<string, unknown> | null; createdAt: string } }>;
}

export function createBalanceRoutes(deps: BalanceRouteDeps): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();

  app.use('*', withWorkspace(deps));

  app.post('/balance/topup', async (c) => {
    const workspaceId = c.get('workspaceId');
    const body = await c.req.json();
    const parsed = topupRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: 'invalid_request', message: parsed.error.message } },
        400,
      );
    }

    const { amountCents, meta } = parsed.data;
    const result = await deps.topUpBalance(workspaceId, amountCents, meta ?? null);
    const response = topupResponseSchema.parse(result);
    return c.json(response, 200);
  });

  return app;
}