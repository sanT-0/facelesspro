/**
 * Persist one scene plan, either from a written script or from an uploaded
 * voiceover (docs/04 §1, §1b).
 *
 * Expensive work — planning, downloading, transcription — happens after
 * `withStep` claims the job and before the commit transaction opens. The
 * transaction contains only the plan, scene rows, (for an upload) the audio
 * asset and narration row, cursor move and next queue insert, so a crash
 * produces all of them or none.
 */

import {
  MAX_SCENES,
  createAiVideoRequestSchema,
  createAiVideoV3RequestSchema,
  createFakeTextVideoRequestSchema,
  createQuizVideoRequestSchema,
  createRobloxVideoRequestSchema,
  narrationPlanSchema,
  scenePlanSchema,
  styleProfileSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type {
  ArtStyleRow,
  ImageStyle,
  SceneMotion,
  ScenePlan,
  Size,
  StyleProfile,
} from '@facelesspro/contracts';
import { normalizeScript } from '@facelesspro/core';
import { asset, findArtStyle, narration, scene, video } from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { StepFailure, withStep } from '@facelesspro/queue';
import type {
  CommitTx,
  StepBody,
  StepDeps,
  StepHandler,
} from '@facelesspro/queue';
import { eq } from 'drizzle-orm';
import { writeFile } from 'node:fs/promises';

import { buildFixedPlan, imagePromptFor, MOTION_CYCLE } from '../planner/heuristic';
import type { FixedSceneSpan } from '../planner/heuristic';
import type { PlanFn, PlanStyle } from '../ports/planner';
import { AsrPortError } from '../ports/asr';
import type { AsrPort, AsrTranscription } from '../ports/asr';
import { PlannerChainError } from '../planner/chain';
import { assertStyleUsable } from '../art-style/usable';
import { withRequiredNegatives } from '../image/negative';
import {
  dataDir,
  ensureParentPath,
  resolveStorageKey,
  storageKey,
} from '../art-style/storage';
import { VoiceoverDownloadError, downloadVoiceover } from '../voiceover/download';
import { v2StyleProfile } from '../v2/style';
import { buildQuizScript } from './quiz-script';
import {
  splitFakeTextConversations,
  buildFakeTextScripts,
} from './fake-text-script';

export type FindStyle = (db: Database, id: string) => Promise<ArtStyleRow | null>;
export type PersistScenePlan = (
  tx: CommitTx,
  videoId: string,
  plan: ScenePlan,
) => Promise<void>;

export interface VoiceoverStoreInput {
  workspaceId: string;
  videoId: string;
  bytes: Uint8Array;
  mime: string;
}

export interface StoredVoiceover {
  key: string;
  bytes: number;
  mime: string;
}

export type StoreVoiceover = (input: VoiceoverStoreInput) => Promise<StoredVoiceover>;

export interface PersistVoiceoverInput {
  videoId: string;
  workspaceId: string;
  plan: ScenePlan;
  transcription: AsrTranscription;
  stored: StoredVoiceover;
}

export type PersistVoiceover = (
  tx: CommitTx,
  input: PersistVoiceoverInput,
) => Promise<void>;

export interface CreateScenesWorkDeps {
  readonly planner: PlanFn;
  /** Required for `voiceoverUrl`; the script branch never touches it. */
  readonly asr?: AsrPort;
  /** Injected in tests; defaults to the guarded HTTPS downloader. */
  readonly downloader?: typeof downloadVoiceover;
  readonly findStyle?: FindStyle;
  readonly persistPlan?: PersistScenePlan;
  readonly persistVoiceover?: PersistVoiceover;
  readonly storeVoiceover?: StoreVoiceover;
}

export interface CreateScenesHandlerDeps extends StepDeps, CreateScenesWorkDeps {}

/** Translate a portable StyleProfile into the planner's three prompt clauses. */
export function planStyleFromProfile(profile: StyleProfile): PlanStyle {
  const negative = withRequiredNegatives(profile.negative);

  return {
    prefix: profile.promptPrefix,
    suffix: [
      `palette ${profile.palette.hex.join(' ')}`,
      `line colour ${profile.line.color}`,
      profile.background,
      profile.composition,
    ].join(', '),
    negative,
  };
}

/** The two create dialects V2 and V3 share once the style is resolved. */
interface NormalizedSceneRequest {
  readonly script?: string;
  readonly voiceoverUrl?: string;
  readonly size: Size;
  readonly style: PlanStyle;
  /** V2 only: `strong-swipe` turns the plan's motion into lateral pans. */
  readonly strongSwipe: boolean;
  /** Pre-computed scenes (used by fake-text to bypass planner scene splitting). */
  readonly plannedScenes?: readonly PlannedScene[];
  /** Internal: fake-text scene data for create-images/create-vocal. */
  readonly _fakeTextScenes?: unknown;
}

/** A pre-planned scene (used by fake-text). */
interface PlannedScene {
  readonly text: string;
  readonly imagePrompt: string;
  readonly motion: SceneMotion;
  readonly emphasis: readonly string[];
  readonly startMs: number;
  readonly endMs: number;
}

/** Extract the script from quiz items using the answer template. */

/** Map quiz image style to V2 preset (fallback to CINEMATIC). */
function mapQuizStyleToV2(quizStyle: string): ImageStyle {
  const v2Styles: readonly ImageStyle[] = [
    'CREEPY_COMIC', '90s_DISNEY', 'STUDIO_GHIBLI', 'ADULT_CARTOON', 'SIMPSONS',
    'CINEMATIC', 'CUTE_ANIME', 'ULTRA_REALISM', 'DARK_COMIC', 'B&W_COMIC',
    'COMIC', 'SATIRICAL_2D', 'PIXAR', '18TH_CENTURY_HISTORICAL', 'POLISHED_CARTOON', 'COMIC_REALISM',
  ];
  const directMatch = v2Styles.find((s) => s === quizStyle);
  if (directMatch) return directMatch;
  // Map similar styles
  if (quizStyle === '3D') return 'ULTRA_REALISM';
  if (quizStyle === 'CINEMATIC_DARK') return 'CINEMATIC';
  if (quizStyle === 'ANIME_DARK') return 'CUTE_ANIME';
  if (quizStyle === 'PUNK') return 'SATIRICAL_2D';
  if (quizStyle === 'PSY') return 'COMIC_REALISM';
  return 'CINEMATIC';
}

/** Build a style profile for quiz from the preset. */
function quizStyleProfile(quizStyle: string | undefined, size: Size): StyleProfile {
  const v2Style = mapQuizStyleToV2(quizStyle ?? 'CINEMATIC');
  return v2StyleProfile(v2Style, size);
}

/**
 * V2's transition is a scene-to-scene instruction, but the renderer's motion is
 * per scene. Until the composer grows real cross-fades, `strong-swipe` is
 * expressed as alternating lateral pans and `smooth` keeps the planner's gentle
 * cycle. This is our interpretation; docs/04 §1 states it plainly.
 */
function applyV2Transition(plan: ScenePlan, strongSwipe: boolean): ScenePlan {
  if (!strongSwipe) return plan;
  return scenePlanSchema.parse({
    ...plan,
    scenes: plan.scenes.map((scene, index) => ({
      ...scene,
      motion: index % 2 === 0 ? 'pan-left' : 'pan-right',
    })),
  });
}

/** Business body exported separately so unit tests need no Postgres or pg-boss. */
export function createCreateScenesWork(deps: CreateScenesWorkDeps): StepBody {
  const lookupStyle = deps.findStyle ?? findArtStyle;
  const persist = deps.persistPlan ?? persistScenePlan;
  const persistUpload = deps.persistVoiceover ?? persistVoiceoverPlan;
  const store = deps.storeVoiceover ?? storeVoiceover;
  const download = deps.downloader ?? downloadVoiceover;

  return async (ctx) => {
    const row = videoRowSchema.safeParse(ctx.video);
    if (!row.success) {
      throw new StepFailure('internal', 'stored video row does not match the video contract', {
        cause: row.error,
      });
    }

    let normalized: NormalizedSceneRequest;
    if (row.data.kind === 'ai-video-v3' && row.data.request.kind === 'ai-video-v3') {
      const request = createAiVideoV3RequestSchema.safeParse(row.data.request.body);
      if (!request.success) {
        throw new StepFailure('internal', 'stored V3 request does not match the request contract', {
          cause: request.error,
        });
      }

      const selectedStyle = await lookupStyle(ctx.db, request.data.artStyleId);
      assertStyleUsable(selectedStyle, row.data.workspace_id, request.data.size);
      const parsedProfile = styleProfileSchema.safeParse(selectedStyle.profile);
      if (!parsedProfile.success) {
        throw new StepFailure('internal', `art style ${selectedStyle.id} has an invalid profile`, {
          cause: parsedProfile.error,
        });
      }

      normalized = {
        ...(request.data.script === undefined ? {} : { script: request.data.script }),
        ...(request.data.voiceoverUrl === undefined
          ? {}
          : { voiceoverUrl: request.data.voiceoverUrl }),
        size: request.data.size,
        style: planStyleFromProfile(parsedProfile.data),
        strongSwipe: false,
      };
    } else if (row.data.kind === 'ai-video' && row.data.request.kind === 'ai-video') {
      const request = createAiVideoRequestSchema.safeParse(row.data.request.body);
      if (!request.success) {
        throw new StepFailure('internal', 'stored V2 request does not match the request contract', {
          cause: request.error,
        });
      }

      const profile = v2StyleProfile(request.data.imageStyle, request.data.size);
      normalized = {
        script: request.data.script,
        size: request.data.size,
        style: planStyleFromProfile(profile),
        strongSwipe: request.data.transition === 'strong-swipe',
      };
    } else if (row.data.kind === 'quiz' && row.data.request.kind === 'quiz') {
      const request = createQuizVideoRequestSchema.safeParse(row.data.request.body);
      if (!request.success) {
        throw new StepFailure('internal', 'stored quiz request does not match the request contract', {
          cause: request.error,
        });
      }

      const body = request.data;
      const profile = quizStyleProfile(body.imageStyle, body.size);
      const quizScript = buildQuizScript(body.items, body.answerTemplate);

      normalized = {
        script: quizScript,
        size: body.size,
        style: planStyleFromProfile(profile),
        strongSwipe: false,
      };
    } else if (row.data.kind === 'fake-text' && row.data.request.kind === 'fake-text') {
      const request = createFakeTextVideoRequestSchema.safeParse(row.data.request.body);
      if (!request.success) {
        throw new StepFailure('internal', 'stored fake-text request does not match the request contract', {
          cause: request.error,
        });
      }

      const body = request.data;

      // Split conversations into scenes (respects autoSplit)
      const sceneDataList = splitFakeTextConversations(body.conversations, body.conversations[0]?.autoSplit ?? false);

      // Build narration scripts for each scene
      const sceneScripts = buildFakeTextScripts(sceneDataList);
      const fullScript = sceneScripts.join(' ');

      // Store per-scene fake-text data in the request body for later steps
      const fakeTextScenes = sceneDataList.map((data) => ({
        template: data.template,
        characters: data.characters,
        messages: data.messages,
        groupName: data.groupName,
        groupPhoto: data.groupPhoto,
        tinderMatch: data.tinderMatch,
      }));

      // Build the scene plan directly with our pre-split scenes.
      // Timings will be re-derived by create-vocal from TTS output.
      // Estimate duration: ~150 words/minute = 2.5 words/sec for English.
      const profile = v2StyleProfile('CINEMATIC', 'portrait');
      const WORDS_PER_SECOND = 2.5;
      let currentTimeMs = 0;
      const plannedScenes = sceneScripts.map((script, index) => {
        const words = script.trim().split(/\s+/).length;
        const estimatedDurationMs = Math.max(1000, Math.round((words / WORDS_PER_SECOND) * 1000));
        const startMs = currentTimeMs;
        const endMs = currentTimeMs + estimatedDurationMs;
        currentTimeMs = endMs;
        return {
          text: script,
          imagePrompt: imagePromptFor(script, planStyleFromProfile(profile)),
          motion: MOTION_CYCLE[index % MOTION_CYCLE.length]!,
          emphasis: [],
          startMs,
          endMs,
        };
      });

      normalized = {
        script: fullScript,
        size: 'portrait',
        style: planStyleFromProfile(profile),
        strongSwipe: false,
        plannedScenes: plannedScenes as NormalizedSceneRequest['plannedScenes'],
      };

      // Attach fake-text scene data to the normalized request for persistence
      (normalized as NormalizedSceneRequest & { _fakeTextScenes?: unknown })._fakeTextScenes = fakeTextScenes;

      // For fake-text, use pre-planned scenes directly (skip planner)
      const plan = {
        scenes: plannedScenes,
        adapter: 'heuristic' as const,
        degradedFrom: [] as ('cloudflare' | 'heuristic' | 'groq' | 'ollama')[],
        totalMs: plannedScenes.at(-1)?.endMs ?? 0,
      };
      const reconstructed = normalizeScript(plan.scenes.map((planned) => planned.text).join(' '));
      if (reconstructed !== normalizeScript(fullScript)) {
        throw new StepFailure(
          'internal',
          'fake-text pre-planned scene text does not reconstruct the normalized script',
        );
      }

      ctx.observe({
        adapter: plan.adapter,
        items: plan.scenes.length,
        degradedFrom: undefined,
      });

      await ctx.transaction(async (tx) => {
        await persist(tx, ctx.videoId, plan);
        // Store fake-text scene data in request body for create-images/create-vocal
        const fakeTextScenes = (normalized as NormalizedSceneRequest & { _fakeTextScenes?: unknown })._fakeTextScenes;
        if (fakeTextScenes !== undefined) {
          const videoRow = await tx.db.select().from(video).where(eq(video.id, ctx.videoId)).limit(1);
          if (videoRow[0]?.request) {
            const currentBody = videoRow[0].request.body as Record<string, unknown>;
            const updatedBody = { ...currentBody, _fakeTextScenes: fakeTextScenes };
            await tx.db.update(video).set({ request: { kind: 'fake-text', body: updatedBody } }).where(eq(video.id, ctx.videoId));
          }
        }
        await tx.advance();
      });
      return;
    } else if (row.data.kind === 'roblox' && row.data.request.kind === 'roblox') {
      const request = createRobloxVideoRequestSchema.safeParse(row.data.request.body);
      if (!request.success) {
        throw new StepFailure('internal', 'stored roblox request does not match the request contract', {
          cause: request.error,
        });
      }

      // A rant is one script over a gameplay background: no art-style row to
      // look up, portrait, and the planner's own motion cycle (a swipe pan
      // would fight the background video). The preset only feeds image prompts;
      // when a background video is supplied the stills stay hidden at render.
      const profile = v2StyleProfile('CINEMATIC', 'portrait');
      normalized = {
        script: request.data.script,
        size: 'portrait',
        style: planStyleFromProfile(profile),
        strongSwipe: false,
      };
    } else {
      throw new StepFailure(
        'internal',
        `create-scenes received an unsupported video kind ${row.data.kind}`,
      );
    }

    const style = normalized.style;

    if (normalized.voiceoverUrl !== undefined) {
      // `createAiVideoV3RequestSchema` guarantees exactly one of the two; the
      // upload path owns everything about the supplied audio, including the
      // narration row `create-vocal` would otherwise have produced.
      const voiceoverUrl = normalized.voiceoverUrl;
      if (deps.asr === undefined) {
        throw new StepFailure(
          'internal',
          'create-scenes cannot process a voiceover without an ASR port',
        );
      }

      const uploaded = await fetchVoiceover(download, voiceoverUrl);
      const transcription = await recognise(deps.asr, uploaded.bytes, uploaded.mime);
      const voiceoverPlan = buildVoiceoverPlan(transcription, style);
      const stored = await storeUploadedAudio(store, {
        workspaceId: row.data.workspace_id,
        videoId: ctx.videoId,
        bytes: uploaded.bytes,
        mime: uploaded.mime,
      });

      ctx.observe({
        adapter: voiceoverPlan.adapter,
        items: voiceoverPlan.scenes.length,
        bytes: stored.bytes,
        degradedFrom:
          voiceoverPlan.degradedFrom.length === 0
            ? undefined
            : voiceoverPlan.degradedFrom.join(','),
      });

      await ctx.transaction(async (tx) => {
        await persistUpload(tx, {
          videoId: ctx.videoId,
          workspaceId: row.data.workspace_id,
          plan: voiceoverPlan,
          transcription,
          stored,
        });
        await tx.advance();
      });
      return;
    }

    const script = normalized.script;
    if (script === undefined) {
      throw new StepFailure('internal', 'create-scenes has neither a script nor a voiceover');
    }

    let candidate: ScenePlan;
    try {
      candidate = await deps.planner.plan({ script, style });
    } catch (error) {
      if (error instanceof PlannerChainError) {
        throw new StepFailure('upstream_failed', error.message, {
          retryable: error.retryable,
          cause: error,
        });
      }
      throw error;
    }

    const parsedPlan = scenePlanSchema.safeParse(candidate);
    if (!parsedPlan.success) {
      throw new StepFailure('upstream_failed', 'planner returned an invalid scene plan', {
        cause: parsedPlan.error,
      });
    }
    const plan = applyV2Transition(parsedPlan.data, normalized.strongSwipe);
    const reconstructed = normalizeScript(
      plan.scenes.map((planned) => planned.text).join(' '),
    );
    if (reconstructed !== normalizeScript(script)) {
      throw new StepFailure(
        'upstream_failed',
        'planner scene text does not reconstruct the normalized script',
      );
    }

    ctx.observe({
      adapter: plan.adapter,
      items: plan.scenes.length,
      degradedFrom:
        plan.degradedFrom.length === 0 ? undefined : plan.degradedFrom.join(','),
    });

    await ctx.transaction(async (tx) => {
      await persist(tx, ctx.videoId, plan);
      // Store fake-text scene data in request body for create-images/create-vocal
      const fakeTextScenes = (normalized as NormalizedSceneRequest & { _fakeTextScenes?: unknown })._fakeTextScenes;
      if (fakeTextScenes !== undefined) {
        const videoRow = await tx.db.select().from(video).where(eq(video.id, ctx.videoId)).limit(1);
        if (videoRow[0]?.request) {
          const currentBody = videoRow[0].request.body as Record<string, unknown>;
          const updatedBody = { ...currentBody, _fakeTextScenes: fakeTextScenes };
          await tx.db.update(video).set({ request: { kind: 'fake-text', body: updatedBody } }).where(eq(video.id, ctx.videoId));
        }
      }
      await tx.advance();
    });
  };
}

/** Queue handler: `withStep` owns locking, failures, idempotency and commit fencing. */
export function createCreateScenesHandler(deps: CreateScenesHandlerDeps): StepHandler {
  const work = createCreateScenesWork(deps);
  return async (job) => {
    await withStep(deps, job.videoId, 'create-scenes', work);
  };
}

/**
 * Turn an ASR answer into a plan whose cuts are the model's sentence
 * boundaries. The gap before a sentence belongs to the scene that just spoke
 * (the same rule `create-vocal` uses), so spans stay contiguous, the first
 * starts at 0 and the last ends on the audio duration.
 */
export function buildVoiceoverPlan(
  transcription: AsrTranscription,
  style: PlanStyle,
): ScenePlan {
  const durationMs = transcriptDurationMs(transcription);
  const segments = transcription.segments
    .map((segment) => ({
      text: segment.text.trim(),
      startMs: segment.startMs,
      endMs: segment.endMs,
    }))
    .filter((segment) => segment.text.length > 0);

  if (segments.length === 0) {
    throw invalidTranscript('transcript has no usable segments');
  }

  let previousStart = -1;
  for (const segment of segments) {
    if (segment.endMs <= segment.startMs) {
      throw invalidTranscript('transcript segment has an empty span');
    }
    if (segment.startMs < previousStart) {
      throw invalidTranscript('transcript segments are not ordered');
    }
    previousStart = segment.startMs;
  }

  const spans: FixedSceneSpan[] = segments.map((segment, index) => ({
    text: segment.text,
    startMs: index === 0 ? 0 : segment.startMs,
    endMs: index + 1 < segments.length ? segments[index + 1]!.startMs : durationMs,
  }));
  for (const span of spans) {
    if (span.endMs <= span.startMs) {
      throw invalidTranscript('two transcript segments start at the same time');
    }
  }

  return buildFixedPlan(mergeToSceneCap(spans, MAX_SCENES), style);
}

/** Words must be ordered and non-overlapping: captions rely on it downstream. */
function transcriptDurationMs(transcription: AsrTranscription): number {
  let previousWordEnd = 0;
  let lastEnd = 0;

  for (const segment of transcription.segments) {
    if (segment.endMs < segment.startMs) {
      throw invalidTranscript('transcript segment ends before it starts');
    }
    lastEnd = Math.max(lastEnd, segment.endMs);
    for (const word of segment.words) {
      if (word.endMs < word.startMs) {
        throw invalidTranscript('transcript word ends before it starts');
      }
      if (word.startMs < previousWordEnd) {
        throw invalidTranscript('transcript word timings overlap');
      }
      previousWordEnd = word.endMs;
      lastEnd = Math.max(lastEnd, word.endMs);
    }
  }

  // The model reports the audio duration; a rounding deficit is closed with the
  // last timed word rather than failing an otherwise usable upload.
  const durationMs = Math.max(transcription.durationMs, lastEnd);
  if (durationMs <= 0) {
    throw invalidTranscript('transcript duration is not positive');
  }
  return durationMs;
}

/**
 * A 30-minute narration can produce more sentences than the plan cap allows.
 * Merge the shortest adjacent pair repeatedly: every remaining cut is still a
 * sentence boundary, and the order is deterministic (ties go to the earliest).
 */
function mergeToSceneCap(
  spans: readonly FixedSceneSpan[],
  cap: number,
): FixedSceneSpan[] {
  const merged = [...spans];
  while (merged.length > cap) {
    let best = 0;
    let bestDuration = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < merged.length; index += 1) {
      const duration = merged[index + 1]!.endMs - merged[index]!.startMs;
      if (duration < bestDuration) {
        best = index;
        bestDuration = duration;
      }
    }
    const left = merged[best]!;
    const right = merged[best + 1]!;
    merged.splice(best, 2, {
      text: `${left.text} ${right.text}`,
      startMs: left.startMs,
      endMs: right.endMs,
    });
  }
  return merged;
}

