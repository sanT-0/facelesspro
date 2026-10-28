/**
 * Planner adapter factory.
 *
 * Builds the adapter chain from the PLANNER environment variable.
 * `PLANNER=cloudflare,groq,ollama,heuristic` (order matters — first healthy wins).
 * Adapters that are not configured (missing env vars) are skipped with a warning.
 */

import type { PlannerPort } from '../ports/planner';

import { createHeuristicPlanner } from './heuristic';
import { createCloudflarePlanner } from './cloudflare';
import { createGroqPlanner } from './groq';
import { createOllamaPlanner } from './ollama';
import { createPlannerChain } from './chain';

export interface PlannerFactoryOptions {
  /** Force-enable/disable specific adapters for testing. */
  forceEnabled?: Record<string, boolean>;
  /** Logger for warnings (e.g. console.warn). */
  logger?: (msg: string) => void;
}

const ADAPTER_CREATORS: Record<string, () => PlannerPort> = {
  cloudflare: createCloudflarePlanner,
  groq: createGroqPlanner,
  ollama: createOllamaPlanner,
  heuristic: createHeuristicPlanner,
} as const;

export function createPlannerChainFromEnv(
  options: PlannerFactoryOptions = {},
): PlannerPort {
  const { forceEnabled = {}, logger = console.warn } = options;

  const plannerEnv = process.env.PLANNER?.trim();
  if (!plannerEnv) {
    logger('PLANNER not set, defaulting to heuristic only');
    return createHeuristicPlanner();
  }

  const requested = plannerEnv.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const adapters: PlannerPort[] = [];

  for (const name of requested) {
    const creator = ADAPTER_CREATORS[name];
    if (!creator) {
      logger(`Unknown planner adapter "${name}", skipping`);
      continue;
    }

    // Check if forceEnabled explicitly disables it
    if (forceEnabled[name] === false) {
      logger(`Planner adapter "${name}" disabled by forceEnabled`);
      continue;
    }

    // Check if forceEnabled explicitly enables it (skips env check)
    if (forceEnabled[name] === true) {
      try {
        adapters.push(creator());
        continue;
      } catch (e) {
        logger(`Failed to create forced-enabled adapter "${name}": ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }

    // Normal path: try to create, skip if config is missing
    try {
      adapters.push(creator());
    } catch (e) {
      // The adapter constructor throws if required env vars are missing
      logger(`Planner adapter "${name}" unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (adapters.length === 0) {
    logger('No planner adapters available, falling back to heuristic');
    return createHeuristicPlanner();
  }

  return createPlannerChain(adapters);
}

/**
 * For tests: build a chain with specific adapters, bypassing env.
 */
export function createPlannerChainForTest(
  adapterNames: string[],
  overrides: Record<string, PlannerPort> = {},
): PlannerPort {
  const adapters: PlannerPort[] = [];

  for (const name of adapterNames) {
    if (overrides[name]) {
      adapters.push(overrides[name]);
      continue;
    }
    const creator = ADAPTER_CREATORS[name];
    if (!creator) {
      throw new Error(`Unknown test adapter: ${name}`);
    }
    adapters.push(creator());
  }

  return createPlannerChain(adapters);
}