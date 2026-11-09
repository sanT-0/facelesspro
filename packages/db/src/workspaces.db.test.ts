/**
 * Workspace, credit ledger, and balance ledger reads over real Postgres.
 */

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './client';
import type { Database } from './client';
import {
  balanceLedger as balanceLedgerTable,
  creditLedger as creditLedgerTable,
  member,
  user,
  workspace,
} from './schema';
import {
  findWorkspace,
  listCreditLogs,
  listBalanceLogs,
} from './workspaces';

let db: Database;
let pool: Pool;
let workspaceId: string;
let ownerUserId: string;

describe('workspace & ledger reads (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    await db.delete(member).where(eq(member.workspace_id, workspaceId));
    await db.delete(user).where(eq(user.id, ownerUserId));
    await db.delete(workspace).where(eq(workspace.id, workspaceId));
  });

  it('finds a workspace with its owner and plan', async () => {
    const ws = await db
      .insert(workspace)
      .values({
        name: `credit-ws-${randomUUID()}`,
        plan_id: 'selfhost',
        credits: null,
        balance_cents: 0,
      })
      .returning({ id: workspace.id, name: workspace.name });
    workspaceId = ws[0]!.id;
    const wsName = ws[0]!.name;

    const u = await db
      .insert(user)
      .values({
        email: `credit-owner-${randomUUID()}@example.com`,
        name: 'Credit Owner',
      })
      .returning({ id: user.id });
    ownerUserId = u[0]!.id;

    await db.insert(member).values({
      workspace_id: workspaceId,
      user_id: ownerUserId,
      role: 'owner',
    });

    const found = await findWorkspace(db, workspaceId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(workspaceId);
    expect(found!.name).toBe(wsName);
    expect(found!.plan.id).toBe('selfhost');
    expect(found!.credits).toBeNull();
    expect(found!.owner.id).toBe(ownerUserId);
    expect(found!.owner.name).toBe('Credit Owner');
  });

  it('returns null for a missing workspace', async () => {
    const found = await findWorkspace(db, randomUUID());
    expect(found).toBeNull();
  });

  it('lists credit logs for a workspace', async () => {
    const ws = await db
      .insert(workspace)
      .values({
        name: `credit-logs-ws-${randomUUID()}`,
        plan_id: 'selfhost',
        credits: null,
        balance_cents: 0,
      })
      .returning({ id: workspace.id });
    workspaceId = ws[0]!.id;

    const vid = null as unknown as string;
    await db
      .insert(creditLedgerTable)
      .values({
        workspace_id: workspaceId,
        video_id: vid,
        action: 'tts',
        units: 10,
        unit_cost: 2,
        delta: -20,
      });

    const logs = await listCreditLogs(db, workspaceId);
    expect(logs.some((l) => l.videoId === null && l.action === 'tts')).toBe(true);
  });

  it('lists balance logs for a workspace', async () => {
    const ws = await db
      .insert(workspace)
      .values({
        name: `balance-logs-ws-${randomUUID()}`,
        plan_id: 'selfhost',
        credits: null,
        balance_cents: 0,
      })
      .returning({ id: workspace.id });
    workspaceId = ws[0]!.id;

    await db.insert(balanceLedgerTable).values({
      workspace_id: workspaceId,
      kind: 'topup',
      amount_cents: 5000,
      meta: { source: 'stripe' },
    });

    const logs = await listBalanceLogs(db, workspaceId);
    expect(logs.some((l) => l.kind === 'topup' && l.amountCents === 5000)).toBe(
      true,
    );
  });
});
