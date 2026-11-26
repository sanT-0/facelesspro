/**
 * Roblox Rant, end to end, over Postgres + pg-boss + real ffmpeg.
 *
 * Drives a single Roblox request through all five production step handlers —
 * planner (heuristic), TTS (fixture or media-service), image chain
 * (background video, no generated images), captions, render — and keeps
 * the resulting MP4, thumbnail, manifest and a probe summary under
 * `.data/artifacts/p9-roblox/`.
 *
 * Offline (`npm run test:db`) uses the heuristic planner, fixture TTS, and
 * background video: real transactions, locks, idempotency, the ledger,
 * Postgres, pg-boss, libass and ffmpeg, but no provider network. `LIVE=1`
 * builds the planner and TTS from `.env` instead.
 *
 * The roblox request uses a script with a gameplay background video. The
 * narration is the script read with a pitch shift (voicePitch).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assetRowSchema,
  createRobloxVideoRequestSchema,
  renderRowSchema,
  scenePlanSchema,
  sceneRowSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type { ScenePlan } from '@facelesspro/contracts';
import {
  asset,
  captionTrack,
  creditLedger,
  databaseUrl,
  narration,
  render,
  scene,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { queueFor, stopBoss } from '@facelesspro/queue';
import type { ConsumedJob } from '@facelesspro/queue';
import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dataDir, resolveStorageKey } from '../art-style/storage';
import { createImageChainFromEnv } from '../image/factory';
import { createPlannerChainFromEnv } from '../planner/factory';
import { createHeuristicPlanner } from '../planner/heuristic';
import type { ImageFn } from '../ports/image';
import type { PlanFn } from '../ports/planner';
import type { TtsPort } from '../ports/tts';
import { createMediaTtsPort } from '../tts/media';
import { createCreateCaptionsHandler } from './create-captions';
import { createCreateImagesHandler } from './create-images';
import { createCreateScenesHandler } from './create-scenes';
import { createCreateVocalHandler } from './create-vocal';
import { createCreateRenderHandler, renderKey, thumbnailKey } from './render';

/** Roblox rant script: short enough for one scene (~15 words, ~8s at default rate). */
const ROBLOX_SCRIPT = `this game is broken and buggy`;

const ARTIFACT_DIR = '.data/artifacts/p9-roblox';
const BACKGROUND_VIDEO = join(ARTIFACT_DIR, 'background.mp4');
const AUDIO_SECONDS = 30;
const IMAGE_UNIT_COST = 5;
const TTS_UNIT_COST = 1;
const SUBTITLE_UNIT_COST = 2;
const LIVE = process.env.LIVE === '1';

const PAIR = {
  id: 'valluvar',
  ta: 'ta-IN-ValluvarNeural',
  en: 'ta-IN-ValluvarNeural',
  notes: 'one speaker reads both languages',
};

let db: Database;
let pool: Pool;
let boss: PgBoss;
let workspaceId: string;
let videoId: string;
let mp3: Uint8Array;
let fixtureDurationMs: number;

/** Split a run's text into words and distribute its span by character count. */
function wordsFor(
  text: string,
  startMs: number,
  spanMs: number,
): Array<{ text: string; startMs: number; endMs: number }> {
  const tokens = text.split(/\s+/u).filter((token) => token.length > 0);
  const chars = tokens.reduce((total, token) => total + [...token].length, 0) || 1;
  let cursor = startMs;

  return tokens.map((token, index) => {
    const isLast = index === tokens.length - 1;
    const end = isLast
      ? startMs + spanMs
      : Math.min(
          startMs + spanMs,
          cursor + Math.max(1, Math.round((spanMs * [...token].length) / chars)),
        );
    const word = { text: token, startMs: cursor, endMs: Math.max(cursor, end) };
    cursor = word.endMs;
    return word;
  });
}

function plannerFor(live: boolean): PlanFn {
  if (!live) {
    const base = createHeuristicPlanner();
    return {
      plan: (request) => base.plan({ ...request, rates: { en: 120 } }),
    };
  }
  return createPlannerChainFromEnv({ env: process.env });
}

function imageFor(live: boolean): ImageFn {
  if (!live) {
    return createImageChainFromEnv({ env: { IMAGE: 'procedural' }, logger: () => {} });
  }
  return createImageChainFromEnv({ env: process.env });
}

