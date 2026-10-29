import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { estimateDuration } from './duration';
import { EmptyScriptError, estimateScenePlan, scriptLanguagePlan } from './estimate';
import { normalizeScript } from './sentences';

/** The 12-sentence mixed script every planner artifact is pinned against. */
const fixture = readFileSync(
  fileURLToPath(new URL('../../../fixtures/scripts/tamil-mixed.txt', import.meta.url)),
  'utf8',
);

const tamil = 'வணக்கம் நண்பர்களே. இன்று ஒரு சிறிய விஷயம் பேசுவோம்.';
const english = 'Hello friends. Today we talk about money and freelancing.';

describe('scriptLanguagePlan', () => {
  it('counts Tamil words as Tamil', () => {
    const plan = scriptLanguagePlan(tamil);
    expect(plan.run).toBe('ta');
    expect(plan.words.ta).toBe(7);
    expect(plan.words.en).toBe(0);
  });

  it('counts English words as English', () => {
    const plan = scriptLanguagePlan(english);
    expect(plan.run).toBe('en');
    expect(plan.words).toEqual({ ta: 0, en: 9 });
  });

  it('reports mixed when both voices speak', () => {
    const plan = scriptLanguagePlan('வணக்கம் நண்பர்களே. Hello friends.');
    expect(plan).toMatchObject({ run: 'mixed', words: { ta: 2, en: 2 } });
  });

  it('honours a force override over the written script', () => {
    // A Tamil word forced onto the English voice is an English word for routing.
    const plan = scriptLanguagePlan('[[en:வணக்கம்]] நண்பர்களே.');
    expect(plan).toMatchObject({ run: 'mixed', words: { ta: 1, en: 1 } });
  });

  it('treats a Tanglish run as Tamil, because that is the voice it gets', () => {
    const plan = scriptLanguagePlan('vanakkam namaskaram.');
    expect(plan.run).toBe('ta');
    expect(plan.words.en).toBe(0);
    expect(plan.words.ta).toBe(2);
  });

  it('does not count punctuation as a word', () => {
    expect(scriptLanguagePlan('வணக்கம், நண்பர்களே!').words.ta).toBe(2);
  });
});

describe('estimateScenePlan', () => {
  it('estimates the fixture into three scenes that reassemble the script', () => {
    const plan = estimateScenePlan(fixture);

    expect(plan.sceneCount).toBe(3);
    expect(plan.scenes.map((scene) => scene.idx)).toEqual([0, 1, 2]);
    expect(plan.scenes.map((scene) => scene.text).join(' ')).toBe(normalizeScript(fixture));
    expect(plan.scenes[0]!.startMs).toBe(0);
  });

  it('makes the total equal the last scene end and the narration estimate', () => {
    const plan = estimateScenePlan(fixture);

    expect(plan.totalMs).toBe(plan.scenes.at(-1)!.endMs);
    expect(Math.abs(plan.totalMs - estimateDuration(fixture).durationMs)).toBeLessThanOrEqual(1);
    expect(plan.totalMs).toBeGreaterThan(0);
  });

  it('gives every scene a positive, non-overlapping span', () => {
    const plan = estimateScenePlan(fixture);
    for (const [index, scene] of plan.scenes.entries()) {
      expect(scene.endMs).toBeGreaterThan(scene.startMs);
      if (index > 0) {
        expect(scene.startMs).toBeGreaterThanOrEqual(plan.scenes[index - 1]!.endMs);
      }
    }
  });

  it('reports the fixture as a mixed-language plan', () => {
    const plan = estimateScenePlan(fixture);
    expect(plan.language.run).toBe('mixed');
    expect(plan.language.words.ta).toBeGreaterThan(0);
    expect(plan.language.words.en).toBeGreaterThan(0);
  });

  it('estimates a Tamil-only script without inventing English words', () => {
    const plan = estimateScenePlan(tamil);
    expect(plan.sceneCount).toBe(1);
    expect(plan.language).toMatchObject({ run: 'ta', words: { en: 0 } });
  });

  it('estimates an English-only script', () => {
    const plan = estimateScenePlan(english);
    expect(plan.language.run).toBe('en');
    expect(plan.language.words.ta).toBe(0);
  });

  it('is deterministic', () => {
    expect(estimateScenePlan(fixture)).toEqual(estimateScenePlan(fixture));
  });

  it('passes duration options through to the scene budget', () => {
    const normal = estimateScenePlan(fixture);
    const slow = estimateScenePlan(fixture, { rates: { ta: 65, en: 75 } });

    expect(slow.sceneCount).toBeGreaterThan(normal.sceneCount);
    expect(slow.totalMs).toBeGreaterThan(normal.totalMs);
    expect(slow.scenes.map((scene) => scene.text).join(' ')).toBe(normalizeScript(fixture));
  });

  it('passes packing overrides through', () => {
    const tight = estimateScenePlan(fixture, { minSeconds: 1, maxSeconds: 5 });
    expect(tight.sceneCount).toBeGreaterThan(estimateScenePlan(fixture).sceneCount);
  });

  it('rejects a blank or wordless script with EmptyScriptError', () => {
    for (const script of ['', '   \n\n  ', '...', '!!!', '🙏🙏']) {
      expect(() => estimateScenePlan(script)).toThrow(EmptyScriptError);
    }
  });

  it('surfaces a programming error as a TypeError, not as an empty script', () => {
    expect(() => estimateScenePlan(42 as unknown as string)).toThrow(TypeError);
  });
});
