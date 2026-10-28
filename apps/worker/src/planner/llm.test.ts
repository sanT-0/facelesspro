import { describe, expect, it } from 'vitest';

import {
  buildPlannerPrompt,
  buildScenePlanFromLLM,
  parseLLMResponse,
  validateScenePlan,
  validateSceneTextConcat,
} from './llm';

import { scenePlanSchema } from '@facelesspro/contracts';

const SCRIPT = `இன்று நாம் பேசுவது about money and freelancing. Dr. Raman said, "start small."
முதல் விதி: உங்கள் customer-க்கு ஒரு clear promise கொடுங்கள். அதாவது, அவர்கள் ஏன் உங்களிடம் வர வேண்டும்?`;

const STYLE = {
  prefix: 'flat vector illustration, wide shot',
  suffix: 'muted earth palette, soft light',
  negative: 'no text, no watermark',
};

const VALID_LLM_RESPONSE = {
  scenes: [
    {
      text: 'இன்று நாம் பேசுவது about money and freelancing.',
      imagePrompt: 'a person thinking about money, flat vector illustration, wide shot, muted earth palette, soft light, no text, no watermark',
      motion: 'kenburns-in',
      emphasis: ['money', 'freelancing'],
    },
    {
      text: 'Dr. Raman said, "start small."',
      imagePrompt: 'a doctor giving advice, flat vector illustration, wide shot, muted earth palette, soft light, no text, no watermark',
      motion: 'pan-left',
      emphasis: ['start', 'small'],
    },
    {
      text: 'முதல் விதி: உங்கள் customer-க்கு ஒரு clear promise கொடுங்கள். அதாவது, அவர்கள் ஏன் உங்களிடம் வர வேண்டும்?',
      imagePrompt: 'customer promise concept, flat vector illustration, wide shot, muted earth palette, soft light, no text, no watermark',
      motion: 'kenburns-out',
      emphasis: ['promise', 'customer'],
    },
  ],
};

