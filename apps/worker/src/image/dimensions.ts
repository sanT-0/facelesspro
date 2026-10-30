import type { Size } from '@facelesspro/contracts';

/** Shared 16:9 / 9:16 generation geometry for 1024-class adapters. */
export const IMAGE_NATIVE_DIMENSIONS = {
  landscape: { width: 1024, height: 576 },
  portrait: { width: 576, height: 1024 },
} as const satisfies Record<Size, { readonly width: number; readonly height: number }>;

export type ImageDimensions = (typeof IMAGE_NATIVE_DIMENSIONS)[Size];
