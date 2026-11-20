/**
 * Optional scene describer for the deterministic planner.
 *
 * The heuristic planner decides cuts with `packScenes()`, which is the only way
 * to keep a Tamil script intact when no model can copy it verbatim: a 3B/7B
 * local model asked to reproduce Tamil sentences routinely drops or rewords
 * one, and the plan is then rejected. What such a model *can* do reliably is
 * describe, in English, what each already-decided scene shows. That is exactly
 * what an image model needs — CLIP is trained on English, so a Tamil-script
 * prompt is near-random input.
 *
 * So this is deliberately not a planner: it never moves a cut, never times a
 * scene and never touches `scenes.text`. It only replaces the deterministic
 * "scene's own words" description with a model-written English sentence, and
 * the plan still records `adapter: heuristic` because the boundaries are
 * unchanged. If the model is unreachable or answers the wrong number of lines,
 * the deterministic description stays and the video still completes.
 */

import type { DescribeScenes } from '../ports/planner';
import { UpstreamError, postJson } from './http';

const ADAPTER = 'ollama-describe';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_TIMEOUT_MS = 300_000;
/** One sentence per scene; longer answers are words the prompt cannot use. */
const MAX_DESCRIPTION_CHARS = 320;

export interface OllamaDescribeOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Reads `OLLAMA_DESCRIBE_*`, falling back to the planner's model and timeout. */
export function ollamaDescribeOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): OllamaDescribeOptions {
  const timeoutText = env.OLLAMA_DESCRIBE_TIMEOUT_MS ?? env.OLLAMA_PLANNER_TIMEOUT_MS;
  const parsedTimeout = Number(timeoutText);
  return {
    baseUrl: env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
    model:
      env.OLLAMA_DESCRIBE_MODEL?.trim() ||
      env.OLLAMA_PLANNER_MODEL?.trim() ||
      DEFAULT_MODEL,
    timeoutMs:
      Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS,
  };
}

/** One numbered line per scene: free text is far more robust than nested JSON. */
export function buildDescribePrompt(scenes: readonly string[]): string {
  return `Describe each numbered scene as a photograph, in ENGLISH only, for an image model.
One sentence per scene. Say what the camera sees: subject, place, action, light. No style words,
no captions, no lettering in the picture.

${scenes.map((scene, index) => `${index + 1}. ${scene}`).join('\n')}

Answer with exactly ${scenes.length} lines, each starting with its number and a period, like
"1. ...". No other text.`;
}

function collapse(text: string): string {
  let words = text.replace(/\s+/gu, ' ').trim();
  words = words.replace(/^["'`]+|["'`]+$/gu, '');
  const parts = words.split(' ').filter((word) => word.length > 0);
  while (parts.join(' ').length > MAX_DESCRIPTION_CHARS && parts.length > 1) parts.pop();
  return parts.join(' ');
}

/**
 * Read `1. …` lines. Numbering is stripped, blank lines ignored, and the count
 * must match exactly: a short answer would silently shift descriptions onto the
 * wrong scenes, which is worse than the deterministic fallback.
 */
export function parseDescribeLines(text: string, count: number): string[] {
  const lines = text.split(/\r?\n/u);
  const numbered: Array<{ index: number; description: string }> = [];
  for (const line of lines) {
    const match = /^\s*(\d+)\s*[.):-]\s*(.+)$/u.exec(line);
    if (match === null) continue;
    const index = Number(match[1]);
    const description = collapse(match[2]!.replace(/^[.):-]\s*/u, ''));
    if (!Number.isInteger(index) || description.length === 0) continue;
    numbered.push({ index, description });
  }

  // Some models answer with bare sentences; accept them only when the count is
  // unambiguous, and only when nothing was numbered.
  const chosen =
    numbered.length === 0
      ? lines.map(collapse).filter((line) => line.length > 0)
      : [...numbered].sort((a, b) => a.index - b.index).map((item) => item.description);

  if (chosen.length !== count) {
    throw new UpstreamError(
      ADAPTER,
      `expected ${count} scene descriptions, got ${chosen.length}`,
      { retryable: false },
    );
  }
  return chosen;
}

/** Ask a local Ollama model for one English visual description per scene. */
export function createOllamaDescriber(
  options: OllamaDescribeOptions = ollamaDescribeOptionsFromEnv(),
): DescribeScenes {
  const baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/u, '');
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (scenes) => {
    if (scenes.length === 0) return [];
    const payload = await postJson({
      url: `${baseUrl}/api/chat`,
      headers: {},
      body: {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a cinematographer. Answer with numbered lines only.',
          },
          { role: 'user', content: buildDescribePrompt(scenes) },
        ],
        stream: false,
        options: { temperature: 0.1, num_predict: 80 * scenes.length },
      },
      adapter: ADAPTER,
      timeoutMs,
      fetchImpl: options.fetchImpl,
    });

    const content =
      typeof payload === 'object' && payload !== null
        ? (payload as { message?: { content?: unknown } }).message?.content
        : undefined;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new UpstreamError(ADAPTER, 'answer contained no text', { retryable: false });
    }
    return parseDescribeLines(content, scenes.length);
  };
}