async function fetchVoiceover(
  download: typeof downloadVoiceover,
  url: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  try {
    const result = await download(url);
    return { bytes: result.bytes, mime: result.mime };
  } catch (error) {
    if (error instanceof VoiceoverDownloadError) {
      throw new StepFailure(error.code, error.message, {
        retryable: error.retryable,
        cause: error,
      });
    }
    throw new StepFailure('upstream_failed', 'voiceover download failed', {
      retryable: true,
      cause: error,
    });
  }
}

async function recognise(
  asr: AsrPort,
  audio: Uint8Array,
  mime: string,
): Promise<AsrTranscription> {
  try {
    return await asr.transcribe({ audio, mime });
  } catch (error) {
    if (error instanceof AsrPortError) {
      const code =
        error.status === 413
          ? 'payload_too_large'
          : error.status !== null && error.status >= 400 && error.status < 500
            ? 'invalid_request'
            : 'upstream_failed';
      throw new StepFailure(code, error.message, {
        retryable: error.retryable,
        cause: error,
      });
    }
    throw new StepFailure('upstream_failed', 'speech-to-text failed', {
      retryable: true,
      cause: error,
    });
  }
}

/**
 * A disk write is infrastructure, not a user error: the same bytes can succeed
 * on the next attempt, and the key is deterministic, so it stays retryable.
 */