function fakeTts(): TtsPort {
  return {
    resolvePair: async (pairId) => {
      if (pairId !== PAIR.id) throw new Error(`unexpected pair ${pairId}`);
      return PAIR;
    },
    synthesize: async (request) => {
      const count = request.segments.length;

      return {
        requestId: 'p9-roblox-request',
        audio: mp3,
        mime: 'audio/mpeg',
        durationMs: fixtureDurationMs,
        segments: request.segments.map((segment, index) => {
          const startMs = index * Math.floor(fixtureDurationMs / request.segments.length);
          const spanMs = index === count - 1 ? fixtureDurationMs - startMs : Math.floor(fixtureDurationMs / request.segments.length);
          return {
            index,
            voice: segment.voice,
            text: segment.text,
            startMs,
            durationMs: spanMs,
            words: wordsFor(segment.text, startMs, spanMs),
          };
        }),
      };
    },
  };
}

function ttsFor(live: boolean): TtsPort {
  if (!live) return fakeTts();
  return createMediaTtsPort({ baseUrl: process.env.MEDIA_SERVICE_URL });
}

async function purgeStepQueues(): Promise<void> {
  for (const step of [
    'create-scenes',
    'create-vocal',
    'create-images',
    'create-captions',
    'render',
  ] as const) {
    await boss.purgeQueue(queueFor(step));
  }
}

async function deleteVideoRows(): Promise<void> {
  await db.delete(captionTrack).where(eq(captionTrack.video_id, videoId));
  await db.delete(narration).where(eq(narration.video_id, videoId));
  await db.delete(scene).where(eq(scene.video_id, videoId));
  await db.delete(creditLedger).where(eq(creditLedger.video_id, videoId));
  await db.delete(asset).where(eq(asset.workspace_id, workspaceId));
  await db.delete(video).where(eq(video.id, videoId));
  await db.delete(workspace).where(eq(workspace.id, workspaceId));
}

