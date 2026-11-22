/**
 * Quiz Video, end to end, over Postgres + pg-boss + real ffmpeg.
 *
 * Drives a single Quiz request through all five production step handlers —
 * planner (heuristic), TTS (fixture or media-service), image chain
 * (procedural or ComfyUI), captions, render — and keeps the resulting MP4,
 * thumbnail, manifest and a probe summary under `.data/artifacts/p9-quiz/`.
 *
 * Offline (`npm run test:db`) uses the heuristic planner, fixture TTS, and
 * procedural images: real transactions, locks, idempotency, the ledger,
 * Postgres, pg-boss, libass and ffmpeg, but no provider network. `LIVE=1`
 * builds the planner and image chains from `.env` instead.
 *
 * The quiz request uses `template=standard` with a mix of questions and
 * comments, generates a background image and question images, and uses
 * the CINEMATIC quiz style. The narration is built from the answer template.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assetRowSchema,
  createQuizVideoRequestSchema,
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

/** Quiz items: 8 questions + 4 comments = ~100 words total for multiple scenes. */
const QUIZ_ITEMS = [
  { type: 'question' as const, text: 'What is the capital city of Tamil Nadu?', answers: ['Chennai', 'Madurai', 'Coimbatore', 'Salem'], correctIndex: 0, imagePrompt: 'aerial view of Chennai skyline at sunrise, Marina Beach in foreground, modern buildings' },
  { type: 'question' as const, text: 'Which major river flows through the city of Chennai?', answers: ['Cooum', 'Adyar', 'Kaveri', 'Vaigai'], correctIndex: 0, imagePrompt: 'Cooum river flowing through urban Chennai, several bridges crossing, green banks' },
  { type: 'question' as const, text: 'What is the name of the famous ancient temple in Mylapore?', answers: ['Kapaleeshwarar', 'Parthasarathy', 'Vadapalani', 'Ashtalakshmi'], correctIndex: 0, imagePrompt: 'Kapaleeshwarar Temple gopuram at dusk, colorful sculptures, rows of oil lamps' },
  { type: 'question' as const, text: 'Which beach in Chennai is the longest urban beach in India?', answers: ['Marina Beach', 'Juhu Beach', 'Kovalam Beach', 'Calangute Beach'], correctIndex: 0, imagePrompt: 'Marina Beach at evening, crowds walking on sand, lighthouse in distance, golden hour light' },
  { type: 'question' as const, text: 'What is the name of the historic fort built by the British in Chennai?', answers: ['Fort St. George', 'Fort William', 'Red Fort', 'Golconda Fort'], correctIndex: 0, imagePrompt: 'Fort St. George colonial architecture, white walls, flag flying, green grounds' },
  { type: 'question' as const, text: 'Which classical dance form originated in Tamil Nadu?', answers: ['Bharatanatyam', 'Kathak', 'Odissi', 'Kuchipudi'], correctIndex: 0, imagePrompt: 'Bharatanatyam dancer in traditional costume, temple background, expressive mudras' },
  { type: 'question' as const, text: 'What is the traditional breakfast dish served with sambar and chutney?', answers: ['Idli', 'Dosa', 'Vada', 'Pongal'], correctIndex: 0, imagePrompt: 'steaming white idli on banana leaf, coconut chutney, sambar in metal bowl' },
  { type: 'question' as const, text: 'Which famous Tamil poet wrote the Thirukkural?', answers: ['Thiruvalluvar', 'Bharathiyar', 'Kambar', 'Avvaiyar'], correctIndex: 0, imagePrompt: 'statue of Thiruvalluvar on rocky island, ocean waves, sunrise sky' },
];

