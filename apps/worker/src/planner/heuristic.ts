/**
 * The offline planner: `packScenes()` plus a templated image prompt.
 *
 * This adapter is always available, deterministic, and needs no network, so it
 * is both the last adapter in the chain and the fake used by tests. It is
 * deliberately honest about what it cannot do: by itself it does not describe a
 * picture, it describes the scene's own words.
 *
 * `options.describe` is the one model-shaped hole: a caller may supply a
 * describer that turns each already-decided scene into an English visual
 * sentence (see `describe.ts`). The model never chooses cuts, timings or text,
 * and its failure falls back to the deterministic description, so Tamil
 * correctness never depends on a model's mood.
 *
 * Emphasis is empty on purpose: without a model there is no signal for which
 * word deserves a bounce, and wrong emphasis is worse than none.
 */

import { scenePlanSchema } from '@facelesspro/contracts';
import type { PlannedScene, SceneMotion, ScenePlan } from '@facelesspro/contracts';
import { normalizeScript, packScenes } from '@facelesspro/core';

import type { PlanRequest, PlanStyle, PlannerPort, DescribeScenes } from '../ports/planner';
import { composeImagePrompt } from './prompt';

/** Cycled so consecutive scenes do not all move the same way. */
const MOTION_CYCLE: readonly SceneMotion[] = [
  'kenburns-in',
  'pan-left',
  'kenburns-out',
  'pan-right',
];

/** Enough for an image model to see the subject, short enough to stay a prompt. */
const MAX_DESCRIPTION_WORDS = 18;
const MAX_DESCRIPTION_CHARS = 220;

/**
 * Options for the deterministic planner.
 *
 * `describe` is the only place a model may contribute, and it can only replace
 * the image description: cuts, timings, emphasis and text stay deterministic.
 * On any failure the deterministic description is kept, so an unreachable local
 * model costs prompt quality, never the video.
 */
export interface HeuristicPlannerOptions {
  readonly describe?: DescribeScenes;
  /** Defaults to `console.warn`; injected so tests stay silent. */
  readonly logger?: (message: string) => void;
}

export function createHeuristicPlanner(
  options: HeuristicPlannerOptions = {},
): PlannerPort {
  const logger = options.logger ?? ((message: string) => console.warn(message));

  return {
    name: 'heuristic',
    plan: async (request: PlanRequest): Promise<ScenePlan> => {
      // Parse at the boundary like any other adapter output: an invalid plan is
      // a bug here, not something a downstream step should discover.
      const plan = buildPlan(request);
      const scenes = await describeScenes(plan, request.style, options.describe, logger);
      return scenePlanSchema.parse({ ...plan, scenes });
    },
  };
}

/**
 * Replace each prompt's description with a model-written English sentence when a
 * describer is configured. Any error leaves the plan exactly as built.
 */
async function describeScenes(
  plan: ScenePlan,
  style: PlanStyle | undefined,
  describe: DescribeScenes | undefined,
  logger: (message: string) => void,
): Promise<ScenePlan['scenes']> {
  if (describe === undefined) return plan.scenes;
  let descriptions: readonly string[];
  try {
    descriptions = await describe(plan.scenes.map((scene) => scene.text));
  } catch (error) {
    logger(
      `heuristic planner kept its deterministic image prompts: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return plan.scenes;
  }
  if (descriptions.length !== plan.scenes.length) {
    logger(
      `heuristic planner kept its deterministic image prompts: describer returned ` +
        `${descriptions.length} descriptions for ${plan.scenes.length} scenes`,
    );
    return plan.scenes;
  }
  return plan.scenes.map((scene, index) => ({
    ...scene,
    imagePrompt: composeImagePrompt(descriptions[index] ?? '', style),
  }));
}

/** One span whose cut is already decided (an ASR sentence boundary). */
export interface FixedSceneSpan {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Build a plan on boundaries that are already known, instead of packing a
 * script: voiceover intake gets its cuts from speech, so asking the planner to
 * re-segment would move them off the speaker's breath.
 *
 * Since no model is asked for imagery here, the prompt is the deterministic
 * `imagePromptFor()` description and the adapter is recorded as `heuristic`
 * (a model-authored description is a later upgrade, not a silent lie).
 */
export function buildFixedPlan(
  spans: readonly FixedSceneSpan[],
  style: PlanStyle = {},
): ScenePlan {
  const scenes: PlannedScene[] = spans.map((span, index) => ({
    text: span.text,
    imagePrompt: imagePromptFor(span.text, style),
    motion: MOTION_CYCLE[index % MOTION_CYCLE.length]!,
    emphasis: [],
    startMs: span.startMs,
    endMs: span.endMs,
  }));

  return scenePlanSchema.parse({
    scenes,
    adapter: 'heuristic',
    degradedFrom: [],
    totalMs: scenes.at(-1)?.endMs,
  });
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
  return composeImagePrompt(describe(text), style);
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
