import { readFileSync } from 'node:fs';

import { scenePlanSchema } from '@facelesspro/contracts';
import { normalizeScript } from '@facelesspro/core';
import { describe, expect, it } from 'vitest';

import { buildFixedPlan, buildSectionPlan, createHeuristicPlanner, enhanceVisualCue, imagePromptFor } from './heuristic';

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

describe('heuristic planner with a describer', () => {
  it('uses the model descriptions but keeps cuts, timings and text', async () => {
    const plain = await planner.plan({ script: SCRIPT });
    const described = await createHeuristicPlanner({
      describe: async (scenes) =>
        scenes.map((_, index) => `scene ${index + 1}: a lit window in an old house`),
      logger: () => {},
    }).plan({ script: SCRIPT, style: { prefix: 'cinematic', negative: 'no text' } });

    expect(described.scenes.map((scene) => scene.text)).toEqual(
      plain.scenes.map((scene) => scene.text),
    );
    expect(described.scenes.map((scene) => [scene.startMs, scene.endMs])).toEqual(
      plain.scenes.map((scene) => [scene.startMs, scene.endMs]),
    );
    expect(described.adapter).toBe('heuristic');
    expect(described.degradedFrom).toEqual([]);
    for (const [index, scene] of described.scenes.entries()) {
      expect(scene.imagePrompt).toContain(`scene ${index + 1}: a lit window in an old house`);
      expect(scene.imagePrompt.startsWith('cinematic, ')).toBe(true);
      expect(scene.imagePrompt.endsWith(', no text')).toBe(true);
    }
  });

  it('asks the describer with the scene texts in order', async () => {
    const seen: string[][] = [];
    await createHeuristicPlanner({
      describe: async (scenes) => {
        seen.push([...scenes]);
        return scenes.map(() => 'a room');
      },
      logger: () => {},
    }).plan({ script: SCRIPT });
    const plain = await planner.plan({ script: SCRIPT });
    expect(seen).toEqual([plain.scenes.map((scene) => scene.text)]);
  });

  it('keeps deterministic prompts and warns when the describer throws', async () => {
    const warnings: string[] = [];
    const plan = await createHeuristicPlanner({
      describe: async () => {
        throw new Error('ollama down');
      },
      logger: (message) => warnings.push(message),
    }).plan({ script: SCRIPT });
    const plain = await planner.plan({ script: SCRIPT });

    expect(plan.scenes.map((scene) => scene.imagePrompt)).toEqual(
      plain.scenes.map((scene) => scene.imagePrompt),
    );
    expect(warnings.join('\n')).toContain('ollama down');
  });

  it('ignores a describer that answers the wrong number of scenes', async () => {
    const warnings: string[] = [];
    const plan = await createHeuristicPlanner({
      describe: async () => ['only one'],
      logger: (message) => warnings.push(message),
    }).plan({ script: SCRIPT });
    const plain = await planner.plan({ script: SCRIPT });

    expect(plan.scenes.map((scene) => scene.imagePrompt)).toEqual(
      plain.scenes.map((scene) => scene.imagePrompt),
    );
    expect(warnings.join('\n')).toContain('descriptions for');
  });
});

describe('buildFixedPlan', () => {
  it('keeps boundaries the caller already decided and describes each span', () => {
    const plan = buildFixedPlan(
      [
        { text: 'வணக்கம் நண்பர்களே.', startMs: 0, endMs: 2_700 },
        { text: 'Today we plan.', startMs: 2_700, endMs: 6_400 },
      ],
      { prefix: 'flat vector illustration', negative: 'no people' },
    );

    scenePlanSchema.parse(plan);
    expect(plan.adapter).toBe('heuristic');
    expect(plan.degradedFrom).toEqual([]);
    expect(plan.totalMs).toBe(6_400);
    expect(plan.scenes.map((scene) => [scene.startMs, scene.endMs])).toEqual([
      [0, 2_700],
      [2_700, 6_400],
    ]);
    expect(plan.scenes[0]?.motion).toBe('kenburns-in');
    expect(plan.scenes[1]?.motion).toBe('pan-left');
    for (const scene of plan.scenes) {
      expect(scene.emphasis).toEqual([]);
      expect(scene.imagePrompt.startsWith('flat vector illustration, ')).toBe(true);
      expect(scene.imagePrompt.endsWith(', no people')).toBe(true);
    }
  });
});

