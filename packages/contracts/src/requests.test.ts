import { describe, expect, it } from 'vitest';

import {
  IMAGE_STYLES,
  QUIZ_IMAGE_STYLES,
  MAX_FAKE_TEXT_MESSAGES,
  MAX_QUIZ_ITEMS,
} from './common';
import {
  captionVideoMetaSchema,
  createAiVideoRequestSchema,
  createAiVideoV3RequestSchema,
  createCaptionVideoRequestSchema,
  createCommentaryVideoRequestSchema,
  createFakeTextVideoRequestSchema,
  createQuizVideoRequestSchema,
  createRobloxVideoRequestSchema,
  fakeTextScreenshotRequestSchema,
  renderOptionsSchema,
  renderRequestSchema,
  textToSpeechRequestSchema,
} from './requests';

const ART_STYLE = '0190a0a0-0000-7000-8000-000000000000';

/**
 * Structural, not `any`: every zod schema has a `safeParse`, and an issue has
 * an optional `path`. Keeping it structural lets one helper serve all schemas.
 */
type SafeParseLike = {
  safeParse(value: unknown): {
    success: boolean;
    error?: {
      issues: ReadonlyArray<{ path?: PropertyKey[]; message: string }>;
    };
  };
};

function issuesOf(schema: SafeParseLike, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success || result.error === undefined) return [];
  return result.error.issues.map((issue) => ({
    path: (issue.path ?? []).join('.'),
    message: issue.message,
  }));
}

function pathsOf(schema: SafeParseLike, value: unknown) {
  return issuesOf(schema, value).map((issue) => issue.path);
}

