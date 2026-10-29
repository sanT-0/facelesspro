/**
 * The model-facing half of the planner: prompt in, validated plan out.
 *
 * Every provider adapter (cloudflare, groq, ollama) is the same three lines —
 * call the API, hand the text here, return the plan — because everything that
 * can be wrong with a model's answer is decided here:
 *
 * 1. **The text is not the model's to edit.** `concat(scene.text) === script`
 *    (whitespace aside) is checked, and a mismatch is a violation, not something
 *    to silently repair: rewriting narration would change what the video says.
 * 2. **The timings are not the model's to guess.** `startMs`/`endMs` come from
 *    `estimateDuration()`, and a 300 ms gap is placed where a sentence actually
 *    ends — so a mid-sentence cut carries no pause.
 * 3. **A bad answer is data, not an exception to swallow.** Violations are
 *    returned in a typed error (`PlannerValidationError.violations`) so the
 *    repair loop can re-ask with the specific diff instead of "try again".
 *
 * Model output is parsed leniently where leniency is safe (code fences, prose
 * around the JSON, extra keys are stripped) and strictly where it is not (the
 * scene text, the motion vocabulary, the prompt bound).
 */

import {
  MAX_EMPHASIS_WORDS,
  MAX_SCENES,
  sceneMotionSchema,
  scenePlanSchema,
} from '@facelesspro/contracts';
import type { PlannedScene, SceneMotion, ScenePlan } from '@facelesspro/contracts';
import {
  DEFAULT_DURATION_RATES,
  DEFAULT_SCENE_MAX_SECONDS,
  DEFAULT_SCENE_MIN_SECONDS,
  DEFAULT_SENTENCE_PAUSE_SECONDS,
  estimateDuration,
  normalizeScript,
  splitSentences,
} from '@facelesspro/core';
import type { DurationOptions, DurationRates } from '@facelesspro/core';
import { z } from 'zod';

import type { PlanRequest } from '../ports/planner';

import { composeImagePrompt } from './prompt';

/** The description the model writes; style clauses are added around it. */
export const MAX_MODEL_DESCRIPTION_CHARS = 600;

/** One scene as the model returns it: no timings, by design. */
export interface ModelBeat {
  text: string;
  /** What the camera sees. Style clauses are injected by the adapter. */
  imagePrompt: string;
  motion: SceneMotion;
  emphasis: string[];
}

export interface ModelPlan {
  scenes: ModelBeat[];
}

/**
 * The model's JSON is parsed with unknown keys stripped: an extra `"duration"`
 * field is a model habit, not a contract breach. Everything that matters is
 * validated explicitly below.
 */
const modelBeatSchema = z.object({
  text: z.string().min(1),
  imagePrompt: z.string().min(1).max(MAX_MODEL_DESCRIPTION_CHARS),
  motion: sceneMotionSchema,
  emphasis: z.array(z.string().min(1)).max(MAX_EMPHASIS_WORDS).default([]),
});

const modelPlanSchema = z.object({
  scenes: z.array(modelBeatSchema).min(1).max(MAX_SCENES),
});

/** The model's answer could not be read as a plan at all. */
export class PlannerResponseError extends Error {
  override readonly name = 'PlannerResponseError';
  /** `invalid-json` = not JSON; `invalid-shape` = JSON, wrong fields. */
  readonly kind: 'invalid-json' | 'invalid-shape';
  /** Re-asking the same prompt is not expected to help; the repair loop rephrases. */
  readonly retryable = false;

  constructor(kind: 'invalid-json' | 'invalid-shape', message: string) {
    super(message);
    this.kind = kind;
  }
}

export type PlannerViolationCode =
  | 'text-mismatch'
  | 'scene-empty'
  | 'scene-too-short'
  | 'scene-too-long'
  | 'prompt-too-long'
  | 'contract';

