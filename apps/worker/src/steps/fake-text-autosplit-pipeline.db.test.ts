/**
 * Fake Text Video autoSplit test, end to end, over Postgres + pg-boss + real ffmpeg.
 *
 * Tests the autoSplit functionality with a long conversation that exceeds
 * FAKE_TEXT_SCENE_CHAR_LIMIT (800 chars), producing multiple scenes/frames.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assetRowSchema,
  createFakeTextVideoRequestSchema,
  renderRowSchema,
  scenePlanSchema,
  sceneManifestSchema,
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
import { createCreateImagesHandler, framesManifestKey } from './create-images';
import { createCreateScenesHandler } from './create-scenes';
import { createCreateVocalHandler } from './create-vocal';
import { createCreateRenderHandler, renderKey, thumbnailKey } from './render';

/** Fake text conversation: 2 characters, 20 messages = ~60s narration, autoSplit: true. */
const FAKE_TEXT_CONVERSATION_AUTOSPLIT = {
  template: 'whatsapp' as const,
  language: 'en' as const,
  characters: [
    { id: 'arun', name: 'Arun', side: 'left' as const, voiceId: 'valluvar' },
    { id: 'bala', name: 'Bala', side: 'right' as const, voiceId: 'pallavi' },
  ],
  messages: [
    { text: 'Hey, did you see the cricket match yesterday between India and Australia?', characterId: 'arun' },
    { text: 'Yeah, what a game! That last over was absolutely insane with the run chase.', characterId: 'bala' },
    { text: 'I honestly thought we were completely done for at 45 for 4 in the tenth over.', characterId: 'arun' },
    { text: 'Same here. But then Jadeja turned it around completely with that partnership.', characterId: 'bala' },
    { text: 'His partnership with Hardik Pandya was absolutely clutch under pressure.', characterId: 'arun' },
    { text: 'Absolutely. 78 runs off just 42 balls? That has to be legendary stuff right there.', characterId: 'bala' },
    { text: 'Did you see that incredible catch at the boundary by the fielder?', characterId: 'arun' },
    { text: 'The one-handed stunner? I still cannot believe he actually caught that cleanly.', characterId: 'bala' },
    { text: 'Best match of the entire season so far without any doubt in my mind.', characterId: 'arun' },
    { text: 'Completely agreed. Cannot wait for the next match between these two teams.', characterId: 'bala' },
    { text: 'What about the bowling performance though? Bumrah was absolutely on fire today.', characterId: 'arun' },
    { text: 'Four wickets for just 28 runs in his ten overs? That is world-class bowling right there.', characterId: 'bala' },
    { text: 'And the fielding effort to back it up was just as impressive throughout the innings.', characterId: 'arun' },
    { text: 'Every run saved in the field made the difference in such a tight and close contest.', characterId: 'bala' },
    { text: 'The middle overs partnership really set up the platform for the final flourish.', characterId: 'arun' },
    { text: 'Exactly. Rotating strike and finding boundaries at regular intervals was the key.', characterId: 'bala' },
    { text: 'Same time next weekend for the second ODI? We should make it a regular thing.', characterId: 'arun' },
    { text: 'You know it. I will bring the snacks and drinks this time around for sure.', characterId: 'bala' },
    { text: 'Perfect. Let me know what time works best and I will be there early.', characterId: 'arun' },
    { text: 'How about 2 PM at the usual spot? We can grab lunch before the match starts.', characterId: 'bala' },
  ],
  autoSplit: true,
  groupName: 'Cricket Fans',
  groupPhoto: undefined,
  tinderMatch: false,
  useVoiceV2: false,
};

const ARTIFACT_DIR = '.data/artifacts/p9-fake-text-autosplit';
const SOURCE_MP3 = join(ARTIFACT_DIR, 'source-30s.mp3');
const AUDIO_SECONDS = 60;
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
        requestId: 'p9-fake-text-autosplit-request',
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

let db: Database;
let pool: Pool;
let boss: PgBoss;
let workspaceId: string;
let videoId: string;
let mp3: Uint8Array;
let fixtureDurationMs: number;

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

