import { readFileSync } from 'node:fs';

import { scenePlanSchema } from '@facelesspro/contracts';
import { normalizeScript } from '@facelesspro/core';
import { describe, expect, it } from 'vitest';

import { createHeuristicPlanner, imagePromptFor } from './heuristic';

const SCRIPT = normalizeScript(readFileSync('fixtures/scripts/tamil-mixed.txt', 'utf8'));
const planner = createHeuristicPlanner();

const durationMs = (scene: { startMs: number; endMs: number }) => scene.endMs - scene.startMs;

describe('heuristic planner', () => {
  it('plans the fixture into valid 8–20 s scenes', async () => {
    const plan = await planner.plan({ script: SCRIPT });
    scenePlanSchema.parse(plan);

    expect(plan.adapter).toBe('heuristic');
    expect(plan.degradedFrom).toEqual([]);
    expect(plan.scenes.length).toBeGreaterThanOrEqual(2);
    for (const scene of plan.scenes) {
      expect(durationMs(scene)).toBeGreaterThanOrEqual(8_000);
      expect(durationMs(scene)).toBeLessThanOrEqual(20_000);
      expect(scene.text.length).toBeGreaterThan(0);
      expect(scene.imagePrompt.length).toBeGreaterThan(0);
    }
    expect(plan.totalMs).toBe(plan.scenes.at(-1)!.endMs);
  });

  it('preserves the script when scene texts are joined', async () => {
    const plan = await planner.plan({ script: SCRIPT });
    expect(plan.scenes.map((scene) => scene.text).join(' ')).toBe(SCRIPT);
  });

  it('injects the style into every prompt', async () => {
    const plan = await planner.plan({
      script: SCRIPT,
      style: { prefix: 'flat vector illustration', suffix: 'muted earth palette' },
    });
    for (const scene of plan.scenes) {
      expect(scene.imagePrompt.startsWith('flat vector illustration, ')).toBe(true);
      expect(scene.imagePrompt).toContain('muted earth palette');
      expect(scene.imagePrompt).toContain('no text, no watermark');
    }
  });

  it('keeps the default negatives when no style is given', () => {
    expect(imagePromptFor('இன்று நாம் பேசுவது about money.')).toBe(
      'இன்று நாம் பேசுவது about money, no text, no watermark',
    );
  });

  it('uses a custom negative instead of the default', () => {
    expect(imagePromptFor('ஒரு வீடு', { negative: 'no people' })).toBe('ஒரு வீடு, no people');
  });

  it('describes a scene without punctuation or emoji', async () => {
    const plan = await planner.plan({ script: 'வணக்கம், நண்பர்களே! 🙏 இன்று பேசுவோம்.' });
    expect(plan.scenes[0]?.imagePrompt).toBe(
      'வணக்கம் நண்பர்களே இன்று பேசுவோம், no text, no watermark',
    );
  });

  it('falls back to a description when the scene has no words', () => {
    expect(imagePromptFor('🙏')).toBe('a scene from the narration, no text, no watermark');
  });

  it('bounds the description to whole words', async () => {
    const long = `${'வார்த்தை '.repeat(400).trim()}.`;
    const plan = await planner.plan({ script: long });
    for (const scene of plan.scenes) {
      expect(scene.imagePrompt.length).toBeLessThanOrEqual(1_000);
      // Every word of the description is intact: trimming is by word, not char.
      // No style was given, so the description is the first prompt segment.
      const description = scene.imagePrompt.split(', ')[0]!;
      expect(description.split(' ').every((word) => word === 'வார்த்தை')).toBe(true);
    }
  });

  it('never invents emphasis without a model', async () => {
    const plan = await planner.plan({ script: SCRIPT });
    for (const scene of plan.scenes) expect(scene.emphasis).toEqual([]);
  });

  it('cycles motion so consecutive scenes differ', async () => {
    const plan = await planner.plan({ script: SCRIPT });
    const motions = plan.scenes.map((scene) => scene.motion);
    expect(new Set(motions).size).toBeGreaterThan(1);
    expect(motions[0]).not.toBe(motions[1]);
  });

  it('is deterministic', async () => {
    expect(await planner.plan({ script: SCRIPT })).toEqual(await planner.plan({ script: SCRIPT }));
  });

  it('packs more scenes for a slower voice', async () => {
    const normal = await planner.plan({ script: SCRIPT });
    const slow = await planner.plan({ script: SCRIPT, rates: { ta: 65, en: 75 } });
    expect(slow.scenes.length).toBeGreaterThan(normal.scenes.length);
  });

  it('honours the scene cap, even past 20 s', async () => {
    const plan = await planner.plan({ script: SCRIPT, maxScenes: 1 });
    expect(plan.scenes).toHaveLength(1);
    expect(durationMs(plan.scenes[0]!)).toBeGreaterThan(20_000);
    expect(plan.scenes[0]?.text).toBe(SCRIPT);
  });

  it('refuses an empty script', async () => {
    await expect(planner.plan({ script: '   \n\n ' })).rejects.toThrow(/non-empty script/u);
  });

  it('names itself as the heuristic adapter', () => {
    expect(planner.name).toBe('heuristic');
  });
});
