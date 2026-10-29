/**
 * Shared primitives, enums and limits.
 *
 * Everything here is a *public contract*: the same schema validates the HTTP
 * request, the MCP tool arguments and the row written to Postgres. If a field
 * is not defined here it does not exist (see AGENTS.md).
 *
 * Source of truth: docs/01-product-spec.md §3–§9 and docs/02 §3.2. Enumerations
 * recovered from the shipped client are marked `[P]`; our own additions are
 * marked `[+]`.
 */

import { z } from 'zod';

// --- ids and time -----------------------------------------------------------

/** API-generated identity. Clients never choose an id. */
export const idSchema = z.uuid();

/**
 * `2026-08-05T09:20:11.000Z` — UTC. Offsets are accepted too, because the
 * Python service emits `datetime.isoformat()` (`+00:00`, microseconds).
 */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** `#RRGGBB`, used by caption styles. */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'expected #RRGGBB');

// --- urls -------------------------------------------------------------------

/** Absolute https URL. `http://` is rejected everywhere a user supplies one. */
export const httpsUrlSchema = z
  .url()
  .refine((value) => value.startsWith('https://'), 'must be an https:// URL');

/**
 * A public asset reference: absolute URL, or a path served by this instance
 * (`/audio/voices/...`). Voices and styles use the path form in self-host mode.
 */
export const urlOrPathSchema = z.union([
  z.url(),
  z.string().startsWith('/').min(2),
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  return (
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host === '[::1]'
  );
}

/**
 * Webhook target. HTTPS only and no loopback: a webhook that points at
 * ourselves is an SSRF primitive, not a callback. Private ranges are blocked
 * again at delivery time (DNS can change between create and send).
 */
export const webhookUrlSchema = httpsUrlSchema.superRefine((value, ctx) => {
  const host = new URL(value).hostname;
  if (isLoopbackHost(host)) {
    ctx.addIssue({
      code: 'custom',
      message: 'webhookUrl must not point at localhost',
    });
  }
});

/** JSON endpoints the API returns, e.g. `editorUrl`. */
export const editorUrlSchema = z.url();

// --- pipeline vocabulary (public contract, do not rename) --------------------

export const VIDEO_STATUS = [
  'processing',
  'rendering',
  'completed',
  'failed',
] as const;
export const videoStatusSchema = z.enum(VIDEO_STATUS);
export type VideoStatus = z.infer<typeof videoStatusSchema>;

/**
 * Step ids and their order. `render` is last and only runs when a render was
 * requested. Mirrors docs/04 §1 and services/media's caller contract.
 */
export const VIDEO_STEPS = [
  'create-scenes',
  'create-vocal',
  'create-images',
  'create-captions',
  'render',
] as const;
export const videoStepSchema = z.enum(VIDEO_STEPS);
export type VideoStep = z.infer<typeof videoStepSchema>;

export const videoKindSchema = z.enum([
  'ai-video-v3',
  'ai-video',
  'quiz',
  'fake-text',
  'roblox',
  'caption',
  'commentary',
]);
export type VideoKind = z.infer<typeof videoKindSchema>;

// --- create-request vocabulary ----------------------------------------------

export const sizeSchema = z.enum(['landscape', 'portrait']);
export type Size = z.infer<typeof sizeSchema>;

/** `slow` is 10% cheaper with a longer deadline (parity taste). */
export const speedSchema = z.enum(['slow', 'standard']);

/** `[P]` 16 fixed V2 styles, recovered from the client. */
export const IMAGE_STYLES = [
  'CREEPY_COMIC',
  '90s_DISNEY',
  'STUDIO_GHIBLI',
  'ADULT_CARTOON',
  'SIMPSONS',
  'CINEMATIC',
  'CUTE_ANIME',
  'ULTRA_REALISM',
  'DARK_COMIC',
  'B&W_COMIC',
  'COMIC',
  'SATIRICAL_2D',
  'PIXAR',
  '18TH_CENTURY_HISTORICAL',
  'POLISHED_CARTOON',
  'COMIC_REALISM',
] as const;
export const imageStyleSchema = z.enum(IMAGE_STYLES);
export type ImageStyle = z.infer<typeof imageStyleSchema>;

/** `[P]` Quiz style list is a different, smaller set than V2. */
export const QUIZ_IMAGE_STYLES = [
  'CINEMATIC',
  'ANIME',
  '3D',
  'CINEMATIC_DARK',
  'ANIME_DARK',
  'COMIC',
  'CARTOON',
  'PUNK',
  'PSY',
] as const;
export const quizImageStyleSchema = z.enum(QUIZ_IMAGE_STYLES);

export const transitionSchema = z.enum(['smooth', 'strong-swipe']);

/** `[P]` Nine chat skins, recovered from the client. */
export const FAKE_TEXT_TEMPLATES = [
  'iphone',
  'iphone-dark',
  'whatsapp',
  'whatsapp-dark',
  'instagram',
  'instagram-dark',
  'tinder',
  'tinder-dark',
  'cantina',
] as const;
export const fakeTextTemplateSchema = z.enum(FAKE_TEXT_TEMPLATES);

export const quizTemplateSchema = z.enum(['standard', 'multi-levels']);

/**
 * Narration language. `auto` is ours: it lets one script mix Tamil, English
 * and Tanglish and derives the voice plan automatically.
 */
export const narrationLanguageSchema = z.enum(['en', 'ta', 'auto']);
export type NarrationLanguage = z.infer<typeof narrationLanguageSchema>;

// --- voices / styles --------------------------------------------------------

/**
 * Engine voice ids across every adapter we ship: edge-tts
 * (`ta-IN-PallaviNeural`), IndicF5 (`indicf5-ta`), Piper (`piper-offline`).
 * The pattern is deliberately looser than the media service's edge-only regex.
 */
export const voiceIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/, 'invalid voice id');

