/**
 * `render`: the stored timeline → one deterministic MP4 + one thumbnail.
 *
 * The pure plan (`@facelesspro/core`) and the ffmpeg adapter
 * (`@facelesspro/art`) do the composition; this step owns the timeline
 * contract, path resolution, artifact verification and the single commit.
 *
 * `render` is last in the public step order, so `tx.advance()` is what "done"
 * means: status `completed`, cursor `null`. Re-render is a later API concern;
 * every run of this step appends one `render` row instead of mutating history.
 */

import {
  assetRowSchema,
  captionTrackRowSchema,
  createAiVideoV3RequestSchema,
  narrationRowSchema,
  sceneMotionSchema,
  sceneRowSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type {
  AssetRow,
  CaptionTrackRow,
  FrameRate,
  NarrationRow,
  RenderFormat,
  Resolution,
  SceneRow,
} from '@facelesspro/contracts';
import { renderDimensions } from '@facelesspro/core';
import type { RenderMotion, RenderPlanInput } from '@facelesspro/core';
import {
  BUNDLED_CAPTION_FONTS_URL,
  extractThumbnail as extractThumbnailAdapter,
  renderVideo as renderVideoAdapter,
} from '@facelesspro/art';
import type { RenderResult } from '@facelesspro/art';
import {
  asset,
  captionTrack as captionTrackTable,
  narration as narrationTable,
  render as renderTable,
  scene as sceneTable,
  video as videoTable,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { StepFailure, withStep } from '@facelesspro/queue';
import type { CommitTx, StepBody, StepDeps, StepHandler } from '@facelesspro/queue';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';

import {
  dataDir,
  resolveStorageKey,
  storageKey,
} from '../art-style/storage';
import { captionKey } from './create-captions';

/** Committed price: 10 cr/minute at 30 fps, doubled at 60 fps (docs/04 §6). */
export const DEFAULT_RENDER_UNIT_COST = 10;
export const RENDER_MIME = 'video/mp4';
export const THUMBNAIL_MIME = 'image/png';

export type LoadScenes = (db: Database, videoId: string) => Promise<SceneRow[]>;
export type LoadAssets = (
  db: Database,
  ids: readonly string[],
) => Promise<AssetRow[]>;
export type LoadNarration = (
  db: Database,
  videoId: string,
) => Promise<NarrationRow | null>;
export type LoadCaptionTrack = (
  db: Database,
  videoId: string,
) => Promise<CaptionTrackRow | null>;

export interface PersistRenderInput {
  readonly workspaceId: string;
  readonly videoId: string;
  readonly resolution: Resolution;
  readonly fps: FrameRate;
  readonly format: RenderFormat;
  readonly durationMs: number;
  readonly render: {
    readonly key: string;
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly frames: number;
  };
  readonly thumbnail: {
    readonly key: string;
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
  };
}

export type PersistRender = (tx: CommitTx, input: PersistRenderInput) => Promise<void>;

export interface CreateRenderWorkDeps {
  readonly loadScenes?: LoadScenes;
  readonly loadAssets?: LoadAssets;
  readonly loadNarration?: LoadNarration;
  readonly loadCaptionTrack?: LoadCaptionTrack;
  /** Injected in unit tests; defaults to the real ffmpeg adapter. */
  readonly renderVideo?: (input: RenderPlanInput) => Promise<RenderResult>;
  readonly extractThumbnail?: (
    videoPath: string,
    outputPath: string,
  ) => Promise<{ bytes: number; width: number; height: number }>;
  readonly persistRender?: PersistRender;
  /** Root every storage key resolves under. Tests inject a fake directory. */
  readonly storageRoot?: () => string;
  /** Fonts handed to libass; never left to the host fontconfig. */
  readonly fontsDir?: string;
  /** Per-minute price at 30 fps; 60 fps is billed at twice this. */
  readonly renderUnitCost?: number;
}

export interface CreateRenderHandlerDeps extends StepDeps, CreateRenderWorkDeps {}

/** Business body exported separately so unit tests need no Postgres or ffmpeg. */
export function createCreateRenderWork(deps: CreateRenderWorkDeps = {}): StepBody {
  const listScenes = deps.loadScenes ?? loadScenes;
  const loadAssets = deps.loadAssets ?? loadAssetsByIds;
  const loadNarration = deps.loadNarration ?? findNarration;
  const loadCaptionTrack = deps.loadCaptionTrack ?? findCaptionTrack;
  const render = deps.renderVideo ?? renderVideoAdapter;
  const thumbnail = deps.extractThumbnail ?? extractThumbnailAdapter;
  const persist = deps.persistRender ?? persistRender;
  const root = deps.storageRoot ?? dataDir;
  const fonts = deps.fontsDir ?? fileURLToPath(BUNDLED_CAPTION_FONTS_URL);
  const unitCost = deps.renderUnitCost ?? DEFAULT_RENDER_UNIT_COST;

  return async (ctx) => {
    const row = videoRowSchema.safeParse(ctx.video);
    if (!row.success) {
      throw new StepFailure('internal', 'stored video row does not match the video contract', {
        cause: row.error,
      });
    }
    if (row.data.kind !== 'ai-video-v3' || row.data.request.kind !== 'ai-video-v3') {
      throw new StepFailure('internal', 'render received a non-V3 video');
    }

    const request = createAiVideoV3RequestSchema.safeParse(row.data.request.body);
    if (!request.success) {
      throw new StepFailure('internal', 'stored V3 request does not match the request contract', {
        cause: request.error,
      });
    }
    const options = request.data.render;
    if (options === undefined) {
      throw new StepFailure('internal', 'render was enqueued for a video with no render request');
    }
    if (row.data.duration_ms === null) {
      throw new StepFailure('internal', 'render found no narration duration');
    }

    const narration = await loadNarration(ctx.db, ctx.videoId);
    if (narration === null) {
      throw new StepFailure('internal', 'render found no narration row');
    }
    const parsedNarration = narrationRowSchema.safeParse(narration);
    if (!parsedNarration.success) {
      throw new StepFailure('internal', 'stored narration does not match the narration contract', {
        cause: parsedNarration.error,
      });
    }
    if (parsedNarration.data.video_id !== ctx.videoId) {
      throw new StepFailure('internal', 'stored narration belongs to a different video');
    }
    if (parsedNarration.data.duration_ms !== row.data.duration_ms) {
      throw new StepFailure('internal', 'video and narration durations do not match');
    }

    const sceneRows = await listScenes(ctx.db, ctx.videoId);
    const timeline = assertTimeline(sceneRows, parsedNarration.data);

    const assetIds = [
      ...timeline.map((scene) => scene.imageAssetId),
      parsedNarration.data.asset_id,
    ];
    const assets = new Map<string, AssetRow>(
      (await loadAssets(ctx.db, assetIds)).map((stored) => [stored.id, stored]),
    );
    const audio = requireAsset(
      assets,
      parsedNarration.data.asset_id,
      row.data.workspace_id,
      'audio',
      'narration',
    );
    const images = timeline.map((scene, index) =>
      requireAsset(assets, scene.imageAssetId, row.data.workspace_id, 'image', `scene ${index}`),
    );

    const storedCaption = await loadCaptionTrack(ctx.db, ctx.videoId);
    let captionTrack: CaptionTrackRow | null = null;
    if (storedCaption !== null) {
      const parsed = captionTrackRowSchema.safeParse(storedCaption);
      if (!parsed.success) {
        throw new StepFailure('internal', 'stored caption track does not match its contract', {
          cause: parsed.error,
        });
      }
      if (parsed.data.video_id !== ctx.videoId) {
        throw new StepFailure('internal', 'stored caption track belongs to a different video');
      }
      captionTrack = parsed.data;
    }

    const directory = root();
    const renderStorageKey = renderKey(
      row.data.workspace_id,
      ctx.videoId,
      options.resolution,
      options.frameRate,
      options.format,
    );
    const thumbnailStorageKey = thumbnailKey(
      row.data.workspace_id,
      ctx.videoId,
      options.resolution,
      options.frameRate,
      options.format,
    );
    const outputPath = resolveStorageKey(directory, renderStorageKey);
    const thumbnailPath = resolveStorageKey(directory, thumbnailStorageKey);

    const planInput: RenderPlanInput = {
      scenes: timeline.map((scene, index) => ({
        imagePath: resolveStorageKey(directory, images[index]!.key),
        durationMs: scene.durationMs,
        motion: scene.motion,
      })),
      audioPath: resolveStorageKey(directory, audio.key),
      outputPath,
      resolution: options.resolution,
      fps: options.frameRate,
      size: request.data.size,
      format: options.format,
      ...(captionTrack === null
        ? {}
        : {
            captions: {
              path: resolveStorageKey(
                directory,
                captionKey(row.data.workspace_id, ctx.videoId, 'ass'),
              ),
              fontsDir: fonts,
            },
          }),
    };

    const result = await renderSafely(render, planInput);
    const expected = renderDimensions(options.resolution, request.data.size);
    if (
      result.width !== expected.width ||
      result.height !== expected.height ||
      result.fps !== options.frameRate ||
      result.bytes <= 0
    ) {
      throw new StepFailure(
        'internal',
        `encoder returned ${result.width}x${result.height}@${result.fps} instead of ${expected.width}x${expected.height}@${options.frameRate}`,
      );
    }
    if (result.durationMs !== parsedNarration.data.duration_ms) {
      throw new StepFailure(
        'internal',
        `encoder duration ${result.durationMs}ms does not match the master ${parsedNarration.data.duration_ms}ms`,
      );
    }

    const thumbnailResult = await thumbnailSafely(thumbnail, outputPath, thumbnailPath);
    if (
      thumbnailResult.bytes <= 0 ||
      thumbnailResult.width <= 0 ||
      thumbnailResult.height <= 0
    ) {
      throw new StepFailure('internal', 'thumbnail extractor returned an empty image');
    }

    const minutes = parsedNarration.data.duration_ms / 60_000;
    const billedUnitCost = options.frameRate === 60 ? unitCost * 2 : unitCost;

    ctx.observe({
      items: timeline.length,
      bytes: result.bytes,
      costUnits: minutes,
    });

    await ctx.transaction(async (tx) => {
      await persist(tx, {
        workspaceId: row.data.workspace_id,
        videoId: ctx.videoId,
        resolution: options.resolution,
        fps: options.frameRate,
        format: options.format,
        durationMs: parsedNarration.data.duration_ms,
        render: {
          key: renderStorageKey,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          fps: result.fps,
          frames: result.totalFrames,
        },
        thumbnail: {
          key: thumbnailStorageKey,
          bytes: thumbnailResult.bytes,
          width: thumbnailResult.width,
          height: thumbnailResult.height,
        },
      });
      await tx.charge({ action: 'render', units: minutes, unitCost: billedUnitCost });
      await tx.advance();
    });
  };
}

/** Queue handler: `withStep` owns locking, failures, idempotency and commit fencing. */
export function createCreateRenderHandler(deps: CreateRenderHandlerDeps): StepHandler {
  const work = createCreateRenderWork(deps);
  return async (job) => {
    await withStep(deps, job.videoId, 'render', work);
  };
}

export function renderKey(
  workspaceId: string,
  videoId: string,
  resolution: Resolution,
  fps: FrameRate,
  format: RenderFormat,
): string {
  return storageKey(
    'ws',
    workspaceId,
    'videos',
    videoId,
    `render-${resolution}p-${fps}-${format}.mp4`,
  );
}

export function thumbnailKey(
  workspaceId: string,
  videoId: string,
  resolution: Resolution,
  fps: FrameRate,
  format: RenderFormat,
): string {
  return storageKey(
    'ws',
    workspaceId,
    'videos',
    videoId,
    `thumbnail-${resolution}p-${fps}-${format}.png`,
  );
}

export async function loadScenes(db: Database, videoId: string): Promise<SceneRow[]> {
  const rows = await db
    .select()
    .from(sceneTable)
    .where(eq(sceneTable.video_id, videoId))
    .orderBy(asc(sceneTable.idx));
  return rows.map((row) => sceneRowSchema.parse(row));
}

export async function loadAssetsByIds(
  db: Database,
  ids: readonly string[],
): Promise<AssetRow[]> {
  if (ids.length === 0) return [];
  const wanted = [...new Set(ids)];
  const rows = await db.select().from(asset).where(inArray(asset.id, wanted));
  return rows.map((row) => assetRowSchema.parse(row));
}

export async function findNarration(
  db: Database,
  videoId: string,
): Promise<NarrationRow | null> {
  const rows = await db
    .select()
    .from(narrationTable)
    .where(eq(narrationTable.video_id, videoId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : narrationRowSchema.parse(row);
}

export async function findCaptionTrack(
  db: Database,
  videoId: string,
): Promise<CaptionTrackRow | null> {
  const rows = await db
    .select()
    .from(captionTrackTable)
    .where(eq(captionTrackTable.video_id, videoId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : captionTrackRowSchema.parse(row);
}

/** All artifact rows and the completed render row join one fenced commit. */
export async function persistRender(
  tx: CommitTx,
  input: PersistRenderInput,
): Promise<void> {
  const insertedRender = await tx.db
    .insert(asset)
    .values({
      workspace_id: input.workspaceId,
      kind: 'render',
      key: input.render.key,
      bytes: input.render.bytes,
      mime: RENDER_MIME,
      meta: {
        resolution: input.resolution,
        fps: input.fps,
        format: input.format,
        width: input.render.width,
        height: input.render.height,
        frames: input.render.frames,
        durationMs: input.durationMs,
      },
    })
    .returning({ id: asset.id });
  const renderAssetId = insertedRender[0]?.id;
  if (insertedRender.length !== 1 || renderAssetId === undefined) {
    throw new StepFailure('internal', 'render asset insert returned the wrong rows');
  }

  const insertedThumbnail = await tx.db
    .insert(asset)
    .values({
      workspace_id: input.workspaceId,
      kind: 'thumbnail',
      key: input.thumbnail.key,
      bytes: input.thumbnail.bytes,
      mime: THUMBNAIL_MIME,
      meta: {
        resolution: input.resolution,
        fps: input.fps,
        format: input.format,
        width: input.thumbnail.width,
        height: input.thumbnail.height,
      },
    })
    .returning({ id: asset.id });
  if (insertedThumbnail.length !== 1 || insertedThumbnail[0]?.id === undefined) {
    throw new StepFailure('internal', 'thumbnail asset insert returned the wrong rows');
  }

  await tx.db.insert(renderTable).values({
    video_id: input.videoId,
    resolution: input.resolution,
    fps: input.fps,
    format: input.format,
    asset_id: renderAssetId,
    status: 'completed',
  });

  await tx.db
    .update(videoTable)
    .set({
      video_url: input.render.key,
      duration_ms: input.durationMs,
      updated_at: sql`now()`,
    })
    .where(eq(videoTable.id, input.videoId));
}

interface TimelineScene {
  readonly imageAssetId: string;
  readonly durationMs: number;
  readonly motion: RenderMotion;
}

/**
 * The spans were re-derived from the stitched master in `create-vocal`, so they
 * must tile the narration exactly. A gap or a stale estimate would silently cut
 * audio, which is worse than refusing to render.
 */
function assertTimeline(
  scenes: readonly SceneRow[],
  narration: NarrationRow,
): TimelineScene[] {
  if (scenes.length === 0) {
    throw new StepFailure('internal', 'render found no scenes');
  }

  const timeline: TimelineScene[] = [];
  let previousEnd = 0;
  for (const [index, scene] of scenes.entries()) {
    if (scene.idx !== index) {
      throw new StepFailure('internal', `scene ${index} is stored out of order`);
    }
    if (scene.text.length === 0) {
      throw new StepFailure('internal', `scene ${index} has empty text`);
    }
    if (scene.image_asset_id === null || scene.image_asset_id === undefined) {
      throw new StepFailure('internal', `scene ${index} has no image asset`);
    }
    if (scene.start_ms !== previousEnd) {
      throw new StepFailure('internal', `scene ${index} is not contiguous with the previous scene`);
    }
    if (scene.end_ms <= scene.start_ms) {
      throw new StepFailure('internal', `scene ${index} has an empty timing span`);
    }
    const preset = (scene.motion as Record<string, unknown>).preset;
    const motion = sceneMotionSchema.safeParse(preset);
    if (!motion.success) {
      throw new StepFailure('internal', `scene ${index} has an unsupported render motion`);
    }
    timeline.push({
      imageAssetId: scene.image_asset_id,
      durationMs: scene.end_ms - scene.start_ms,
      motion: motion.data,
    });
    previousEnd = scene.end_ms;
  }

  if (previousEnd !== narration.duration_ms) {
    throw new StepFailure(
      'internal',
      `scene spans end at ${previousEnd}ms but the master is ${narration.duration_ms}ms`,
    );
  }
  return timeline;
}

function requireAsset(
  assets: ReadonlyMap<string, AssetRow>,
  id: string,
  workspaceId: string,
  kind: AssetRow['kind'],
  label: string,
): AssetRow {
  const found = assets.get(id);
  if (found === undefined) {
    throw new StepFailure('internal', `render is missing the ${label} asset ${id}`);
  }
  if (found.workspace_id !== workspaceId) {
    throw new StepFailure('internal', `the ${label} asset belongs to another workspace`);
  }
  if (found.kind !== kind) {
    throw new StepFailure('internal', `the ${label} asset is a ${found.kind}, not a ${kind}`);
  }
  if (found.key.length === 0) {
    throw new StepFailure('internal', `the ${label} asset has no storage key`);
  }
  return found;
}

async function renderSafely(
  render: (input: RenderPlanInput) => Promise<RenderResult>,
  input: RenderPlanInput,
): Promise<RenderResult> {
  try {
    return await render(input);
  } catch (error) {
    throw new StepFailure(
      'upstream_failed',
      `ffmpeg render failed: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true, cause: error },
    );
  }
}

async function thumbnailSafely(
  thumbnail: (
    videoPath: string,
    outputPath: string,
  ) => Promise<{ bytes: number; width: number; height: number }>,
  videoPath: string,
  outputPath: string,
): Promise<{ bytes: number; width: number; height: number }> {
  try {
    return await thumbnail(videoPath, outputPath);
  } catch (error) {
    throw new StepFailure(
      'upstream_failed',
      `thumbnail extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true, cause: error },
    );
  }
}
