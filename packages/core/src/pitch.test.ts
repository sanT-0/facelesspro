import { describe, expect, it } from 'vitest';

import {
  VOICE_PITCH_DEFAULT,
  VOICE_PITCH_MAX,
  VOICE_PITCH_MIN,
  voicePitchPercent,
} from './pitch';

describe('voicePitchPercent', () => {
  it('leaves the default voice untouched', () => {
    expect(voicePitchPercent(VOICE_PITCH_DEFAULT)).toBe(0);
  });

  it('uses the full headroom at both ends of the slider', () => {
    expect(voicePitchPercent(VOICE_PITCH_MIN)).toBe(-100);
    expect(voicePitchPercent(VOICE_PITCH_MAX)).toBe(100);
  });

  it('is monotonic across the slider', () => {
    let previous = -101;
    for (let pitch = VOICE_PITCH_MIN; pitch <= VOICE_PITCH_MAX; pitch += 1) {
      const percent = voicePitchPercent(pitch);
      expect(percent).toBeGreaterThanOrEqual(previous);
      previous = percent;
    }
  });

  it('maps the two halves linearly around the default', () => {
    // 90 below the default is the whole lower half; 40 above is the upper.
    expect(voicePitchPercent(100)).toBe(-44);
    expect(voicePitchPercent(122)).toBe(-20);
    expect(voicePitchPercent(160)).toBe(50);
    expect(voicePitchPercent(170)).toBe(75);
  });

  it('clamps a value outside the contract instead of emitting an engine error', () => {
    expect(voicePitchPercent(0)).toBe(-100);
    expect(voicePitchPercent(400)).toBe(100);
  });

  it('rejects a non-finite pitch', () => {
    expect(() => voicePitchPercent(Number.NaN)).toThrow(RangeError);
    expect(() => voicePitchPercent(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
