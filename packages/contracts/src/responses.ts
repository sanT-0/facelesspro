/**
 * Response bodies (docs/01 §3–§9, docs/07 §2).
 *
 * A webhook body contains the same `video` object as `GET /v1/videos/:id`, so
 * there is exactly one video schema here and the webhook module reuses it.
 * That is the parity rule and it is also the only way the two can never drift.
 */

import { z } from 'zod';

import {
  artStyleStatusSchema,
  assetKindSchema,
  balanceKindSchema,
  creditActionSchema,
  engineSchema,
  frameRateSchema,
  hexColorSchema,
  idSchema,
  isoDateTimeSchema,
  MAX_SCENES,
  planIdSchema,
  renderFormatSchema,
  renderStatusSchema,
  resolutionSchema,
  sizeSchema,
  videoKindSchema,
  videoStatusSchema,
  videoStepSchema,
  voiceIdSchema,
  urlOrPathSchema,
} from './common';
import { apiErrorBodySchema } from './errors';
import { plannerAdapterSchema } from './planner';
import { styleProfileSchema } from './style-profile';

// --- errors -----------------------------------------------------------------

const nestedErrorSchema = apiErrorBodySchema.shape.error;
export type VideoError = z.infer<typeof nestedErrorSchema>;

// --- create / read ----------------------------------------------------------

/** All create endpoints return this, and only this (docs/07 §2.1). */
export const createVideoResponseSchema = z.strictObject({
  id: idSchema,
  status: z.literal('processing'),
  /** Whether this creation asked for an mp4. */
  render: z.boolean(),
  createdAt: isoDateTimeSchema,
  editorUrl: z.url(),
});
export type CreateVideoResponse = z.infer<typeof createVideoResponseSchema>;

export const sceneResponseSchema = z.strictObject({
  id: idSchema,
  idx: z.int().min(0),
  text: z.string(),
  imageUrl: z.url().optional(),
  /** Composition hints (zoom, pan, seed). Opaque to the client. */
  motion: z.record(z.string(), z.unknown()).optional(),
  startMs: z.int().min(0),
  endMs: z.int().min(0),
});
export type SceneResponse = z.infer<typeof sceneResponseSchema>;

/** `GET /v1/videos/:id` and the `video` key of every webhook (must match). */
export const videoResponseSchema = z.strictObject({
  id: idSchema,
  kind: videoKindSchema,
  status: videoStatusSchema,
  /** Current or last failed step; null once a render completes. */
  step: videoStepSchema.nullable(),
  render: z.boolean(),
  /** Public, unauthenticated, stable once completed (parity). */
  videoUrl: z.url().optional(),
  thumbnailUrl: z.url().optional(),
  durationMs: z.int().min(0).optional(),
  error: nestedErrorSchema.nullable().optional(),
  scenes: z.array(sceneResponseSchema).optional(),
  editorUrl: z.url(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type VideoResponse = z.infer<typeof videoResponseSchema>;

/** A row of `render`: one mp4 variant, not the video itself. */
export const renderResponseSchema = z.strictObject({
  id: idSchema,
  resolution: resolutionSchema,
  fps: frameRateSchema,
  format: renderFormatSchema,
  status: renderStatusSchema,
  url: z.url().optional(),
  createdAt: isoDateTimeSchema,
});
export type RenderResponse = z.infer<typeof renderResponseSchema>;

// --- §2.4 dry-run plan (our addition) ---------------------------------------

/** Languages a script can be estimated in; `mixed` means both voices are used. */
export const PLAN_LANGUAGE_RUNS = ['ta', 'en', 'mixed'] as const;
export const planLanguageRunSchema = z.enum(PLAN_LANGUAGE_RUNS);
export type PlanLanguageRun = z.infer<typeof planLanguageRunSchema>;

export const planLanguageSchema = z.strictObject({
  run: planLanguageRunSchema,
  /** Script words routed to each voice, before number expansion. */
  words: z.strictObject({ ta: z.int().min(0), en: z.int().min(0) }),
});
export type PlanLanguage = z.infer<typeof planLanguageSchema>;

/** One cut in the estimate: no prompt or motion yet, those are P3's. */
export const planScenePreviewSchema = z.strictObject({
  idx: z.int().min(0),
  text: z.string().min(1),
  startMs: z.int().min(0),
  endMs: z.int().min(0),
});
export type PlanScenePreview = z.infer<typeof planScenePreviewSchema>;

/**
 * `POST /v1/videos/plan` — the deterministic estimate, not a stored plan.
 * `adapter` is honest about who cut the scenes: a dry run does not call a model,
 * so it is `heuristic` unless that changes later. There is no `cost` field until
 * pricing lands with P6 (docs/07 §2.4).
 */
export const planVideoResponseSchema = z
  .strictObject({
    scenes: z.array(planScenePreviewSchema).min(1).max(MAX_SCENES),
    sceneCount: z.int().min(1).max(MAX_SCENES),
    totalMs: z.int().min(0),
    language: planLanguageSchema,
    adapter: plannerAdapterSchema,
  })
  .superRefine((value, ctx) => {
    if (value.sceneCount !== value.scenes.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['sceneCount'],
        message: `sceneCount (${value.sceneCount}) must equal scenes.length (${value.scenes.length})`,
      });
    }
    const first = value.scenes[0]!;
    if (first.startMs !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['scenes', 0, 'startMs'],
        message: 'the first scene must start at 0',
      });
    }
    value.scenes.forEach((scene, index) => {
      if (scene.idx !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', index, 'idx'],
          message: `scene idx (${scene.idx}) must equal its position (${index})`,
        });
      }
      if (scene.endMs <= scene.startMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', index, 'endMs'],
          message: 'a scene must end after it starts',
        });
      }
      const previous = value.scenes[index - 1];
      if (previous !== undefined && scene.startMs < previous.endMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', index, 'startMs'],
          message: `scene starts (${scene.startMs}) before the previous end (${previous.endMs})`,
        });
      }
    });
    const last = value.scenes.at(-1)!;
    if (value.totalMs !== last.endMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['totalMs'],
        message: `totalMs (${value.totalMs}) must equal the last scene endMs (${last.endMs})`,
      });
    }
  });
