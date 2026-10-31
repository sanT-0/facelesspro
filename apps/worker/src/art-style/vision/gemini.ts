/**
 * Gemini flash vision adapter (docs/06 §1.5 rank 2).
 *
 * `POST /v1beta/models/{model}:generateContent` with the prompt and every frame
 * as an `inline_data` part. The key goes in `x-goog-api-key` rather than a query
 * string so it cannot leak into a logged URL.
 *
 * Gemini is ranked below Cloudflare for cost, above it for description quality;
 * `STYLE=cloudflare,gemini,heuristic` therefore tries Cloudflare first.
 */

import type { StyleAdapter } from '@facelesspro/contracts';

import type { StyleVisionPort } from '../../ports/style-vision';
import { UpstreamError, postJson } from '../../planner/http';
import { loadVisionFrames } from './frames';
import { parseVisionAnswer } from './parse';
import { buildVisionPrompt } from './prompt';
import type { LoadVisionFrames } from './types';

const ADAPTER: StyleAdapter = 'gemini';
export const DEFAULT_GEMINI_VISION_MODEL = 'gemini-2.0-flash';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface GeminiVisionOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to ffmpeg downscale + base64. */
  loadFrames?: LoadVisionFrames;
}

/** Read the adapter's configuration, or explain exactly what is missing. */
export function geminiVisionOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): GeminiVisionOptions {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('gemini vision is not configured: missing GEMINI_API_KEY');
  }

  return {
    apiKey,
    model: env.GEMINI_VISION_MODEL?.trim() || DEFAULT_GEMINI_VISION_MODEL,
    timeoutMs: Number(env.GEMINI_VISION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

export function createGeminiStyleVision(
  options: GeminiVisionOptions = geminiVisionOptionsFromEnv(),
): StyleVisionPort {
  const model = options.model ?? DEFAULT_GEMINI_VISION_MODEL;
  const loadFrames = options.loadFrames ?? loadVisionFrames;

  return {
    name: ADAPTER,
    describe: async (request) => {
      const frames = await loadFrames(request.framePaths);
      const prompt = buildVisionPrompt({ frameCount: frames.length });

      const payload = await postJson({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        headers: { 'x-goog-api-key': options.apiKey },
        body: {
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                ...frames.map((frame) => ({
                  inline_data: { mime_type: frame.mimeType, data: frame.data },
                })),
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
          },
        },
        adapter: ADAPTER,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        fetchImpl: options.fetchImpl,
      });

      const text = textFrom(payload);
      if (text === null || text.trim().length === 0) {
        throw new UpstreamError(ADAPTER, 'response contained no text', { retryable: false });
      }

      const answer = parseVisionAnswer(text);
      return { ...answer, adapter: ADAPTER, degradedFrom: [] };
    },
  };
}

/** Join every `candidates[].content.parts[].text`, or null when there is none. */
function textFrom(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return null;

  const texts: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const parts = (candidate as { content?: { parts?: unknown } }).content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (typeof part !== 'object' || part === null) continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join('') : null;
}