describe('Fake Text Video autoSplit pipeline (Postgres + ffmpeg)', () => {
  beforeAll(async () => {
    const connectionString = databaseUrl();
    const { pool: pgPool } = await import('@facelesspro/db').then((m) => m.createDb(connectionString));
    pool = pgPool;
    db = await import('@facelesspro/db').then((m) => m.databaseFor(pool));
    boss = await import('@facelesspro/queue').then((m) => m.createBoss({ connectionString }));
    await boss.start();
    await import('@facelesspro/queue').then((m) => m.ensureQueues(boss));

    mp3 = new Uint8Array(await readFile(SOURCE_MP3));
    fixtureDurationMs = AUDIO_SECONDS * 1000;
  });

  afterAll(async () => {
    await stopBoss(boss);
    await pool.end();
  });

  beforeEach(async () => {
    await purgeStepQueues();
    const ws = await db.insert(workspace).values({ name: 'fake-text-autosplit-e2e' }).returning({ id: workspace.id });
    workspaceId = ws[0]!.id;
  });

  afterEach(async () => {
    await deleteVideoRows();
  });

  it('runs full autoSplit pipeline and produces multiple scenes', async () => {
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

    const request = createFakeTextVideoRequestSchema.parse({
      conversations: [FAKE_TEXT_CONVERSATION_AUTOSPLIT],
      render: { resolution: 1_080, frameRate: 30, format: 'standard' },
    });

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'fake-text',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'fake-text', body: request },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    await scenes(job('create-scenes', 'fake-text-autosplit-scenes-1'));

    let stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-vocal');
    const plan = scenePlanSchema.parse(stored.plan) as ScenePlan;
    // autoSplit should produce multiple scenes (limit is 800 chars, this conversation is ~2500 chars)
    expect(plan.scenes.length).toBeGreaterThan(1);
    expect(['heuristic', 'ollama']).toContain(plan.adapter);

    const sceneRows = (
      await db
        .select()
        .from(scene)
        .where(eq(scene.video_id, videoId))
        .orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(sceneRows.length).toBe(plan.scenes.length);

    await vocal(job('create-vocal', 'fake-text-autosplit-vocal-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-images');
    const afterVocal = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(afterVocal.map((row) => row.action)).toEqual(['tts']);

    const narrations = await db
      .select()
      .from(narration)
      .where(eq(narration.video_id, videoId));
    expect(narrations).toHaveLength(1);
    const narrationDurationMs = narrations[0]?.duration_ms ?? 0;
    expect(stored.duration_ms).toBe(narrationDurationMs);
    if (live) {
      expect(Math.abs(narrationDurationMs - 60_000)).toBeLessThanOrEqual(15_000);
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

    await images(job('create-images', 'fake-text-autosplit-images-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-captions');

    const imageAssets = await db
      .select()
      .from(asset)
      .where(eq(asset.workspace_id, workspaceId));
    const sceneFrames = imageAssets.filter((row) => row.kind === 'image');
    expect(sceneFrames.length).toBe(sceneRows.length);

    const chatSkinFrames = imageAssets.filter((row) => row.meta?.adapter === 'procedural');
    expect(chatSkinFrames.length).toBe(sceneRows.length);

    const manifestKey = framesManifestKey(workspaceId, videoId);
    const manifest = sceneManifestSchema.parse(
      JSON.parse(
        await readFile(resolveStorageKey(dataDir(), manifestKey), 'utf8'),
      ) as unknown,
    );
    expect(manifest.frames.map((frame) => frame.idx)).toEqual(
      sceneRows.map((row) => row.idx),
    );
    expect(manifest.frames.every((frame) => frame.adapter === 'procedural')).toBe(true);
    expect(manifest.frames.length).toBeGreaterThan(1);

    await captions(job('create-captions', 'fake-text-autosplit-captions-1'));

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

    await renderStep(job('render', 'fake-text-autosplit-render-1'));

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
    expect(countKind('image')).toBe(sceneRows.length);
    expect(countKind('caption')).toBe(4);
    expect(countKind('render')).toBe(1);
    expect(countKind('thumbnail')).toBe(1);

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(ledger.map((row) => row.action).sort()).toEqual([
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

    const imageAdapters = [...new Set(manifest.frames.map((frame) => frame.adapter))];
    const degradedFrom = [...new Set(manifest.frames.flatMap((frame) => frame.degradedFrom))];
    const productionReady = imageAdapters.every((adapter) => adapter !== 'procedural');

    await mkdir(ARTIFACT_DIR, { recursive: true });
    const artifact = join(ARTIFACT_DIR, live ? 'fake-text-autosplit-60s-live' : 'fake-text-autosplit-60s-fixture');
    await copyFile(mp4Path, `${artifact}.mp4`);
    await copyFile(pngPath, `${artifact}-thumbnail.png`);
    await writeFile(
      `${artifact}-manifest.json`,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      `${artifact}-summary.json`,
      `${JSON.stringify(
        {
          request: {
            kind: 'fake-text',
            conversations: 1,
            template: 'whatsapp',
            characters: 2,
            messages: FAKE_TEXT_CONVERSATION_AUTOSPLIT.messages.length,
            autoSplit: true,
            render: { resolution: 1_080, frameRate: 30, format: 'standard' },
          },
          scenes: timedScenes.map((row) => ({
            idx: row.idx,
            text: row.text,
            motion: plan.scenes[row.idx]?.motion,
            startMs: row.start_ms,
            endMs: row.end_ms,
          })),
          cues: tracks[0]?.cues.length ?? 0,
          ledger: ledger.map((row) => ({
            action: row.action,
            units: row.units,
            unitCost: row.unit_cost,
            delta: row.delta,
          })),
          tts: { source: live ? 'media-service' : 'fixture', durationMs: narrationDurationMs },
          images: { adapters: imageAdapters, degradedFrom, productionReady },
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
    await renderStep(job('render', 'fake-text-autosplit-render-duplicate'));
    expect(
      (await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))).filter(
        (row) => row.kind === 'render' || row.kind === 'thumbnail',
      ),
    ).toHaveLength(2);
    expect(
      await db.select().from(creditLedger).where(eq(creditLedger.video_id, videoId)),
    ).toHaveLength(3);
  }, LIVE ? 3_600_000 : 300_000);
});