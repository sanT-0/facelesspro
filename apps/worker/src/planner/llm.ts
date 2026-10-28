/**
 * Shared logic for LLM-based planner adapters.
 *
 * All model adapters follow the same pattern:
 * 1. Build a prompt with the script, style, and constraints
 * 2. Call the provider's API
 * 3. Parse and validate the JSON response
 * 4. Use `packScenes()` from core to compute timings (models never emit timings)
 * 5. Return a valid ScenePlan with the adapter's name
 */

import { scenePlanSchema, type PlannedScene, type SceneMotion, type ScenePlan } from '@facelesspro/contracts';
import { normalizeScript, packScenes } from '@facelesspro/core';

import type { PlanRequest, PlanStyle, PlannerAdapter } from '../ports/planner';

/** The JSON shape the LLM is asked to return. Timings are NOT included. */
export interface LLMSceneBeat {
  text: string;
  imagePrompt: string;
  motion: SceneMotion;
  emphasis: string[];
}

export interface LLMPlanResponse {
  scenes: LLMSceneBeat[];
}

/** Constraints we ask the model to respect. Also used to validate its answer. */
export const PLANNER_CONSTRAINTS = {
  minSceneSeconds: 8,
  maxSceneSeconds: 20,
  maxScenes: 120,
  maxPromptChars: 1000,
  maxEmphasisWords: 12,
} as const;

/**
 * Build the system prompt for the planner LLM.
 * The prompt is deterministic given the script and style.
 */
export function buildPlannerPrompt(
  script: string,
  style: PlanStyle = {},
  constraints = PLANNER_CONSTRAINTS,
): string {
  const prefix = style.prefix?.trim() ?? 'flat vector illustration, wide shot';
  const suffix = style.suffix?.trim() ?? 'muted earth palette, soft light';
  const negative = style.negative?.trim() ?? 'no text, no watermark';

  return `You are a scene planner for a faceless video generator.
Given a narration script, split it into scenes and return ONLY valid JSON.

CONSTRAINTS (hard, validated after you answer):
- ${constraints.minSceneSeconds}–${constraints.maxSceneSeconds} seconds per scene (measured by word count at 130 wpm Tamil / 150 wpm English / 140 wpm mixed + 300 ms per sentence gap)
- Maximum ${constraints.maxScenes} scenes
- Image prompt ≤ ${constraints.maxPromptChars} characters
- Emphasis words ≤ ${constraints.maxEmphasisWords} per scene
- Motion must be one of: kenburns-in, kenburns-out, pan-left, pan-right, none
- Scene text concatenated must equal the original script (modulo whitespace)

STYLE (inject into every imagePrompt):
prefix: "${prefix}"
suffix: "${suffix}"
negative: "${negative}"

SCRIPT:
${script}

Return ONLY this JSON shape:
{
  "scenes": [
    {
      "text": "scene narration text",
      "imagePrompt": "what to draw for this scene",
      "motion": "kenburns-in",
      "emphasis": ["word1", "word2"]
    }
  ]
}`;
}

/**
 * Parse and validate the LLM's response.
 * Throws if the response is not valid JSON or doesn't match the expected shape.
 */
export function parseLLMResponse(raw: string): LLMPlanResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`LLM returned invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!parsed || typeof parsed !== 'object' || !('scenes' in parsed)) {
    throw new Error('LLM response missing "scenes" array');
  }

  const scenes = (parsed as Record<string, unknown>).scenes;
  if (!Array.isArray(scenes)) {
    throw new Error('LLM "scenes" is not an array');
  }

  if (scenes.length === 0) {
    throw new Error('LLM returned zero scenes');
  }

  // Basic validation of each scene
  for (const [index, scene] of scenes.entries()) {
    if (!scene || typeof scene !== 'object') {
      throw new Error(`Scene ${index} is not an object`);
    }
    const s = scene as Record<string, unknown>;
    if (typeof s.text !== 'string' || s.text.trim().length === 0) {
      throw new Error(`Scene ${index} has empty or missing text`);
    }
    if (typeof s.imagePrompt !== 'string' || s.imagePrompt.trim().length === 0) {
      throw new Error(`Scene ${index} has empty or missing imagePrompt`);
    }
    if (typeof s.motion !== 'string') {
      throw new Error(`Scene ${index} has missing motion`);
    }
    if (!Array.isArray(s.emphasis)) {
      throw new Error(`Scene ${index} has missing emphasis`);
    }
  }

  return { scenes: scenes as LLMSceneBeat[] };
}

/**
 * Validate the model's scene text concatenation matches the normalized script.
 * This is the hard invariant: concat(scene.text) === normalizeScript(script).
 */
export function validateSceneTextConcat(
  llmScenes: LLMSceneBeat[],
  originalScript: string,
): { valid: boolean; diff?: string } {
  const normalizedOriginal = normalizeScript(originalScript);
  const concatText = normalizeScript(llmScenes.map((s) => s.text).join(' '));

  if (concatText === normalizedOriginal) {
    return { valid: true };
  }

  // Provide a helpful diff
  return {
    valid: false,
    diff: `concat(scene.text) mismatch: expected "${normalizedOriginal.slice(0, 200)}…", got "${concatText.slice(0, 200)}…"`,
  };
}

/**
 * Given the LLM's scene beats (text, imagePrompt, motion, emphasis), compute timings
 * using the deterministic packScenes() from core, and return a full ScenePlan.
 *
 * The model's scene text is used as the unit for packing — this guarantees the
 * timings match what the TTS will actually speak.
 */
export function buildScenePlanFromLLM(
  llmResponse: LLMPlanResponse,
  request: PlanRequest,
  adapterName: PlannerAdapter,
): ScenePlan {
  // Validate text concatenation
  const concatCheck = validateSceneTextConcat(llmResponse.scenes, request.script);
  if (!concatCheck.valid) {
    throw new Error(`LLM scene text concatenation failed: ${concatCheck.diff}`);
  }

  // Pack the model's scene text into timed scenes using our deterministic packer
  // We join the LLM's scene text with spaces, then packScenes will split on sentences
  const scriptForPacking = llmResponse.scenes.map((s) => s.text).join(' ');
  const drafts = packScenes(scriptForPacking, {
    minSeconds: request.minSeconds,
    maxSeconds: request.maxSeconds,
    maxScenes: request.maxScenes,
    rates: request.rates,
    sentencePauseSeconds: request.sentencePauseSeconds,
  });

  if (drafts.length !== llmResponse.scenes.length) {
    throw new Error(
      `packScenes produced ${drafts.length} scenes but LLM returned ${llmResponse.scenes.length}; ` +
        `this means the LLM's scene boundaries don't match sentence boundaries. ` +
        `Try adjusting the script or constraints.`,
    );
  }

  const scenes: PlannedScene[] = drafts.map((draft, index) => {
    const llmScene = llmResponse.scenes[index]!;
    return {
      text: draft.text, // Use the packed text (preserves the concat invariant)
      imagePrompt: llmScene.imagePrompt,
      motion: llmScene.motion,
      emphasis: llmScene.emphasis,
      startMs: draft.startMs,
      endMs: draft.endMs,
    };
  });

  return {
    scenes,
    adapter: adapterName,
    degradedFrom: [],
    totalMs: scenes.at(-1)!.endMs,
  };
}

/**
 * Validate a complete ScenePlan against the contract schema.
 * This is the final boundary check before the plan leaves the adapter.
 */
export function validateScenePlan(plan: ScenePlan): ScenePlan {
  return scenePlanSchema.parse(plan);
}