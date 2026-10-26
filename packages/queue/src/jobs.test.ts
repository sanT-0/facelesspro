import { VIDEO_STEPS } from '@facelesspro/contracts';
import { describe, expect, it } from 'vitest';

import { STEP_QUEUE_OPTIONS } from './boss';
import {
  InvalidJobError,
  jobData,
  parseJob,
  queueFor,
  stepForQueue,
} from './jobs';
import { DEFAULT_LOCK_TTL_MS, nextStepOf } from './step';

const VIDEO_ID = '00000000-0000-4000-8000-000000000001';

describe('queue names', () => {
  it('are the step ids, one queue per step', () => {
    expect(VIDEO_STEPS.map(queueFor)).toEqual([...VIDEO_STEPS]);
  });

  it('round-trip through the parser', () => {
    for (const step of VIDEO_STEPS) {
      expect(stepForQueue(queueFor(step))).toBe(step);
    }
  });

  it('reject a queue that is not a step', () => {
    // The old upstream spelling is exactly the kind of drift this guards.
    expect(() => stepForQueue('create-caption')).toThrow(InvalidJobError);
    expect(() => stepForQueue('')).toThrow(InvalidJobError);
  });
});

describe('job payload', () => {
  it('carries the video id and nothing else', () => {
    expect(jobData({ videoId: VIDEO_ID, step: 'create-scenes' })).toEqual({
      videoId: VIDEO_ID,
    });
  });

  it('reuses the queue name as the step, so the two cannot disagree', () => {
    expect(parseJob('create-images', { videoId: VIDEO_ID })).toEqual({
      videoId: VIDEO_ID,
      step: 'create-images',
    });
  });

  it('rejects a payload that is not an object', () => {
    for (const data of [null, undefined, 'video', 42, []]) {
      expect(() => parseJob('render', data)).toThrow(InvalidJobError);
    }
    // An array with no `videoId` falls through to the id check; both are fatal.
    expect(() => parseJob('render', [])).toThrow(/videoId/);
  });

  it('rejects a missing or malformed videoId instead of guessing', () => {
    expect(() => parseJob('render', {})).toThrow(/videoId/);
    expect(() => parseJob('render', { videoId: 'nope' })).toThrow(/videoId/);
    expect(() => parseJob('render', { videoId: 7 })).toThrow(/videoId/);
  });

  it('checks the queue before the payload', () => {
    expect(() => parseJob('not-a-step', {})).toThrow(/unknown queue/);
  });
});

describe('step order', () => {
  it('follows the public tuple', () => {
    expect(VIDEO_STEPS.map(nextStepOf)).toEqual([
      'create-vocal',
      'create-images',
      'create-captions',
      'render',
      null,
    ]);
  });

  it('locks the 30 minute lock TTL above the slowest documented step', () => {
    // docs/04 §8: cold render is 1–3 min, cold create-vocal 3–6 min.
    expect(DEFAULT_LOCK_TTL_MS).toBe(30 * 60_000);
  });
});

describe('queue policy', () => {
  it('retries twice with backoff, then records the failure', () => {
    expect(STEP_QUEUE_OPTIONS.retryLimit).toBe(2);
    expect(STEP_QUEUE_OPTIONS.retryBackoff).toBe(true);
    expect(STEP_QUEUE_OPTIONS.retryDelay).toBe(30);
  });

  it('expires long after the slowest step and keeps jobs for a day', () => {
    expect(STEP_QUEUE_OPTIONS.expireInSeconds).toBe(3600);
    expect(STEP_QUEUE_OPTIONS.expireInSeconds).toBeGreaterThan(6 * 60);
    expect(STEP_QUEUE_OPTIONS.retentionSeconds).toBe(86_400);
  });
});
