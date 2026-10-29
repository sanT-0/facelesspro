/**
 * Create-request bodies, one schema per template (docs/01 §3).
 *
 * Every schema is strict: an unknown key is an `invalid_request`, not silently
 * dropped. That is how "if a field is not in a schema it does not exist" stays
 * true across api, web, mcp and worker.
 *
 * Cross-field rules that need the database (does the style support this size?)
 * are enforced in the handler, not here. Rules that are pure shape — script
 * length by aspect, exactly one of script/voiceover, answer index bounds — live
 * here so every front door fails identically.
 */

import { z } from 'zod';

import {
  AUDIO_EXTENSIONS,
  MAX_FAKE_TEXT_MESSAGES,
  MAX_QUIZ_ITEMS,
  MAX_QUIZ_TEXT_CHARS,
  MAX_ROBLOX_SCRIPT_CHARS,
  MAX_SCRIPT_CHARS,
  MAX_TTS_CHARS,
  MAX_V2_SCRIPT_CHARS,
  MAX_V3_LANDSCAPE_CHARS,
  MAX_V3_PORTRAIT_CHARS,
  VIDEO_EXTENSIONS,
  aspectRatioSchema,
  captionTemplateIdSchema,
  fakeTextTemplateSchema,
  frameRateSchema,
  httpsUrlSchema,
  imageStyleSchema,
  narrationLanguageSchema,
  quizImageStyleSchema,
  quizTemplateSchema,
  renderFormatSchema,
  resolutionSchema,
  sizeSchema,
  speedSchema,
  transitionSchema,
  voiceIdSchema,
  webhookUrlSchema,
} from './common';

// --- shared pieces ----------------------------------------------------------

/**
 * `[P]` Defaults are the recovered ones: V3 is the artwork-first template
 * (stability 50, style 0), V2 is more animated (stability 38, style 50).
 */
export const VOICE_STYLE_V3 = {
  stability: 50,
  similarityBoost: 75,
  style: 0,
  speed: 100,
} as const;

export const VOICE_STYLE_V2 = {
  stability: 38,
  similarityBoost: 75,
  style: 50,
  speed: 100,
} as const;

const voiceStyleFields = {
  stability: z.number().min(0).max(100).default(50),
  similarityBoost: z.number().min(0).max(100).default(75),
  style: z.number().min(0).max(100).default(0),
  /** Percentage of normal speaking rate. */
  speed: z.number().min(50).max(200).default(100),
};

export const voiceStyleSchema = z.strictObject(voiceStyleFields);
export type VoiceStyle = z.infer<typeof voiceStyleSchema>;

export const voiceStyleV2Schema = z.strictObject({
  ...voiceStyleFields,
  stability: z.number().min(0).max(100).default(38),
  style: z.number().min(0).max(100).default(50),
});

/** `{}` means "render with the defaults", so every field has one. */
export const renderOptionsSchema = z.strictObject({
  resolution: resolutionSchema.default(1080),
  frameRate: frameRateSchema.default(30),
  format: renderFormatSchema.default('standard'),
});
export type RenderOptions = z.infer<typeof renderOptionsSchema>;

/** `POST /v1/videos/:id/render` body. */
export const renderRequestSchema = z.strictObject({
  resolution: resolutionSchema.default(1080),
  frameRate: frameRateSchema.default(30),
  format: renderFormatSchema.default('standard'),
  webhookUrl: webhookUrlSchema.optional(),
});
export type RenderRequest = z.output<typeof renderRequestSchema>;

/** Negative ids are built-in templates (parity); 0 is never a valid id. */
function extensionOf(url: string): string | null {
  const path = new URL(url).pathname.toLowerCase();
  const dot = path.lastIndexOf('.');
  return dot === -1 ? null : path.slice(dot + 1);
}

function hasExtension(url: string, allowed: readonly string[]): boolean {
  const extension = extensionOf(url);
  return extension !== null && allowed.includes(extension);
}

const audioUrlSchema = httpsUrlSchema.refine(
  (value) => hasExtension(value, AUDIO_EXTENSIONS),
  `voiceoverUrl must end in ${AUDIO_EXTENSIONS.join('/')}`,
);

export const captionVideoUrlSchema = httpsUrlSchema.refine(
  (value) => hasExtension(value, VIDEO_EXTENSIONS),
  `url must end in ${VIDEO_EXTENSIONS.join('/')}`,
);

// --- §3.1 AI Video V3 -------------------------------------------------------

