/**
 * Groq planner adapter.
 *
 * Calls Groq's REST API to get scene beats from an LLM.
 * Requires: GROQ_API_KEY environment variable.
 * Model: configurable, defaults to llama-3.1-8b-instant (fast, free tier).
 */

import type { PlanRequest, PlannerPort } from '../ports/planner';
import type { ScenePlan } from '@facelesspro/contracts';

import { buildPlannerPrompt, buildScenePlanFromLLM, parseLLMResponse, validateScenePlan } from './llm';

interface GroqConfig {
  apiKey: string;
  model: string;
  /** Request timeout in ms. */
  timeoutMs: number;
  /** Base URL (for testing/compat). */
  baseUrl: string;
}

const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

function getConfig(): GroqConfig {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const model = process.env.GROQ_PLANNER_MODEL?.trim() ?? DEFAULT_MODEL;
  const timeoutMs = Number(process.env.GROQ_PLANNER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const baseUrl = process.env.GROQ_PLANNER_BASE_URL?.trim() ?? DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error('Groq planner adapter requires GROQ_API_KEY environment variable');
  }

  return { apiKey, model, timeoutMs, baseUrl };
}

/**
 * Call Groq's chat completions API with the given prompt.
 * Returns the raw text response from the model.
 */
async function callGroq(prompt: string, config: GroqConfig): Promise<string> {
  const url = `${config.baseUrl}/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are a scene planner. Return ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`Groq API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Groq API error: ${data.error.message}`);
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('Groq returned empty response');
    }

    return text;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Groq request timed out after ${config.timeoutMs} ms`);
    }
    throw error;
  }
}

export function createGroqPlanner(): PlannerPort {
  return {
    name: 'groq',
    plan: async (request: PlanRequest): Promise<ScenePlan> => {
      const config = getConfig();
      const prompt = buildPlannerPrompt(request.script, request.style);

      const rawResponse = await callGroq(prompt, config);
      const llmResponse = parseLLMResponse(rawResponse);
      const plan = buildScenePlanFromLLM(llmResponse, request, 'groq');

      return validateScenePlan(plan);
    },
  };
}