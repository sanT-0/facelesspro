/**
 * AI Video V2, end to end, over Postgres + pg-boss + real ffmpeg.
 *
 * The P9 gate asks for one watchable V2 artifact, not a unit-test opinion. This
 * drives a single V2 request through all five production step handlers — a
 * planner, a TTS port, an image chain, the caption step and the real render —
 * and keeps the resulting MP4, thumbnail, manifest and a probe summary under
 * `.data/artifacts/p9-v2/`.
 *
 * Offline (`npm run test:db`) the planner is the heuristic and the images are
 * the procedural floor: real transactions, locks, idempotency, the ledger,
 * Postgres, pg-boss, libass and ffmpeg, but no provider network. `LIVE=1`
 * builds the planner and image chains from `.env` instead, so the artifact is
 * produced by whatever models the deployment actually has. The tone file is
 * not speech in either mode; the separate listening gate proves narration
 * quality.
 *
 * **A green run is not the quality bar.** The summary records the image
 * adapters, what they degraded from, and `productionReady`, so a procedural or
 * local-CPU artifact can never be mistaken for production art.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assetRowSchema,
  createAiVideoRequestSchema,
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
  createDb,
  creditLedger,
  databaseUrl,
  narration,
  render,
  scene,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import { createBoss, queueFor, stopBoss } from '@facelesspro/queue';
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
import { v2StyleId } from '../v2/style';
import { createCreateCaptionsHandler } from './create-captions';
import { createCreateImagesHandler, framesManifestKey } from './create-images';
import { createCreateScenesHandler } from './create-scenes';
import { createCreateVocalHandler } from './create-vocal';
import { createCreateRenderHandler, renderKey, thumbnailKey } from './render';

/** Six sentences, ~53 words: about half a minute of Tamil/English speech. */
const SCRIPT = [
  'வணக்கம் நண்பர்களே, இன்று நாம் ஒரு சிறிய கதையைப் பார்க்கப் போகிறோம்.',
  'நகரத்தின் ஓரத்தில் ஒரு பழைய வீடு நின்றது.',
  'அந்த வீட்டின் ஜன்னலில் ஒரு மஞ்சள் விளக்கு ஒவ்வொரு இரவும் எரிந்தது.',
  'வழிப்போக்கர்கள் அங்கு நின்று சிறிது நேரம் பேசுவார்கள்.',
  'Today a stranger left one book on the wooden table.',
  'அந்த ஒரு புத்தகம் மெதுவாக ஒரு சிறிய நூலகமாக மாறியது.',
  'ஒரு நாள் ஒரு சிறுவன் அந்த நூலகத்தில் ஒரு புதிய கதையைக் கண்டான்.',
  'அவன் அதைப் படித்து முடித்தபோது விளக்கின் வெளிச்சம் இன்னும் பிரகாசமாக இருந்தது.',
].join(' ');

const ARTIFACT_DIR = '.data/artifacts/p9-v2';
const SOURCE_MP3 = join(ARTIFACT_DIR, 'source-30s.mp3');
const AUDIO_SECONDS = 30;
const START_CREDITS = 1_000;
const IMAGE_UNIT_COST = 5;
const TTS_UNIT_COST = 1;
const SUBTITLE_UNIT_COST = 2;
/** `LIVE=1` uses the configured providers and a local CPU image model, which is slow. */
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

/**
 * The gate artifact must be watchable, so `LIVE=1` asks the real media service
 * for narration. The default run stays offline and deterministic with the tone
 * fixture; a live run that cannot reach the service fails instead of silently
 * falling back, because a green live test that used the fixture is a lie.
 */
function ttsFor(live: boolean): TtsPort {
  if (!live) return fakeTts();
  return createMediaTtsPort({ baseUrl: process.env.MEDIA_SERVICE_URL });
}

/**
 * Same rule for the two model-backed steps: the offline run stays
 * deterministic, and `LIVE=1` uses whatever `.env` configures. A live run
 * therefore proves the configured provider path end to end — and when that
 * chain falls back, the artifact summary records the adapter that actually
 * drew each frame.
 */
function plannerFor(live: boolean): PlanFn {
  if (!live) return createHeuristicPlanner();
  return createPlannerChainFromEnv({ env: process.env });
}

