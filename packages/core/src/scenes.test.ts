import { describe, expect, it } from 'vitest';

import { DEFAULT_DURATION_RATES, DEFAULT_SENTENCE_PAUSE_SECONDS, estimateDuration } from './duration';
import {
  DEFAULT_MAX_SCENES,
  DEFAULT_SCENE_MAX_SECONDS,
  DEFAULT_SCENE_MIN_SECONDS,
  packScenes,
} from './scenes';
import { normalizeScript } from './sentences';

/** The same 408-character mixed script the splitter was checked against. */
const SCRIPT = `இன்று நாம் பேசுவது about money and freelancing. Dr. Raman said, "start small."
ஒரு நல்ல business கட்ட 3.5 வருடம் ஆகலாம்... but only if you never ship.

முதல் விதி: உங்கள் customer-க்கு ஒரு clear promise கொடுங்கள். அதாவது, அவர்கள் ஏன்
உங்களிடம் வர வேண்டும்? Honestly, most people cannot answer that — and that is the whole problem!
2024 ஆம் ஆண்டில் ₹1,20,000 லாபம் வந்தது, அதாவது 15% வளர்ச்சி. வாழ்த்துக்கள் 🙏`;

const seconds = (scene: { startMs: number; endMs: number }) => (scene.endMs - scene.startMs) / 1000;

const sentenceOf = (words: number) =>
  `${Array.from({ length: words }, () => 'வார்த்தை').join(' ')}.`;

describe('packScenes', () => {
  it('documents its bounds', () => {
    expect(DEFAULT_SCENE_MIN_SECONDS).toBe(8);
    expect(DEFAULT_SCENE_MAX_SECONDS).toBe(20);
    expect(DEFAULT_MAX_SCENES).toBe(120);
    expect(DEFAULT_SENTENCE_PAUSE_SECONDS).toBe(0.3);
    expect(DEFAULT_DURATION_RATES).toEqual({ ta: 130, en: 150, mixed: 140 });
  });

  it('packs a real mixed script into 8–20 s scenes with no runt', () => {
    const scenes = packScenes(SCRIPT);
    expect(scenes.length).toBeGreaterThanOrEqual(2);
    for (const scene of scenes) {
      expect(scene.text.length).toBeGreaterThan(0);
      expect(seconds(scene)).toBeGreaterThanOrEqual(8);
      expect(seconds(scene)).toBeLessThanOrEqual(20);
    }
  });

  it('preserves the script when scene texts are joined', () => {
    // The planner's hard invariant, layer by layer: sentences then scenes.
    expect(packScenes(SCRIPT).map((scene) => scene.text).join(' ')).toBe(normalizeScript(SCRIPT));
  });

  it('gives every scene a contiguous, non-overlapping span', () => {
    const scenes = packScenes(SCRIPT);
    expect(scenes[0]?.startMs).toBe(0);
    for (let i = 1; i < scenes.length; i += 1) {
      const previous = scenes[i - 1]!;
      const current = scenes[i]!;
      expect(current.startMs).toBeGreaterThanOrEqual(previous.endMs);
      expect(current.endMs).toBeGreaterThan(current.startMs);
    }
    // The plan must add up to the narration estimate it is based on.
    expect(Math.abs(scenes.at(-1)!.endMs - estimateDuration(SCRIPT).durationMs)).toBeLessThanOrEqual(1);
  });

  it('counts the sentence gap that falls inside a scene', () => {
    const text = `${sentenceOf(10)} ${sentenceOf(10)}`;
    const scenes = packScenes(text);
    expect(scenes).toHaveLength(1);
    // Same milliseconds as the narration estimate: 20 words at 130 wpm + one gap.
    expect(scenes[0]!.endMs - scenes[0]!.startMs).toBe(estimateDuration(text).durationMs);
  });

  it('merges short sentences into one scene when the total is under the minimum', () => {
    const text = `${sentenceOf(6)} ${sentenceOf(6)} ${sentenceOf(6)}`;
    expect(packScenes(text)).toHaveLength(1);
  });

  it('keeps a single short sentence as one short scene', () => {
    // Below the minimum is unavoidable here; packing must not invent text.
    const scenes = packScenes('வணக்கம் நண்பர்களே.');
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.text).toBe('வணக்கம் நண்பர்களே.');
    expect(scenes[0]!.endMs - scenes[0]!.startMs).toBe(
      estimateDuration('வணக்கம் நண்பர்களே.').durationMs,
    );
  });

  it('splits a sentence longer than the maximum at word boundaries', () => {
    // 60 Tamil words ≈ 27.7 s: it cannot fit one scene.
    const text = sentenceOf(60);
    const scenes = packScenes(text);
    expect(scenes.length).toBeGreaterThan(1);
    for (const scene of scenes) {
      expect(seconds(scene)).toBeLessThanOrEqual(20);
      expect(scene.text.startsWith(' ')).toBe(false);
      expect(scene.text.endsWith(' ')).toBe(false);
    }
    expect(scenes.map((scene) => scene.text).join(' ')).toBe(normalizeScript(text));
    // Balanced halves, not 20 s + a 7 s tail.
    for (const scene of scenes) expect(seconds(scene)).toBeGreaterThanOrEqual(8);
  });

  it('never starts a scene inside a Tamil grapheme cluster', () => {
    for (const scene of packScenes(sentenceOf(60))) {
      // A dependent vowel sign or virama at the start means a cut inside a cluster.
      expect(/^\p{M}/u.test(scene.text)).toBe(false);
    }
  });

  it('respects a scene cap by merging, even past the maximum', () => {
    // The cap is a hard product limit (image budget); a long scene is better
    // than silently dropping text.
    const scenes = packScenes(SCRIPT, { maxScenes: 1 });
    expect(scenes).toHaveLength(1);
    expect(seconds(scenes[0]!)).toBeGreaterThan(20);
    expect(scenes[0]?.text).toBe(normalizeScript(SCRIPT));
  });

  it('packs more scenes for a slower voice', () => {
    const normal = packScenes(SCRIPT);
    const slow = packScenes(SCRIPT, { rates: { ta: 65, en: 75 } });
    expect(slow.length).toBeGreaterThan(normal.length);
  });

  it('is deterministic', () => {
    expect(packScenes(SCRIPT)).toEqual(packScenes(SCRIPT));
  });

  it('returns nothing for empty input', () => {
    expect(packScenes('')).toEqual([]);
    expect(packScenes('   \n\n  ')).toEqual([]);
  });

  it('rejects bounds that cannot be satisfied', () => {
    for (const options of [
      { minSeconds: 0 },
      { minSeconds: -1 },
      { maxSeconds: 0 },
      { minSeconds: 21, maxSeconds: 20 },
      { maxScenes: 0 },
      { maxScenes: 1.5 },
      { minSeconds: Number.NaN },
    ]) {
      expect(() => packScenes(SCRIPT, options), JSON.stringify(options)).toThrow(TypeError);
    }
    expect(() => packScenes(42 as unknown as string)).toThrow(TypeError);
  });
});