export type PlanVideoResponse = z.infer<typeof planVideoResponseSchema>;

/** `POST /v1/text-to-speech`. */
export const textToSpeechResponseSchema = z.strictObject({
  audioUrl: z.url(),
  durationMs: z.int().min(0),
  voiceId: voiceIdSchema,
});
export type TextToSpeechResponse = z.infer<typeof textToSpeechResponseSchema>;

// --- §4 art styles ----------------------------------------------------------

/** `POST /v1/art-styles` — immediate response while the style builds. */
export const createArtStyleResponseSchema = z.strictObject({
  id: idSchema,
  status: z.literal('building'),
  createdAt: isoDateTimeSchema,
});
export type CreateArtStyleResponse = z.infer<typeof createArtStyleResponseSchema>;

export const artStyleSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  published: z.boolean(),
  formats: z.array(sizeSchema).min(1),
  previewUrl: urlOrPathSchema,
  portraitPreviewUrl: urlOrPathSchema.optional(),
  /**
   * Absolute CDN URL or a `/files/...` path. Both are accepted for the same
   * reason as `previewUrl`: sample clips live in the same storage as previews,
   * and the api should not have to make a public origin mandatory to list a
   * style that was built locally.
   */
  sampleVideoUrls: z.array(urlOrPathSchema),
  status: artStyleStatusSchema,
  createdAt: isoDateTimeSchema,
});
export type ArtStyle = z.infer<typeof artStyleSchema>;

/**
 * `GET /v1/art-styles` omits styles that are still building (parity), and the
 * route also omits `failed` rows, so `status` is always `ready` here. Kept as a
 * field because a later workspace view can surface a failed build.
 */
export const artStyleListSchema = z.strictObject({
  styles: z.array(artStyleSchema),
});
export type ArtStyleList = z.infer<typeof artStyleListSchema>;

/** `GET /v1/art-styles/:id/export` — portable between machines. */
export const artStyleExportSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().min(1),
  formats: z.array(sizeSchema).min(1),
  /** The exact document stored in `art_style.profile`; re-validated on import. */
  profile: styleProfileSchema,
});
export type ArtStyleExport = z.infer<typeof artStyleExportSchema>;

// --- §5 voices --------------------------------------------------------------

export const voiceSchema = z.strictObject({
  id: voiceIdSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  gender: z.string().optional(),
  accent: z.string().optional(),
  age: z.string().optional(),
  useCase: z.string().optional(),
  previewUrl: urlOrPathSchema.optional(),
  /** Capability tags — ours, not parity. */
  languages: z.array(z.string().min(2)),
  mixesEnglish: z.boolean(),
  engine: engineSchema,
  sampleRate: z.int().positive().optional(),
  wordTimings: z.boolean(),
});
export type Voice = z.infer<typeof voiceSchema>;

export const voiceListSchema = z.strictObject({
  voices: z.array(voiceSchema),
});
export type VoiceList = z.infer<typeof voiceListSchema>;

/** A Tamil voice plus the English voice that continues the same speaker. */
export const voicePairSchema = z.strictObject({
  id: z.string().min(1),
  ta: voiceIdSchema,
  en: voiceIdSchema,
  notes: z.string(),
});
export type VoicePair = z.infer<typeof voicePairSchema>;

export const voicePairListSchema = z.strictObject({
  pairs: z.array(voicePairSchema),
});
export type VoicePairList = z.infer<typeof voicePairListSchema>;

// --- §6 captions ------------------------------------------------------------

/**
 * Caption template document. This is our design: the parity contract is only
 * "templates have an id, a name and a spec", plus negative ids for built-ins.
 */
