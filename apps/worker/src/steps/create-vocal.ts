/**
 * `create-vocal`: scene text → one narration track + word timings.
 *
 * The narration is planned **per scene** even though it is synthesised in one
 * request. That is what makes the scene offsets exact: scene *i* owns a
 * contiguous slice of the response segments, so its real start/end come from
 * the stitched master rather than from the planner's estimate. A mid-sentence
 * scene cut produces a `none` boundary (0 ms) between the two runs, so splitting
 * there cannot add a pause that the script did not ask for.
 *
 * Network work happens after `withStep` claims the job and before the commit
 * transaction opens. The transaction contains only the asset row, narration
 * row, re-derived scene timings, cursor move and ledger row.
 */

import {
  MAX_MEDIA_SEGMENTS,
  createAiVideoV3RequestSchema,
  narrationPlanSchema,
  sceneRowSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type { NarrationPlan, SceneRow } from '@facelesspro/contracts';
import { buildNarrationPlan, normalizeScript, planToSegments } from '@facelesspro/core';
import type { NarrationSegment } from '@facelesspro/core';
import { asset, narration, scene, video } from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { StepFailure, withStep } from '@facelesspro/queue';
import type {
  CommitTx,
  StepBody,
  StepDeps,
  StepHandler,
} from '@facelesspro/queue';
import { and, asc, eq } from 'drizzle-orm';
import { writeFile } from 'node:fs/promises';

import type { TtsPort, TtsSynthesis } from '../ports/tts';
import { TtsPortError } from '../ports/tts';
import {
  dataDir,
  ensureParentPath,
  resolveStorageKey,
  storageKey,
} from '../art-style/storage';

export type ListScenes = (db: Database, videoId: string) => Promise<SceneRow[]>;

export interface NarrationStoreInput {
  workspaceId: string;
  videoId: string;
  bytes: Uint8Array;
}

export interface StoredNarration {
  key: string;
  bytes: number;
  mime: string;
}

export type StoreNarration = (input: NarrationStoreInput) => Promise<StoredNarration>;

export interface PersistNarrationInput {
  videoId: string;
  workspaceId: string;
  synthesis: TtsSynthesis;
  voicePlan: NarrationPlan;
  timings: readonly SceneTiming[];
  stored: StoredNarration;
}

export type PersistNarration = (
  tx: CommitTx,
  input: PersistNarrationInput,
) => Promise<void>;

export interface CreateVocalWorkDeps {
  readonly tts: TtsPort;
  /** `TTS_PAIR`; used when the request omits `voiceId`. */
  readonly defaultPairId: string;
  readonly listScenes?: ListScenes;
  readonly storeNarration?: StoreNarration;
  readonly persistNarration?: PersistNarration;
  /** Self-host records units at zero cost; a paid plan would supply its price. */
  readonly ttsUnitCost?: number;
}

export interface CreateVocalHandlerDeps extends StepDeps, CreateVocalWorkDeps {}

interface SceneRange {
  first: number;
}

export interface SceneTiming {
  idx: number;
  startMs: number;
  endMs: number;
}

export function createCreateVocalWork(deps: CreateVocalWorkDeps): StepBody {
  const loadScenes = deps.listScenes ?? listScenes;
  const store = deps.storeNarration ?? storeNarration;
  const persist = deps.persistNarration ?? persistNarration;
  const unitCost = deps.ttsUnitCost ?? 0;

  return async (ctx) => {
    const row = videoRowSchema.safeParse(ctx.video);
    if (!row.success) {
      throw new StepFailure('internal', 'stored video row does not match the video contract', {
        cause: row.error,
      });
    }
    if (row.data.kind !== 'ai-video-v3' || row.data.request.kind !== 'ai-video-v3') {
      throw new StepFailure('internal', 'create-vocal received a non-V3 video');
    }

    const request = createAiVideoV3RequestSchema.safeParse(row.data.request.body);
    if (!request.success) {
      throw new StepFailure('internal', 'stored V3 request does not match the request contract', {
        cause: request.error,
      });
    }
    if (request.data.voiceoverUrl !== undefined) {
      // Intake already downloaded, transcribed and stored the upload (docs/04
      // §1b). No TTS runs and no characters are charged; the narration row and
      // scene spans were written by `create-scenes`.
      ctx.observe({ items: 0 });
      await ctx.transaction(async (tx) => {
        await tx.advance();
      });
      return;
    }
    const script = request.data.script;
    if (script === undefined) {
      throw new StepFailure(
        'internal',
        'stored V3 request has neither a script nor a voiceover',
      );
    }

    const rows = await loadScenes(ctx.db, ctx.videoId);
    if (rows.length === 0) {
      throw new StepFailure('internal', 'create-vocal found no scenes to narrate');
    }
    const scenes = rows.map((value) => sceneRowSchema.parse(value));
    assertScenesReconstructScript(scenes, script);

    const pairId = request.data.voiceId ?? deps.defaultPairId;
    const pair = await callTts(() => deps.tts.resolvePair(pairId), 'voice pair');

    const plans = scenes.map((value, index) => {
      const plan = buildNarrationPlan(value.text, {
        ta: pair.ta,
        en: pair.en,
        pair: pair.id,
      });
      if (plan.runs.length === 0) {
        throw new StepFailure('unprocessable', `scene ${index + 1} has no speakable words`);
      }
      return plan;
    });

    const ranges: SceneRange[] = [];
    const segments: NarrationSegment[] = [];
    for (const plan of plans) {
      const first = segments.length;
      const planSegments = planToSegments(plan);
      segments.push(...planSegments);
      ranges.push({ first });
    }
    if (segments.length > MAX_MEDIA_SEGMENTS) {
      throw new StepFailure(
        'unprocessable',
        `narration needs ${segments.length} runs; the media service accepts ${MAX_MEDIA_SEGMENTS}`,
      );
    }

    const synthesis = await callTts(
      () => deps.tts.synthesize({ segments }),
      'synthesis',
    );
    assertSynthesis(synthesis, segments);
    const timings = deriveSceneTimings(synthesis, ranges, scenes.length);

    const merged = mergePlans(script, pair.id, pair.ta, pair.en, plans);
    const stored = await storeBytes(store, {
      workspaceId: row.data.workspace_id,
      videoId: ctx.videoId,
      bytes: synthesis.audio,
    });
    const units = segments.reduce((total, segment) => total + [...segment.text].length, 0);

    ctx.observe({
      items: segments.length,
      bytes: stored.bytes,
      costUnits: units,
    });

    await ctx.transaction(async (tx) => {
      await persist(tx, {
        videoId: ctx.videoId,
        workspaceId: row.data.workspace_id,
        synthesis,
        voicePlan: merged,
        timings,
        stored,
      });
      await tx.charge({ action: 'tts', units, unitCost });
      await tx.advance();
    });
  };
}

/** Queue handler: `withStep` owns locking, failures, idempotency and commit fencing. */
export function createCreateVocalHandler(deps: CreateVocalHandlerDeps): StepHandler {
  const work = createCreateVocalWork(deps);
  return async (job) => {
    await withStep(deps, job.videoId, 'create-vocal', work);
  };
}

export async function listScenes(db: Database, videoId: string): Promise<SceneRow[]> {
  return await db
    .select()
    .from(scene)
    .where(eq(scene.video_id, videoId))
    .orderBy(asc(scene.idx));
}

/** Deterministic key from docs/03 §5, so a retry overwrites rather than appends. */
export function narrationKey(workspaceId: string, videoId: string): string {
  return storageKey('ws', workspaceId, 'videos', videoId, 'audio', 'narration.mp3');
}

export async function storeNarration(
  input: NarrationStoreInput,
): Promise<StoredNarration> {
  const key = narrationKey(input.workspaceId, input.videoId);
  const path = resolveStorageKey(dataDir(), key);
  await ensureParentPath(path);
  await writeFile(path, input.bytes);
  return { key, bytes: input.bytes.byteLength, mime: 'audio/mpeg' };
}

/** Everything the step writes, inside one `withStep` transaction. */
export async function persistNarration(
  tx: CommitTx,
  input: PersistNarrationInput,
): Promise<void> {
  const inserted = await tx.db
    .insert(asset)
    .values({
      workspace_id: input.workspaceId,
      kind: 'audio',
      key: input.stored.key,
      bytes: input.stored.bytes,
      mime: input.stored.mime,
      meta: {
        requestId: input.synthesis.requestId,
        durationMs: input.synthesis.durationMs,
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
    duration_ms: input.synthesis.durationMs,
    word_timings: input.synthesis.segments.flatMap((segment) =>
      segment.words.map((word) => ({
        text: word.text,
        start_ms: word.startMs,
        end_ms: word.endMs,
      })),
    ),
    voice_plan: input.voicePlan,
  });

  for (const timing of input.timings) {
    await tx.db
      .update(scene)
      .set({ start_ms: timing.startMs, end_ms: timing.endMs })
      .where(and(eq(scene.video_id, input.videoId), eq(scene.idx, timing.idx)));
  }

  await tx.db
    .update(video)
    .set({ duration_ms: input.synthesis.durationMs })
    .where(eq(video.id, input.videoId));
}

/**
 * `voice_plan` is the audit record: the request script untouched, the exact
 * runs that were synthesised, and the overrides that produced them.
 */
function mergePlans(
  script: string,
  pairId: string,
  ta: string,
  en: string,
  plans: readonly NarrationPlan[],
): NarrationPlan {
  const runs = plans.flatMap((plan) => plan.runs);
  // Offsets belong to the whole request script, so they must come from a global
  // parse; the runs are the per-scene list that was actually synthesised.
  const overrides = buildNarrationPlan(script, { ta, en, pair: pairId }).overrides;

  return narrationPlanSchema.parse({
    script,
    spokenText: runs.map((run) => run.text).join(' '),
    runs,
    overrides,
    pair: pairId,
  });
}

function assertScenesReconstructScript(scenes: readonly SceneRow[], script: string): void {
  const joined = normalizeScript(scenes.map((value) => value.text).join(' '));
  if (joined !== normalizeScript(script)) {
    throw new StepFailure(
      'internal',
      'stored scene text does not reconstruct the request script',
    );
  }
}

async function callTts<T>(fn: () => Promise<T>, stage: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TtsPortError) {
      // 404/422 means the selector is wrong, not that the synthesizer is down.
      if (error.status === 404 || error.status === 422) {
        throw new StepFailure('invalid_request', `${stage}: ${error.message}`, {
          cause: error,
        });
      }
      throw new StepFailure('upstream_failed', error.message, {
        retryable: error.retryable,
        cause: error,
      });
    }
    throw new StepFailure('upstream_failed', `${stage} failed`, {
      retryable: true,
      cause: error,
    });
  }
}

