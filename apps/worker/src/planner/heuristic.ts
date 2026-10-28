/**
 * The offline planner: `packScenes()` plus a templated image prompt.
 *
 * This adapter is always available, needs no network, and is deterministic, so
 * it is both the last adapter in the chain and the fake used by tests. It is
 * deliberately honest about what it cannot do: it does not describe a picture,
 * it describes the scene's own words. P3's style prompt and a model adapter are
 * what turn that into `"warm kitchen, one woman at a table"`; inventing imagery
 * here would be a guess rendered 30 times per video.
 *
 * Emphasis is empty on purpose: without a model there is no signal for which
 * word deserves a bounce, and wrong emphasis is worse than none.
 */

import { scenePlanSchema } from '@facelesspro/contracts';
import type { PlannedScene, SceneMotion, ScenePlan } from '@facelesspro/contracts';
import { normalizeScript, packScenes } from '@facelesspro/core';

import type { PlanRequest, PlanStyle, PlannerPort } from '../ports/planner';

/** Cycled so consecutive scenes do not all move the same way. */
const MOTION_CYCLE: readonly SceneMotion[] = [
  'kenburns-in',
  'pan-left',
  'kenburns-out',
  'pan-right',
];

const DEFAULT_NEGATIVE = 'no text, no watermark';
/** Enough for an image model to see the subject, short enough to stay a prompt. */
const MAX_DESCRIPTION_WORDS = 18;
const MAX_DESCRIPTION_CHARS = 220;

export function createHeuristicPlanner(): PlannerPort {
  return {
    name: 'heuristic',
    plan: async (request: PlanRequest): Promise<ScenePlan> => {
      // Parse at the boundary like any other adapter output: an invalid plan is
      // a bug here, not something a downstream step should discover.
      return scenePlanSchema.parse(buildPlan(request));
    },
  };
}

function buildPlan(request: PlanRequest): ScenePlan {
  const script = normalizeScript(request.script);
  if (script.length === 0) {
    throw new Error('heuristic planner needs a non-empty script');
  }

  const drafts = packScenes(script, {
    minSeconds: request.minSeconds,
    maxSeconds: request.maxSeconds,
    maxScenes: request.maxScenes,
    rates: request.rates,
    sentencePauseSeconds: request.sentencePauseSeconds,
  });

  const scenes: PlannedScene[] = drafts.map((draft, index) => ({
    text: draft.text,
    imagePrompt: imagePromptFor(draft.text, request.style),
    motion: MOTION_CYCLE[index % MOTION_CYCLE.length]!,
    emphasis: [],
    startMs: draft.startMs,
    endMs: draft.endMs,
  }));

  return {
    scenes,
    adapter: 'heuristic',
    degradedFrom: [],
    totalMs: scenes.at(-1)!.endMs,
  };
}

/**
 * `"{prefix}, {scene words}, {suffix}, {negative}"` — docs/04 §1 step 6 with the
 * description taken from the scene text instead of a model.
 */
export function imagePromptFor(text: string, style: PlanStyle = {}): string {
  const prefix = style.prefix?.trim() ?? '';
  const suffix = style.suffix?.trim() ?? '';
  const negative = style.negative?.trim() ?? DEFAULT_NEGATIVE;

  let words = describe(text).split(' ').filter((word) => word.length > 0);
  const build = (): string =>
    [prefix, words.join(' '), suffix, negative]
      .filter((part) => part.length > 0)
      .join(', ');

  let prompt = build();
  // The contract bounds prompts at 1000 chars; trim the description, never the
  // style clauses (they carry the look of the whole video).
  while (prompt.length > 1000 && words.length > 1) {
    words = words.slice(0, -1);
    prompt = build();
  }
  return prompt;
}

/** Scene words as a description: no punctuation, no emoji, no double spaces. */
function describe(text: string): string {
  const cleaned = text
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (cleaned.length === 0) return 'a scene from the narration';
  let words = cleaned.split(' ').slice(0, MAX_DESCRIPTION_WORDS);
  // Trim whole words only, so a Tamil cluster is never cut in half.
  while (words.length > 1 && words.join(' ').length > MAX_DESCRIPTION_CHARS) {
    words = words.slice(0, -1);
  }
  return words.join(' ');
}
