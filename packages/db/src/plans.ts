/**
 * Plan definitions now live in `@facelesspro/contracts` so the web pricing page
 * and the server cannot disagree about a limit. Re-exported here because every
 * existing db import (`./plans`, the package barrel, workspace reads) expects
 * this module.
 */

export { PLAN_DEFINITIONS, PLANS, planFor } from '@facelesspro/contracts';
export type { PlanDef } from '@facelesspro/contracts';
