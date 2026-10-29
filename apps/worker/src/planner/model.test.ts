import { describe, expect, it } from 'vitest';

import type { PlanRequest } from '../ports/planner';
import {
  MAX_MODEL_DESCRIPTION_CHARS,
  PlannerResponseError,
  PlannerValidationError,
  buildPlannerPrompt,
  expectedSceneCount,
  parseModelText,
  planFromBeats,
  sceneWordBudget,
} from './model';
import type { ModelPlan, PlannerViolation } from './model';

const word = 'வார்த்தை';
const sentence = (words: number) => `${Array.from({ length: words }, () => word).join(' ')}.`;

/** 25 Tamil words ≈ 11.5 s at 130 wpm: comfortably inside 8–20 s. */
const SENTENCE_A = sentence(25);
const SENTENCE_B = sentence(25);
const SENTENCE_C = sentence(25);
const SCRIPT = `${SENTENCE_A} ${SENTENCE_B} ${SENTENCE_C}`;

const plan = (texts: readonly string[]): ModelPlan => ({
  scenes: texts.map((text) => ({
    text,
    imagePrompt: 'a woman at a desk',
    motion: 'kenburns-in',
    emphasis: [],
  })),
});

const violationsOf = (request: PlanRequest, model: ModelPlan): readonly PlannerViolation[] => {
  try {
    planFromBeats(model, request, 'groq');
  } catch (error) {
    if (error instanceof PlannerValidationError) return error.violations;
    throw error;
  }
  throw new Error('expected a PlannerValidationError');
};

const responseErrorOf = (raw: string): PlannerResponseError => {
  try {
    parseModelText(raw);
  } catch (error) {
    if (error instanceof PlannerResponseError) return error;
    throw error;
  }
  throw new Error('expected a PlannerResponseError');
};

