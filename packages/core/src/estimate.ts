/**
 * A dry-run estimate: how the script would be cut, how long it would run, and
 * which voice would speak each word.
 *
 * This is deliberately **not** a model call. `POST /v1/videos/plan` must answer
 * in milliseconds, cost nothing, and be reproducible from the script alone, so
 * it runs the same deterministic layer the planner falls back to
 * (`packScenes()` + `estimateDuration()`). The response says `adapter:
 * "heuristic"` for exactly that reason: an estimate is honest about its
 * provenance instead of pretending a model chose the cuts.
 *
 * It does not replace the planner. A real creation may let a model choose the
 * boundaries (and write image prompts); this function only previews the
 * deterministic plan a user gets when no model is reachable — the floor, not the
 * ceiling. Because it shares `packScenes()` with that fallback, the preview
 * cannot disagree with the video it predicts.
 *
 * Pure: no I/O, no clock, no network.
 */

import type { Lang } from './types';
import { estimateDuration, spokenWordTokens } from './duration';
import { segmentWithOverrides } from './overrides';
import { packScenes } from './scenes';
import type { PackScenesOptions } from './scenes';

/** `mixed` means both voices are used; it is not a third language. */
export type PlanLanguageRun = Lang | 'mixed';

export interface ScriptLanguagePlan {
  /** `mixed` when at least one word goes to each voice. */
  run: PlanLanguageRun;
  /** Whole-word counts routed to each voice, before number expansion. */
  words: { ta: number; en: number };
}

export interface PlanSceneEstimate {
  idx: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface ScenePlanEstimate {
  scenes: PlanSceneEstimate[];
  sceneCount: number;
  /** Equal to the last scene's `endMs`, so a client never adds up twice. */
  totalMs: number;
  language: ScriptLanguagePlan;
}

/**
 * A script with no speakable word. Distinct from a schema failure: `"..."`
 * is a string of the right length, but there is nothing to narrate.
 */
export class EmptyScriptError extends Error {
  constructor(message = 'script contains no words to speak') {
    super(message);
    this.name = 'EmptyScriptError';
  }
}

/**
 * Route words to the Tamil or English voice, using the same segmentation the
 * narration plan uses — including `[[ta:…]]` / `[[en:…]]` overrides.
 *
 * Counting by `run.lang` rather than by script is deliberate: a Tanglish run is
 * spoken by the Tamil voice, and an override forces a voice even when the
 * written script would suggest the other one.
 */
export function scriptLanguagePlan(script: string): ScriptLanguagePlan {
  const { runs } = segmentWithOverrides(script);
  let ta = 0;
  let en = 0;
  for (const run of runs) {
    const words = spokenWordTokens(run.text).length;
    if (run.lang === 'ta') ta += words;
    else en += words;
  }
  const run: PlanLanguageRun = ta > 0 && en > 0 ? 'mixed' : en > 0 ? 'en' : 'ta';
  return { run, words: { ta, en } };
}

/**
 * Estimate scenes, duration and language from the script. Throws
 * `EmptyScriptError` for blank or wordless input; every other failure is a
 * programming error (`TypeError` from the underlying functions).
 */
export function estimateScenePlan(
  script: string,
  options: PackScenesOptions = {},
): ScenePlanEstimate {
  // Checked before packing: a wordless script can still produce a scene, but
  // its span would be zero-length, which is not a plan.
  const duration = estimateDuration(script, options);
  if (duration.words === 0) throw new EmptyScriptError();

  const drafts = packScenes(script, options);
  if (drafts.length === 0) throw new EmptyScriptError();

  const scenes: PlanSceneEstimate[] = drafts.map((draft, idx) => ({
    idx,
    text: draft.text,
    startMs: draft.startMs,
    endMs: draft.endMs,
  }));

  return {
    scenes,
    sceneCount: scenes.length,
    totalMs: scenes.at(-1)!.endMs,
    language: scriptLanguagePlan(script),
  };
}