const v3Base = {
  artStyleId: z.uuid(),
  script: z.string().min(1).max(MAX_V3_LANDSCAPE_CHARS).optional(),
  voiceoverUrl: audioUrlSchema.optional(),
  size: sizeSchema.default('landscape'),
  speed: speedSchema.default('standard'),
  voiceId: voiceIdSchema.optional(),
  voiceStyle: voiceStyleSchema.default(VOICE_STYLE_V3),
  /** Artwork-first template: captions off unless asked for. */
  captions: z.boolean().default(false),
  captionTemplateId: captionTemplateIdSchema.optional(),
  render: renderOptionsSchema.optional(),
  webhookUrl: webhookUrlSchema.optional(),
};

export const createAiVideoV3RequestSchema = z
  .strictObject(v3Base)
  .superRefine((value, ctx) => {
    const hasScript = value.script !== undefined;
    const hasVoiceover = value.voiceoverUrl !== undefined;
    if (hasScript === hasVoiceover) {
      ctx.addIssue({
        code: 'custom',
        path: [hasScript ? 'voiceoverUrl' : 'script'],
        message: 'provide exactly one of script or voiceoverUrl',
      });
    }
    if (value.script !== undefined) {
      const limit =
        value.size === 'portrait' ? MAX_V3_PORTRAIT_CHARS : MAX_V3_LANDSCAPE_CHARS;
      if (value.script.length > limit) {
        ctx.addIssue({
          code: 'custom',
          path: ['script'],
          message: `script must be at most ${limit} characters for ${value.size}`,
        });
      }
    }
  });
export type CreateAiVideoV3Request = z.input<typeof createAiVideoV3RequestSchema>;
export type CreateAiVideoV3RequestParsed = z.output<
  typeof createAiVideoV3RequestSchema
>;

// --- §3.2 AI Video V2 -------------------------------------------------------

export const createAiVideoRequestSchema = z.strictObject({
  script: z.string().min(1).max(MAX_V2_SCRIPT_CHARS),
  imageStyle: imageStyleSchema.default('CREEPY_COMIC'),
  size: sizeSchema.default('portrait'),
  transition: transitionSchema.default('smooth'),
  voiceId: voiceIdSchema.optional(),
  voiceStyle: voiceStyleV2Schema.default(VOICE_STYLE_V2),
  render: renderOptionsSchema.optional(),
  webhookUrl: webhookUrlSchema.optional(),
});
export type CreateAiVideoRequest = z.input<typeof createAiVideoRequestSchema>;
export type CreateAiVideoRequestParsed = z.output<typeof createAiVideoRequestSchema>;

// --- §3.3 Quiz --------------------------------------------------------------

export const quizItemSchema = z
  .strictObject({
    type: z.enum(['question', 'comment']).default('question'),
    text: z.string().min(1).max(MAX_QUIZ_TEXT_CHARS),
    answers: z.array(z.string().min(1).max(MAX_QUIZ_TEXT_CHARS)).default([]),
    correctIndex: z.int().min(0).optional(),
    imagePrompt: z.string().min(1).optional(),
  })
  .superRefine((item, ctx) => {
    if (item.type === 'comment') return;
    if (item.answers.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['answers'],
        message: 'a question needs at least one answer',
      });
      return;
    }
    if (item.correctIndex === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['correctIndex'],
        message: 'a question needs correctIndex',
      });
      return;
    }
    if (item.correctIndex >= item.answers.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['correctIndex'],
        message: 'correctIndex is out of range',
      });
    }
  });
export type QuizItem = z.output<typeof quizItemSchema>;

export const createQuizVideoRequestSchema = z.strictObject({
  items: z.array(quizItemSchema).min(1).max(MAX_QUIZ_ITEMS),
  template: quizTemplateSchema.default('standard'),
  language: narrationLanguageSchema.optional(),
  voiceId: voiceIdSchema.optional(),
  /**
   * Narration-only; on-screen text is unaffected. `{{answer}}` is required
   * because without it the answer is never spoken.
   */
  answerTemplate: z
    .string()
    .min(1)
    .refine((value) => value.includes('{{answer}}'), 'answerTemplate needs {{answer}}')
    .optional(),
  generateBackgroundImage: z.boolean().default(false),
  backgroundImagePrompt: z.string().min(1).optional(),
  generateQuestionImage: z.boolean().default(false),
  imageStyle: quizImageStyleSchema.optional(),
  render: renderOptionsSchema.optional(),
  webhookUrl: webhookUrlSchema.optional(),
});
export type CreateQuizVideoRequest = z.input<typeof createQuizVideoRequestSchema>;
export type CreateQuizVideoRequestParsed = z.output<
  typeof createQuizVideoRequestSchema
