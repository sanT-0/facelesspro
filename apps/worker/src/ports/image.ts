/** Image generation port — one scene prompt in, one validated PNG out. */

import type {
  GeneratedImage,
  ImageAdapter,
  ImageCapabilities,
  ImageGenerationRequest,
} from '@facelesspro/contracts';

export interface ImageFn {
  draw(request: ImageGenerationRequest): Promise<GeneratedImage>;
}

export interface ImagePort extends ImageFn {
  readonly name: ImageAdapter;
  readonly capabilities: ImageCapabilities;
}
