/** Ordered image adapter chain: first valid image wins, failures become provenance. */

import type {
  GeneratedImage,
  ImageAdapter,
  ImageGenerationRequest,
} from '@facelesspro/contracts';

import type { ImageFn, ImagePort } from '../ports/image';

export interface ImageAdapterFailure {
  readonly adapter: ImageAdapter;
  readonly message: string;
  /** Whether trying the complete chain again later could plausibly help this adapter. */
  readonly retryable: boolean;
}

export class ImageChainError extends Error {
  override readonly name = 'ImageChainError';
  readonly failures: readonly ImageAdapterFailure[];
  /** True only when every configured adapter failed transiently. */
  readonly retryable: boolean;

  constructor(failures: readonly ImageAdapterFailure[]) {
    super(
      `every image adapter failed: ${failures
        .map((failure) => `${failure.adapter}: ${failure.message}`)
        .join('; ')}`,
    );
    this.failures = failures;
    this.retryable = failures.length > 0 && failures.every((failure) => failure.retryable);
  }
}

function isRetryable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    (error as { retryable: unknown }).retryable === true
  );
}

export function createImageChain(adapters: readonly ImagePort[]): ImageFn {
  if (adapters.length === 0) throw new TypeError('an image chain needs at least one adapter');

  return {
    draw: async (request: ImageGenerationRequest): Promise<GeneratedImage> => {
      const failures: ImageAdapterFailure[] = [];
      for (const adapter of adapters) {
        try {
          const image = await adapter.draw(request);
          // Direct adapters always report an empty list. The chain is the only
          // layer that knows which configured adapters actually failed first.
          return { ...image, degradedFrom: failures.map((failure) => failure.adapter) };
        } catch (error) {
          failures.push({
            adapter: adapter.name,
            message: error instanceof Error ? error.message : String(error),
            retryable: isRetryable(error),
          });
        }
      }
      throw new ImageChainError(failures);
    },
  };
}