export interface PlannerViolation {
  code: PlannerViolationCode;
  /** 0-based scene index, when the violation belongs to one scene. */
  scene?: number;
  /** Operator- and model-readable sentence; the repair loop quotes it verbatim. */
  message: string;
}

/** The plan was readable but breaks a rule; the violations say which. */
export class PlannerValidationError extends Error {
  override readonly name = 'PlannerValidationError';
  readonly violations: readonly PlannerViolation[];
  readonly retryable = false;

  constructor(violations: readonly PlannerViolation[]) {
    super(violations.map((violation) => violation.message).join('; '));
    this.violations = violations;
  }
}

/** Everything in a `PlanRequest` except the script itself. */
export type PlanBounds = Omit<PlanRequest, 'script'>;

/** Words per scene implied by the bounds, from the slowest and fastest rates. */
export function sceneWordBudget(request: PlanBounds = {}): { min: number; max: number } {
  const rates: DurationRates = { ...DEFAULT_DURATION_RATES, ...request.rates };
  const fastest = Math.max(rates.ta, rates.en, rates.mixed);
  const slowest = Math.min(rates.ta, rates.en, rates.mixed);
  const minSeconds = request.minSeconds ?? DEFAULT_SCENE_MIN_SECONDS;
  const maxSeconds = request.maxSeconds ?? DEFAULT_SCENE_MAX_SECONDS;
  return {
    // Conservative in both directions: the fastest rate sets the floor, the
    // slowest sets the ceiling, so a Tamil-only scene cannot slip past the max.
    min: Math.ceil((minSeconds * fastest) / 60),
    max: Math.floor((maxSeconds * slowest) / 60),
  };
}

/** How many scenes the script implies, given the bounds. */
export function expectedSceneCount(
  script: string,
  request: PlanBounds = {},
): { min: number; max: number } {
  const total = estimateDuration(script, durationOptions(request)).seconds;
  const minSeconds = request.minSeconds ?? DEFAULT_SCENE_MIN_SECONDS;
  const maxSeconds = request.maxSeconds ?? DEFAULT_SCENE_MAX_SECONDS;
  return {
    min: Math.max(1, Math.ceil(total / maxSeconds)),
    max: Math.max(1, Math.floor(total / minSeconds)),
  };
}

/**
 * Why the previous answer was rejected, as the repair re-ask needs to state it.
 *
 * The two arms are deliberately different: a plan that broke a rule is re-asked
 * with the specific rule it broke, while an answer that could not be read is
 * re-asked for JSON — there is no diff to quote from a body that never parsed.
 */
export type PlannerRejection =
  | { kind: 'violations'; violations: readonly PlannerViolation[] }
  | { kind: 'unreadable'; message: string };

/** `null` when the error is not a model-answer problem and must not be re-asked. */
export function rejectionOf(error: unknown): PlannerRejection | null {
  if (error instanceof PlannerValidationError) {
    // A style whose clauses alone exceed the prompt budget is a configuration
    // bug; no wording of an answer can fix it, so it is not worth another call.
    const repairable = error.violations.filter((violation) => violation.code !== 'prompt-too-long');
    return repairable.length === 0 ? null : { kind: 'violations', violations: repairable };
  }
  if (error instanceof PlannerResponseError) {
    return { kind: 'unreadable', message: error.message };
  }
  return null;
}

/**
 * The prompt. Deterministic for a given request, so a failing answer can be
 * reproduced and a diff re-asked.
 */