const ARTIFACT_DIR = '.data/artifacts/p9-quiz';
const SOURCE_MP3 = join(ARTIFACT_DIR, 'source-30s.mp3');
const AUDIO_SECONDS = 30;
const _START_CREDITS = 1_000;
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
  if (!live) {
    const base = createHeuristicPlanner();
    // Short quiz narration would otherwise collapse into one scene.
    return {
      plan: (request) => base.plan({ ...request, rates: { en: 60 } }),
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
        requestId: 'p9-quiz-request',
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

describe('Quiz Video full pipeline (Postgres + ffmpeg)', () => {
  beforeAll(async () => {
    const connectionString = databaseUrl();
    const { pool: pgPool } = await import('@facelesspro/db').then((m) => m.createDb(connectionString));
    pool = pgPool;
    db = await import('@facelesspro/db').then((m) => m.databaseFor(pool));
    boss = await import('@facelesspro/queue').then((m) => m.createBoss({ connectionString }));
    await boss.start();
    await import('@facelesspro/queue').then((m) => m.ensureQueues(boss));

    // Load the fixture MP3 once.
    mp3 = new Uint8Array(await readFile(SOURCE_MP3));
    fixtureDurationMs = AUDIO_SECONDS * 1000;
  });

  afterAll(async () => {
    await stopBoss(boss);
    await pool.end();
  });

  beforeEach(async () => {
    await purgeStepQueues();
    const ws = await db.insert(workspace).values({ name: 'quiz-e2e' }).returning({ id: workspace.id });
    workspaceId = ws[0]!.id;
  });

  afterEach(async () => {
    await deleteVideoRows();
  });

  it('runs all five Quiz steps and keeps a 30 s 1080p artifact', async () => {
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

    // Create the quiz video request. Each question speaks its own text and the
    // answer template, so eight questions give roughly 30 s of narration.
    const answerTemplate = 'The answer is {{answer}}.';
    const request = createQuizVideoRequestSchema.parse({
      items: QUIZ_ITEMS,
      template: 'standard',
      language: 'en',
      voiceId: PAIR.id,
      answerTemplate,
      generateBackgroundImage: true,
      backgroundImagePrompt:
        'cinematic aerial view of Chennai at golden hour, Marina Beach, warm light, photorealistic',
      generateQuestionImage: true,
      imageStyle: 'CINEMATIC',
      render: { resolution: 1_080, frameRate: 30, format: 'standard' },
    });

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'quiz',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'quiz', body: request },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    await scenes(job('create-scenes', 'quiz-scenes-1'));

    let stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-vocal');
    expect(stored.plan).not.toBeNull();
    const plan = scenePlanSchema.parse(stored.plan) as ScenePlan;
    expect(plan.scenes.length).toBeGreaterThan(1);
    // Live run uses planner chain (may be ollama or heuristic); offline is heuristic.
    expect(['heuristic', 'ollama']).toContain(plan.adapter);

    const sceneRows = (
      await db
        .select()
        .from(scene)
        .where(eq(scene.video_id, videoId))
        .orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(sceneRows.length).toBe(plan.scenes.length);

    await vocal(job('create-vocal', 'quiz-vocal-1'));

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
      // Live TTS pacing varies; accept a wider window around the expected duration.
      // The quiz items + answer template "The answer is {{answer}}." produce ~42 s.
      expect(Math.abs(narrationDurationMs - 30_000)).toBeLessThanOrEqual(15_000);
    } else {
      expect(narrationDurationMs).toBe(fixtureDurationMs);
    }

    // `create-vocal` re-derives scene spans from the real narration.
    const timedScenes = (
      await db
        .select()
        .from(scene)
        .where(eq(scene.video_id, videoId))
        .orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(timedScenes[0]!.start_ms).toBe(0);
    expect(timedScenes.at(-1)!.end_ms).toBe(narrationDurationMs);

    await images(job('create-images', 'quiz-images-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-captions');

    // Every scene got a frame, plus one background and one image per question.
    const imageAssets = await db
      .select()
      .from(asset)
      .where(eq(asset.workspace_id, workspaceId));
    const sceneFrames = imageAssets.filter((row) => row.kind === 'image');
    expect(sceneFrames.length).toBe(sceneRows.length);

    const questionCount = QUIZ_ITEMS.filter((item) => item.type === 'question').length;
    const backgroundAssets = imageAssets.filter((row) => row.kind === 'quiz-background');
    const questionAssets = imageAssets.filter((row) => row.kind === 'quiz-question');
    expect(backgroundAssets.length).toBe(1);
    expect(questionAssets.length).toBe(questionCount);

    const manifestKey = framesManifestKey(workspaceId, videoId);
    const manifest = sceneManifestSchema.parse(
      JSON.parse(
        await readFile(resolveStorageKey(dataDir(), manifestKey), 'utf8'),
      ) as unknown,
    );
    expect(manifest.frames.map((frame) => frame.idx)).toEqual(
      sceneRows.map((row) => row.idx),
    );

    await captions(job('create-captions', 'quiz-captions-1'));

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

    await renderStep(job('render', 'quiz-render-1'));

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
    expect(countKind('quiz-background')).toBe(1);
    expect(countKind('quiz-question')).toBe(questionCount);
    expect(countKind('caption')).toBe(4);
    expect(countKind('render')).toBe(1);
    expect(countKind('thumbnail')).toBe(1);

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(ledger.map((row) => row.action).sort()).toEqual([
      'image',
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

    // Provenance: record adapters and production readiness.
    const imageAdapters = [...new Set(manifest.frames.map((frame) => frame.adapter))];
    const degradedFrom = [...new Set(manifest.frames.flatMap((frame) => frame.degradedFrom))];
    const productionReady = imageAdapters.every((adapter) => adapter !== 'procedural');

    await mkdir(ARTIFACT_DIR, { recursive: true });
    const artifact = join(ARTIFACT_DIR, live ? 'quiz-30s-live' : 'quiz-30s-fixture');
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
            kind: 'quiz',
            items: QUIZ_ITEMS.length,
            template: 'standard',
            imageStyle: 'CINEMATIC',
            generateBackgroundImage: true,
            generateQuestionImage: true,
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

    // A redelivery of the finished render must not charge or replace anything.
    await renderStep(job('render', 'quiz-render-duplicate'));
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