describe('llm shared module', () => {
  describe('buildPlannerPrompt', () => {
    it('includes the script and style in the prompt', () => {
      const prompt = buildPlannerPrompt(SCRIPT, STYLE);
      expect(prompt).toContain(SCRIPT);
      expect(prompt).toContain('flat vector illustration, wide shot');
      expect(prompt).toContain('muted earth palette, soft light');
      expect(prompt).toContain('no text, no watermark');
    });

    it('includes constraints in the prompt', () => {
      const prompt = buildPlannerPrompt(SCRIPT, STYLE);
      expect(prompt).toContain('8–20 seconds');
      expect(prompt).toContain('120 scenes');
      expect(prompt).toContain('1000 characters');
    });

    it('uses defaults when style is empty', () => {
      const prompt = buildPlannerPrompt(SCRIPT, {});
      expect(prompt).toContain('flat vector illustration, wide shot');
      expect(prompt).toContain('muted earth palette, soft light');
      expect(prompt).toContain('no text, no watermark');
    });
  });

  describe('parseLLMResponse', () => {
    it('parses valid JSON response', () => {
      const json = JSON.stringify(VALID_LLM_RESPONSE);
      const result = parseLLMResponse(json);
      expect(result.scenes).toHaveLength(3);
      expect(result.scenes[0].text).toContain('money');
    });

    it('throws on invalid JSON', () => {
      expect(() => parseLLMResponse('not json')).toThrow('invalid JSON');
    });

    it('throws when scenes array is missing', () => {
      expect(() => parseLLMResponse('{}')).toThrow('missing "scenes"');
    });

    it('throws when scenes is not an array', () => {
      expect(() => parseLLMResponse('{"scenes": "not array"}')).toThrow('not an array');
    });

    it('throws when scenes is empty', () => {
      expect(() => parseLLMResponse('{"scenes": []}')).toThrow('zero scenes');
    });

    it('throws when a scene has empty text', () => {
      const bad = { ...VALID_LLM_RESPONSE, scenes: [{ ...VALID_LLM_RESPONSE.scenes[0], text: '' }] };
      expect(() => parseLLMResponse(JSON.stringify(bad))).toThrow('empty or missing text');
    });

    it('throws when a scene has empty imagePrompt', () => {
      const bad = { ...VALID_LLM_RESPONSE, scenes: [{ ...VALID_LLM_RESPONSE.scenes[0], imagePrompt: '' }] };
      expect(() => parseLLMResponse(JSON.stringify(bad))).toThrow('empty or missing imagePrompt');
    });
  });

  describe('validateSceneTextConcat', () => {
    it('passes when concat matches normalized script', () => {
      const result = validateSceneTextConcat(VALID_LLM_RESPONSE.scenes, SCRIPT);
      expect(result.valid).toBe(true);
    });

    it('fails when concat does not match', () => {
      const mismatched = [
        { ...VALID_LLM_RESPONSE.scenes[0], text: 'completely different text' },
      ];
      const result = validateSceneTextConcat(mismatched, SCRIPT);
      expect(result.valid).toBe(false);
      expect(result.diff).toBeDefined();
    });

    it('ignores whitespace differences', () => {
      const withExtraSpace = [
        { ...VALID_LLM_RESPONSE.scenes[0], text: '  இன்று நாம் பேசுவது about money and freelancing.  ' },
        VALID_LLM_RESPONSE.scenes[1],
        VALID_LLM_RESPONSE.scenes[2],
      ];
      const result = validateSceneTextConcat(withExtraSpace, SCRIPT);
      expect(result.valid).toBe(true);
    });
  });

  describe('buildScenePlanFromLLM', () => {
    it('builds a valid ScenePlan with correct timings', () => {
      const request = { script: SCRIPT, style: STYLE };
      const plan = buildScenePlanFromLLM(VALID_LLM_RESPONSE, request, 'groq');

      expect(plan.adapter).toBe('groq');
      expect(plan.scenes).toHaveLength(3);
      expect(plan.totalMs).toBeGreaterThan(0);
      expect(plan.scenes[0].startMs).toBe(0);
    });

    it('ensures scene texts concatenate to the script', () => {
      const request = { script: SCRIPT, style: STYLE };
      const plan = buildScenePlanFromLLM(VALID_LLM_RESPONSE, request, 'groq');

      const concat = plan.scenes.map((s) => s.text).join(' ');
      expect(concat).toBe(SCRIPT);
    });

    it('uses the LLM imagePrompt, motion, and emphasis', () => {
      const request = { script: SCRIPT, style: STYLE };
      const plan = buildScenePlanFromLLM(VALID_LLM_RESPONSE, request, 'groq');

      expect(plan.scenes[0].imagePrompt).toBe(VALID_LLM_RESPONSE.scenes[0].imagePrompt);
      expect(plan.scenes[0].motion).toBe('kenburns-in');
      expect(plan.scenes[0].emphasis).toEqual(['money', 'freelancing']);
    });

    it('throws when scene count mismatches after packing', () => {
      // Create a response where the LLM's scene boundaries don't match sentence boundaries
      // Use a script that would pack into fewer scenes than the LLM returned
      const badResponse = {
        scenes: [
          { text: 'Short one.', imagePrompt: 'x', motion: 'kenburns-in', emphasis: [] },
          { text: 'Short two.', imagePrompt: 'x', motion: 'pan-left', emphasis: [] },
          { text: 'Short three.', imagePrompt: 'x', motion: 'kenburns-out', emphasis: [] },
          { text: 'Short four.', imagePrompt: 'x', motion: 'pan-right', emphasis: [] },
        ],
      };
      const request = { script: 'Short one. Short two. Short three. Short four.' };
      expect(() => buildScenePlanFromLLM(badResponse, request, 'groq')).toThrow(
        'packScenes produced',
      );
    });

    it('throws when concat validation fails', () => {
      const badResponse = {
        scenes: [{ text: 'wrong text', imagePrompt: 'x', motion: 'kenburns-in', emphasis: [] }],
      };
      const request = { script: SCRIPT, style: STYLE };
      expect(() => buildScenePlanFromLLM(badResponse, request, 'groq')).toThrow('concatenation failed');
    });
  });

  describe('validateScenePlan', () => {
    it('passes a valid plan', () => {
      const request = { script: SCRIPT, style: STYLE };
      const plan = buildScenePlanFromLLM(VALID_LLM_RESPONSE, request, 'groq');
      expect(() => validateScenePlan(plan)).not.toThrow();
    });

    it('rejects a plan with invalid adapter', () => {
      const request = { script: SCRIPT, style: STYLE };
      const plan = buildScenePlanFromLLM(VALID_LLM_RESPONSE, request, 'groq');
      (plan as Record<string, unknown>).adapter = 'invalid';
      expect(() => validateScenePlan(plan)).toThrow();
    });

    it('rejects a plan with overlapping scenes', async () => {
      // Build a valid plan first, then corrupt it
      const { scenePlanSchema } = await import('@facelesspro/contracts');
      const validPlan = scenePlanSchema.parse({
        scenes: [
          { text: 'Scene one.', imagePrompt: 'x', motion: 'kenburns-in', emphasis: [], startMs: 0, endMs: 10000 },
          { text: 'Scene two.', imagePrompt: 'x', motion: 'pan-left', emphasis: [], startMs: 10000, endMs: 20000 },
        ],
        adapter: 'groq',
        degradedFrom: [],
        totalMs: 20000,
      });
      // Now corrupt it
      validPlan.scenes[1].startMs = 5000; // Overlaps with scene 0
      expect(() => validateScenePlan(validPlan)).toThrow();
    });
  });
});