function imageFor(live: boolean): ImageFn {
  if (!live) {
    return createImageChainFromEnv({ env: { IMAGE: 'procedural' }, logger: () => {} });
  }
  return createImageChainFromEnv({ env: process.env });
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
  // Explicit order: `narration.asset_id` restricts deletion.
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

/** TTS that answers with real MP3 bytes and a timeline following the request. */
function fakeTts(): TtsPort {
  return {
    resolvePair: async (pairId) => {
      if (pairId !== PAIR.id) throw new Error(`unexpected pair ${pairId}`);
      return PAIR;
    },
    synthesize: async (request) => {
      const count = request.segments.length;
      const slot = Math.floor(fixtureDurationMs / count);

      return {
        requestId: 'p9-v2-request',
        audio: mp3,
        mime: 'audio/mpeg',
        durationMs: fixtureDurationMs,
        segments: request.segments.map((segment, index) => {
          const startMs = index * slot;
          const spanMs = index === count - 1 ? fixtureDurationMs - startMs : slot;
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

describe('AI Video V2 full pipeline (Postgres + ffmpeg)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
    boss = await createBoss({
      connectionString: databaseUrl(),
      supervise: false,
      schedule: false,
    });

    await mkdir(ARTIFACT_DIR, { recursive: true });
    // A real MPEG-1 Layer III file, so the stored asset, ffprobe duration and
    // render audio input all agree. It is a tone, not speech.
    run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=392:sample_rate=44100:duration=${AUDIO_SECONDS}`,
      '-af',
      'volume=0.2',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '128k',
      SOURCE_MP3,
    ]);

    const probe = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', SOURCE_MP3],
      { encoding: 'utf8' },
    );
    if (probe.status !== 0) {
      throw new Error(`ffprobe could not read the test MP3: ${probe.stderr}`);
    }
    fixtureDurationMs = Math.round(Number(probe.stdout.trim()) * 1_000);
    if (!Number.isFinite(fixtureDurationMs) || fixtureDurationMs <= 0) {
      throw new Error(`ffprobe returned an unusable duration: ${probe.stdout}`);
    }
    mp3 = new Uint8Array(await readFile(SOURCE_MP3));
  });

  afterAll(async () => {
    await stopBoss(boss);
    await pool.end();
  });

  beforeEach(async () => {
    await purgeStepQueues();
    const workspaces = await db
      .insert(workspace)
      .values({ name: `v2-${randomUUID()}`, credits: START_CREDITS })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const body = createAiVideoRequestSchema.parse({
      script: SCRIPT,
      imageStyle: 'CINEMATIC',
      size: 'landscape',
      transition: 'strong-swipe',
      render: { resolution: 1080, frameRate: 30, format: 'standard' },
    });
    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'ai-video', body },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;
  });

  afterEach(async () => {
    await deleteVideoRows();
    await purgeStepQueues();
  });

  it('runs all five V2 steps and keeps a 30 s 1080p artifact', async () => {
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
      englishPairId: 'andrew',
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

    await scenes(job('create-scenes', 'v2-scenes-1'));

    let stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-vocal');
    expect(stored.plan).not.toBeNull();
    const plan = scenePlanSchema.parse(stored.plan) as ScenePlan;
    expect(plan.scenes.length).toBeGreaterThan(1);
    // `strong-swipe` is FacelessPro's alternating lateral pan until the
    // composer grows a real cross-fade.
    expect(plan.scenes.map((planned) => planned.motion)).toEqual(
      plan.scenes.map((_, index) => (index % 2 === 0 ? 'pan-left' : 'pan-right')),
    );
    // Create-scenes charges 1 credit (action: 'plan')
    const afterScenes = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(afterScenes).toHaveLength(1);
    expect(afterScenes[0]?.action).toBe('plan');
    expect(afterScenes[0]?.units).toBe(1);
    expect(afterScenes[0]?.unit_cost).toBe(1);

    const sceneRows = (
      await db
        .select()
        .from(scene)
        .where(eq(scene.video_id, videoId))
        .orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(sceneRows.length).toBe(plan.scenes.length);
    // The Tamil correctness invariant: joining scenes still rebuilds the script.
    expect(sceneRows.map((row) => row.text).join(' ')).toBe(SCRIPT);

    await vocal(job('create-vocal', 'v2-vocal-1'));

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
      // The P9 gate says "about 30 seconds"; the real voice decides the exact
      // length, so bound it instead of pretending a network voice is exact.
      expect(Math.abs(narrationDurationMs - 30_000)).toBeLessThanOrEqual(8_000);
    } else {
      expect(narrationDurationMs).toBe(fixtureDurationMs);
    }
    const timings = narrations[0]?.word_timings ?? [];
    expect(timings.length).toBeGreaterThan(30);
    for (let index = 1; index < timings.length; index += 1) {
      expect(timings[index]!.start_ms).toBeGreaterThanOrEqual(timings[index - 1]!.start_ms);
      expect(timings[index]!.end_ms).toBeGreaterThanOrEqual(timings[index]!.start_ms);
    }
    // The master can end on a short tail of silence after the last word.
    expect(timings.at(-1)!.end_ms).toBeGreaterThanOrEqual(narrationDurationMs - 500);
    expect(timings.at(-1)!.end_ms).toBeLessThanOrEqual(narrationDurationMs);

    // `create-vocal` re-derives scene spans from the real narration, so the
    // stored cursor now covers the master instead of the planner's estimate.
    const timedScenes = (
      await db
        .select()
        .from(scene)
        .where(eq(scene.video_id, videoId))
        .orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(timedScenes[0]!.start_ms).toBe(0);
    expect(timedScenes.at(-1)!.end_ms).toBe(narrationDurationMs);
    for (let index = 1; index < timedScenes.length; index += 1) {
      expect(timedScenes[index]!.start_ms).toBeGreaterThanOrEqual(
        timedScenes[index - 1]!.end_ms,
      );
    }

    await images(job('create-images', 'v2-images-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-captions');

    // Every scene got a frame, and the manifest records the preset's stable id
    // rather than inventing a UUID for a V2 request that has no art style row.
    const imageAssets = await db
      .select()
      .from(asset)
      .where(eq(asset.workspace_id, workspaceId));
    expect(imageAssets.filter((row) => row.kind === 'image')).toHaveLength(sceneRows.length);

    const manifestKey = framesManifestKey(workspaceId, videoId);
    const manifest = sceneManifestSchema.parse(
      JSON.parse(
        await readFile(resolveStorageKey(dataDir(), manifestKey), 'utf8'),
      ) as unknown,
    );
    expect(manifest.styleId).toBe(v2StyleId('CINEMATIC'));
    expect(manifest.frames.map((frame) => frame.idx)).toEqual(
      sceneRows.map((row) => row.idx),
    );

    await captions(job('create-captions', 'v2-captions-1'));

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

    await renderStep(job('render', 'v2-render-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.status).toBe('completed');
    expect(stored.step).toBeNull();
    expect(stored.duration_ms).toBe(narrationDurationMs);
    expect(stored.video_url).toBe(renderKey(workspaceId, videoId, 1_080, 30, 'standard'));

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
      'image',
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
      width: 1_920,
      height: 1_080,
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

    // Provenance matters more than the fact that a file exists: the offline
    // procedural floor keeps the pipeline runnable, but it is not production
    // art. The summary says so explicitly so a smoke artifact cannot be
    // mistaken for a production-quality video again.
    const imageAdapters = [...new Set(manifest.frames.map((frame) => frame.adapter))];
    const degradedFrom = [...new Set(manifest.frames.flatMap((frame) => frame.degradedFrom))];
    const productionReady = imageAdapters.every((adapter) => adapter !== 'procedural');

    await mkdir(ARTIFACT_DIR, { recursive: true });
    // Keep the two runs apart: the offline fixture must never overwrite the
    // live-narrated gate artifact.
    const artifact = join(ARTIFACT_DIR, live ? 'v2-30s-live' : 'v2-30s-fixture');
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
            kind: 'ai-video',
            imageStyle: 'CINEMATIC',
            size: 'landscape',
            transition: 'strong-swipe',
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
          planner: {
            adapter: plan.adapter,
            degradedFrom: plan.degradedFrom,
            describe: live ? (process.env.PLANNER_DESCRIBE?.trim() || null) : null,
          },
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

    // A redelivery of the finished render must not charge or replace anything.
    await renderStep(job('render', 'v2-render-duplicate'));
    expect(
      (await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))).filter(
        (row) => row.kind === 'render' || row.kind === 'thumbnail',
      ),
    ).toHaveLength(2);
    expect(
      await db.select().from(creditLedger).where(eq(creditLedger.video_id, videoId)),
    ).toHaveLength(5);
  }, LIVE ? 3_600_000 : 300_000);
});