export function buildPlannerPrompt(
  request: PlanRequest,
  options: { rejection?: PlannerRejection } = {},
): string {
  const script = normalizeScript(request.script);
  const words = sceneWordBudget(request);
  const count = expectedSceneCount(script, request);
  const total = estimateDuration(script, durationOptions(request));
  const minSeconds = request.minSeconds ?? DEFAULT_SCENE_MIN_SECONDS;
  const maxSeconds = request.maxSeconds ?? DEFAULT_SCENE_MAX_SECONDS;

  const prefix = request.style?.prefix?.trim() ?? 'flat vector illustration, wide shot';
  const suffix = request.style?.suffix?.trim() ?? 'muted earth palette, soft light';
  const negative = request.style?.negative?.trim() ?? 'no text, no watermark';

  return `You plan scenes for a faceless narrated video. The narration is Tamil, English, or a mix of both.

RULES (checked automatically; a violation is rejected)
1. Copy the script exactly. Never rewrite, translate, summarise, reorder, or drop a word.
2. Split only between sentences. Each scene is one or more whole sentences, verbatim.
3. Joining the scenes' texts with one space must reproduce the script exactly.
4. Each scene must be ${minSeconds}–${maxSeconds} seconds of speech: about ${words.min}–${words.max} words.
   The whole script is ${total.seconds.toFixed(1)} s, so aim for ${count.min}–${count.max} scenes.
5. "imagePrompt" describes what the camera sees: subject, action, setting, shot. 1–2 sentences,
   no lettering or captions in the image. The art style is added for you:
   prefix "${prefix}", suffix "${suffix}", negative "${negative}".
6. "motion" is one of: kenburns-in, kenburns-out, pan-left, pan-right, none. Vary it.
7. "emphasis" is 0–${MAX_EMPHASIS_WORDS} words copied verbatim from that scene's text.

SCRIPT (verbatim between the markers):
<<<
${script}
>>>

Return ONLY this JSON, no prose, no code fences:
{"scenes":[{"text":"…","imagePrompt":"…","motion":"kenburns-in","emphasis":["…"]}]}${rejectionBlock(options.rejection)}`;
}

/** The footer that turns a prompt into a repair re-ask. */
function rejectionBlock(rejection: PlannerRejection | undefined): string {
  if (rejection === undefined) return '';

  if (rejection.kind === 'unreadable') {
    return `

YOUR PREVIOUS ANSWER WAS REJECTED
It could not be read as a plan: ${rejection.message}
Return the complete plan again as ONE JSON object — no prose, no code fences.`;
  }

  const listed = rejection.violations
    .map((violation) => `- ${violation.message}`)
    .join('\n');
  return `

YOUR PREVIOUS ANSWER WAS REJECTED
It broke these rules:
${listed}
Return the complete corrected plan: same script, same rules, fix only what is listed.`;
}

/**
 * Read the model's answer. Lenient about packaging (fences, surrounding prose),
 * strict about the plan itself.
 */
