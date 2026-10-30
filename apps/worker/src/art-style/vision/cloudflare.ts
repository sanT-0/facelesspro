/**
 * Cloudflare Workers AI vision adapter (docs/06 §1.5 rank 1).
 *
 * `POST /accounts/{id}/ai/run/{model}` with a top-level `image` array of base64
 * strings and a `prompt`, because llava's Workers AI binding is not the chat
 * shape the planner uses. The reply is `{ result: { response } }` for llava;
 * some image-to-text models answer `{ result: { description } }`, so both are
 * read and anything else is a permanent upstream failure.
 */

import type { StyleAdapter } from '@facelesspro/contracts';

import type { StyleVisionPort } from '../../ports/style-vision';
import { UpstreamError, postJson } from '../../planner/http';
import { loadVisionFrames } from './frames';
import { parseVisionAnswer } from './parse';
import { buildVisionPrompt } from './prompt';
import type { LoadVisionFrames } from './types';

const ADAPTER: StyleAdapter = 'cloudflare';
export const DEFAULT_CLOUDFLARE_VISION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface CloudflareVisionOptions {
  accountId: string;
  apiToken: string;
  model?: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to ffmpeg downscale + base64. */
  loadFrames?: LoadVisionFrames;
}

/** Read the adapter's configuration, or explain exactly what is missing. */
export function cloudflareVisionOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): CloudflareVisionOptions {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const missing = [
    accountId ? null : 'CLOUDFLARE_ACCOUNT_ID',
    apiToken ? null : 'CLOUDFLARE_API_TOKEN',
  ].filter((name): name is string => name !== null);

  if (!accountId || !apiToken) {
    throw new Error(`cloudflare vision is not configured: missing ${missing.join(', ')}`);
  }

  return {
    accountId,
    apiToken,
    model: env.CLOUDFLARE_VISION_MODEL?.trim() || DEFAULT_CLOUDFLARE_VISION_MODEL,
    timeoutMs: Number(env.CLOUDFLARE_VISION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

export function createCloudflareStyleVision(
  options: CloudflareVisionOptions = cloudflareVisionOptionsFromEnv(),
): StyleVisionPort {
  const model = options.model ?? DEFAULT_CLOUDFLARE_VISION_MODEL;
  const loadFrames = options.loadFrames ?? loadVisionFrames;

  return {
    name: ADAPTER,
    describe: async (request) => {
      const frames = await loadFrames(request.framePaths);
      const prompt = buildVisionPrompt({ frameCount: frames.length });

      const payload = await postJson({
        url: `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run/${model}`,
        headers: { Authorization: `Bearer ${options.apiToken}` },
        body: {
          image: frames.map((frame) => frame.data),
          prompt,
          max_tokens: 1024,
          temperature: 0.2,
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

/** `{ result: { response } }` or `{ result: { description } }`, else null. */
function textFrom(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== 'object' || result === null) return null;

  const response = (result as { response?: unknown }).response;
  if (typeof response === 'string') return response;

  const description = (result as { description?: unknown }).description;
  return typeof description === 'string' ? description : null;
}