export const captionSpecSchema = z.strictObject({
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
  /** Words shown at once; the renderer breaks lines on grapheme clusters. */
  wordLimit: z.int().min(1).max(10).optional(),
  maxLines: z.int().min(1).max(4).optional(),
  uppercase: z.boolean().optional(),
  emoji: z.boolean().optional(),
  position: z.enum(['top', 'center', 'bottom']).optional(),
  highlightColor: hexColorSchema.optional(),
  outlineColor: hexColorSchema.optional(),
  outlineWidth: z.number().min(0).max(20).optional(),
});
export type CaptionSpec = z.infer<typeof captionSpecSchema>;

export const captionTemplateSchema = z.strictObject({
  id: z.int(),
  name: z.string().min(1),
  spec: captionSpecSchema,
});
export type CaptionTemplate = z.infer<typeof captionTemplateSchema>;

export const captionTemplateListSchema = z.strictObject({
  templates: z.array(captionTemplateSchema),
});
export type CaptionTemplateList = z.infer<typeof captionTemplateListSchema>;

/** One on-screen caption cue. Timings are in the master track's clock. */
export const captionCueSchema = z.strictObject({
  text: z.string(),
  startMs: z.int().min(0),
  endMs: z.int().min(0),
});
export type CaptionCue = z.infer<typeof captionCueSchema>;

// --- §7 export --------------------------------------------------------------

export const exportVariantSchema = z.strictObject({
  resolution: resolutionSchema,
  frameRate: frameRateSchema,
  format: renderFormatSchema,
});
export type ExportVariant = z.infer<typeof exportVariantSchema>;

// --- libraries --------------------------------------------------------------

export const soundEffectSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  url: urlOrPathSchema,
  durationMs: z.int().min(0).optional(),
  tags: z.array(z.string()).optional(),
});
export type SoundEffect = z.infer<typeof soundEffectSchema>;

export const soundEffectListSchema = z.strictObject({
  soundEffects: z.array(soundEffectSchema),
});
export type SoundEffectList = z.infer<typeof soundEffectListSchema>;

export const backgroundVideoSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  url: urlOrPathSchema,
  durationMs: z.int().min(0).optional(),
  thumbnailUrl: urlOrPathSchema.optional(),
  tags: z.array(z.string()).optional(),
});
export type BackgroundVideo = z.infer<typeof backgroundVideoSchema>;

export const backgroundVideoListSchema = z.strictObject({
  backgroundVideos: z.array(backgroundVideoSchema),
});
export type BackgroundVideoList = z.infer<typeof backgroundVideoListSchema>;

/** `POST /v1/files`. */
export const fileUploadResponseSchema = z.strictObject({
  key: z.string().min(1),
  url: z.url(),
  bytes: z.int().min(0),
  mime: z.string().min(1),
});
export type FileUploadResponse = z.infer<typeof fileUploadResponseSchema>;

// --- §8 credits and plans ---------------------------------------------------

/**
 * `creditsPerMonth` and `minutesPerMonth` are `null` when unlimited
 * (`selfhost`). JSON cannot carry `Infinity`, and a client should not have to
 * understand a magic number.
 */
export const planSchema = z.strictObject({
  id: planIdSchema,
  minutesPerMonth: z.number().min(0).nullable(),
  creditsPerMonth: z.number().min(0).nullable(),
  maxVideoMinutes: z.number().min(0),
  maxResolution: resolutionSchema,
  seats: z.int().min(1),
});
export type Plan = z.infer<typeof planSchema>;

export const workspaceSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  plan: planSchema,
  /** `null` = unlimited (selfhost). Paid plans always carry a number. */
  credits: z.number().nullable(),
  owner: z.strictObject({
    id: idSchema,
    email: z.email(),
    name: z.string().min(1),
  }),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const creditLogEntrySchema = z.strictObject({
  id: idSchema,
  videoId: idSchema.optional(),
  action: creditActionSchema,
  units: z.number().min(0),
  /** Credits per unit at the time of the charge. */
  unitCost: z.number().min(0),
  /** Negative for a charge, positive for a refund. */
  delta: z.number(),
  createdAt: isoDateTimeSchema,
});
export type CreditLogEntry = z.infer<typeof creditLogEntrySchema>;

export const creditLogListSchema = z.strictObject({
  logs: z.array(creditLogEntrySchema),
});
export type CreditLogList = z.infer<typeof creditLogListSchema>;

export const balanceLogEntrySchema = z.strictObject({
  id: idSchema,
  kind: balanceKindSchema,
  amountCents: z.int(),
  meta: z.record(z.string(), z.unknown()).optional(),
  createdAt: isoDateTimeSchema,
});
export type BalanceLogEntry = z.infer<typeof balanceLogEntrySchema>;

export const balanceLogListSchema = z.strictObject({
  logs: z.array(balanceLogEntrySchema),
});
export type BalanceLogList = z.infer<typeof balanceLogListSchema>;

// --- assets -----------------------------------------------------------------

export const assetSchema = z.strictObject({
  id: idSchema,
  kind: assetKindSchema,
  key: z.string().min(1),
  url: z.url(),
  bytes: z.int().min(0),
  mime: z.string().min(1),
  createdAt: isoDateTimeSchema,
});
export type Asset = z.infer<typeof assetSchema>;