// --- render / export --------------------------------------------------------

export const renderFormatSchema = z.enum(['standard', 'greenscreen']);
export type RenderFormat = z.infer<typeof renderFormatSchema>;

export const frameRateSchema = z.union([z.literal(30), z.literal(60)]);
export type FrameRate = z.infer<typeof frameRateSchema>;

/**
 * Vertical pixels. 1080p / 2K / 4K. Kept as numbers because both the render
 * spec and `Plan.maxResolution` compare them numerically.
 */
export const RESOLUTIONS = [1080, 1440, 2160] as const;
export const resolutionSchema = z.union([
  z.literal(1080),
  z.literal(1440),
  z.literal(2160),
]);
export type Resolution = z.infer<typeof resolutionSchema>;

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export const aspectRatioSchema = z.enum(ASPECT_RATIOS);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const captionExportFormatSchema = z.enum(['srt', 'vtt', 'ass', 'json']);

// --- workspace / credits ----------------------------------------------------

export const MEMBER_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const planIdSchema = z.enum([
  'free',
  'pro',
  'premium',
  'premium_plus',
  'max',
  /** Dev / self-host: unlimited credits, ledger still records unit costs. */
  'selfhost',
]);
export type PlanId = z.infer<typeof planIdSchema>;

// --- ledger / artifacts -----------------------------------------------------

/**
 * What a credit row paid for. Values come from docs/04: `plan` is the
 * (zero-cost) scene planner, recorded so a video's cost is explainable.
 */
export const creditActionSchema = z.enum([
  'plan',
  'tts',
  'image',
  'subtitles',
  'render',
]);
export type CreditAction = z.infer<typeof creditActionSchema>;

export const balanceKindSchema = z.enum(['topup', 'charge', 'refund']);
export type BalanceKind = z.infer<typeof balanceKindSchema>;

export const artStyleStatusSchema = z.enum(['building', 'ready', 'failed']);
export type ArtStyleStatus = z.infer<typeof artStyleStatusSchema>;

export const assetKindSchema = z.enum([
  'image',
  'gif',
  'video',
  'audio',
  'caption',
  'render',
  'thumbnail',
  'style-preview',
  'upload',
]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const renderStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
]);
export type RenderStatus = z.infer<typeof renderStatusSchema>;

export const engineSchema = z.enum(['edge', 'indicf5', 'piper']);
export type Engine = z.infer<typeof engineSchema>;

/** Negative ids are built-in caption templates (parity); 0 does not exist. */
export const captionTemplateIdSchema = z
  .int()
  .refine((value) => value !== 0, 'captionTemplateId 0 does not exist');

// --- limits (one place, imported by api, worker and web) --------------------

/** Absolute script ceiling, any template. docs/03 §7. */
export const MAX_SCRIPT_CHARS = 50_000;
/** V3 per aspect; docs/01 §3.1. */
export const MAX_V3_LANDSCAPE_CHARS = 30_000;
export const MAX_V3_PORTRAIT_CHARS = 4_000;
/** V2 script ceiling; docs/01 §3.2. */
export const MAX_V2_SCRIPT_CHARS = 10_000;
/** Roblox rant; docs/01 §3.5. */
export const MAX_ROBLOX_SCRIPT_CHARS = 5_000;
export const MAX_QUIZ_ITEMS = 100;
export const MAX_QUIZ_TEXT_CHARS = 400;
export const MAX_FAKE_TEXT_MESSAGES = 1_000;
export const MAX_VIDEO_MINUTES = 30;
export const MAX_SCENES = 120;
export const MAX_TTS_CHARS = 5_000;

export const MAX_VOICEOVER_BYTES = 200 * 1024 * 1024;
export const MAX_CAPTION_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_CAPTION_VIDEO_SECONDS = 2 * 60 * 60;

/** Accepted containers for `voiceoverUrl` and uploaded caption videos. */
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'] as const;
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv'] as const;
