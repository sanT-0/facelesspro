/**
 * Which preview canvases to produce for one style.
 *
 * Split out of `runtime.ts` so the decision is testable without loading
 * Postgres, pg-boss or the vision factory. It reads only the merged profile and
 * the style's requested formats.
 */

import {
  LANDSCAPE_PREVIEW,
  PORTRAIT_PREVIEW,
} from '@facelesspro/core';
import type { StyleProfile } from '@facelesspro/contracts';

export interface PreviewPlan {
  /** Canvas for the grid and the clip. */
  readonly grid: { readonly width: number; readonly height: number };
  readonly clip: { readonly width: number; readonly height: number };
  /** Portrait grid only when the style offers portrait and the reference is not already portrait. */
  readonly portrait: { readonly width: number; readonly height: number } | null;
}

/**
 * A portrait reference already produces a portrait grid, so a second
 * `preview-portrait.png` would be a duplicate. A landscape reference that
 * offers a portrait size gets the 9:16 centre-crop contact sheet the product
 * spec promises. Generated art (`ImagePort`) will not change this decision.
 */
export function previewPlan(profile: StyleProfile, formats: readonly string[]): PreviewPlan {
  const orientation = profile.measured.aspect.orientation;
  if (orientation === 'portrait') {
    return { grid: PORTRAIT_PREVIEW, clip: PORTRAIT_PREVIEW, portrait: null };
  }
  return {
    grid: LANDSCAPE_PREVIEW,
    clip: LANDSCAPE_PREVIEW,
    portrait: formats.includes('portrait') ? PORTRAIT_PREVIEW : null,
  };
}
