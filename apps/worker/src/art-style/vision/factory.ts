/**
 * `STYLE=cloudflare,gemini,heuristic` → a vision adapter chain.
 *
 * Order is the whole configuration: the first adapter that answers describes
 * the style. An adapter whose credentials are absent is skipped with a warning
 * rather than included and failed at request time — a misconfiguration should
 * look like a misconfiguration in the log, not like a provider outage.
 *
 * The heuristic adapter is the floor: it needs no key and cannot fail, so the
 * chain always ends with a description.
 */

import type { StyleAdapter } from '@facelesspro/contracts';

import type { StyleVisionFn } from '../../ports/style-vision';
import { createStyleVisionChain } from './chain';
import { createCloudflareStyleVision, cloudflareVisionOptionsFromEnv } from './cloudflare';
import { createGeminiStyleVision, geminiVisionOptionsFromEnv } from './gemini';
import { createHeuristicStyleVision } from './heuristic';

export interface StyleVisionFactoryOptions {
  /** Defaults to `process.env`; injected so tests never read the real environment. */
  env?: Record<string, string | undefined>;
  /** Defaults to `console.warn`. */
  logger?: (message: string) => void;
  /** Injected into the HTTP adapters; tests pass a fake. */
  fetchImpl?: typeof fetch;
  /** Injected into the HTTP adapters; tests pass fake base64 frames. */
  loadFrames?: (paths: readonly string[]) => Promise<
    Array<{ path: string; mimeType: 'image/jpeg'; data: string }>
  >;
}

type Env = Record<string, string | undefined>;

type Creator = (env: Env, options: StyleVisionFactoryOptions) => ReturnType<typeof createHeuristicStyleVision>;

const CREATORS: Record<StyleAdapter, Creator> = {
  cloudflare: (env, options) =>
    createCloudflareStyleVision({
      ...cloudflareVisionOptionsFromEnv(env),
      fetchImpl: options.fetchImpl,
      loadFrames: options.loadFrames,
    }),
  gemini: (env, options) =>
    createGeminiStyleVision({
      ...geminiVisionOptionsFromEnv(env),
      fetchImpl: options.fetchImpl,
      loadFrames: options.loadFrames,
    }),
  heuristic: () => createHeuristicStyleVision(),
};

const isAdapter = (name: string): name is StyleAdapter =>
  Object.prototype.hasOwnProperty.call(CREATORS, name);

/** Build the chain described by `STYLE`, degrading to the heuristic alone. */
export function createStyleVisionChainFromEnv(
  options: StyleVisionFactoryOptions = {},
): StyleVisionFn {
  const env = options.env ?? process.env;
  const logger = options.logger ?? ((message: string) => console.warn(message));

  const requested = (env.STYLE ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (requested.length === 0) {
    logger('STYLE is not set; describing art styles with the heuristic adapter only');
    return createStyleVisionChain([createHeuristicStyleVision()]);
  }

  const adapters = [];
  for (const name of requested) {
    if (!isAdapter(name)) {
      logger(`STYLE names an unknown adapter "${name}"; ignoring it`);
      continue;
    }
    try {
      adapters.push(CREATORS[name](env, options));
    } catch (error) {
      logger(
        `STYLE adapter "${name}" is not available: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (adapters.length === 0) {
    logger('no configured STYLE adapter is available; describing art styles with the heuristic adapter');
    return createStyleVisionChain([createHeuristicStyleVision()]);
  }

  return createStyleVisionChain(adapters);
}
