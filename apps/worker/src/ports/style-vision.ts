/**
 * The style-vision port (docs/03 §7).
 *
 * The art-style step calls `describe()` and never a vendor: Cloudflare, Gemini
 * and the numeric heuristic are adapters behind this one method, selected by
 * `STYLE=…` and degraded down the chain. Same shape as the planner port on
 * purpose — one provider pattern for the whole worker.
 *
 * The request carries both the sampled frame paths (what a model sees) and the
 * numeric profile (what the heuristic sees). A VLM adapter ignores the numeric
 * half; the heuristic ignores the frames. Neither may invent the other's
 * fields: palette stays measured, description stays observed.
 */

import type { NumericStyleProfile, StyleAdapter, StyleVision } from '@facelesspro/contracts';

export type { StyleAdapter, StyleVision } from '@facelesspro/contracts';

export interface StyleVisionRequest {
  /** Reference frames from `sampleFrames()`, already deduplicated. */
  framePaths: readonly string[];
  /** The measured half, for adapters that cannot see pixels. */
  numeric: NumericStyleProfile;
}

export interface StyleVisionFn {
  describe(request: StyleVisionRequest): Promise<StyleVision>;
}

export interface StyleVisionPort extends StyleVisionFn {
  /** Adapter id from `STYLE_ADAPTERS`; the answer records the same id. */
  readonly name: StyleAdapter;
}