async function storeUploadedAudio(
  store: StoreVoiceover,
  input: VoiceoverStoreInput,
): Promise<StoredVoiceover> {
  try {
    return await store(input);
  } catch (error) {
    throw new StepFailure(
      'internal',
      `could not store voiceover: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true, cause: error },
    );
  }
}

function invalidTranscript(message: string): StepFailure {
  return new StepFailure('upstream_failed', `media service ${message}`, {
    retryable: false,
  });
}

/** Deterministic key; the uploaded container decides the extension. */
export function voiceoverKey(
  workspaceId: string,
  videoId: string,
  mime: string,
): string {
  return storageKey(
    'ws',
    workspaceId,
    'videos',
    videoId,
    'audio',
    `narration.${extensionForMime(mime)}`,
  );
}

const AUDIO_EXTENSION: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
};

function extensionForMime(mime: string): string {
  return AUDIO_EXTENSION[mime] ?? 'mp3';
}

export async function storeVoiceover(
  input: VoiceoverStoreInput,
): Promise<StoredVoiceover> {
  const key = voiceoverKey(input.workspaceId, input.videoId, input.mime);
  const path = resolveStorageKey(dataDir(), key);
  await ensureParentPath(path);
  await writeFile(path, input.bytes);
  return { key, bytes: input.bytes.byteLength, mime: input.mime };
}

export async function persistScenePlan(
  tx: CommitTx,
  videoId: string,
  plan: ScenePlan,
): Promise<void> {
  await writePlan(tx, videoId, plan);
}

/** Steps a written script and an upload share: ordered scenes + video plan. */
async function writePlan(
  tx: CommitTx,
  videoId: string,
  plan: ScenePlan,
): Promise<void> {
  await tx.db.insert(scene).values(
    plan.scenes.map((planned, idx) => ({
      video_id: videoId,
      idx,
      text: planned.text,
      motion: { preset: planned.motion, emphasis: planned.emphasis },
      start_ms: planned.startMs,
      end_ms: planned.endMs,
    })),
  );
  await tx.db
    .update(video)
    .set({ plan, duration_ms: plan.totalMs })
    .where(eq(video.id, videoId));
}

/**
 * The upload's commit. `create-scenes` writes the narration row because it is
 * the step that already holds the transcript; `create-vocal` then only advances.
 * No TTS runs, so `runs` is honestly empty and `pair` is null.
 */
export async function persistVoiceoverPlan(
  tx: CommitTx,
  input: PersistVoiceoverInput,
): Promise<void> {
  await writePlan(tx, input.videoId, input.plan);

  const inserted = await tx.db
    .insert(asset)
    .values({
      workspace_id: input.workspaceId,
      kind: 'audio',
      key: input.stored.key,
      bytes: input.stored.bytes,
      mime: input.stored.mime,
      meta: {
        source: 'voiceover',
        requestId: input.transcription.requestId,
        durationMs: input.plan.totalMs,
        language: input.transcription.language,
      },
    })
    .returning({ id: asset.id });
  const assetId = inserted[0]?.id;
  if (assetId === undefined) {
    throw new StepFailure('internal', 'asset insert returned no row');
  }

  await tx.db.insert(narration).values({
    video_id: input.videoId,
    asset_id: assetId,
    duration_ms: input.plan.totalMs,
    word_timings: input.transcription.segments.flatMap((segment) =>
      segment.words.map((word) => ({
        text: word.text,
        start_ms: word.startMs,
        end_ms: word.endMs,
      })),
    ),
    voice_plan: narrationPlanSchema.parse({
      script: input.transcription.text,
      spokenText: input.transcription.text,
      runs: [],
      overrides: [],
      pair: null,
    }),
  });
}
