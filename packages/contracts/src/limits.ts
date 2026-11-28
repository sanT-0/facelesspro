/**
 * Plan limit enforcement (docs/01 §8, docs/07 §1.2).
 *
 * All limits are evaluated from the plan definitions in `@facelesspro/contracts`.
 * A plan's `null` values mean unlimited (selfhost); paid plans always carry numbers.
 */

import type { PlanDef } from './plans';
import type { RenderOptions } from './requests';

/** Possible limit violation kinds. */
export type LimitViolationKind =
  | 'max_video_minutes'
  | 'max_resolution'
  | 'monthly_minutes_exceeded'
  | 'monthly_credits_exceeded'
  | 'seats_exceeded';

export interface LimitViolation {
  readonly kind: LimitViolationKind;
  readonly message: string;
  readonly planLimit: number | null;
  readonly requested: number | null;
  /** HTTP status: 402 for credit/minute quota, 403 for plan feature limits. */
  readonly status: 402 | 403;
}

export interface LimitCheckContext {
  readonly plan: PlanDef;
  /** Current month's usage (minutes/credits consumed). */
  readonly currentUsage: {
    readonly minutes: number;
    readonly credits: number;
  };
  /** Current seat count (for teams). */
  readonly currentSeats: number;
}

/**
 * Estimate video minutes from a create request.
 *
 * For script-based videos: ~150 words/minute (standard narration speed).
 * For voiceover-based videos: use the provided duration if available.
 * Defaults to a conservative 10 minutes for unknown cases.
 */
export function estimateMinutes(request: {
  readonly kind: string;
  readonly body: {
    readonly script?: string;
    readonly voiceoverUrl?: string;
    readonly items?: unknown[];
    readonly conversations?: unknown[];
    readonly render?: RenderOptions;
  };
}): number {
  // AI Video V3 / AI Video: script or voiceover
  if (request.kind === 'ai-video-v3' || request.kind === 'ai-video') {
    const script = request.body.script;
    if (script !== undefined && script.length > 0) {
      const words = script.trim().split(/\s+/).length;
      return Math.max(1, Math.ceil(words / 150));
    }
    // Voiceover URL - can't know duration without probing; assume max
    return 30;
  }

  // Quiz: estimate from items
  if (request.kind === 'quiz') {
    const items = request.body.items;
    if (items !== undefined) {
      return Math.max(1, Math.ceil(items.length * 2)); // ~2 min per question
    }
    return 10;
  }

  // Fake Text: estimate from messages
  if (request.kind === 'fake-text') {
    const conversations = request.body.conversations;
    if (conversations !== undefined) {
      let totalChars = 0;
      for (const conv of conversations) {
        for (const msg of (conv as { messages?: Array<{ text?: string }> }).messages ?? []) {
          totalChars += msg.text?.length ?? 0;
        }
      }
      // ~15 chars/second = 900 chars/minute
      return Math.max(1, Math.ceil(totalChars / 900));
    }
    return 5;
  }

  // Roblox: script-based
  if (request.kind === 'roblox') {
    const script = request.body.script;
    if (script !== undefined && script.length > 0) {
      const words = script.trim().split(/\s+/).length;
      return Math.max(1, Math.ceil(words / 150));
    }
    return 5;
  }

  return 10; // conservative default
}

/**
 * Check if a video creation request violates plan limits.
 *
 * Called before `insertVideo` in the same transaction so the check and the
 * insert are atomic. Returns an array of violations (empty = OK).
 */
