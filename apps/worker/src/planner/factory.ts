/**
 * `PLANNER=cloudflare,groq,ollama,heuristic` → an adapter chain.
 *
 * Order is the whole configuration: the first adapter that answers plans the
 * video. An adapter whose credentials are absent is skipped with a warning
 * rather than included and failed at request time — a misconfiguration should
 * look like a misconfiguration in the log, not like a provider outage.
 *
 * The heuristic adapter is the floor: it needs nothing and cannot fail, so the
 * chain always ends with a plan.
 */

import type { PlannerAdapter } from '@facelesspro/contracts';
import type { PlanFn } from '../ports/planner';

import { createCloudflarePlanner, cloudflareOptionsFromEnv } from './cloudflare';
import { createPlannerChain } from './chain';
import { createGroqPlanner, groqOptionsFromEnv } from './groq';
import { createHeuristicPlanner } from './heuristic';
import { createOllamaDescriber, ollamaDescribeOptionsFromEnv } from './describe';
import { createOllamaPlanner, ollamaOptionsFromEnv } from './ollama';

export interface PlannerFactoryOptions {
  /** Defaults to `process.env`; injected so tests never read the real environment. */
  env?: Record<string, string | undefined>;
  /** Defaults to `console.warn`. */
  logger?: (message: string) => void;
  /** Injected into the HTTP adapters; tests pass a fake. */
  fetchImpl?: typeof fetch;
}

type Env = Record<string, string | undefined>;

const CREATORS: Record<PlannerAdapter, (env: Env, fetchImpl?: typeof fetch) => ReturnType<typeof createHeuristicPlanner>> = {
  cloudflare: (env, fetchImpl) => createCloudflarePlanner({ ...cloudflareOptionsFromEnv(env), fetchImpl }),
  groq: (env, fetchImpl) => createGroqPlanner({ ...groqOptionsFromEnv(env), fetchImpl }),
  ollama: (env, fetchImpl) => createOllamaPlanner({ ...ollamaOptionsFromEnv(env), fetchImpl }),
  heuristic: () => createHeuristicPlanner(),
};

const isAdapter = (name: string): name is PlannerAdapter =>
  Object.prototype.hasOwnProperty.call(CREATORS, name);

/**
 * `PLANNER_DESCRIBE=ollama` lets the deterministic planner ask a local model for
 * English scene descriptions. It changes prompts only, never cuts or timings.
 */
function describerFromEnv(
  env: Env,
  fetchImpl: typeof fetch | undefined,
  logger: (message: string) => void,
) {
  const name = (env.PLANNER_DESCRIBE ?? '').trim().toLowerCase();
  if (name.length === 0 || name === 'none') return undefined;
  if (name !== 'ollama') {
    logger(`PLANNER_DESCRIBE names an unknown describer "${name}"; ignoring it`);
    return undefined;
  }
  try {
    return createOllamaDescriber({ ...ollamaDescribeOptionsFromEnv(env), fetchImpl });
  } catch (error) {
    logger(
      `PLANNER_DESCRIBE adapter "ollama" is not available: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

/** Build the chain described by `PLANNER`, degrading to the heuristic alone. */
export function createPlannerChainFromEnv(options: PlannerFactoryOptions = {}): PlanFn {
  const env = options.env ?? process.env;
  const logger = options.logger ?? ((message: string) => console.warn(message));
  const describe = describerFromEnv(env, options.fetchImpl, logger);
  const heuristic = (): ReturnType<typeof createHeuristicPlanner> =>
    createHeuristicPlanner({ describe, logger });

  const requested = (env.PLANNER ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (requested.length === 0) {
    logger('PLANNER is not set; planning with the heuristic adapter only');
    return createPlannerChain([heuristic()]);
  }

  const adapters = [];
  for (const name of requested) {
    if (!isAdapter(name)) {
      logger(`PLANNER names an unknown adapter "${name}"; ignoring it`);
      continue;
    }
    try {
      adapters.push(name === 'heuristic' ? heuristic() : CREATORS[name](env, options.fetchImpl));
    } catch (error) {
      logger(
        `PLANNER adapter "${name}" is not available: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (adapters.length === 0) {
    logger('no configured PLANNER adapter is available; planning with the heuristic adapter');
    return createPlannerChain([heuristic()]);
  }

  return createPlannerChain(adapters);
}
