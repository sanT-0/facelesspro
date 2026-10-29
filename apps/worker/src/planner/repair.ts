/**
 * One repair attempt: ask, check, re-ask with the diff.
 *
 * The planner's whole failure policy is here (docs/04 §1 step 5):
 *
 * - A **rejected answer** is not a provider outage. It is re-asked once with the
 *   violations quoted back, because a model that wrote a 4-second scene can
 *   usually fix it when told which scene and what the bound is. A blind retry of
 *   the same prompt is what would burn quota; a re-ask that carries the diff is
 *   a different request.
 * - A **transport failure** is not re-asked here at all. `postJson` already
 *   classified it (`429`, timeout, 5xx → `retryable: true`) and the chain/step
 *   runner owns that decision; retrying inside the adapter would multiply a
 *   rate limit by every adapter in the chain.
 * - Exactly **two calls**, never three. If the repaired answer is still wrong,
 *   the second error survives untouched — including its own violations — so the
 *   chain can degrade and the video's error names the real reason.
 *
 * Timings still come from `planFromBeats()` on both attempts; a repair cannot
 * change how a scene is timed, only where its text starts and ends.
 */

import type { PlannerAdapter, ScenePlan } from '@facelesspro/contracts';

import type { PlanRequest } from '../ports/planner';
import { buildPlannerPrompt, parseModelText, planFromBeats, rejectionOf } from './model';

/** The first call plus one repair. Exported so tests pin the budget. */
export const MAX_PLANNER_ATTEMPTS = 2;

/** The provider-specific part: send a prompt, return the model's text. */
export type ModelCall = (prompt: string) => Promise<string>;

export async function planWithRepair(
  request: PlanRequest,
  adapter: PlannerAdapter,
  call: ModelCall,
): Promise<ScenePlan> {
  let attempts = 0;
  let prompt = buildPlannerPrompt(request);

  for (;;) {
    attempts += 1;
    // Deliberately outside the try: an `UpstreamError` must leave immediately,
    // not be mistaken for a bad answer and re-asked.
    const text = await call(prompt);

    try {
      return planFromBeats(parseModelText(text), request, adapter);
    } catch (error) {
      const rejection = rejectionOf(error);
      // A bug in the adapter (or a style that cannot fit) is not the model's
      // fault to fix; only an answer that was read but rejected gets a re-ask.
      if (rejection === null || attempts >= MAX_PLANNER_ATTEMPTS) throw error;
      prompt = buildPlannerPrompt(request, { rejection });
    }
  }
}
