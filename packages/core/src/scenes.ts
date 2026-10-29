/**
 * Script → scenes.
 *
 * This is the deterministic planner: the fallback when no model is reachable and
 * the validator every model answer is held to. It only decides *where the
 * picture cuts*, so it works on sentences and never edits them: scene texts
 * joined with a space reproduce `normalizeScript(script)`, which is the
 * planner's hard invariant (`concat(scene.text) === script`).
 *
 * The bound is seconds, not characters. Characters-per-second differ by script
 * (Tamil packs fewer words per character than English), so `estimateDuration()`
 * supplies the budget and the char proxy in docs/04 is gone.
 *
 * Shape of the result:
 * - 8–20 s per scene when that is reachable at all. A script shorter than 8 s is
 *   one short scene; a sentence longer than 20 s is cut at word boundaries into
 *   balanced parts, and the cut carries no pause (only a sentence boundary has
 *   one).
 * - At most `maxScenes` (120, mirroring `MAX_SCENES` in `packages/contracts`),
 *   enforced by merging the cheapest adjacent pair. Merging past 20 s is
 *   deliberate: the image budget is the hard limit, and dropping narration text
 *   is not an option.
 * - Timings: `startMs`/`endMs` cover the scene's speech plus the 300 ms gaps
 *   between its sentences; the last scene ends on the narration estimate, so a
 *   plan adds up exactly once.
 *
 * Chosen by dynamic programming rather than greedy, because greedy is what
 * leaves a 0.5 s runt on the end of a video: the cost function makes a scene
 * outside the bounds 1000× worse than a scene merely far from 14 s.
 *
 * Pure: no I/O, no clock, no network.
 */

import { DEFAULT_SENTENCE_PAUSE_SECONDS, estimateDuration } from './duration';
import type { DurationOptions } from './duration';
import { splitSentences } from './sentences';

export const DEFAULT_SCENE_MIN_SECONDS = 8;
export const DEFAULT_SCENE_MAX_SECONDS = 20;
/** Mirrors `MAX_SCENES`; `packages/core` has no dependencies, so it is restated. */
export const DEFAULT_MAX_SCENES = 120;

export interface PackScenesOptions extends DurationOptions {
  minSeconds?: number;
  maxSeconds?: number;
  maxScenes?: number;
}

export interface SceneDraft {
  text: string;
  startMs: number;
  endMs: number;
}

/** A sentence, or a piece of one too long for a single scene. */
interface Unit {
  text: string;
  seconds: number;
  /** Whether a sentence ends after this unit, i.e. whether a gap follows it. */
  gapAfter: boolean;
}

interface PackingBounds {
  minSeconds: number;
  maxSeconds: number;
  maxScenes: number;
  gap: number;
}