/**
 * A disk write is infrastructure, not a user error: the same bytes can succeed
 * on the next attempt, and the step is idempotent, so it must stay retryable.
 */
async function storeBytes(
  store: StoreNarration,
  input: NarrationStoreInput,
): Promise<StoredNarration> {
  try {
    return await store(input);
  } catch (error) {
    throw new StepFailure(
      'internal',
      `could not store narration: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true, cause: error },
    );
  }
}

function assertSynthesis(
  synthesis: TtsSynthesis,
  requested: readonly { text: string; voice: string }[],
): void {
  if (synthesis.durationMs <= 0) {
    throw invalidSynthesis('master duration is not positive');
  }
  if (synthesis.segments.length !== requested.length) {
    throw invalidSynthesis(
      `expected ${requested.length} segments, received ${synthesis.segments.length}`,
    );
  }

  let previousStart = -1;
  synthesis.segments.forEach((segment, index) => {
    const expected = requested[index]!;
    if (
      segment.index !== index ||
      segment.text !== expected.text ||
      segment.voice !== expected.voice
    ) {
      throw invalidSynthesis(`segment ${index} does not match the request`);
    }
    if (segment.durationMs <= 0 || segment.startMs < 0) {
      throw invalidSynthesis(`segment ${index} has an invalid span`);
    }
    if (segment.startMs < previousStart) {
      throw invalidSynthesis('segment starts are not monotonic');
    }
    previousStart = segment.startMs;

    let previousWordStart = segment.startMs;
    for (const word of segment.words) {
      if (word.startMs < previousWordStart || word.endMs < word.startMs) {
        throw invalidSynthesis(`segment ${index} has non-monotonic word timings`);
      }
      if (word.endMs > segment.startMs + segment.durationMs) {
        throw invalidSynthesis(`segment ${index} has a word outside its span`);
      }
      previousWordStart = word.startMs;
    }
  });

  if (synthesis.segments[0]?.startMs !== 0) {
    throw invalidSynthesis('the first segment does not start at zero');
  }
}

function deriveSceneTimings(
  synthesis: TtsSynthesis,
  ranges: readonly SceneRange[],
  sceneCount: number,
): SceneTiming[] {
  return ranges.map((range, index) => {
    const start = synthesis.segments[range.first]?.startMs ?? -1;
    if (start < 0) throw invalidSynthesis(`scene ${index + 1} has no segment`);
    // The gap before the next scene's first run belongs to this scene, so the
    // stored spans stay contiguous and the last ends on the probed duration.
    const end =
      index + 1 < sceneCount
        ? (synthesis.segments[ranges[index + 1]!.first]?.startMs ?? -1)
        : synthesis.durationMs;
    if (end <= start) {
      throw invalidSynthesis(`scene ${index + 1} has an empty audio span`);
    }
    return { idx: index, startMs: index === 0 ? 0 : start, endMs: end };
  });
}

function invalidSynthesis(message: string): StepFailure {
  return new StepFailure('upstream_failed', `media service ${message}`, {
    retryable: false,
  });
}
