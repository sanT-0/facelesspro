/**
 * Plan definitions (docs/01 §8).
 *
 * Plans are code, not a table: `workspace.plan_id` is a pointer into this
 * map, so a plan change is not a migration. There are no prices to copy,
 * so these are the documented shape with placeholder values. `selfhost`
 * has `null` (unlimited) credits and minutes.
 *
 * They live in `@facelesspro/contracts` rather than `@facelesspro/db` so the
 * public pricing page and the server read the same numbers; `@facelesspro/db`
 * re-exports them, and the api still injects `planFor` into workspace reads.
 */

import type { PlanId } from './common';

export interface PlanDef {
  readonly id: PlanId;
  /** `null` = unlimited (selfhost). Paid plans always carry a number. */
  readonly minutesPerMonth: number | null;
  /** `null` = unlimited (selfhost). Paid plans always carry a number. */
  readonly creditsPerMonth: number | null;
  readonly maxVideoMinutes: number;
  readonly maxResolution: 1080 | 1440 | 2160;
  readonly seats: number;
}

/**
 * Display order for the pricing page and any plan listing: cheapest first,
 * with the self-hosted install last because it is not a tier above `max`.
 */
export const PLAN_DEFINITIONS: readonly PlanDef[] = [
  {
    id: 'free',
    minutesPerMonth: 10,
    creditsPerMonth: 100,
    maxVideoMinutes: 10,
    maxResolution: 1080,
    seats: 1,
  },
  {
    id: 'pro',
    minutesPerMonth: 60,
    creditsPerMonth: 600,
    maxVideoMinutes: 30,
    maxResolution: 1440,
    seats: 1,
  },
  {
    id: 'premium',
    minutesPerMonth: 300,
    creditsPerMonth: 3000,
    maxVideoMinutes: 60,
    maxResolution: 2160,
    seats: 3,
  },
  {
    id: 'premium_plus',
    minutesPerMonth: 600,
    creditsPerMonth: 6000,
    maxVideoMinutes: 120,
    maxResolution: 2160,
    seats: 5,
  },
  {
    id: 'max',
    minutesPerMonth: 1800,
    creditsPerMonth: 18000,
    maxVideoMinutes: 300,
    maxResolution: 2160,
    seats: 10,
  },
  {
    id: 'selfhost',
    minutesPerMonth: null,
    creditsPerMonth: null,
    maxVideoMinutes: 30,
    maxResolution: 1080,
    seats: 1,
  },
];

export const PLANS: ReadonlyMap<PlanId, PlanDef> = new Map(
  PLAN_DEFINITIONS.map((plan) => [plan.id, plan]),
);

export function planFor(planId: PlanId): PlanDef {
  const plan = PLANS.get(planId);
  if (plan === undefined) {
    throw new Error(`unknown plan: ${planId}`);
  }
  return plan;
}
