import { describe, expect, it } from 'vitest';

import { SAMPLE_ROOT, sampleSetDir } from './samples';

describe('sampleSetDir', () => {
  it('names one directory per pair', () => {
    expect(sampleSetDir('valluvar')).toBe('samples/tts/valluvar');
    expect(sampleSetDir('pallavi')).toBe('samples/tts/pallavi');
    expect(sampleSetDir('seraphina')).toBe('samples/tts/seraphina');
    expect(sampleSetDir('vivienne')).toBe('samples/tts/vivienne');
    expect(sampleSetDir('thalita')).toBe('samples/tts/thalita');
    expect(sampleSetDir('indicf5-ta')).toBe('samples/tts/indicf5-ta');
  });

  it('keeps every set under the sample root', () => {
    expect(SAMPLE_ROOT).toBe('samples/tts');
    for (const pair of ['valluvar', 'pallavi', 'piper-offline']) {
      expect(sampleSetDir(pair).startsWith(`${SAMPLE_ROOT}/`)).toBe(true);
    }
  });

  it('rejects anything that is not a pair id', () => {
    // An engine voice id, an absolute path, a traversal, a stray space: all of
    // these would either scatter sets or write outside samples/tts.
    for (const bad of [
      '',
      'Valluvar',
      'ta-IN-ValluvarNeural',
      'samples/tts/valluvar',
      '../valluvar',
      'valluvar/../pallavi',
      'valluvar ',
      'pallavi.',
    ]) {
      expect(() => sampleSetDir(bad), bad).toThrow(/pair id/u);
    }
  });
});
