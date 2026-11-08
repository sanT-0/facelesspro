/**
 * `create-images`: one still per planned scene, post-processed and stored.
 *
 * The planner already composed each `imagePrompt` from the style profile (see
 * `planner/prompt.ts`), so this step sends that final prompt unchanged. What it
 * adds is the caller-owned seed (`hash(videoId, sceneIdx)`), the style negative
 * clause, palette correction, the histogram consistency guard and durable
 * storage.
 *
 * Generation and disk writes happen after `withStep` claims the job and before
 * the commit transaction opens. The transaction contains only the image asset
 * rows, the scene links, the ledger row and the cursor move.
 */

import {
  createAiVideoV3RequestSchema,
  imageGenerationRequestSchema,
  sceneManifestSchema,
  scenePlanSchema,
  sceneRowSchema,
  styleProfileSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type {
  ArtStyleRow,
  GeneratedImage,
  ImageGenerationRequest,
  SceneFrameManifest,
  SceneManifest,
  ScenePlan,
  SceneRow,
  Size,
  StyleProfile,
} from '@facelesspro/contracts';
import { sceneSeedFor } from '@facelesspro/core';
import { asset, findArtStyle, scene } from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { StepFailure, withStep } from '@facelesspro/queue';
import type {
  CommitTx,
  StepBody,
  StepDeps,
  StepHandler,
} from '@facelesspro/queue';
import { and, asc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { assertStyleUsable } from '../art-style/usable';
import {
  dataDir,
  ensureParentPath,
  resolveStorageKey,
  storageKey,
} from '../art-style/storage';
import type { ImageFn } from '../ports/image';
import { ImageChainError } from '../image/chain';
import { withRequiredNegatives } from '../image/negative';
import { postprocessScene } from '../image/postprocess';
import type { SceneFrame } from '../image/postprocess';

/** Rows this step reads; injectable so unit tests need no Postgres. */
export type FindStyle = (db: Database, id: string) => Promise<ArtStyleRow | null>;
export type ListScenes = (db: Database, videoId: string) => Promise<SceneRow[]>;

export interface ProcessSceneOptions {
  /** Adapter used for the first draw and any one-shot regenerate. */
  readonly draw: ImageFn;
  /** Histograms of the scenes already accepted, nearest-neighbour compared. */
  readonly referenceHistograms: readonly (readonly number[])[];
}

export type ProcessScene = (
  request: ImageGenerationRequest,
  options: ProcessSceneOptions,
) => Promise<SceneFrame>;

export interface FrameBytes {
  readonly key: string;
  readonly bytes: Uint8Array;
}

export interface StoreFramesInput {
  readonly workspaceId: string;
  readonly videoId: string;
  readonly frames: readonly FrameBytes[];
  readonly manifest: SceneManifest;
}

export interface StoredFrames {
  readonly keys: readonly string[];
  readonly manifestKey: string;
}

export type StoreFrames = (input: StoreFramesInput) => Promise<StoredFrames>;

export interface PersistImagesInput {
  readonly videoId: string;
  readonly workspaceId: string;
  readonly frames: readonly SceneFrameManifest[];
}

export type PersistImages = (tx: CommitTx, input: PersistImagesInput) => Promise<void>;

export interface CreateImagesWorkDeps {
  readonly image: ImageFn;
  readonly findStyle?: FindStyle;
  readonly listScenes?: ListScenes;
  /** Injected in unit tests; defaults to the real adapter draw + postprocess. */
  readonly processScene?: ProcessScene;
  readonly storeFrames?: StoreFrames;
  readonly persistImages?: PersistImages;
  /** Self-host records units at zero cost; a paid plan supplies its price. */
  readonly imageUnitCost?: number;
}

export interface CreateImagesHandlerDeps extends StepDeps, CreateImagesWorkDeps {}

/** Business body exported separately so unit tests need no Postgres or pg-boss. */
export function createCreateImagesWork(deps: CreateImagesWorkDeps): StepBody {
  const lookupStyle = deps.findStyle ?? findArtStyle;
  const loadScenes = deps.listScenes ?? listScenes;
  const process = deps.processScene ?? processSceneFrame;
  const store = deps.storeFrames ?? storeFrames;
  const persist = deps.persistImages ?? persistImages;
  const unitCost = deps.imageUnitCost ?? 0;

  return async (ctx) => {
    const row = videoRowSchema.safeParse(ctx.video);
    if (!row.success) {
      throw new StepFailure('internal', 'stored video row does not match the video contract', {
        cause: row.error,
      });
    }
    if (row.data.kind !== 'ai-video-v3' || row.data.request.kind !== 'ai-video-v3') {
      throw new StepFailure('internal', 'create-images received a non-V3 video');
    }

    const request = createAiVideoV3RequestSchema.safeParse(row.data.request.body);
    if (!request.success) {
      throw new StepFailure('internal', 'stored V3 request does not match the request contract', {
        cause: request.error,
      });
    }
    if (row.data.plan === null || row.data.plan === undefined) {
      throw new StepFailure('internal', 'create-images found no stored scene plan');
    }
    const plan = scenePlanSchema.safeParse(row.data.plan);
    if (!plan.success) {
      throw new StepFailure('internal', 'stored scene plan does not match the plan contract', {
        cause: plan.error,
      });
    }
    if (plan.data.scenes.length === 0) {
      throw new StepFailure('internal', 'stored scene plan has no scenes');
    }

    const selectedStyle = await lookupStyle(ctx.db, request.data.artStyleId);
    assertStyleUsable(selectedStyle, row.data.workspace_id, request.data.size);
    const profile = styleProfileSchema.safeParse(selectedStyle.profile);
    if (!profile.success) {
      throw new StepFailure('internal', `art style ${selectedStyle.id} has an invalid profile`, {
        cause: profile.error,
      });
    }

    const rows = await loadScenes(ctx.db, ctx.videoId);
    const scenes = assertScenesMatchPlan(rows, plan.data);

    const requests = buildRequests(
      ctx.videoId,
      plan.data,
      profile.data,
      request.data.size,
    );

    const references: number[][] = [];
    const frames: SceneFrameManifest[] = [];
    const frameBytes: FrameBytes[] = [];
    for (const [idx, imageRequest] of requests.entries()) {
      let frame: SceneFrame;
      try {
        frame = await process(imageRequest, {
          draw: deps.image,
          referenceHistograms: [...references],
        });
      } catch (error) {
        throw mapImageFailure(error, idx);
      }
      references.push([...frame.histogram]);

      const key = frameKey(row.data.workspace_id, ctx.videoId, idx);
      const sha256 = createHash('sha256').update(frame.image.bytes).digest('hex');
      frames.push({
        idx,
        key,
        prompt: frame.prompt,
        seed: frame.image.seed,
        adapter: frame.image.adapter,
        degradedFrom: [...frame.image.degradedFrom],
        width: frame.image.width,
        height: frame.image.height,
        bytes: frame.image.bytes.byteLength,
        sha256,
        correction: frame.correction,
        consistency: frame.consistency,
      });
      frameBytes.push({ key, bytes: frame.image.bytes });
      // `scenes` is ordered and has the same length; this asserts the pairing.
      if (scenes[idx]?.idx !== idx) {
        throw new StepFailure('internal', `scene row ${idx} is missing or out of order`);
      }
    }

    const manifest = sceneManifestSchema.parse({
      version: 1,
      videoId: ctx.videoId,
      styleId: selectedStyle.id,
      size: request.data.size,
      frames,
    });

    await storeFramesSafely(store, {
      workspaceId: row.data.workspace_id,
      videoId: ctx.videoId,
      frames: frameBytes,
      manifest,
    });

    const degraded = [...new Set(frames.flatMap((frame) => frame.degradedFrom))];
    ctx.observe({
      adapter: frames.at(-1)?.adapter,
      items: frames.length,
      ok: frames.length,
      bytes: frames.reduce((total, frame) => total + frame.bytes, 0),
      costUnits: Math.ceil(frames.length / 20),
      degradedFrom: degraded.length === 0 ? undefined : degraded.join(','),
    });

    await ctx.transaction(async (tx) => {
      await persist(tx, {
        videoId: ctx.videoId,
        workspaceId: row.data.workspace_id,
        frames,
      });
      await tx.charge({
        action: 'image',
        units: Math.ceil(frames.length / 20),
        unitCost,
      });
      await tx.advance();
    });
  };
}

/** Queue handler: `withStep` owns locking, failures, idempotency and commit fencing. */
export function createCreateImagesHandler(deps: CreateImagesHandlerDeps): StepHandler {
  const work = createCreateImagesWork(deps);
  return async (job) => {
    await withStep(deps, job.videoId, 'create-images', work);
  };
}

export async function listScenes(db: Database, videoId: string): Promise<SceneRow[]> {
  return await db
    .select()
    .from(scene)
    .where(eq(scene.video_id, videoId))
    .orderBy(asc(scene.idx));
}

/** docs/03 §5: `ws/<workspace>/videos/<video>/frames/0001.png`. */
export function frameKey(workspaceId: string, videoId: string, idx: number): string {
  return storageKey(
    'ws',
    workspaceId,
    'videos',
    videoId,
    'frames',
    `${String(idx + 1).padStart(4, '0')}.png`,
  );
}

export function framesManifestKey(workspaceId: string, videoId: string): string {
  return storageKey('ws', workspaceId, 'videos', videoId, 'frames', 'manifest.json');
}

export async function storeFrames(input: StoreFramesInput): Promise<StoredFrames> {
  const root = dataDir();
  for (const frame of input.frames) {
    const path = resolveStorageKey(root, frame.key);
    await ensureParentPath(path);
    await writeFile(path, frame.bytes);
  }

  const manifestKey = framesManifestKey(input.workspaceId, input.videoId);
  const manifestPath = resolveStorageKey(root, manifestKey);
  await ensureParentPath(manifestPath);
  await writeFile(manifestPath, `${JSON.stringify(input.manifest, null, 2)}\n`, 'utf8');

  return { keys: input.frames.map((frame) => frame.key), manifestKey };
}

/** Everything the step writes, inside one `withStep` transaction. */
export async function persistImages(tx: CommitTx, input: PersistImagesInput): Promise<void> {
  if (input.frames.length === 0) {
    throw new StepFailure('internal', 'persistImages received no frames');
  }

  const inserted = await tx.db
    .insert(asset)
    .values(
      input.frames.map((frame) => ({
        workspace_id: input.workspaceId,
        kind: 'image' as const,
        key: frame.key,
        bytes: frame.bytes,
        mime: 'image/png',
        meta: {
          seed: frame.seed,
          adapter: frame.adapter,
          degradedFrom: frame.degradedFrom,
          sha256: frame.sha256,
          regenerated: frame.consistency.regenerated,
        },
      })),
    )
    .returning({ id: asset.id, key: asset.key });

  if (inserted.length !== input.frames.length) {
    throw new StepFailure('internal', 'asset insert returned the wrong number of rows');
  }
  const byKey = new Map(inserted.map((value) => [value.key, value.id]));

  for (const frame of input.frames) {
    const assetId = byKey.get(frame.key);
    if (assetId === undefined) {
      throw new StepFailure('internal', `asset insert did not return ${frame.key}`);
    }
    const linked = await tx.db
      .update(scene)
      .set({ image_asset_id: assetId })
      .where(and(eq(scene.video_id, input.videoId), eq(scene.idx, frame.idx)))
      .returning({ id: scene.id });
    if (linked.length !== 1) {
      throw new StepFailure('internal', `could not link image asset for scene ${frame.idx}`);
    }
  }
}

/** Default process: draw once, then correct/guard and re-draw at most once. */
async function processSceneFrame(
  request: ImageGenerationRequest,
  options: ProcessSceneOptions,
): Promise<SceneFrame> {
  const generated: GeneratedImage = await options.draw.draw(request);
  return await postprocessScene(request, generated, {
    draw: options.draw,
    referenceHistograms: options.referenceHistograms,
  });
}

function buildRequests(
  videoId: string,
  plan: ScenePlan,
  profile: StyleProfile,
  size: Size,
): ImageGenerationRequest[] {
  const negativePrompt = withRequiredNegatives(profile.negative);
  try {
    return plan.scenes.map((planned, idx) =>
      imageGenerationRequestSchema.parse({
        prompt: planned.imagePrompt,
        negativePrompt,
        seed: sceneSeedFor(videoId, idx),
        size,
        style: profile,
      }),
    );
  } catch (error) {
    throw new StepFailure('internal', 'stored plan cannot form a valid image request', {
      cause: error,
    });
  }
}

function assertScenesMatchPlan(rows: readonly SceneRow[], plan: ScenePlan): SceneRow[] {
  if (rows.length !== plan.scenes.length) {
    throw new StepFailure(
      'internal',
      `stored scenes (${rows.length}) do not match the plan (${plan.scenes.length})`,
    );
  }
  const scenes = rows.map((value) => sceneRowSchema.parse(value));
  scenes.forEach((value, index) => {
    if (value.idx !== index) {
      throw new StepFailure('internal', `scene row ${index} has index ${value.idx}`);
    }
    if (value.text !== plan.scenes[index]?.text) {
      throw new StepFailure('internal', `scene row ${index} text does not match the plan`);
    }
  });
  return scenes;
}

function mapImageFailure(error: unknown, idx: number): StepFailure {
  if (error instanceof StepFailure) return error;
  if (error instanceof ImageChainError) {
    return new StepFailure('upstream_failed', `scene ${idx + 1}: ${error.message}`, {
      retryable: error.retryable,
      cause: error,
    });
  }
  return new StepFailure(
    'upstream_failed',
    `scene ${idx + 1} image failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { retryable: true, cause: error },
  );
}

/** A disk write is infrastructure: same bytes can succeed on the next attempt. */
async function storeFramesSafely(
  store: StoreFrames,
  input: StoreFramesInput,
): Promise<StoredFrames> {
  try {
    return await store(input);
  } catch (error) {
    throw new StepFailure(
      'internal',
      `could not store scene frames: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { retryable: true, cause: error },
    );
  }
}