>;

// --- §3.4 Fake text ---------------------------------------------------------

/**
 * `messages[]` is the one shape the shipped client did not expose in the
 * bundles we analysed. We model the minimum the renderer needs — text plus an
 * optional speaker — and record the gap in docs/PROGRESS rather than pretend
 * to know fields we never observed.
 */
export const chatCharacterSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  side: z.enum(['left', 'right']),
  voiceId: voiceIdSchema.optional(),
});
export type ChatCharacter = z.infer<typeof chatCharacterSchema>;

export const chatMessageSchema = z.strictObject({
  text: z.string().min(1).max(2_000),
  characterId: z.string().min(1).max(64).optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const fakeTextConversationSchema = z
  .strictObject({
    template: fakeTextTemplateSchema,
    language: narrationLanguageSchema.default('en'),
    characters: z.array(chatCharacterSchema).min(1).max(10),
    messages: z.array(chatMessageSchema).min(1),
    autoSplit: z.boolean().default(false),
    groupName: z.string().min(1).max(120).optional(),
    groupPhoto: httpsUrlSchema.optional(),
    /** Tinder skins only; ignored by the others. */
    tinderMatch: z.boolean().default(false),
    useVoiceV2: z.boolean().default(false),
  })
  .superRefine((conversation, ctx) => {
    const ids = new Set(conversation.characters.map((character) => character.id));
    conversation.messages.forEach((message, index) => {
      if (message.characterId !== undefined && !ids.has(message.characterId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['messages', index, 'characterId'],
          message: 'unknown characterId',
        });
      }
    });
  });
export type FakeTextConversation = z.output<typeof fakeTextConversationSchema>;

export const createFakeTextVideoRequestSchema = z
  .strictObject({
    conversations: z.array(fakeTextConversationSchema).min(1),
    backgroundVideoId: z.string().min(1).optional(),
    backgroundVideoStartFrom: z.number().min(0).optional(),
    render: renderOptionsSchema.optional(),
    webhookUrl: webhookUrlSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const total = value.conversations.reduce(
      (sum, conversation) => sum + conversation.messages.length,
      0,
    );
    if (total > MAX_FAKE_TEXT_MESSAGES) {
      ctx.addIssue({
        code: 'custom',
        path: ['conversations'],
        message: `at most ${MAX_FAKE_TEXT_MESSAGES} messages across all conversations`,
      });
    }
  });
export type CreateFakeTextVideoRequest = z.input<
  typeof createFakeTextVideoRequestSchema
>;

// --- §3.5 Roblox rant -------------------------------------------------------

export const createRobloxVideoRequestSchema = z.strictObject({
  script: z.string().min(1).max(MAX_ROBLOX_SCRIPT_CHARS),
  voiceId: voiceIdSchema.optional(),
  /** Engine pitch, 50–180. Default matches the shipped client. */
  voicePitch: z.number().min(50).max(180).default(140),
  captionWordLimit: z.int().min(1).max(10).default(6),
  autoAddEmoji: z.boolean().default(true),
  backgroundVideoId: z.string().min(1).optional(),
  backgroundVideoStartFrom: z.number().min(0).optional(),
  render: renderOptionsSchema.optional(),
  webhookUrl: webhookUrlSchema.optional(),
});
export type CreateRobloxVideoRequest = z.input<
  typeof createRobloxVideoRequestSchema
>;

// --- §3.6 Caption video -----------------------------------------------------

/**
 * The JSON half of `POST /v1/caption-videos`. The multipart form posts the file
 * plus these fields as strings; the api layer parses them with this schema
 * after JSON-decoding the `render` field. Keeping the shape here means a JSON
 * `url` call and a multipart call validate identically.
 */
export const captionVideoMetaSchema = z.strictObject({
  templateId: captionTemplateIdSchema.optional(),
  render: renderOptionsSchema.optional(),
  webhookUrl: webhookUrlSchema.optional(),
});
export type CaptionVideoMeta = z.output<typeof captionVideoMetaSchema>;

export const createCaptionVideoRequestSchema = captionVideoMetaSchema.extend({
  url: captionVideoUrlSchema,
});
export type CreateCaptionVideoRequest = z.input<
  typeof createCaptionVideoRequestSchema
>;

// --- §3.7 Commentary (our preset, not parity-critical) ----------------------

/** A thin preset over V3: background + comment text + voice. */
export const createCommentaryVideoRequestSchema = z.strictObject({
  text: z.string().min(1).max(MAX_V3_LANDSCAPE_CHARS),
  artStyleId: z.uuid(),
  size: sizeSchema.default('portrait'),
  voiceId: voiceIdSchema.optional(),
  voiceStyle: voiceStyleSchema.default(VOICE_STYLE_V3),
  captions: z.boolean().default(true),
  captionTemplateId: captionTemplateIdSchema.optional(),
  render: renderOptionsSchema.optional(),
  webhookUrl: webhookUrlSchema.optional(),
});
export type CreateCommentaryVideoRequest = z.input<
  typeof createCommentaryVideoRequestSchema
>;

// --- §2.1 stand-alone TTS and screenshot ------------------------------------

export const textToSpeechRequestSchema = z.strictObject({
  text: z.string().min(1).max(MAX_TTS_CHARS),
  voiceId: voiceIdSchema.optional(),
  voiceStyle: voiceStyleV2Schema.default(VOICE_STYLE_V2),
});
export type TextToSpeechRequest = z.output<typeof textToSpeechRequestSchema>;

export const fakeTextScreenshotRequestSchema = z.strictObject({
  conversation: fakeTextConversationSchema,
});
export type FakeTextScreenshotRequest = z.input<
  typeof fakeTextScreenshotRequestSchema
>;

// --- §2.4 dry-run plan ------------------------------------------------------

/**
 * `POST /v1/videos/plan` — a pure estimate, not a creation: no video row, no
 * charge, no model call. `size` only applies the script ceiling that creation
 * would apply, so a script that cannot be created is not "plannable" either.
 */
export const planVideoRequestSchema = z
  .strictObject({
    script: z.string().min(1).max(MAX_SCRIPT_CHARS),
    size: sizeSchema.default('landscape'),
  })
  .superRefine((value, ctx) => {
    const limit = value.size === 'portrait' ? MAX_V3_PORTRAIT_CHARS : MAX_V3_LANDSCAPE_CHARS;
    if (value.script.length > limit) {
      ctx.addIssue({
        code: 'custom',
        path: ['script'],
        message: `script must be at most ${limit} characters for ${value.size}`,
      });
    }
    if (value.script.trim().length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['script'],
        message: 'script must not be blank',
      });
    }
  });
