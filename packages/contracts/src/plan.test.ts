import { describe, expect, it } from 'vitest';

import {
  MAX_V3_LANDSCAPE_CHARS,
  MAX_V3_PORTRAIT_CHARS,
  planVideoRequestSchema,
  planVideoResponseSchema,
} from './index';

const request = (overrides: Record<string, unknown> = {}) => ({
  script: 'வணக்கம் நண்பர்களே. இன்று ஒரு சிறிய விஷயம் பேசுவோம்.',
  ...overrides,
});

const response = (overrides: Record<string, unknown> = {}) => ({
  scenes: [
    { idx: 0, text: 'வணக்கம் நண்பர்களே.', startMs: 0, endMs: 5_000 },
    { idx: 1, text: 'இன்று ஒரு சிறிய விஷயம் பேசுவோம்.', startMs: 5_300, endMs: 9_000 },
  ],
  sceneCount: 2,
  totalMs: 9_000,
  language: { run: 'ta', words: { ta: 2, en: 0 } },
  adapter: 'heuristic',
  ...overrides,
});

const issuePaths = (result: ReturnType<typeof planVideoResponseSchema.safeParse>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));

describe('plan video request', () => {
  it('accepts a script and defaults the size to landscape', () => {
    const parsed = planVideoRequestSchema.parse(request());
    expect(parsed.size).toBe('landscape');
    expect(parsed.script).toContain('வணக்கம்');
  });

  it('keeps a portrait size', () => {
    expect(planVideoRequestSchema.parse(request({ size: 'portrait' })).size).toBe('portrait');
  });

  it('rejects a blank script, naming the field', () => {
    const result = planVideoRequestSchema.safeParse(request({ script: '   ' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]!.path).toEqual(['script']);
    expect(result.error.issues[0]!.message).toContain('blank');
  });

  it('applies the portrait character ceiling, not the landscape one', () => {
    const portrait = planVideoRequestSchema.safeParse(
      request({ size: 'portrait', script: 'x'.repeat(MAX_V3_PORTRAIT_CHARS + 1) }),
    );
    expect(portrait.success).toBe(false);
    if (!portrait.success) {
      expect(portrait.error.issues[0]!.message).toContain(`at most ${MAX_V3_PORTRAIT_CHARS}`);
    }

    const atLimit = planVideoRequestSchema.safeParse(
      request({ size: 'portrait', script: 'x'.repeat(MAX_V3_PORTRAIT_CHARS) }),
    );
    expect(atLimit.success).toBe(true);

    const tooLong = planVideoRequestSchema.safeParse(
      request({ script: 'x'.repeat(MAX_V3_LANDSCAPE_CHARS + 1) }),
    );
    expect(tooLong.success).toBe(false);
  });

  it('rejects an unknown field instead of dropping it', () => {
    expect(planVideoRequestSchema.safeParse(request({ voiceId: 'pallavi' })).success).toBe(false);
  });

  it('requires a script', () => {
    expect(planVideoRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('plan video response', () => {
  it('accepts a heuristic estimate', () => {
    const parsed = planVideoResponseSchema.parse(response());
    expect(parsed.sceneCount).toBe(2);
    expect(parsed.totalMs).toBe(9_000);
    expect(parsed.language.run).toBe('ta');
  });

  it('accepts a mixed-language plan', () => {
    const parsed = planVideoResponseSchema.parse(
      response({ language: { run: 'mixed', words: { ta: 10, en: 4 } } }),
    );
    expect(parsed.language.words).toEqual({ ta: 10, en: 4 });
  });

  it('rejects an unknown language run', () => {
    expect(
      planVideoResponseSchema.safeParse(response({ language: { run: 'tanglish', words: { ta: 1, en: 0 } } }))
        .success,
    ).toBe(false);
  });

  it('rejects an adapter outside the planner vocabulary', () => {
    expect(planVideoResponseSchema.safeParse(response({ adapter: 'chain' })).success).toBe(false);
  });

  it('rejects a scene count that does not match the scenes', () => {
    const result = planVideoResponseSchema.safeParse(response({ sceneCount: 3 }));
    expect(issuePaths(result)).toContain('sceneCount');
  });

  it('rejects a first scene that does not start at 0', () => {
    const scenes = response().scenes as Array<Record<string, unknown>>;
    scenes[0]!.startMs = 100;
    const result = planVideoResponseSchema.safeParse(response({ scenes }));
    expect(issuePaths(result)).toContain('scenes.0.startMs');
  });

  it('rejects overlapping or out-of-order scenes', () => {
    const scenes = response().scenes as Array<Record<string, unknown>>;
    scenes[1]!.startMs = 4_000;
    expect(issuePaths(planVideoResponseSchema.safeParse(response({ scenes })))).toContain(
      'scenes.1.startMs',
    );
  });

  it('rejects a scene that ends before it starts', () => {
    const scenes = response().scenes as Array<Record<string, unknown>>;
    scenes[0]!.endMs = 0;
    expect(issuePaths(planVideoResponseSchema.safeParse(response({ scenes })))).toContain(
      'scenes.0.endMs',
    );
  });

  it('rejects a total that does not equal the last end', () => {
    expect(issuePaths(planVideoResponseSchema.safeParse(response({ totalMs: 8_999 })))).toContain(
      'totalMs',
    );
  });

  it('rejects a scene idx that disagrees with its position', () => {
    const scenes = response().scenes as Array<Record<string, unknown>>;
    scenes[1]!.idx = 5;
    expect(issuePaths(planVideoResponseSchema.safeParse(response({ scenes })))).toContain(
      'scenes.1.idx',
    );
  });

  it('rejects unknown keys', () => {
    expect(planVideoResponseSchema.safeParse(response({ cost: 0 })).success).toBe(false);
  });
});
