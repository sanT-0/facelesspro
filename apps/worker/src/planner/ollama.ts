/**
 * Ollama planner adapter.
 *
 * Calls a local Ollama instance to get scene beats from an LLM.
 * Requires: OLLAMA_BASE_URL (default http://localhost:11434) and model name.
 * Model: configurable, defaults to llama3.1:8b (or any model pulled locally).
 */

import type { PlanRequest, PlannerPort } from '../ports/planner';
import type { ScenePlan } from '@facelesspro/contracts';

import { buildPlannerPrompt, buildScenePlanFromLLM, parseLLMResponse, validateScenePlan } from './llm';

interface OllamaConfig {
  baseUrl: string;
  model: string;
  /** Request timeout in ms. Ollama can be slow on first run. */
  timeoutMs: number;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_TIMEOUT_MS = 120_000; // Ollama can be slow, especially cold

function getConfig(): OllamaConfig {
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim() ?? DEFAULT_BASE_URL;
  const model = process.env.OLLAMA_PLANNER_MODEL?.trim() ?? DEFAULT_MODEL;
  const timeoutMs = Number(process.env.OLLAMA_PLANNER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  return { baseUrl, model, timeoutMs };
}

/**
 * Call Ollama's chat completions API with the given prompt.
 * Returns the raw text response from the model.
 */
async function callOllama(prompt: string, config: OllamaConfig): Promise<string> {
  const url = `${config.baseUrl}/api/chat`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are a scene planner. Return ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ],
        format: 'json', // Ollama's JSON mode
        options: {
          temperature: 0.3,
          num_predict: 2048,
        },
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`Ollama API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      error?: string;
    };

    if (data.error) {
      throw new Error(`Ollama API error: ${data.error}`);
    }

    const text = data.message?.content?.trim();
    if (!text) {
      throw new Error('Ollama returned empty response');
    }

    return text;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${config.timeoutMs} ms`);
    }
    throw error;
  }
}

export function createOllamaPlanner(): PlannerPort {
  return {
    name: 'ollama',
    plan: async (request: PlanRequest): Promise<ScenePlan> => {
      const config = getConfig();
      const prompt = buildPlannerPrompt(request.script, request.style);

      const rawResponse = await callOllama(prompt, config);
      const llmResponse = parseLLMResponse(rawResponse);
      const plan = buildScenePlanFromLLM(llmResponse, request, 'ollama');

      return validateScenePlan(plan);
    },
  };
}