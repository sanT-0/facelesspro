/**
 * Ollama planner — a local model, no key, no quota.
 *
 * `POST {base}/api/chat` with `stream: false` and `format: "json"`. The default
 * timeout is longer than the hosted adapters': a cold model on a laptop can take
 * a minute to answer, and failing then would push the video onto the heuristic
 * for no reason.
 */

import type { PlannerAdapter, ScenePlan } from '@facelesspro/contracts';

import type { PlanRequest, PlannerPort } from '../ports/planner';
import { UpstreamError, postJson } from './http';
import { planWithRepair } from './repair';

const ADAPTER: PlannerAdapter = 'ollama';
export const DEFAULT_OLLAMA_MODEL = 'llama3.1:8b';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_TIMEOUT_MS = 120_000;

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Ollama needs no credential, so it is "configured" whenever it is in the
 * `PLANNER` list; the chain still degrades if nothing is listening on the port.
 */
export function ollamaOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): OllamaOptions {
  return {
    baseUrl: env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
    model: env.OLLAMA_PLANNER_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
    timeoutMs: Number(env.OLLAMA_PLANNER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

export function createOllamaPlanner(options: OllamaOptions = ollamaOptionsFromEnv()): PlannerPort {
  const model = options.model ?? DEFAULT_OLLAMA_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/u, '');

  return {
    name: ADAPTER,
    plan: async (request: PlanRequest): Promise<ScenePlan> => {
      return planWithRepair(request, ADAPTER, async (prompt) => {
        const payload = await postJson({
          url: `${baseUrl}/api/chat`,
          headers: {},
          body: {
            model,
            messages: [
              { role: 'system', content: 'You plan scenes. Answer with JSON only.' },
              { role: 'user', content: prompt },
            ],
            format: 'json',
            stream: false,
            options: { temperature: 0.3, num_predict: 4096 },
          },
          adapter: ADAPTER,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          fetchImpl: options.fetchImpl,
        });

        const text = (payload as { message?: { content?: unknown } } | null)?.message?.content;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new UpstreamError(ADAPTER, 'response contained no text', { retryable: false });
        }
        return text;
      });
    },
  };
}
