import { describe, expect, it } from 'vitest';

import {
  captionJsonExportSchema,
  captionPreviewRequestSchema,
  captionTemplateListSchema,
  videoPlanResponseSchema,
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

describe('caption preview request', () => {
  it('accepts a template id, a spec override, or both', () => {
    expect(captionPreviewRequestSchema.parse({})).toEqual({});
    expect(captionPreviewRequestSchema.parse({ templateId: -1 })).toEqual({
      templateId: -1,
    });
    expect(
      captionPreviewRequestSchema.parse({ spec: { wordLimit: 3, emoji: true } }),
    ).toEqual({ spec: { wordLimit: 3, emoji: true } });
  });

  it('rejects an unknown key and an out-of-range word limit', () => {
    expect(
      captionPreviewRequestSchema.safeParse({ wordLimit: 3 }).success,
    ).toBe(false);
    expect(
      captionPreviewRequestSchema.safeParse({ spec: { wordLimit: 11 } }).success,
    ).toBe(false);
    expect(
      captionPreviewRequestSchema.safeParse({ templateId: 0 }).success,
    ).toBe(false);
  });
});

describe('video plan response', () => {
  const plan = {
    scenes: [
      {
        text: 'தமிழ் முதல் காட்சி',
        imagePrompt: 'a Tamil street at dawn',
        motion: 'kenburns-in',
        emphasis: ['தமிழ்'],
        startMs: 0,
        endMs: 2_400,
      },
    ],
    adapter: 'heuristic',
    degradedFrom: [],
    totalMs: 2_400,
  };
  const voicePlan = {
    script: 'தமிழ் முதல் காட்சி',
    spokenText: 'தமிழ் முதல் காட்சி',
    runs: [
      {
        text: 'தமிழ் முதல் காட்சி',
        lang: 'ta',
        voice: 'ta-IN-ValluvarNeural',
        script: 'tamil',
      },
    ],
    overrides: [],
    pair: null,
  };

  it('carries the stored plan and a nullable voice plan', () => {
    expect(videoPlanResponseSchema.parse({ plan, voicePlan: null })).toEqual({
      plan,
      voicePlan: null,
    });
    expect(videoPlanResponseSchema.parse({ plan, voicePlan })).toEqual({
      plan,
      voicePlan,
    });
  });

  it('rejects an incomplete plan or an unknown key', () => {
    expect(
      videoPlanResponseSchema.safeParse({
        plan: { ...plan, totalMs: 1 },
        voicePlan: null,
      }).success,
    ).toBe(false);
    expect(
      videoPlanResponseSchema.safeParse({ plan, voicePlan: null, extra: true })
        .success,
    ).toBe(false);
  });
});
