/**
 * Cloudflare Workers AI planner.
 *
 * `POST /accounts/{id}/ai/run/{model}` returns `{ result: { response } }`.
 * Free-tier friendly and the default in docs/03; the account id and token are
 * the only configuration, so an unconfigured adapter fails at construction and
 * the factory simply skips it.
 */

import type { PlannerAdapter, ScenePlan } from '@facelesspro/contracts';

import type { PlanRequest, PlannerPort } from '../ports/planner';
import { UpstreamError, postJson } from './http';
import { planWithRepair } from './repair';

const ADAPTER: PlannerAdapter = 'cloudflare';
export const DEFAULT_CLOUDFLARE_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CloudflareOptions {
  accountId: string;
  apiToken: string;
  model?: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Read the adapter's configuration, or explain exactly what is missing. */
export function cloudflareOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): CloudflareOptions {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const missing = [
    accountId ? null : 'CLOUDFLARE_ACCOUNT_ID',
    apiToken ? null : 'CLOUDFLARE_API_TOKEN',
  ].filter((name): name is string => name !== null);

  if (!accountId || !apiToken) {
    throw new Error(`cloudflare planner is not configured: missing ${missing.join(', ')}`);
  }

  return {
    accountId,
    apiToken,
    model: env.CLOUDFLARE_PLANNER_MODEL?.trim() || DEFAULT_CLOUDFLARE_MODEL,
    timeoutMs: Number(env.CLOUDFLARE_PLANNER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

export function createCloudflarePlanner(options: CloudflareOptions = cloudflareOptionsFromEnv()): PlannerPort {
  const model = options.model ?? DEFAULT_CLOUDFLARE_MODEL;

  return {
    name: ADAPTER,
    plan: async (request: PlanRequest): Promise<ScenePlan> => {
      return planWithRepair(request, ADAPTER, async (prompt) => {
        const payload = await postJson({
          url: `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run/${model}`,
          headers: { Authorization: `Bearer ${options.apiToken}` },
          body: {
            messages: [
              { role: 'system', content: 'You plan scenes. Answer with JSON only.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 4096,
          },
          adapter: ADAPTER,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          fetchImpl: options.fetchImpl,
        });

        const text = (payload as { result?: { response?: unknown } } | null)?.result?.response;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new UpstreamError(ADAPTER, 'response contained no text', { retryable: false });
        }
        return text;
      });
    },
  };
}