export type PlanVideoRequest = z.input<typeof planVideoRequestSchema>;
export type PlanVideoRequestParsed = z.output<typeof planVideoRequestSchema>;

// --- §3.8 Art Style (multipart upload) -------------------------------------------

/**
 * The JSON half of `POST /v1/art-styles`. The multipart form posts the file
 * plus these fields as strings; the api layer parses them with this schema
 * after JSON-decoding the `formats` field. Keeping the shape here means a JSON
 * `url` call and a multipart call validate identically (future-proofing).
 */
export const artStyleMetaSchema = z.strictObject({
  name: z.string().min(1).max(128).optional(),
  formats: z.array(sizeSchema).min(1).max(2).default(['landscape']),
  published: z.boolean().default(false),
});
export type ArtStyleMeta = z.output<typeof artStyleMetaSchema>;

/** Multipart request: `file` (required) + the meta fields above. */
export const createArtStyleRequestSchema = artStyleMetaSchema.extend({
  /** The reference video file. Validated by the handler with ffprobe. */
  file: z.instanceof(File).optional(),
});
export type CreateArtStyleRequest = z.input<typeof createArtStyleRequestSchema>;

// --- internal render spec ---------------------------------------------------

/**
 * What the render service receives. Not an HTTP body: `aspect` is derived from
 * the video's `size`, so a client can never request a contradictory pair.
 */
export const renderSpecSchema = z.strictObject({
  videoId: z.uuid(),
  resolution: resolutionSchema,
  fps: frameRateSchema,
  format: renderFormatSchema,
  aspect: aspectRatioSchema,
});
export type RenderSpec = z.infer<typeof renderSpecSchema>;

export function aspectForSize(size: z.infer<typeof sizeSchema>): z.infer<
  typeof aspectRatioSchema
> {
  return size === 'portrait' ? '9:16' : '16:9';
}
