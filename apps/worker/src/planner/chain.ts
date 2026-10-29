/**
 * Adapter chain: the first healthy planner wins.
 *
 * `PLANNER=cloudflare,groq,heuristic` is the whole configuration (docs/03 §2).
 * A failed adapter does not fail the video — the next one plans it and the plan
 * records `degradedFrom`, so a degraded video is explainable afterwards without
 * reading logs.
 *
 * If every adapter fails, the step must fail: a video with no plan has nothing
 * to draw. The error carries each adapter's diagnosis, and `retryable` is true
 * only when *every* failure was transient — a retry cannot fix a rejected plan
 * or a bad key, and docs/03 §2 says a blind retry only burns quota.
 */

import type { PlannerAdapter, ScenePlan } from '@facelesspro/contracts';

import type { PlanFn, PlanRequest, PlannerPort } from '../ports/planner';

export interface AdapterFailure {
  adapter: PlannerAdapter;
  message: string;
  /** Whether retrying this adapter later could plausibly succeed. */
  retryable: boolean;
}

export class PlannerChainError extends Error {
  override readonly name = 'PlannerChainError';
  readonly failures: readonly AdapterFailure[];
  /** True only when every adapter failed for a transient reason. */
  readonly retryable: boolean;

  constructor(failures: readonly AdapterFailure[]) {
    super(
      `every planner adapter failed: ${failures
        .map((failure) => `${failure.adapter}: ${failure.message}`)
        .join('; ')}`,
    );
    this.failures = failures;
    this.retryable = failures.length > 0 && failures.every((failure) => failure.retryable);
  }
}

/** Adapters mark transient failures; anything else is permanent by default. */
function isRetryable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    (error as { retryable: unknown }).retryable === true
  );
}

export function createPlannerChain(adapters: readonly PlannerPort[]): PlanFn {
  if (adapters.length === 0) {
    throw new TypeError('a planner chain needs at least one adapter');
  }

  return {
    plan: async (request: PlanRequest): Promise<ScenePlan> => {
      const failures: AdapterFailure[] = [];

      for (const adapter of adapters) {
        try {
          const plan = await adapter.plan(request);
          // The adapter names itself in `plan.adapter`; the chain owns the
          // degradation history, so it is the one that fills `degradedFrom`.
          return { ...plan, degradedFrom: failures.map((failure) => failure.adapter) };
        } catch (error) {
          failures.push({
            adapter: adapter.name,
            message: error instanceof Error ? error.message : String(error),
            retryable: isRetryable(error),
          });
        }
      }

      throw new PlannerChainError(failures);
    },
  };
}
