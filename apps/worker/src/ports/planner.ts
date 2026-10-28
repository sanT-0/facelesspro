/**
 * The planner port (docs/03 §2).
 *
 * The pipeline calls `plan()` and never a vendor: Cloudflare, Groq, Ollama and
 * the heuristic splitter are adapters behind this one method, selected by
 * `PLANNER=…` and degraded down the chain. That is what makes "free today,
 * better tomorrow" true without touching `create-scenes`.
 *
 * The port returns the *stored* shape (`ScenePlan` in contracts), timings
 * included. Adapters that ask a model for beats still get their timings from
 * `packages/core`, so the field cannot be hallucinated.
 */

import type { PlannerAdapter, ScenePlan } from '@facelesspro/contracts';
import type { DurationRates } from '@facelesspro/core';

/** Art-style clauses injected into every image prompt (P3 fills these in). */
export interface PlanStyle {
  /** Prepended: medium/composition, e.g. "flat vector illustration, wide shot". */
  prefix?: string;
  /** Appended: palette and line clauses. */
  suffix?: string;
  /** Defaults to "no text, no watermark". */
  negative?: string;
}

export interface PlanRequest {
  script: string;
  style?: PlanStyle;
  /** Scene bounds; the product defaults are 8–20 s. */
  minSeconds?: number;
  maxSeconds?: number;
  maxScenes?: number;
  /** Per-language words-per-minute overrides (a slow voice needs more scenes). */
  rates?: Partial<DurationRates>;
  sentencePauseSeconds?: number;
}

export interface PlanFn {
  plan(request: PlanRequest): Promise<ScenePlan>;
}

export interface PlannerPort extends PlanFn {
  /** Adapter id from `PLANNER_ADAPTERS`; the adapter's plans record the same id. */
  readonly name: PlannerAdapter;
}
