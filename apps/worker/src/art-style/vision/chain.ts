/**
 * Vision adapter chain: the first healthy description wins.
 *
 * `STYLE=cloudflare,gemini,heuristic` is the whole configuration (docs/03 §7).
 * A failed adapter does not fail the art style — the next one describes it and
 * the answer records `degradedFrom`, so a style described by the fallback is
 * explainable afterwards without reading logs.
 *
 * If every adapter fails the step must fail: a style with no description has
 * nothing to merge. `retryable` is true only when every failure was transient —
 * a model that ignored the contract will ignore it again.
 *
 * Same semantics as `planner/chain.ts` on purpose; the duplication is ~40 lines
 * against a shared generic that would obscure which fields are provenance.
 */

import type { StyleAdapter, StyleVision } from '@facelesspro/contracts';

import type { StyleVisionFn, StyleVisionPort, StyleVisionRequest } from '../../ports/style-vision';

export interface StyleAdapterFailure {
  adapter: StyleAdapter;
  message: string;
  /** Whether retrying this adapter later could plausibly succeed. */
  retryable: boolean;
}

export class StyleVisionChainError extends Error {
  override readonly name = 'StyleVisionChainError';
  readonly failures: readonly StyleAdapterFailure[];
  /** True only when every adapter failed for a transient reason. */
  readonly retryable: boolean;

  constructor(failures: readonly StyleAdapterFailure[]) {
    super(
      `every style vision adapter failed: ${failures
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

export function createStyleVisionChain(adapters: readonly StyleVisionPort[]): StyleVisionFn {
  if (adapters.length === 0) {
    throw new TypeError('a style vision chain needs at least one adapter');
  }

  return {
    describe: async (request: StyleVisionRequest): Promise<StyleVision> => {
      const failures: StyleAdapterFailure[] = [];

      for (const adapter of adapters) {
        try {
          const vision = await adapter.describe(request);
          // The adapter names itself in `vision.adapter`; the chain owns the
          // degradation history, so it is the one that fills `degradedFrom`.
          return { ...vision, degradedFrom: failures.map((failure) => failure.adapter) };
        } catch (error) {
          failures.push({
            adapter: adapter.name,
            message: error instanceof Error ? error.message : String(error),
            retryable: isRetryable(error),
          });
        }
      }

      throw new StyleVisionChainError(failures);
    },
  };
}
