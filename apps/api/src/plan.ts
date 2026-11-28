/**
 * `POST /v1/videos/plan` — a pure dry-run estimate, not a creation.
 *
 * No database row, no charge, no model call: the script is cut with the same
 * deterministic planner the video falls back to (`packScenes()`), timed with
 * `estimateDuration()`, and language-routed with `scriptLanguagePlan()`. The
 * answer says `adapter: "heuristic"` so a client never mistakes an estimate for
 * a model plan.
 *
 * Pure function over `unknown`: the handler parses JSON defensively and calls
 * this. A request that parses but cannot be planned (blank, wordless, or over
 * the size ceiling) is `400 invalid_request` naming `script`.
 *
 * Also accepts a production script (headings, `**Visual:**`, `**Voiceover:**`)
 * and plans only the narration text.
 */

import { type PlanVideoResponse, planVideoRequestSchema, planVideoResponseSchema } from '@facelesspro/contracts';
import { apiError } from '@facelesspro/contracts';
import { EmptyScriptError, estimateScenePlan } from '@facelesspro/core';
import { parseProductionScript } from '@facelesspro/core';

export function planVideo(input: unknown): {
  status: 200;
  body: PlanVideoResponse;
} | {
  status: 400;
  body: { error: { code: string; message: string; field?: string } };
} {
  const parsed = planVideoRequestSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = Array.isArray(issue.path) && issue.path.length > 0
      ? issue.path.join('.')
      : undefined;
    return {
      status: 400,
      body: apiError(
        'invalid_request',
        issue.message ?? 'invalid request',
        field,
      ),
    };
  }

  // Try to parse as a production script first.
  const script = parsed.data.script;
  const production = parseProductionScript(script);
  const narration = production !== null ? production.narration : script;

  let plan;
  try {
    plan = estimateScenePlan(narration, {
      rates: { ta: 130, en: 150, mixed: 140 },
    });
  } catch (error) {
    if (error instanceof EmptyScriptError) {
      return {
        status: 400,
        body: apiError('invalid_request', error.message, 'script'),
      };
    }
    throw error;
  }

  const body: PlanVideoResponse = {
    scenes: plan.scenes.map((scene, idx) => ({
      idx,
      text: scene.text,
      startMs: scene.startMs,
      endMs: scene.endMs,
    })),
    sceneCount: plan.sceneCount,
    totalMs: plan.totalMs,
    language: plan.language,
    adapter: 'heuristic',
  };

  return { status: 200, body: planVideoResponseSchema.parse(body) };
}