export function packScenes(script: string, options: PackScenesOptions = {}): SceneDraft[] {
  if (typeof script !== 'string') {
    throw new TypeError('packScenes expects a string');
  }
  const minSeconds = options.minSeconds ?? DEFAULT_SCENE_MIN_SECONDS;
  const maxSeconds = options.maxSeconds ?? DEFAULT_SCENE_MAX_SECONDS;
  const maxScenes = options.maxScenes ?? DEFAULT_MAX_SCENES;
  for (const [name, value] of [
    ['minSeconds', minSeconds],
    ['maxSeconds', maxSeconds],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive number, got ${String(value)}`);
    }
  }
  if (maxSeconds <= minSeconds) {
    throw new TypeError(
      `maxSeconds (${maxSeconds}) must be greater than minSeconds (${minSeconds})`,
    );
  }
  if (!Number.isInteger(maxScenes) || maxScenes < 1) {
    throw new TypeError(`maxScenes must be a positive integer, got ${String(maxScenes)}`);
  }
  const gap = options.sentencePauseSeconds ?? DEFAULT_SENTENCE_PAUSE_SECONDS;

  const sentences = splitSentences(script);
  if (sentences.length === 0) return [];

  const units = toUnits(sentences, maxSeconds, gap, options);
  const ranges = chooseRanges(units, { minSeconds, maxSeconds, maxScenes, gap });
  return toScenes(units, ranges, gap);
}

function toUnits(
  sentences: ReturnType<typeof splitSentences>,
  maxSeconds: number,
  gap: number,
  options: PackScenesOptions,
): Unit[] {
  const units: Unit[] = [];
  sentences.forEach((sentence, index) => {
    const lastSentence = index === sentences.length - 1;
    const seconds = estimateDuration(sentence.text, options).seconds;
    const words = sentence.text.split(' ');
    if (seconds <= maxSeconds || words.length < 2) {
      units.push({ text: sentence.text, seconds, gapAfter: !lastSentence });
      return;
    }
    // Too long for any scene: cut into as many balanced parts as needed, so the
    // tail is not a 3 s scrap nobody can watch.
    const parts = Math.min(words.length, Math.ceil(seconds / maxSeconds));
    const perPart = Math.ceil(words.length / parts);
    for (let start = 0; start < words.length; start += perPart) {
      const chunk = words.slice(start, start + perPart).join(' ');
      const lastPart = start + perPart >= words.length;
      units.push({
        text: chunk,
        seconds: estimateDuration(chunk, options).seconds,
        gapAfter: lastPart && !lastSentence,
      });
    }
  });
  return units;
}

/** Dynamic programme over unit ranges; returns inclusive `[start, stop]` pairs. */
function chooseRanges(
  units: readonly Unit[],
  { minSeconds, maxSeconds, maxScenes, gap }: PackingBounds,
): Array<[number, number]> {
  const target = (minSeconds + maxSeconds) / 2;
  const count = units.length;
  const best = new Array<number>(count + 1).fill(Number.POSITIVE_INFINITY);
  const from = new Array<number>(count + 1).fill(-1);
  best[0] = 0;

  for (let end = 1; end <= count; end += 1) {
    let seconds = 0;
    let boundaries = 0;
    for (let start = end - 1; start >= 0; start -= 1) {
      seconds += units[start]!.seconds;
      const duration = seconds + boundaries * gap;
      // Extending only ever adds speech, so once a scene is too long and there
      // is already a shorter candidate, nothing further left can help.
      if (duration > maxSeconds && start < end - 1) break;
      const outside =
        duration < minSeconds
          ? minSeconds - duration
          : duration > maxSeconds
            ? duration - maxSeconds
            : 0;
      const cost = outside * outside * 1000 + (duration - target) ** 2;
      const total = best[start]! + cost;
      if (total < best[end]!) {
        best[end] = total;
        from[end] = start;
      }
      if (start > 0 && units[start - 1]!.gapAfter) boundaries += 1;
    }
  }

  const ranges: Array<[number, number]> = [];
  for (let end = count; end > 0; end = from[end]!) {
    ranges.push([from[end]!, end - 1]);
  }
  ranges.reverse();

  // A scene cap can only be met by merging; pick the cheapest merge each time so
  // the overflow is spread rather than dumped on the last scene.
  while (ranges.length > maxScenes) {
    let mergeAt = 0;
    let mergeDuration = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < ranges.length; i += 1) {
      const duration = sceneSeconds(units, ranges[i]![0], ranges[i + 1]![1], gap);
      if (duration < mergeDuration) {
        mergeDuration = duration;
        mergeAt = i;
      }
    }
    ranges.splice(mergeAt, 2, [ranges[mergeAt]![0], ranges[mergeAt + 1]![1]]);
  }
  return ranges;
}

function sceneSeconds(units: readonly Unit[], start: number, stop: number, gap: number): number {
  let seconds = 0;
  for (let i = start; i <= stop; i += 1) {
    seconds += units[i]!.seconds;
    if (i < stop && units[i]!.gapAfter) seconds += gap;
  }
  return seconds;
}

function toScenes(
  units: readonly Unit[],
  ranges: ReadonlyArray<readonly [number, number]>,
  gap: number,
): SceneDraft[] {
  const scenes: SceneDraft[] = [];
  let clock = 0;
  ranges.forEach(([start, stop], index) => {
    const startMs = Math.round(clock * 1000);
    clock += sceneSeconds(units, start, stop, gap);
    const endMs = Math.round(clock * 1000);
    const text = units
      .slice(start, stop + 1)
      .map((unit) => unit.text)
      .join(' ');
    scenes.push({ text, startMs, endMs });
    const lastScene = index === ranges.length - 1;
    if (!lastScene && units[stop]!.gapAfter) clock += gap;
  });
  return scenes;
}
