/**
 * Cloudflare Workers AI planner adapter.
 *
 * Calls Cloudflare's Workers AI REST API to get scene beats from an LLM.
 * Requires: CF_ACCOUNT_ID and CF_API_TOKEN environment variables.
 * Model: configurable, defaults to @cf/meta/llama-3.1-8b-instruct
 */

import type { PlanRequest, PlannerPort } from '../ports/planner';
import type { ScenePlan } from '@facelesspro/contracts';

import { buildPlannerPrompt, buildScenePlanFromLLM, parseLLMResponse, validateScenePlan } from './llm';

interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  model: string;
  /** Request timeout in ms. */
  timeoutMs: number;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DEFAULT_TIMEOUT_MS = 30_000;

function getConfig(): CloudflareConfig {
  const accountId = process.env.CF_ACCOUNT_ID?.trim();
  const apiToken = process.env.CF_API_TOKEN?.trim();
  const model = process.env.CF_PLANNER_MODEL?.trim() ?? DEFAULT_MODEL;
  const timeoutMs = Number(process.env.CF_PLANNER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  if (!accountId || !apiToken) {
    throw new Error(
      'Cloudflare planner adapter requires CF_ACCOUNT_ID and CF_API_TOKEN environment variables',
    );
  }

  return { accountId, apiToken, model, timeoutMs };
}

/**
 * Call Cloudflare Workers AI with the given prompt.
 * Returns the raw text response from the model.
 */
async function callCloudflare(prompt: string, config: CloudflareConfig): Promise<string> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a scene planner. Return ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`Cloudflare API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      result?: { response?: string };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      throw new Error(`Cloudflare API error: ${data.errors.map((e) => e.message).join(', ')}`);
    }

    const text = data.result?.response?.trim();
    if (!text) {
      throw new Error('Cloudflare returned empty response');
    }

    return text;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Cloudflare request timed out after ${config.timeoutMs} ms`);
    }
    throw error;
  }
}

export function createCloudflarePlanner(): PlannerPort {
  return {
    name: 'cloudflare',
    plan: async (request: PlanRequest): Promise<ScenePlan> => {
      const config = getConfig();
      const prompt = buildPlannerPrompt(request.script, request.style);

      const rawResponse = await callCloudflare(prompt, config);
      const llmResponse = parseLLMResponse(rawResponse);
      const plan = buildScenePlanFromLLM(llmResponse, request, 'cloudflare');

      return validateScenePlan(plan);
    },
  };
}