export function parseModelText(raw: string): ModelPlan {
  const text = raw.trim();
  if (text.length === 0) {
    throw new PlannerResponseError('invalid-json', 'the model returned an empty response');
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new PlannerResponseError(
      'invalid-json',
      `the model returned no JSON object: ${text.slice(0, 120)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new PlannerResponseError(
      'invalid-json',
      `the model's JSON is malformed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = modelPlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new PlannerResponseError(
      'invalid-shape',
      `the model's JSON does not match the plan shape: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

/** Keep only emphasis words that occur in the scene, each once, capped. */
function emphasisIn(text: string, words: readonly string[]): string[] {
  const tokens = new Set(
    text
      .split(/\s+/u)
      .map((token) => token.replace(/^[\p{P}\p{S}\p{Z}]+|[\p{P}\p{S}\p{Z}]+$/gu, ''))
      .filter((token) => token.length > 0),
  );

  const kept: string[] = [];
  for (const word of words) {
    const cleaned = word.trim();
    if (cleaned.length === 0 || kept.includes(cleaned) || !tokens.has(cleaned)) continue;
    kept.push(cleaned);
    if (kept.length === MAX_EMPHASIS_WORDS) break;
  }
  return kept;
}

function durationOptions(request: PlanBounds): DurationOptions {
  return {
    rates: request.rates,
    sentencePauseSeconds: request.sentencePauseSeconds,
  };
}

/**
 * Turn validated beats into the stored plan: text normalised, timings from core,
 * style injected into every prompt, emphasis filtered to words that exist.
 */
export function planFromBeats(
  model: ModelPlan,
  request: PlanRequest,
  adapter: ScenePlan['adapter'],
): ScenePlan {
  const script = normalizeScript(request.script);
  if (script.length === 0) {
    throw new Error('planner needs a non-empty script');
  }

  const texts = model.scenes.map((beat) => normalizeScript(beat.text));
  const durations = texts.map((text) => estimateDuration(text, durationOptions(request)));
  const minSeconds = request.minSeconds ?? DEFAULT_SCENE_MIN_SECONDS;
  const maxSeconds = request.maxSeconds ?? DEFAULT_SCENE_MAX_SECONDS;

  const violations: PlannerViolation[] = [];

  const joined = normalizeScript(texts.join(' '));
  if (joined !== script) {
    violations.push({
      code: 'text-mismatch',
      message:
        'the scenes\' text does not reassemble the script; copy every sentence verbatim and do not add or drop words',
    });
  }

  texts.forEach((text, index) => {
    const duration = durations[index]!;
    if (duration.words === 0) {
      violations.push({
        code: 'scene-empty',
        scene: index,
        message: `scene ${index + 1} has no speakable words`,
      });
      return;
    }
    if (duration.seconds < minSeconds) {
      violations.push({
        code: 'scene-too-short',
        scene: index,
        message: `scene ${index + 1} is ${duration.seconds.toFixed(1)} s (${duration.words} words); minimum is ${minSeconds} s — merge it with a neighbouring scene`,
      });
    } else if (duration.seconds > maxSeconds) {
      violations.push({
        code: 'scene-too-long',
        scene: index,
        message: `scene ${index + 1} is ${duration.seconds.toFixed(1)} s (${duration.words} words); maximum is ${maxSeconds} s — split it between sentences`,
      });
    }
  });

  // Prompts are composed before timings so a style that cannot fit fails here,
  // with the scene named, rather than as a zod error at the boundary.
  const prompts: string[] = [];
  model.scenes.forEach((beat, index) => {
    try {
      prompts.push(composeImagePrompt(beat.imagePrompt, request.style));
    } catch (error) {
      violations.push({
        code: 'prompt-too-long',
        scene: index,
        message: `scene ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  if (violations.length > 0) throw new PlannerValidationError(violations);

  // A gap belongs after a scene only where a sentence ends there; a cut inside a
  // sentence is a camera cut, not a pause.
  const sentenceEnds = new Set(splitSentences(script).map((sentence) => sentence.end));
  const pause = request.sentencePauseSeconds ?? DEFAULT_SENTENCE_PAUSE_SECONDS;

  const scenes: PlannedScene[] = [];
  let clock = 0;
  let offset = 0;
  model.scenes.forEach((beat, index) => {
    const text = texts[index]!;
    if (index > 0) offset += 1; // the joining space
    const end = offset + text.length;
    offset = end;

    const startMs = Math.round(clock * 1000);
    clock += durations[index]!.seconds;
    const endMs = Math.round(clock * 1000);

    scenes.push({
      text,
      imagePrompt: prompts[index]!,
      motion: beat.motion,
      emphasis: emphasisIn(text, beat.emphasis),
      startMs,
      endMs,
    });

    const last = index === model.scenes.length - 1;
    if (!last && sentenceEnds.has(end)) clock += pause;
  });

  const plan: ScenePlan = {
    scenes,
    adapter,
    degradedFrom: [],
    totalMs: scenes.at(-1)!.endMs,
  };

  // The contract is the last word: if something still disagrees (a zero-length
  // span, a prompt over the bound), it becomes a violation the repair loop sees.
  const parsed = scenePlanSchema.safeParse(plan);
  if (!parsed.success) {
    throw new PlannerValidationError(
      parsed.error.issues.map((issue) => ({
        code: 'contract' as const,
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      })),
    );
  }
  return parsed.data;
}