function job(step: ConsumedJob['step'], jobId: string): ConsumedJob {
  return { jobId, videoId, step };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(binary: 'ffmpeg' | 'ffprobe', args: readonly string[]): string {
  const result = spawnSync(binary, [...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${binary} exited with ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

describe('Roblox Rant pipeline (Postgres + ffmpeg)', () => {
  beforeAll(async () => {
    const connectionString = databaseUrl();
    const { pool: pgPool } = await import('@facelesspro/db').then((m) => m.createDb(connectionString));
    pool = pgPool;
    db = await import('@facelesspro/db').then((m) => m.databaseFor(pool));
    boss = await import('@facelesspro/queue').then((m) => m.createBoss({ connectionString }));
    await boss.start();
    await import('@facelesspro/queue').then((m) => m.ensureQueues(boss));

    // Create proper audio fixture (MP3 tone) for narration
    const audioFixture = join(ARTIFACT_DIR, 'narration.mp3');
    await mkdir(ARTIFACT_DIR, { recursive: true });
    spawnSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
      '-c:a', 'libmp3lame', '-b:a', '128k',
      audioFixture
    ], { encoding: 'utf8' });
    mp3 = new Uint8Array(await readFile(audioFixture));
    fixtureDurationMs = AUDIO_SECONDS * 1000;
  });

  afterAll(async () => {
    await stopBoss(boss);
    await pool.end();
  });

  beforeEach(async () => {
    await purgeStepQueues();
    const ws = await db.insert(workspace).values({ name: 'roblox-e2e' }).returning({ id: workspace.id });
    workspaceId = ws[0]!.id;
  });

  afterEach(async () => {
    await deleteVideoRows();
  });

  it('runs full pipeline and produces a watchable 30s artifact', async () => {
    const live = LIVE;
    const scenes = createCreateScenesHandler({
      db,
      pool,
      boss,
      planner: plannerFor(live),
    });
    const vocal = createCreateVocalHandler({
      db,
      pool,
      boss,
      tts: ttsFor(live),
      defaultPairId: PAIR.id,
      ttsUnitCost: TTS_UNIT_COST,
    });
    const images = createCreateImagesHandler({
      db,
      pool,
      boss,
      image: imageFor(live),
      imageUnitCost: IMAGE_UNIT_COST,
    });
    const captions = createCreateCaptionsHandler({
      db,
      pool,
      boss,
      subtitleUnitCost: SUBTITLE_UNIT_COST,
    });
    const renderStep = createCreateRenderHandler({
      db,
      pool,
      boss,
      storageRoot: dataDir,
    });

    // Upload background video as an asset first
    const bgVideoBytes = new Uint8Array(await readFile(BACKGROUND_VIDEO));
    const bgKey = `backgrounds/${createHash('sha256').update(bgVideoBytes).digest('hex').slice(0, 16)}.mp4`;
    await mkdir(join(dataDir(), 'backgrounds'), { recursive: true });
    await writeFile(join(dataDir(), bgKey), bgVideoBytes);
    const bgAssetResult = await db
      .insert(asset)
      .values({
        workspace_id: workspaceId,
        kind: 'video',
        key: bgKey,
        bytes: bgVideoBytes.byteLength,
        mime: 'video/mp4',
      })
      .returning({ id: asset.id });
    const backgroundAssetId = bgAssetResult[0]!.id;

    // Create a dummy transparent image asset for scenes (1x1 transparent PNG)
    const dummyKey = `dummy/transparent.png`;
    await mkdir(join(dataDir(), 'dummy'), { recursive: true });
    // Generate a proper 1x1 transparent PNG using ImageMagick or a known-good PNG
    // Use a base64-encoded valid 1x1 transparent PNG
    const validPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const dummyPng = Buffer.from(validPngBase64, 'base64');
    await mkdir(join(dataDir(), 'dummy'), { recursive: true });
    await writeFile(join(dataDir(), dummyKey), dummyPng);
    const dummyAssetResult = await db
      .insert(asset)
      .values({
        workspace_id: workspaceId,
        kind: 'image',
        key: dummyKey,
        bytes: dummyPng.byteLength,
        mime: 'image/png',
      })
      .returning({ id: asset.id });
    const dummyAssetId = dummyAssetResult[0]!.id;

    const request = createRobloxVideoRequestSchema.parse({
      script: ROBLOX_SCRIPT,
      voicePitch: 140,
      captionWordLimit: 6,
      autoAddEmoji: true,
      backgroundVideoId: backgroundAssetId,
      render: { resolution: 1_080, frameRate: 30, format: 'standard' },
    });

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'roblox',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'roblox', body: request },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    await scenes(job('create-scenes', 'roblox-scenes-1'));

    let stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-vocal');
    expect(stored.plan).not.toBeNull();
    const plan = scenePlanSchema.parse(stored.plan) as ScenePlan;
    expect(plan.scenes.length).toBeGreaterThan(0);
    expect(['heuristic', 'ollama']).toContain(plan.adapter);

    const sceneRows = (
      await db
        .select()
        .from(scene)
        .where(eq(scene.video_id, videoId))
        .orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(sceneRows.length).toBe(plan.scenes.length);

    await vocal(job('create-vocal', 'roblox-vocal-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-images');
    const afterVocal = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(afterVocal.map((row) => row.action)).toEqual(['plan', 'tts']);

    const narrations = await db
      .select()
      .from(narration)
      .where(eq(narration.video_id, videoId));
    expect(narrations).toHaveLength(1);
    const narrationDurationMs = narrations[0]?.duration_ms ?? 0;
    expect(stored.duration_ms).toBe(narrationDurationMs);
    if (live) {
      expect(Math.abs(narrationDurationMs - 30_000)).toBeLessThanOrEqual(15_000);
    } else {
      expect(narrationDurationMs).toBe(fixtureDurationMs);
    }

    const timedScenes = (
      await db
        .select()
        .from(scene)
        .where(eq(scene.video_id, videoId))
        .orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(timedScenes[0]!.start_ms).toBe(0);
    expect(timedScenes.at(-1)!.end_ms).toBeGreaterThanOrEqual(20_000);

    await images(job('create-images', 'roblox-images-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-captions');

    const imageAssets = await db
      .select()
      .from(asset)
      .where(eq(asset.workspace_id, workspaceId));
    // Roblox has no generated frames; background is handled at render
    expect(imageAssets.filter((row) => row.kind === 'image')).toHaveLength(1); // dummy image

    await captions(job('create-captions', 'roblox-captions-1'));

    // Store dummy asset ID for render step
    await db
      .update(video)
      .set({
        request: {
          kind: 'roblox',
          body: { ...request, _robloxAssets: { backgroundAssetId, dummyAssetId } },
        },
      })
      .where(eq(video.id, videoId));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('render');
    const tracks = await db
      .select()
      .from(captionTrack)
      .where(eq(captionTrack.video_id, videoId));
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.template_id).toBe(-1);
    expect((tracks[0]?.cues.length ?? 0)).toBeGreaterThan(0);

    await renderStep(job('render', 'roblox-render-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.status).toBe('completed');
    expect(stored.step).toBeNull();
    expect(stored.duration_ms).toBe(narrationDurationMs);
    expect(stored.video_url).toBe(
      renderKey(workspaceId, videoId, 1_080, 30, 'standard'),
    );

    const storedRender = renderRowSchema.parse(
      (await db.select().from(render).where(eq(render.video_id, videoId)))[0],
    );
    expect(storedRender).toMatchObject({
      resolution: 1_080,
      fps: 30,
      format: 'standard',
      status: 'completed',
    });
    expect(storedRender.asset_id).not.toBeNull();

    const assets = (
      await db
        .select()
        .from(asset)
        .where(eq(asset.workspace_id, workspaceId))
        .orderBy(asc(asset.kind))
    ).map((row) => assetRowSchema.parse(row));
    const countKind = (kind: string): number => assets.filter((row) => row.kind === kind).length;
    expect(countKind('audio')).toBe(1);
    expect(countKind('image')).toBe(1); // dummy image
    expect(countKind('caption')).toBe(4);
    expect(countKind('render')).toBe(1);
    expect(countKind('thumbnail')).toBe(1);
    expect(countKind('video')).toBe(1); // background video

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(ledger.map((row) => row.action).sort()).toEqual([
      'plan',
      'render',
      'subtitles',
      'tts',
    ]);

    const renderAsset = assets.find((row) => row.kind === 'render');
    const thumbnailAsset = assets.find((row) => row.kind === 'thumbnail');
    if (renderAsset === undefined || thumbnailAsset === undefined) {
      throw new Error('render or thumbnail asset missing');
    }
    expect(renderAsset.mime).toBe('video/mp4');
    expect(thumbnailAsset.key).toBe(
      thumbnailKey(workspaceId, videoId, 1_080, 30, 'standard'),
    );

    const root = dataDir();
    const mp4Path = resolveStorageKey(root, renderAsset.key);
    const pngPath = resolveStorageKey(root, thumbnailAsset.key);
    const mp4 = new Uint8Array(await readFile(mp4Path));
    const png = new Uint8Array(await readFile(pngPath));
    expect(renderAsset.bytes).toBe(mp4.byteLength);
    expect(thumbnailAsset.bytes).toBe(png.byteLength);
    expect(Buffer.from(png.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');

    const probe = JSON.parse(
      run('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,channels,sample_rate:format=duration',
        '-of',
        'json',
        mp4Path,
      ]),
    ) as {
      streams: Array<Record<string, unknown>>;
      format: { duration: string };
    };
    const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
    const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio');
    expect(videoStream).toMatchObject({
      codec_name: 'h264',
      width: 1_080,
      height: 1_920,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30/1',
    });
    expect(audioStream).toMatchObject({
      codec_name: 'aac',
      channels: 2,
      sample_rate: '48000',
    });
    expect(
      Math.abs(Number(probe.format.duration) * 1_000 - narrationDurationMs),
    ).toBeLessThan(250);

    await mkdir(ARTIFACT_DIR, { recursive: true });
    const artifact = join(ARTIFACT_DIR, live ? 'roblox-30s-live' : 'roblox-30s-fixture');
    await copyFile(mp4Path, `${artifact}.mp4`);
    await copyFile(pngPath, `${artifact}-thumbnail.png`);
    await writeFile(
      `${artifact}-manifest.json`,
      `${JSON.stringify(
        {
          frames: [],
          videoId,
          workspaceId,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(
      `${artifact}-summary.json`,
      `${JSON.stringify(
        {
          request: {
            kind: 'roblox',
            scriptChars: ROBLOX_SCRIPT.length,
            voicePitch: 140,
            captionWordLimit: 6,
            autoAddEmoji: true,
            backgroundVideoId: backgroundAssetId,
            render: { resolution: 1_080, frameRate: 30, format: 'standard' },
          },
          cues: tracks[0]?.cues.length ?? 0,
          ledger: ledger.map((row) => ({
            action: row.action,
            units: row.units,
            unitCost: row.unit_cost,
            delta: row.delta,
          })),
          tts: { source: live ? 'media-service' : 'fixture', durationMs: narrationDurationMs },
          mp4: { bytes: mp4.byteLength, sha256: sha256(mp4), durationMs: narrationDurationMs },
          thumbnail: { bytes: png.byteLength, sha256: sha256(png) },
          probe,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // Idempotency: re-render should not charge or replace
    await renderStep(job('render', 'roblox-render-duplicate'));
    expect(
      (await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))).filter(
        (row) => row.kind === 'render' || row.kind === 'thumbnail',
      ),
    ).toHaveLength(2);
    expect(
      await db.select().from(creditLedger).where(eq(creditLedger.video_id, videoId)),
    ).toHaveLength(4);
  }, LIVE ? 3_600_000 : 300_000);
});
