import { describe, expect, it } from 'vitest';

import {
  captionJsonExportSchema,
  captionTemplateListSchema,
} from './responses';

describe('caption template responses', () => {
  it('uses the shared non-zero caption template id contract', () => {
    const template = { name: 'Built-in', spec: {} };
    expect(
      captionTemplateListSchema.safeParse({
        templates: [{ ...template, id: -1 }, { ...template, id: 1 }],
      }).success,
    ).toBe(true);
    expect(
      captionTemplateListSchema.safeParse({
        templates: [{ ...template, id: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe('caption JSON export responses', () => {
  const valid = {
    version: 1,
    durationMs: 1000,
    cues: [
      {
        index: 1,
        startMs: 0,
        endMs: 1000,
        lines: ['தமிழ் captions'],
        words: [
          { text: 'தமிழ்', startMs: 0, endMs: 400 },
          { text: 'captions', startMs: 400, endMs: 1000 },
        ],
        emoji: '🔥',
      },
    ],
  };

  it('accepts the versioned strict sidecar shape', () => {
    expect(captionJsonExportSchema.parse(valid)).toEqual(valid);
    expect(
      captionJsonExportSchema.safeParse({ ...valid, sourcePath: 'private.ass' }).success,
    ).toBe(false);
    expect(
      captionJsonExportSchema.safeParse({
        ...valid,
        cues: [{ ...valid.cues[0], emoji: '🔥🔥' }],
      }).success,
    ).toBe(false);
    expect(
      captionJsonExportSchema.safeParse({
        ...valid,
        cues: [{ ...valid.cues[0], lines: ['தமிழ்\ncaptions'] }],
      }).success,
    ).toBe(false);
  });

  it('pins sequential indexes, cue order and final duration', () => {
    expect(
      captionJsonExportSchema.safeParse({
        ...valid,
        cues: [{ ...valid.cues[0], index: 2 }],
      }).success,
    ).toBe(false);
    expect(
      captionJsonExportSchema.safeParse({ ...valid, durationMs: 999 }).success,
    ).toBe(false);
    expect(
      captionJsonExportSchema.safeParse({
        ...valid,
        durationMs: 1500,
        cues: [
          valid.cues[0],
          {
            ...valid.cues[0],
            index: 2,
            startMs: 900,
            endMs: 1500,
            words: [{ text: 'overlap', startMs: 900, endMs: 1500 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
