import { describe, expect, it } from 'vitest';

import type { PlanRequest } from '../ports/planner';
import { UpstreamError } from './http';
import {
  PlannerResponseError,
  PlannerValidationError,
  buildPlannerPrompt,
} from './model';
import { MAX_PLANNER_ATTEMPTS, planWithRepair } from './repair';

const word = 'வார்த்தை';
const sentence = (words: number) => `${Array.from({ length: words }, () => word).join(' ')}.`;

/** 25 Tamil words ≈ 11.5 s; two of them are 2 scenes inside 8–20 s. */
const SENTENCE_A = sentence(25);
const SENTENCE_B = sentence(25);
const SCRIPT = `${SENTENCE_A} ${SENTENCE_B}`;

const request: PlanRequest = { script: SCRIPT };

const answer = (texts: readonly string[], motion = 'none'): string =>
  JSON.stringify({
    scenes: texts.map((text) => ({ text, imagePrompt: 'a desk by a window', motion, emphasis: [] })),
  });

/** Both sentences in one 23 s scene: a `scene-too-long` violation. */
const TOO_LONG = answer([`${SENTENCE_A} ${SENTENCE_B}`]);
/** The second sentence dropped: a `text-mismatch` violation. */
const INCOMPLETE = answer([SENTENCE_A]);
const GOOD = answer([SENTENCE_A, SENTENCE_B]);

/** A fake model call that answers from a queue and records every prompt. */
function scriptedCall(...answers: readonly string[]) {
  const prompts: string[] = [];
  const call = async (prompt: string): Promise<string> => {
    prompts.push(prompt);
    const next = answers[prompts.length - 1];
    if (next === undefined) throw new Error(`only ${answers.length} answer(s) scripted`);
    return next;
  };
  return { prompts, call };
}

const violationsOf = async (error: unknown): Promise<readonly { code: string; message: string }[]> => {
  expect(error).toBeInstanceOf(PlannerValidationError);
  return (error as PlannerValidationError).violations;
};

describe('planWithRepair', () => {
  it('returns the plan on the first valid answer with no repair', async () => {
    const { prompts, call } = scriptedCall(GOOD);
    const plan = await planWithRepair(request, 'groq', call);

    expect(plan.adapter).toBe('groq');
    expect(plan.degradedFrom).toEqual([]);
    expect(plan.scenes).toHaveLength(2);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(SCRIPT);
  });

  it('re-asks once with the violation and accepts the repaired answer', async () => {
    const { prompts, call } = scriptedCall(TOO_LONG, GOOD);
    const plan = await planWithRepair(request, 'groq', call);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('YOUR PREVIOUS ANSWER WAS REJECTED');
    expect(prompts[1]).toContain('maximum is 20 s');
    expect(prompts[1]).toContain('Return the complete corrected plan');
    expect(prompts[1]).toContain(SCRIPT);
    expect(prompts[1]).not.toContain('startMs');
    expect(plan.scenes.map((scene) => scene.text)).toEqual([SENTENCE_A, SENTENCE_B]);
  });

  it('re-asks a plan that does not reassemble the script, naming the rule', async () => {
    const { prompts, call } = scriptedCall(INCOMPLETE, GOOD);
    const plan = await planWithRepair(request, 'groq', call);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('does not reassemble the script');
    expect(plan.scenes).toHaveLength(2);
  });

  it('re-asks an unreadable answer for JSON, without inventing a diff', async () => {
    const { prompts, call } = scriptedCall('I cannot help with that.', GOOD);
    const plan = await planWithRepair(request, 'groq', call);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('could not be read as a plan');
    expect(prompts[1]).toContain('ONE JSON object');
    expect(plan.scenes).toHaveLength(2);
  });

  it('re-asks an answer whose shape is wrong (unknown motion)', async () => {
    const { prompts, call } = scriptedCall(answer([SENTENCE_A], 'spin'), GOOD);
    await planWithRepair(request, 'groq', call);
    expect(prompts[1]).toContain('does not match the plan shape');
  });

  it('surfaces the second failure, with the second violations, after exactly two calls', async () => {
    const { prompts, call } = scriptedCall(TOO_LONG, INCOMPLETE);
    const error = await planWithRepair(request, 'groq', call).catch((thrown: unknown) => thrown);

    const violations = await violationsOf(error);
    expect(violations[0]!.code).toBe('text-mismatch');
    expect(prompts).toHaveLength(MAX_PLANNER_ATTEMPTS);
  });

  it('never makes a third call, even when the third answer would be valid', async () => {
    const { prompts, call } = scriptedCall(TOO_LONG, INCOMPLETE, GOOD);
    await expect(planWithRepair(request, 'groq', call)).rejects.toBeInstanceOf(
      PlannerValidationError,
    );
    expect(prompts).toHaveLength(2);
  });

  it('throws the second unreadable answer as a PlannerResponseError', async () => {
    const { prompts, call } = scriptedCall('still not json', 'nope');
    const error = await planWithRepair(request, 'groq', call).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PlannerResponseError);
    expect(prompts).toHaveLength(2);
  });

  it('does not re-ask a transport failure — that decision belongs to the chain/step', async () => {
    const prompts: string[] = [];
    const outage = new UpstreamError('groq', 'HTTP 429: rate limited', {
      status: 429,
      retryable: true,
    });
    const call = async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      throw outage;
    };

    const error = await planWithRepair(request, 'groq', call).catch((thrown: unknown) => thrown);
    expect(error).toBe(outage);
    expect((error as UpstreamError).retryable).toBe(true);
    expect(prompts).toHaveLength(1);
  });

  it('does not re-ask an error that is not about the model answer', async () => {
    const prompts: string[] = [];
    const bug = new TypeError('style clauses leave no room for a description');
    const call = async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      throw bug;
    };

    await expect(planWithRepair(request, 'groq', call)).rejects.toBe(bug);
    expect(prompts).toHaveLength(1);
  });

  it('does not re-ask a style that cannot fit — rewording cannot fix a config bug', async () => {
    const { prompts, call } = scriptedCall(GOOD, GOOD);
    const error = await planWithRepair(
      { script: SCRIPT, style: { prefix: 'x'.repeat(1001) } },
      'groq',
      call,
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PlannerValidationError);
    expect(prompts).toHaveLength(1);
  });

  it('builds a deterministic repair prompt', () => {
    const rejection = {
      kind: 'violations' as const,
      violations: [{ code: 'scene-too-long' as const, scene: 0, message: 'scene 1 is 23.1 s' }],
    };
    expect(buildPlannerPrompt(request, { rejection })).toBe(
      buildPlannerPrompt(request, { rejection }),
    );
    expect(buildPlannerPrompt(request, { rejection })).toContain('- scene 1 is 23.1 s');
  });
});
