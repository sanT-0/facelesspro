/**
 * The scene plan — what `create-scenes` produces and every later step reads.
 *
 * Two things are deliberately *not* trusted from a model: the text (it must
 * reassemble into the script, which the validator enforces) and the timings.
 * `startMs`/`endMs` always come from `estimateDuration()`/`packScenes()` in
 * `packages/core`, so a plan is consistent with the narration estimate even when
 * an LLM wrote the beats.
 *
 * `adapter` and `degradedFrom` make degradation visible: a video planned by the
 * fallback after Cloudflare timed out is explainable later without log diving.
 */

import { z } from 'zod';

import { MAX_SCENES } from './common';

/** Motion presets the render service implements. A plan may not invent others. */
export const SCENE_MOTIONS = [
  'kenburns-in',
  'kenburns-out',
  'pan-left',
  'pan-right',
  'none',
] as const;
export const sceneMotionSchema = z.enum(SCENE_MOTIONS);
export type SceneMotion = z.infer<typeof sceneMotionSchema>;

/** Adapters that can produce a plan (docs/03 §2). */
export const PLANNER_ADAPTERS = ['cloudflare', 'groq', 'ollama', 'heuristic', 'chain'] as const;
export const plannerAdapterSchema = z.enum(PLANNER_ADAPTERS);
export type PlannerAdapter = z.infer<typeof plannerAdapterSchema>;

/** Image prompts are model input, so they are bounded like one. */
export const MAX_IMAGE_PROMPT_CHARS = 1_000;
export const MAX_EMPHASIS_WORDS = 12;

export const plannedSceneSchema = z
  .strictObject({
    /** Narration text for this scene. `scenes.text` must reassemble the script. */
    text: z.string().min(1),
    imagePrompt: z.string().min(1).max(MAX_IMAGE_PROMPT_CHARS),
    motion: sceneMotionSchema,
    /** Words from `text` to emphasise. Empty is valid: no emphasis is not a bug. */
    emphasis: z.array(z.string().min(1)).max(MAX_EMPHASIS_WORDS),
    startMs: z.int().min(0),
    endMs: z.int().min(0),
  })
  .refine((scene) => scene.endMs > scene.startMs, {
    message: 'a scene must have a positive duration',
    path: ['endMs'],
  });
export type PlannedScene = z.infer<typeof plannedSceneSchema>;

export const scenePlanSchema = z
  .strictObject({
    scenes: z.array(plannedSceneSchema).min(1).max(MAX_SCENES),
    adapter: plannerAdapterSchema,
    /** Adapters that failed before `adapter` succeeded, in the order tried. */
    degradedFrom: z.array(plannerAdapterSchema),
    totalMs: z.int().min(0),
  })
  .superRefine((plan, ctx) => {
    // The array itself is already invalid when empty or over the cap; adding
    // scene-level issues there would just be noise (and `scenes[0]` is absent).
    if (plan.scenes.length === 0) return;
    const first = plan.scenes[0]!;
    if (first.startMs !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['scenes', 0, 'startMs'],
        message: 'the first scene must start at 0',
      });
    }

    for (let i = 1; i < plan.scenes.length; i += 1) {
      const previous = plan.scenes[i - 1]!;
      const current = plan.scenes[i]!;
      if (current.startMs < previous.endMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', i, 'startMs'],
          message: `scene ${i} starts before scene ${i - 1} ends`,
        });
      }
    }

    const last = plan.scenes.at(-1)!;
    if (plan.totalMs !== last.endMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['totalMs'],
        message: `totalMs (${plan.totalMs}) must equal the last scene endMs (${last.endMs})`,
      });
    }
  });
export type ScenePlan = z.infer<typeof scenePlanSchema>;