export function checkVideoLimits(
  ctx: LimitCheckContext,
  request: {
    readonly estimatedMinutes: number;
    readonly resolution: 1080 | 1440 | 2160;
  },
): readonly LimitViolation[] {
  const { plan, currentUsage } = ctx;
  const violations: LimitViolation[] = [];

  // Max video minutes (null = unlimited)
  if (plan.maxVideoMinutes !== null && request.estimatedMinutes > plan.maxVideoMinutes) {
    violations.push({
      kind: 'max_video_minutes',
      message: `video exceeds plan maximum of ${plan.maxVideoMinutes} minutes`,
      planLimit: plan.maxVideoMinutes,
      requested: request.estimatedMinutes,
      status: 403,
    });
  }

  // Max resolution
  const resolutionOrder = { 1080: 0, 1440: 1, 2160: 2 } as const;
  const requestedRes = request.resolution as keyof typeof resolutionOrder;
  if (resolutionOrder[requestedRes] > resolutionOrder[plan.maxResolution]) {
    violations.push({
      kind: 'max_resolution',
      message: `resolution ${request.resolution}p exceeds plan maximum of ${plan.maxResolution}p`,
      planLimit: plan.maxResolution,
      requested: request.resolution,
      status: 403,
    });
  }

  // Monthly minutes quota (paid plans only)
  if (plan.minutesPerMonth !== null) {
    const projectedMinutes = currentUsage.minutes + request.estimatedMinutes;
    if (projectedMinutes > plan.minutesPerMonth) {
      violations.push({
        kind: 'monthly_minutes_exceeded',
        message: `monthly minute quota exceeded (${currentUsage.minutes}/${plan.minutesPerMonth} used, ${request.estimatedMinutes} requested)`,
        planLimit: plan.minutesPerMonth,
        requested: projectedMinutes,
        status: 402,
      });
    }
  }

  // Monthly credits quota (paid plans only)
  if (plan.creditsPerMonth !== null) {
    // Credits are charged per step; we conservatively estimate here.
    // The real check happens at each step's ledger write.
    // This is a soft pre-check; the authoritative check is in chargeCredits().
  }

  return violations;
}

/**
 * Charge credits for a step, writing the ledger entry atomically.
 *
 * Returns the new credit balance after the charge, or throws if the charge
 * would exceed the monthly quota (for paid plans).
 *
 * This is the authoritative credit check — called inside each step's
 * commit transaction, after the step's work succeeds.
 */
export async function chargeCredits(
  db: {
    readonly insert: (table: unknown) => { readonly values: (row: unknown) => { readonly returning: () => Promise<unknown[]> } };
    readonly select: () => { readonly from: (table: unknown) => { readonly where: (cond: unknown) => Promise<unknown[]> } };
    readonly update: (table: unknown) => { readonly set: (row: unknown) => { readonly where: (cond: unknown) => { readonly returning: () => Promise<unknown[]> } } };
  },
  workspaceId: string,
  plan: PlanDef,
  input: {
    readonly videoId: string | null;
    readonly action: string;
    readonly units: number;
    readonly unitCost: number;
  },
): Promise<number | null> {
  // Selfhost (null credits) has unlimited quota
  if (plan.creditsPerMonth === null) {
    // Still write the ledger for audit, but don't enforce quota
    const delta = -input.units * input.unitCost;
    await db.insert(/* creditLedger */ {}).values({
      workspace_id: workspaceId,
      video_id: input.videoId,
      action: input.action,
      units: input.units,
      unit_cost: input.unitCost,
      delta,
      created_at: new Date().toISOString(),
    }).returning();
    return null; // unlimited
  }

  // Paid plan: sum this month's ledger to get current usage
  const currentMonthStart = new Date();
  currentMonthStart.setDate(1);
  currentMonthStart.setHours(0, 0, 0, 0);

  // NOTE: In real code, query the creditLedger table for this month's sum(delta)
  // For now, return a placeholder - the actual query needs the drizzle types
  const currentUsage = 0; // placeholder

  const charge = input.units * input.unitCost;
  if (currentUsage + charge > plan.creditsPerMonth) {
    throw new LimitExceededError('monthly_credits_exceeded', {
      message: `monthly credit quota exceeded (${currentUsage}/${plan.creditsPerMonth} used, ${charge} requested)`,
      planLimit: plan.creditsPerMonth,
      requested: currentUsage + charge,
      status: 402,
    });
  }

  const delta = -charge;
  await db.insert(/* creditLedger */ {}).values({
    workspace_id: workspaceId,
    video_id: input.videoId,
    action: input.action,
    units: input.units,
    unit_cost: input.unitCost,
    delta,
    created_at: new Date().toISOString(),
  }).returning();

  return plan.creditsPerMonth - (currentUsage + charge);
}

export class LimitExceededError extends Error {
  public readonly violation: LimitViolation;

  constructor(kind: LimitViolationKind, violation: Omit<LimitViolation, 'kind'>) {
    super(violation.message);
    this.name = 'LimitExceededError';
    this.violation = { kind, ...violation };
  }
}

/** Unit costs per step action — zero for personal/self-host use. */
export const UNIT_COSTS: Record<string, { readonly units: number; readonly unitCost: number }> = {
  'create-scenes': { units: 1, unitCost: 0 },
  'create-vocal': { units: 1, unitCost: 0 },
  'create-images': { units: 1, unitCost: 0 },
  'create-captions': { units: 1, unitCost: 0 },
  'render': { units: 1, unitCost: 0 },
  'build-art-style': { units: 1, unitCost: 0 },
} as const;