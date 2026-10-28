import { describe, expect, it } from 'vitest';

import { MAX_SCENES } from './common';
import {
  MAX_IMAGE_PROMPT_CHARS,
  PLANNER_ADAPTERS,
  SCENE_MOTIONS,
  plannedSceneSchema,
  scenePlanSchema,
} from './planner';

const scene = (overrides: Record<string, unknown> = {}) => ({
  text: 'இன்று நாம் பேசுவது about money.',
  imagePrompt: 'a Tamil street at sunrise, no text, no watermark',
  motion: 'kenburns-in',
  emphasis: [],
  startMs: 0,
  endMs: 12_000,
  ...overrides,
});

const plan = (overrides: Record<string, unknown> = {}) => ({
  scenes: [scene(), scene({ startMs: 12_000, endMs: 24_000 })],
  adapter: 'heuristic',
  degradedFrom: [],
  totalMs: 24_000,
  ...overrides,
});

describe('scene plan contract', () => {
  it('pins the adapter and motion vocabularies', () => {
    expect(PLANNER_ADAPTERS).toEqual(['cloudflare', 'groq', 'ollama', 'heuristic', 'chain']);
    expect(SCENE_MOTIONS).toContain('kenburns-in');
    expect(SCENE_MOTIONS).toContain('none');
  });

  it('accepts a plan the heuristic adapter could have produced', () => {
    const parsed = scenePlanSchema.parse(plan());
    expect(parsed.scenes).toHaveLength(2);
    expect(parsed.degradedFrom).toEqual([]);
  });

  it('accepts a degraded plan and records the order it was tried', () => {
    expect(
      scenePlanSchema.parse(plan({ adapter: 'heuristic', degradedFrom: ['cloudflare', 'groq'] }))
        .degradedFrom,
    ).toEqual(['cloudflare', 'groq']);
  });

  it('rejects a motion the render service does not implement', () => {
    expect(scenePlanSchema.safeParse(plan({ scenes: [scene({ motion: 'spin' })] })).success).toBe(
      false,
    );
  });

  it('rejects a scene with no text or no prompt', () => {
    expect(scenePlanSchema.safeParse(plan({ scenes: [scene({ text: '' })] })).success).toBe(false);
    expect(scenePlanSchema.safeParse(plan({ scenes: [scene({ imagePrompt: '' })] })).success).toBe(
      false,
    );
    expect(
      scenePlanSchema.safeParse(
        plan({ scenes: [scene({ imagePrompt: 'x'.repeat(MAX_IMAGE_PROMPT_CHARS + 1) })] }),
      ).success,
    ).toBe(false);
  });

  it('rejects a scene that does not move forward in time', () => {
    expect(scenePlanSchema.safeParse(plan({ scenes: [scene({ startMs: 0, endMs: 0 })] })).success).toBe(
      false,
    );
  });

  it('rejects overlapping scenes and a first scene that does not start at 0', () => {
    expect(
      scenePlanSchema.safeParse(
        plan({
          scenes: [scene(), scene({ startMs: 10_000, endMs: 20_000 })],
          totalMs: 20_000,
        }),
      ).success,
    ).toBe(false);
    expect(
      scenePlanSchema.safeParse(
        plan({
          scenes: [scene({ startMs: 500 }), scene({ startMs: 12_000, endMs: 24_000 })],
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects a total that disagrees with the last scene', () => {
    expect(scenePlanSchema.safeParse(plan({ totalMs: 23_999 })).success).toBe(false);
  });

  it('rejects an empty plan and one over the scene cap', () => {
    expect(scenePlanSchema.safeParse(plan({ scenes: [], totalMs: 0 })).success).toBe(false);
    const tooMany = Array.from({ length: MAX_SCENES + 1 }, (_, i) => scene({ startMs: i * 1000, endMs: (i + 1) * 1000 }));
    expect(
      scenePlanSchema.safeParse(plan({ scenes: tooMany, totalMs: tooMany.length * 1000 })).success,
    ).toBe(false);
  });

  it('rejects unknown keys, because the shape is the contract', () => {
    expect(scenePlanSchema.safeParse(plan({ extra: true })).success).toBe(false);
    expect(plannedSceneSchema.safeParse(scene({ caption: 'x' })).success).toBe(false);
  });
});