describe('planner model layer', () => {
  describe('prompt', () => {
    it('embeds the script verbatim between markers', () => {
      const request: PlanRequest = { script: `  ${SCRIPT}  `.replace(/ +/gu, ' ') };
      expect(buildPlannerPrompt(request)).toContain(`<<<\n${SCRIPT}\n>>>`);
    });

    it('states the word budget implied by the bounds', () => {
      const prompt = buildPlannerPrompt({ script: SCRIPT });
      // 8 s at the fastest rate (150 wpm) = 20 words; 20 s at the slowest (130) = 43.
      expect(prompt).toContain('about 20–43 words');
    });

    it('states the expected scene count for this script', () => {
      const prompt = buildPlannerPrompt({ script: SCRIPT });
      // ~35 s: at least ceil(35/20)=2, at most floor(35/8)=4.
      expect(prompt).toContain('aim for 2–4 scenes');
    });

    it('injects the style clauses and the negative', () => {
      const prompt = buildPlannerPrompt({
        script: SCRIPT,
        style: { prefix: 'ink sketch', suffix: 'sepia palette', negative: 'no people' },
      });
      expect(prompt).toContain('"ink sketch"');
      expect(prompt).toContain('"sepia palette"');
      expect(prompt).toContain('"no people"');
    });

    it('falls back to the default look when no style is given', () => {
      const prompt = buildPlannerPrompt({ script: SCRIPT });
      expect(prompt).toContain('"flat vector illustration, wide shot"');
      expect(prompt).toContain('"no text, no watermark"');
    });

    it('asks for JSON only and never for timings', () => {
      const prompt = buildPlannerPrompt({ script: SCRIPT });
      expect(prompt).toContain('Return ONLY this JSON');
      expect(prompt).not.toContain('startMs');
      expect(prompt).not.toContain('endMs');
      expect(prompt).not.toContain('durationMs');
    });

    it('is deterministic', () => {
      expect(buildPlannerPrompt({ script: SCRIPT })).toBe(
        buildPlannerPrompt({ script: SCRIPT }),
      );
    });
  });

  describe('sceneWordBudget', () => {
    it('uses the slowest rate for the ceiling and the fastest for the floor', () => {
      expect(sceneWordBudget()).toEqual({ min: 20, max: 43 });
    });

    it('tightens the ceiling for a slower voice', () => {
      expect(sceneWordBudget({ rates: { ta: 65, en: 75, mixed: 70 } })).toEqual({ min: 10, max: 21 });
    });

    it('follows custom bounds', () => {
      expect(sceneWordBudget({ minSeconds: 5, maxSeconds: 10 })).toEqual({ min: 13, max: 21 });
    });
  });

  describe('expectedSceneCount', () => {
    it('bounds the count for the script length', () => {
      const count = expectedSceneCount(SCRIPT);
      expect(count.min).toBeGreaterThanOrEqual(2);
      expect(count.max).toBeGreaterThan(count.min);
    });

    it('asks for one scene when the script is shorter than the minimum', () => {
      expect(expectedSceneCount('வணக்கம்.')).toEqual({ min: 1, max: 1 });
    });
  });

  describe('parseModelText', () => {
    const valid = JSON.stringify(plan([SENTENCE_A, SENTENCE_B, SENTENCE_C]));

    it('reads a clean JSON body', () => {
      expect(parseModelText(valid).scenes).toHaveLength(3);
    });

    it('reads JSON inside a markdown fence', () => {
      expect(parseModelText('```json\n' + valid + '\n```').scenes).toHaveLength(3);
    });

    it('ignores prose around the JSON', () => {
      expect(parseModelText(`Here is the plan:\n${valid}\nHope that helps!`).scenes).toHaveLength(3);
    });

    it('strips unknown keys instead of failing the plan', () => {
      const withExtras = JSON.parse(valid) as { scenes: Array<Record<string, unknown>> };
      withExtras.scenes[0]!.durationSeconds = 12;
      const parsed = parseModelText(JSON.stringify(withExtras));
      expect(parsed.scenes[0]).not.toHaveProperty('durationSeconds');
    });

    it('defaults a missing emphasis list to empty', () => {
      const { emphasis: _omitted, ...withoutEmphasis } = plan([SENTENCE_A]).scenes[0]!;
      const parsed = parseModelText(JSON.stringify({ scenes: [withoutEmphasis] }));
      expect(parsed.scenes[0]!.emphasis).toEqual([]);
    });

    it('rejects an empty response', () => {
      expect(responseErrorOf('   ').kind).toBe('invalid-json');
    });

    it('rejects a response with no JSON object', () => {
      expect(responseErrorOf('I cannot help with that.').kind).toBe('invalid-json');
    });

    it('rejects malformed JSON', () => {
      expect(responseErrorOf('{"scenes": [}').kind).toBe('invalid-json');
    });

    it('rejects a motion the renderer cannot implement, naming the field', () => {
      const bad = plan([SENTENCE_A]);
      bad.scenes[0]!.motion = 'spin' as never;
      const error = responseErrorOf(JSON.stringify(bad));
      expect(error.kind).toBe('invalid-shape');
      expect(error.message).toContain('scenes.0.motion');
    });

    it('rejects a scene with no text', () => {
      const bad = plan([SENTENCE_A]);
      bad.scenes[0]!.text = '';
      expect(responseErrorOf(JSON.stringify(bad)).kind).toBe('invalid-shape');
    });

    it('rejects an over-long description before it reaches the image model', () => {
      const bad = plan([SENTENCE_A]);
      bad.scenes[0]!.imagePrompt = 'x'.repeat(MAX_MODEL_DESCRIPTION_CHARS + 1);
      expect(responseErrorOf(JSON.stringify(bad)).kind).toBe('invalid-shape');
    });

    it('rejects an empty scene list', () => {
      expect(responseErrorOf('{"scenes": []}').kind).toBe('invalid-shape');
    });

    it('marks its errors as not retryable — the repair loop rephrases instead', () => {
      expect(responseErrorOf('nope').retryable).toBe(false);
    });
  });

  describe('planFromBeats', () => {
    const request: PlanRequest = { script: SCRIPT };

    it('produces a plan the contract accepts', () => {
      const result = planFromBeats(plan([SENTENCE_A, SENTENCE_B, SENTENCE_C]), request, 'groq');
      expect(result.adapter).toBe('groq');
      expect(result.degradedFrom).toEqual([]);
      expect(result.scenes).toHaveLength(3);
    });

    it('keeps the script intact', () => {
      const result = planFromBeats(plan([SENTENCE_A, SENTENCE_B, SENTENCE_C]), request, 'groq');
      expect(result.scenes.map((scene) => scene.text).join(' ')).toBe(SCRIPT);
    });

    it('gives contiguous spans starting at 0 and totalling the last end', () => {
      const result = planFromBeats(plan([SENTENCE_A, SENTENCE_B, SENTENCE_C]), request, 'groq');
      expect(result.scenes[0]!.startMs).toBe(0);
      for (let i = 1; i < result.scenes.length; i += 1) {
        expect(result.scenes[i]!.startMs).toBeGreaterThanOrEqual(result.scenes[i - 1]!.endMs);
      }
      expect(result.totalMs).toBe(result.scenes.at(-1)!.endMs);
    });

    it('adds one sentence gap where a sentence ends, so the total matches the estimate', () => {
      const result = planFromBeats(plan([SENTENCE_A, SENTENCE_B, SENTENCE_C]), request, 'groq');
      const first = result.scenes[0]!;
      const second = result.scenes[1]!;
      expect(second.startMs - first.endMs).toBe(300);

      // Two sentence gaps in a three-sentence script.
      expect(result.totalMs).toBeCloseTo(
        result.scenes.reduce((sum, scene) => sum + (scene.endMs - scene.startMs), 0) + 600,
        0,
      );
    });

    it('adds no gap when the cut falls inside a sentence', () => {
      const long = sentence(75);
      const words = long.split(' ');
      const model = plan([
        words.slice(0, 25).join(' '),
        words.slice(25, 50).join(' '),
        words.slice(50).join(' '),
      ]);
      const result = planFromBeats(model, { script: long }, 'groq');

      expect(result.scenes[0]!.endMs).toBe(result.scenes[1]!.startMs);
      expect(result.scenes[1]!.endMs).toBe(result.scenes[2]!.startMs);
    });

    it('injects the style into every prompt', () => {
      const result = planFromBeats(plan([SENTENCE_A, SENTENCE_B, SENTENCE_C]), {
        script: SCRIPT,
        style: { prefix: 'ink sketch', suffix: 'sepia palette' },
      }, 'groq');

      for (const scene of result.scenes) {
        expect(scene.imagePrompt.startsWith('ink sketch, ')).toBe(true);
        expect(scene.imagePrompt).toContain('sepia palette');
        expect(scene.imagePrompt).toContain('no text, no watermark');
      }
    });

    it('keeps only emphasis words that exist in the scene, once', () => {
      const model: ModelPlan = {
        scenes: [
          {
            text: SENTENCE_A,
            imagePrompt: 'a desk',
            motion: 'none',
            emphasis: [word, 'absent', word, 'வார்த்தை.'],
          },
        ],
      };
      const result = planFromBeats(model, { script: SENTENCE_A }, 'groq');
      expect(result.scenes[0]!.emphasis).toEqual([word]);
    });

    it('is deterministic', () => {
      const model = plan([SENTENCE_A, SENTENCE_B, SENTENCE_C]);
      expect(planFromBeats(model, request, 'groq')).toEqual(planFromBeats(model, request, 'groq'));
    });

    it('rejects a plan whose text does not reassemble the script', () => {
      const violations = violationsOf(request, plan([SENTENCE_A, SENTENCE_B]));
      expect(violations).toHaveLength(1);
      expect(violations[0]!.code).toBe('text-mismatch');
    });

    it('rejects a scene below the minimum, naming it', () => {
      const short = 'வணக்கம் நண்பர்களே.';
      const violations = violationsOf({ script: short }, plan([short]));
      expect(violations[0]!.code).toBe('scene-too-short');
      expect(violations[0]!.scene).toBe(0);
      expect(violations[0]!.message).toContain('merge');
    });

    it('rejects a scene above the maximum, naming it', () => {
      const violations = violationsOf({ script: sentence(60) }, plan([sentence(60)]));
      expect(violations[0]!.code).toBe('scene-too-long');
      expect(violations[0]!.message).toContain('split');
    });

    it('rejects a scene with no speakable words', () => {
      const violations = violationsOf({ script: '🙏' }, plan(['🙏']));
      expect(violations[0]!.code).toBe('scene-empty');
    });

    it('reports every violation at once, so one repair pass can fix them all', () => {
      const violations = violationsOf({ script: `${sentence(60)} வணக்கம்.` }, plan([sentence(60), 'வணக்கம்.']));
      const codes = violations.map((violation) => violation.code);
      expect(codes).toContain('scene-too-long');
      expect(codes).toContain('scene-too-short');
    });

    it('marks validation errors as not retryable', () => {
      const short = 'வணக்கம் நண்பர்களே.';
      try {
        planFromBeats(plan([short]), { script: short }, 'groq');
      } catch (error) {
        expect(error).toBeInstanceOf(PlannerValidationError);
        expect((error as PlannerValidationError).retryable).toBe(false);
      }
    });

    it('refuses an empty script', () => {
      expect(() => planFromBeats(plan([SENTENCE_A]), { script: '   ' }, 'groq')).toThrow(
        /non-empty script/u,
      );
    });
  });
});
