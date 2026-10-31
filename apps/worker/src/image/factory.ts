/** `IMAGE=cloudflare,pollinations,comfyui,procedural` → an ordered image chain. */

import type { ImageAdapter } from '@facelesspro/contracts';

import type { ImageFn, ImagePort } from '../ports/image';
import { createImageChain } from './chain';
import { cloudflareImageOptionsFromEnv, createCloudflareImageAdapter } from './cloudflare';
import {
  comfyUIImageOptionsFromEnv,
  createComfyUIImageAdapter,
} from './comfyui';
import type { ComfyUIImageOptions } from './comfyui';
import type { NormalizeImage } from './normalize';
import {
  createPollinationsImageAdapter,
  pollinationsImageOptionsFromEnv,
} from './pollinations';
import { createProceduralImageAdapter } from './procedural';

export interface ImageFactoryOptions {
  /** Defaults to `process.env`; injected so tests never read the real environment. */
  readonly env?: Record<string, string | undefined>;
  /** Defaults to `console.warn`. */
  readonly logger?: (message: string) => void;
  /** Shared HTTP injection for hosted adapters and ComfyUI. */
  readonly fetchImpl?: typeof fetch;
  /** Shared provider-raster normalizer injection. Procedural does not use it. */
  readonly normalize?: NormalizeImage;
  /** ComfyUI polling injection so tests never sleep. */
  readonly comfyWait?: NonNullable<ComfyUIImageOptions['wait']>;
}

type Env = Record<string, string | undefined>;
type Creator = (env: Env, options: ImageFactoryOptions) => ImagePort;

const CREATORS: Record<ImageAdapter, Creator> = {
  cloudflare: (env, options) =>
    createCloudflareImageAdapter({
      ...cloudflareImageOptionsFromEnv(env),
      fetchImpl: options.fetchImpl,
      normalize: options.normalize,
    }),
  pollinations: (env, options) =>
    createPollinationsImageAdapter({
      ...pollinationsImageOptionsFromEnv(env),
      fetchImpl: options.fetchImpl,
      normalize: options.normalize,
    }),
  comfyui: (env, options) =>
    createComfyUIImageAdapter({
      ...comfyUIImageOptionsFromEnv(env),
      fetchImpl: options.fetchImpl,
      normalize: options.normalize,
      wait: options.comfyWait,
    }),
  procedural: () => createProceduralImageAdapter(),
};

const isAdapter = (name: string): name is ImageAdapter => Object.hasOwn(CREATORS, name);

/** Build the configured chain, retaining the procedural renderer as zero-config recovery. */
export function createImageChainFromEnv(options: ImageFactoryOptions = {}): ImageFn {
  const env = options.env ?? process.env;
  const logger = options.logger ?? ((message: string) => console.warn(message));
  const requested = (env.IMAGE ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (requested.length === 0) {
    logger('IMAGE is not set; using the procedural image adapter only');
    return createImageChain([createProceduralImageAdapter()]);
  }

  const adapters: ImagePort[] = [];
  const seen = new Set<ImageAdapter>();
  for (const name of requested) {
    if (!isAdapter(name)) {
      logger(`IMAGE names an unknown adapter "${name}"; ignoring it`);
      continue;
    }
    if (seen.has(name)) {
      logger(`IMAGE names duplicate adapter "${name}"; ignoring the duplicate`);
      continue;
    }
    seen.add(name);
    try {
      adapters.push(CREATORS[name](env, options));
    } catch (error) {
      logger(
        `IMAGE adapter "${name}" is not available: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (adapters.length === 0) {
    logger('no configured IMAGE adapter is available; using the procedural image adapter');
    return createImageChain([createProceduralImageAdapter()]);
  }
  return createImageChain(adapters);
}
