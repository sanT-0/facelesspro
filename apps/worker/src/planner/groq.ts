/**
 * Groq planner — OpenAI-compatible chat completions.
 *
 * `POST {base}/chat/completions` with `response_format: {type: "json_object"}`,
 * which is why a Groq answer needs less forgiving here than a raw completion.
 */

import type { PlannerAdapter, ScenePlan } from '@facelesspro/contracts';

import type { PlanRequest, PlannerPort } from '../ports/planner';
import { UpstreamError, postJson } from './http';
import { planWithRepair } from './repair';

const ADAPTER: PlannerAdapter = 'groq';
export const DEFAULT_GROQ_MODEL = 'llama-3.1-8b-instant';
export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface GroqOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function groqOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): GroqOptions {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('groq planner is not configured: missing GROQ_API_KEY');
  }

  return {
    apiKey,
    model: env.GROQ_PLANNER_MODEL?.trim() || DEFAULT_GROQ_MODEL,
    baseUrl: env.GROQ_PLANNER_BASE_URL?.trim() || DEFAULT_GROQ_BASE_URL,
    timeoutMs: Number(env.GROQ_PLANNER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

export function createGroqPlanner(options: GroqOptions = groqOptionsFromEnv()): PlannerPort {
  const model = options.model ?? DEFAULT_GROQ_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_GROQ_BASE_URL).replace(/\/+$/u, '');

  return {
    name: ADAPTER,
    plan: async (request: PlanRequest): Promise<ScenePlan> => {
      return planWithRepair(request, ADAPTER, async (prompt) => {
        const payload = await postJson({
          url: `${baseUrl}/chat/completions`,
          headers: { Authorization: `Bearer ${options.apiKey}` },
          body: {
            model,
            messages: [
              { role: 'system', content: 'You plan scenes. Answer with JSON only.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 4096,
            response_format: { type: 'json_object' },
          },
          adapter: ADAPTER,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          fetchImpl: options.fetchImpl,
        });

        const text = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)
          ?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new UpstreamError(ADAPTER, 'response contained no text', { retryable: false });
        }
        return text;
      });
    },
  };
}
