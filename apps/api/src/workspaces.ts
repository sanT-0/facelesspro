/**
 * `GET /v1/workspace` — the authenticated workspace with its plan, credits, and owner.
 * `GET /v1/credit-logs` — credit ledger movements for the workspace, newest first.
 * `GET /v1/balance-logs` — top-up / charge movements for the workspace, newest first.
 *
 * All three are workspace-scoped reads: the key resolves the workspace once,
 * and every handler reads only that workspace's rows.
 */

import { Hono } from 'hono';

import {
  balanceLogListSchema,
  creditLogListSchema,
  workspaceSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';

export interface WorkspaceRouteDeps extends AuthDeps {
  /** The authenticated workspace with its owner and plan metadata. */
  readonly findWorkspace: (
    workspaceId: string,
  ) => Promise<{
    readonly id: string;
    readonly name: string;
    readonly plan: {
      readonly id: string;
      readonly minutesPerMonth: number | null;
      readonly creditsPerMonth: number | null;
      readonly maxVideoMinutes: number;
      readonly maxResolution: 1080 | 1440 | 2160;
      readonly seats: number;
    };
    readonly credits: number | null;
    readonly owner: {
      readonly id: string;
      readonly email: string;
      readonly name: string;
    };
  } | null>;
  /** Credit ledger entries for a workspace, newest first. */
  readonly listCreditLogs: (
    workspaceId: string,
  ) => Promise<Array<{
    readonly id: string;
    readonly videoId: string | null;
    readonly action: string;
    readonly units: number;
    readonly unitCost: number;
    readonly delta: number;
    readonly createdAt: string;
  }>>;
  /** Balance ledger entries for a workspace, newest first. */
  readonly listBalanceLogs: (
    workspaceId: string,
  ) => Promise<Array<{
    readonly id: string;
    readonly kind: string;
    readonly amountCents: number;
    readonly meta: Record<string, unknown> | null;
    readonly createdAt: string;
  }>>;
}

export function createWorkspaceRoutes(
  deps: WorkspaceRouteDeps,
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();

  app.use('*', withWorkspace(deps));

  app.get('/workspace', async (c) => {
    const workspaceId = c.get('workspaceId');
    const found = await deps.findWorkspace(workspaceId);
    if (found === null) {
      return c.json(
        { error: { code: 'not_found', message: 'workspace not found' } },
        404,
      );
    }

    const body = workspaceSchema.parse({
      id: found.id,
      name: found.name,
      plan: {
        id: found.plan.id,
        minutesPerMonth: found.plan.minutesPerMonth,
        creditsPerMonth: found.plan.creditsPerMonth,
        maxVideoMinutes: found.plan.maxVideoMinutes,
        maxResolution: found.plan.maxResolution,
        seats: found.plan.seats,
      },
      credits: found.credits,
      owner: {
        id: found.owner.id,
        email: found.owner.email,
        name: found.owner.name,
      },
    });

    return c.json(body, 200);
  });

  app.get('/credit-logs', async (c) => {
    const workspaceId = c.get('workspaceId');
    const logs = await deps.listCreditLogs(workspaceId);
    const body = creditLogListSchema.parse({
      logs: logs.map((log) => ({
        id: log.id,
        videoId: log.videoId,
        action: log.action,
        units: log.units,
        unitCost: log.unitCost,
        delta: log.delta,
        createdAt: log.createdAt,
      })),
    });
    return c.json(body, 200);
  });

  app.get('/balance-logs', async (c) => {
    const workspaceId = c.get('workspaceId');
    const logs = await deps.listBalanceLogs(workspaceId);
    const body = balanceLogListSchema.parse({
      logs: logs.map((log) => ({
        id: log.id,
        kind: log.kind,
        amountCents: log.amountCents,
        meta: log.meta,
        createdAt: log.createdAt,
      })),
    });
    return c.json(body, 200);
  });

  return app;
}
