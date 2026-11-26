/**
 * Credit charging and quota enforcement (docs/01 §8, docs/07 §1.2).
 *
 * This is the authoritative implementation of `chargeCredits` — called inside
 * each step's commit transaction after the step's work succeeds. The pre-flight
 * estimate in `@facelesspro/contracts/limits.ts` is a soft check; this is the
 * hard gate that writes the ledger atomically with the step's other changes.
 */

import { and, eq, sql } from 'drizzle-orm';

import type { Database } from './client';
import { creditLedger, workspace } from './schema';
import { planFor } from './plans';
import type { CreditAction } from '@facelesspro/contracts';

/** Unit costs per step action (docs/01 §8 table). */
export const UNIT_COSTS: Record<string, { readonly units: number; readonly unitCost: number }> = {
  'create-scenes': { units: 1, unitCost: 1 },
  'create-vocal': { units: 1, unitCost: 2 },
  'create-images': { units: 1, unitCost: 4 },
  'create-captions': { units: 1, unitCost: 1 },
  'render': { units: 1, unitCost: 10 },
  'build-art-style': { units: 1, unitCost: 50 },
} as const;

export interface ChargeInput {
  readonly videoId: string | null;
  readonly action: CreditAction;
  readonly units: number;
  readonly unitCost: number;
}

/** Result of a credit charge. `null` balance means unlimited (selfhost). */
export interface ChargeResult {
  readonly balance: number | null;
  readonly delta: number;
}

/** Thrown when a charge would exceed the monthly credit quota. */
export class InsufficientCreditsError extends Error {
  public readonly violation: {
    readonly kind: 'monthly_credits_exceeded';
    readonly message: string;
    readonly planLimit: number;
    readonly requested: number;
    readonly status: 402;
  };

  constructor(message: string, planLimit: number, requested: number) {
    super(message);
    this.name = 'InsufficientCreditsError';
    this.violation = {
      kind: 'monthly_credits_exceeded',
      message,
      planLimit,
      requested,
      status: 402,
    };
  }
}

/**
 * Charge credits for a step, writing the ledger entry atomically.
 *
 * Returns the new credit balance after the charge, or `null` for unlimited
 * (selfhost). Throws `InsufficientCreditsError` if the charge would exceed
 * the monthly quota (for paid plans).
 */
export async function chargeCredits(
  db: Database,
  workspaceId: string,
  input: ChargeInput,
): Promise<ChargeResult> {
  const wsRows = await db
    .select({ plan_id: workspace.plan_id })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const ws = wsRows[0];
  if (!ws) throw new Error('workspace not found');

  const plan = planFor(ws.plan_id);

  // Selfhost (null credits) has unlimited quota — still write the ledger
  if (plan.creditsPerMonth === null) {
    const delta = -input.units * input.unitCost;
    await db.insert(creditLedger).values({
      workspace_id: workspaceId,
      video_id: input.videoId,
      action: input.action,
      units: input.units,
      unit_cost: input.unitCost,
      delta,
    } as typeof creditLedger.$inferInsert);
    return { balance: null, delta };
  }

  // Paid plan: sum this month's ledger to get current usage
  const currentMonthStart = new Date();
  currentMonthStart.setDate(1);
  currentMonthStart.setHours(0, 0, 0, 0);

  const currentUsageRows = await db
    .select({ sum: sql<number>`coalesce(sum(delta), 0)` })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.workspace_id, workspaceId),
        sql`${creditLedger.created_at} >= ${currentMonthStart.toISOString()}`,
      ),
    );
  const currentUsage = -Number(currentUsageRows[0]?.sum ?? 0); // delta is negative, so negate

  const charge = input.units * input.unitCost;
  if (currentUsage + charge > plan.creditsPerMonth) {
    throw new InsufficientCreditsError(
      `monthly credit quota exceeded (${currentUsage}/${plan.creditsPerMonth} used, ${charge} requested)`,
      plan.creditsPerMonth,
      currentUsage + charge,
    );
  }

  const delta = -charge;
  await db.insert(creditLedger).values({
    workspace_id: workspaceId,
    video_id: input.videoId,
    action: input.action,
    units: input.units,
    unit_cost: input.unitCost,
    delta,
  } as typeof creditLedger.$inferInsert);

  return { balance: plan.creditsPerMonth - (currentUsage + charge), delta };
}

/**
 * Get current month's credit usage for a workspace.
 * Returns negative delta sum (so a positive number = credits used).
 */
export async function getCurrentCreditUsage(
  db: Database,
  workspaceId: string,
): Promise<number> {
  const currentMonthStart = new Date();
  currentMonthStart.setDate(1);
  currentMonthStart.setHours(0, 0, 0, 0);

  const rows = await db
    .select({ sum: sql<number>`coalesce(sum(delta), 0)` })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.workspace_id, workspaceId),
        sql`${creditLedger.created_at} >= ${currentMonthStart.toISOString()}`,
      ),
    );
  return -Number(rows[0]?.sum ?? 0);
}