describe('buildSectionPlan', () => {
  it('packs each section independently and concatenates with a pause', () => {
    const sections = [
      { text: 'Section one is short.', visual: 'Visual cue for section one.' },
      { text: 'Section two is also short but has more words to make it longer.', visual: 'Visual cue for section two.' },
    ];
    const plan = buildSectionPlan(sections, {
      minSeconds: 4,
      maxSeconds: 10,
      maxScenes: 120,
      rates: { ta: 130, en: 150, mixed: 140 },
      sentencePauseSeconds: 1.0,
      style: { prefix: 'cinematic', negative: 'no text, no watermark' },
    });

    scenePlanSchema.parse(plan);
    expect(plan.adapter).toBe('heuristic');
    expect(plan.degradedFrom).toEqual([]);
    expect(plan.scenes.length).toBeGreaterThanOrEqual(2);
    // First section ends, then 1s pause, then second section starts.
    const firstEnd = plan.scenes.findIndex((s) => s.text.includes('Section one'));
    const secondStart = plan.scenes.findIndex((s) => s.text.includes('Section two'));
    expect(firstEnd).toBeLessThan(secondStart);
    // Visual cues should appear in prompts.
    expect(plan.scenes[0]?.imagePrompt).toContain('Visual cue for section one');
    expect(plan.scenes.at(-1)?.imagePrompt).toContain('Visual cue for section two');
  });

  it('cycles visual cues within a section', () => {
    const sections = [
      { text: 'First sentence. Second sentence. Third sentence.', visual: 'Cue A. Cue B. Cue C.' },
    ];
    const plan = buildSectionPlan(sections, {
      minSeconds: 1,
      maxSeconds: 2,
      maxScenes: 120,
      rates: { ta: 130, en: 150, mixed: 140 },
      sentencePauseSeconds: 1.0,
      style: {},
    });

    expect(plan.scenes.length).toBe(3);
    // Each scene should get a different visual cue.
    const prompts = plan.scenes.map((s) => s.imagePrompt);
    expect(prompts[0]).toContain('Cue A');
    expect(prompts[1]).toContain('Cue B');
    expect(prompts[2]).toContain('Cue C');
  });

  it('merges scenes when over maxScenes', () => {
    const sections = [
      { text: 'A. B. C. D. E. F. G. H. I. J. K. L. M. N. O. P.', visual: 'V.' },
    ];
    const plan = buildSectionPlan(sections, {
      minSeconds: 1,
      maxSeconds: 3,
      maxScenes: 3,
      rates: { ta: 130, en: 150, mixed: 140 },
      sentencePauseSeconds: 1.0,
      style: {},
    });

    expect(plan.scenes.length).toBe(3);
    expect(plan.totalMs).toBeGreaterThan(0);
  });

  it('reconstructs the script from scene texts', () => {
    const sections = [
      { text: 'Hello world.', visual: 'Visual one.' },
      { text: 'Goodbye world.', visual: 'Visual two.' },
    ];
    const plan = buildSectionPlan(sections, {
      minSeconds: 4,
      maxSeconds: 10,
      maxScenes: 120,
      rates: { ta: 130, en: 150, mixed: 140 },
      sentencePauseSeconds: 1.0,
      style: {},
    });

    const reconstructed = plan.scenes.map((s) => s.text).join(' ');
    expect(reconstructed).toBe('Hello world. Goodbye world.');
  });
});

describe('enhanceVisualCue', () => {
  it('adds cinematic terms for cinematic style', () => {
    const enhanced = enhanceVisualCue('police officer in uniform', {
      medium: 'cinematic live action',
      prefix: 'cinematic shot',
    });
    expect(enhanced).toContain('police officer in uniform');
    expect(enhanced).toContain('cinematic lighting');
    expect(enhanced).toContain('depth of field');
    expect(enhanced).toContain('8k');
  });

  it('adds anime terms for anime style', () => {
    const enhanced = enhanceVisualCue('anime girl in city', {
      medium: 'anime illustration',
      prefix: 'anime style',
    });
    expect(enhanced).toContain('anime girl in city');
    expect(enhanced).toContain('cel shaded');
    expect(enhanced).toContain('vibrant colors');
  });

  it('adds vector terms for clean minimal style', () => {
    const enhanced = enhanceVisualCue('geometric shapes', {
      medium: 'clean vector illustration',
      prefix: 'minimal flat vector',
    });
    expect(enhanced).toContain('geometric shapes');
    expect(enhanced).toContain('clean vector illustration');
    expect(enhanced).toContain('crisp edges');
  });

  it('adds close-up terms for portrait cues', () => {
    const enhanced = enhanceVisualCue('close-up of police officer face', {
      medium: 'cinematic live action',
    });
    expect(enhanced).toContain('close-up shot');
    expect(enhanced).toContain('shallow depth of field');
  });

  it('adds wide angle terms for landscape cues', () => {
    const enhanced = enhanceVisualCue('wide city street at night', {
      medium: 'cinematic live action',
    });
    expect(enhanced).toContain('wide angle');
    expect(enhanced).toContain('establishing shot');
  });

  it('adds night atmosphere for dark cues', () => {
    const enhanced = enhanceVisualCue('dark alley at night', {
      medium: 'cinematic live action',
    });
    expect(enhanced).toContain('low key lighting');
    expect(enhanced).toContain('dramatic shadows');
    expect(enhanced).toContain('night atmosphere');
  });

  it('adds golden hour for sunrise/sunset cues', () => {
    const enhanced = enhanceVisualCue('sunrise over police station', {
      medium: 'cinematic live action',
    });
    expect(enhanced).toContain('golden hour lighting');
    expect(enhanced).toContain('warm tones');
  });

  it('adds action terms for motion cues', () => {
    const enhanced = enhanceVisualCue('police chase action scene', {
      medium: 'cinematic live action',
    });
    expect(enhanced).toContain('dynamic motion');
    expect(enhanced).toContain('motion blur');
  });

  it('falls back to professional quality for unknown styles', () => {
    const enhanced = enhanceVisualCue('some scene', {
      medium: 'unknown style',
    });
    expect(enhanced).toContain('professional photography');
    expect(enhanced).toContain('high quality');
  });

  it('handles empty cue gracefully', () => {
    const enhanced = enhanceVisualCue('', { medium: 'cinematic live action' });
    expect(enhanced).toBe('cinematic scene');
  });
});