describe('AI Video V3', () => {
  it('applies the recovered defaults', () => {
    const parsed = createAiVideoV3RequestSchema.parse({
      artStyleId: ART_STYLE,
      script: 'vanakkam',
    });

    expect(parsed.size).toBe('landscape');
    expect(parsed.speed).toBe('standard');
    expect(parsed.captions).toBe(false);
    expect(parsed.voiceStyle).toEqual({
      stability: 50,
      similarityBoost: 75,
      style: 0,
      speed: 100,
    });
    expect(parsed.render).toBeUndefined();
  });

  it('requires exactly one of script and voiceoverUrl', () => {
    expect(
      pathsOf(createAiVideoV3RequestSchema, {
        artStyleId: ART_STYLE,
        script: 'hello',
        voiceoverUrl: 'https://cdn.example.com/a.mp3',
      }),
    ).toContain('voiceoverUrl');

    expect(pathsOf(createAiVideoV3RequestSchema, { artStyleId: ART_STYLE })).toContain(
      'script',
    );
  });

  it('limits the script by aspect, not by one global number', () => {
    const portrait = 'a'.repeat(4_001);
    const landscape = 'a'.repeat(30_001);

    expect(
      pathsOf(createAiVideoV3RequestSchema, {
        artStyleId: ART_STYLE,
        script: portrait,
        size: 'portrait',
      }),
    ).toContain('script');

    expect(
      createAiVideoV3RequestSchema.safeParse({
        artStyleId: ART_STYLE,
        script: portrait,
        size: 'landscape',
      }).success,
    ).toBe(true);

    expect(
      pathsOf(createAiVideoV3RequestSchema, {
        artStyleId: ART_STYLE,
        script: landscape,
        size: 'landscape',
      }),
    ).toContain('script');
  });

  it('accepts only https voiceover containers', () => {
    const ok = createAiVideoV3RequestSchema.safeParse({
      artStyleId: ART_STYLE,
      voiceoverUrl: 'https://cdn.example.com/voice.M4A?token=1',
    });
    expect(ok.success).toBe(true);

    for (const bad of [
      'http://cdn.example.com/voice.mp3',
      'https://cdn.example.com/voice.exe',
      'https://cdn.example.com/voice',
    ]) {
      expect(
        createAiVideoV3RequestSchema.safeParse({
          artStyleId: ART_STYLE,
          voiceoverUrl: bad,
        }).success,
      ).toBe(false);
    }
  });

  it('accepts {} for render and fills the export defaults', () => {
    const parsed = renderOptionsSchema.parse({});
    expect(parsed).toEqual({ resolution: 1080, frameRate: 30, format: 'standard' });
  });

  it('rejects a webhook that is http or points at localhost', () => {
    for (const webhookUrl of [
      'http://example.com/hook',
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://api.localhost/hook',
    ]) {
      expect(
        createAiVideoV3RequestSchema.safeParse({
          artStyleId: ART_STYLE,
          script: 'hi',
          webhookUrl,
        }).success,
      ).toBe(false);
    }

    expect(
      createAiVideoV3RequestSchema.safeParse({
        artStyleId: ART_STYLE,
        script: 'hi',
        webhookUrl: 'https://example.com/hook',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown fields instead of dropping them', () => {
    // zod reports an unknown key at the object root, naming it in the message.
    const issues = issuesOf(createAiVideoV3RequestSchema, {
      artStyleId: ART_STYLE,
      script: 'hi',
      wembhookUrl: 'https://example.com/hook',
    });
    expect(issues.some((issue) => issue.message.includes('wembhookUrl'))).toBe(true);
  });

  it('treats negative caption template ids as built-ins and 0 as invalid', () => {
    const base = { artStyleId: ART_STYLE, script: 'hi' };
    expect(
      createAiVideoV3RequestSchema.safeParse({ ...base, captionTemplateId: -3 }).success,
    ).toBe(true);
    expect(
      pathsOf(createAiVideoV3RequestSchema, { ...base, captionTemplateId: 0 }),
    ).toContain('captionTemplateId');
  });
});

describe('AI Video V2', () => {
  it('applies the V2 defaults, which differ from V3 on purpose', () => {
    const parsed = createAiVideoRequestSchema.parse({ script: 'hai' });

    expect(parsed.imageStyle).toBe('CREEPY_COMIC');
    expect(parsed.size).toBe('portrait');
    expect(parsed.transition).toBe('smooth');
    expect(parsed.voiceStyle.stability).toBe(38);
    expect(parsed.voiceStyle.style).toBe(50);
  });

  it('caps the script at 10,000 characters', () => {
    expect(
      pathsOf(createAiVideoRequestSchema, { script: 'a'.repeat(10_001) }),
    ).toContain('script');
  });

  it('accepts all 16 recovered image styles and nothing else', () => {
    expect(IMAGE_STYLES).toHaveLength(16);
    for (const imageStyle of IMAGE_STYLES) {
      expect(
        createAiVideoRequestSchema.safeParse({ script: 'x', imageStyle }).success,
      ).toBe(true);
    }
    expect(
      createAiVideoRequestSchema.safeParse({ script: 'x', imageStyle: 'GHIBLI' }).success,
    ).toBe(false);
  });
});

describe('quiz', () => {
  const question = {
    text: 'Which one?',
    answers: ['a', 'b'],
    correctIndex: 1,
  };

  it('rejects an out-of-range correctIndex', () => {
    expect(
      pathsOf(createQuizVideoRequestSchema, {
        items: [{ ...question, correctIndex: 2 }],
      }),
    ).toContain('items.0.correctIndex');
  });

  it('lets a comment carry no answers', () => {
    const parsed = createQuizVideoRequestSchema.parse({
      items: [{ type: 'comment', text: 'welcome' }, question],
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.template).toBe('standard');
    expect(parsed.generateBackgroundImage).toBe(false);
  });

  it('requires {{answer}} in the answer template', () => {
    expect(
      pathsOf(createQuizVideoRequestSchema, {
        items: [question],
        answerTemplate: 'The answer is',
      }),
    ).toContain('answerTemplate');
    expect(
      createQuizVideoRequestSchema.safeParse({
        items: [question],
        answerTemplate: 'The answer is {{answer}}',
      }).success,
    ).toBe(true);
  });

  it(`caps the item list at ${MAX_QUIZ_ITEMS}`, () => {
    const items = Array.from({ length: MAX_QUIZ_ITEMS + 1 }, () => question);
    expect(pathsOf(createQuizVideoRequestSchema, { items })).toContain('items');
    expect(
      createQuizVideoRequestSchema.safeParse({ items: items.slice(0, MAX_QUIZ_ITEMS) })
        .success,
    ).toBe(true);
  });

  it('accepts the recovered quiz image styles', () => {
    expect(QUIZ_IMAGE_STYLES).toHaveLength(9);
    for (const imageStyle of QUIZ_IMAGE_STYLES) {
      expect(
        createQuizVideoRequestSchema.safeParse({ items: [question], imageStyle }).success,
      ).toBe(true);
    }
  });
});

describe('fake text', () => {
  const conversation = {
    template: 'whatsapp',
    characters: [
      { id: 'a', name: 'Arun', side: 'left' },
      { id: 'b', name: 'Bala', side: 'right' },
    ],
    messages: [{ text: 'hi' }, { text: 'vanakkam', characterId: 'b' }],
  };

  it('parses a minimal conversation and applies defaults', () => {
    const parsed = createFakeTextVideoRequestSchema.parse({
      conversations: [conversation],
    });
    expect(parsed.conversations[0]?.language).toBe('en');
    expect(parsed.conversations[0]?.autoSplit).toBe(false);
    expect(parsed.conversations[0]?.useVoiceV2).toBe(false);
  });

  it('rejects a message from an unknown character', () => {
    expect(
      pathsOf(createFakeTextVideoRequestSchema, {
        conversations: [
          { ...conversation, messages: [{ text: 'hi', characterId: 'ghost' }] },
        ],
      }),
    ).toContain('conversations.0.messages.0.characterId');
  });

  it(`caps the total messages at ${MAX_FAKE_TEXT_MESSAGES}`, () => {
    const messages = Array.from({ length: MAX_FAKE_TEXT_MESSAGES + 1 }, () => ({
      text: 'hi',
    }));
    expect(
      pathsOf(createFakeTextVideoRequestSchema, {
        conversations: [{ ...conversation, messages }],
      }),
    ).toContain('conversations');
  });

  it('rejects a skin that is not one of the nine', () => {
    expect(
      pathsOf(createFakeTextVideoRequestSchema, {
        conversations: [{ ...conversation, template: 'blackberry' }],
      }),
    ).toContain('conversations.0.template');
  });

  it('screenshot reuses the same conversation shape', () => {
    expect(
      fakeTextScreenshotRequestSchema.safeParse({ conversation }).success,
    ).toBe(true);
    expect(fakeTextScreenshotRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('roblox', () => {
  it('applies the recovered defaults and rejects an impossible pitch', () => {
    const parsed = createRobloxVideoRequestSchema.parse({ script: 'rant' });
    expect(parsed.voicePitch).toBe(140);
    expect(parsed.captionWordLimit).toBe(6);
    expect(parsed.autoAddEmoji).toBe(true);

    for (const voicePitch of [49, 181]) {
      expect(
        createRobloxVideoRequestSchema.safeParse({ script: 'rant', voicePitch }).success,
      ).toBe(false);
    }
    for (const captionWordLimit of [0, 11]) {
      expect(
        createRobloxVideoRequestSchema.safeParse({ script: 'rant', captionWordLimit })
          .success,
      ).toBe(false);
    }
  });
});

describe('caption video', () => {
  it('accepts a video URL and rejects a document', () => {
    expect(
      createCaptionVideoRequestSchema.safeParse({
        url: 'https://cdn.example.com/talk.mp4',
        templateId: -1,
      }).success,
    ).toBe(true);
    expect(
      createCaptionVideoRequestSchema.safeParse({
        url: 'https://cdn.example.com/talk.pdf',
      }).success,
    ).toBe(false);
  });

  it('validates the multipart fields with the same schema as the JSON body', () => {
    const parsed = captionVideoMetaSchema.parse({ render: {} });
    expect(parsed.render).toEqual({ resolution: 1080, frameRate: 30, format: 'standard' });
  });
});

describe('standalone TTS', () => {
  it('keeps the recovered stability default and caps the text', () => {
    const parsed = textToSpeechRequestSchema.parse({ text: 'vanakkam' });
    expect(parsed.voiceStyle.stability).toBe(38);

    expect(textToSpeechRequestSchema.safeParse({ text: '' }).success).toBe(false);
    expect(
      textToSpeechRequestSchema.safeParse({ text: 'a'.repeat(5_001) }).success,
    ).toBe(false);
  });
});

describe('other requests', () => {
  it('render request fills the export defaults', () => {
    expect(renderRequestSchema.parse({})).toEqual({
      resolution: 1080,
      frameRate: 30,
      format: 'standard',
    });
    expect(renderRequestSchema.safeParse({ frameRate: 24 }).success).toBe(false);
  });

  it('commentary is a thin preset with captions on', () => {
    const parsed = createCommentaryVideoRequestSchema.parse({
      text: 'comment',
      artStyleId: ART_STYLE,
    });
    expect(parsed.size).toBe('portrait');
    expect(parsed.captions).toBe(true);
    expect(parsed.text).toBe('comment');
  });
});
