/**
 * Kill-and-resume across the real step boundary (docs/08 §3.7, P5 gate).
 *
 * The scenario the gate names: `create-images` commits (frames, links, ledger
 * row, `create-captions` job) and then the process dies before pg-boss records
 * the claim as done. On restart the queue redelivers the *same* step. It must
 * find the video already moved on, do no work, write no artifact and charge
 * nothing — and the pipeline must still finish from the committed state.
 *
 * Everything here is real except the two providers that would need a network:
 * the planner is the offline heuristic, TTS answers with an ffmpeg-encoded MP3
 * and a contiguous timeline that follows the request, and images use the
 * procedural adapter plus real ffmpeg post-processing.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createAiVideoV3RequestSchema,
  sceneRowSchema,
  styleProfileSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type { StyleProfile } from '@facelesspro/contracts';
import {
  artStyle,
  asset,
  captionTrack,
  createDb,
  creditLedger,
  databaseUrl,
  jobEvent,
  narration,
  scene,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import {
  createBoss,
  queueFor,
  stopBoss,
} from '@facelesspro/queue';
import type { ConsumedJob, StepHandler } from '@facelesspro/queue';
import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dataDir, resolveStorageKey } from '../art-style/storage';
import { createImageChainFromEnv } from '../image/factory';
import { createHeuristicPlanner } from '../planner/heuristic';
import type { TtsPort } from '../ports/tts';
import { createCreateCaptionsHandler } from './create-captions';
import { createCreateImagesHandler } from './create-images';
import { createCreateScenesHandler } from './create-scenes';
import { createCreateVocalHandler } from './create-vocal';

const TAMIL = 'வணக்கம் நண்பர்களே.';
const ENGLISH = 'Today we plan one useful scene.';
const SCRIPT = `${TAMIL} ${ENGLISH}`;
const TEMPLATE_ID = -3;
const ARTIFACT_DIR = '.data/artifacts/p5-resume';
const START_CREDITS = 1_000;
const IMAGE_UNIT_COST = 5;
const TTS_UNIT_COST = 1;
const SUBTITLE_UNIT_COST = 2;

const PAIR = {
  id: 'valluvar',
  ta: 'ta-IN-ValluvarNeural',
  en: 'ta-IN-ValluvarNeural',
  notes: 'one speaker reads both languages',
};

const profile: StyleProfile = styleProfileSchema.parse({
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene, thick clean outlines',
  palette: { hex: ['#14213d', '#fca311'], weights: [0.7, 0.3] },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple geometric background',
  composition: 'centred subject with generous safe area',
  characters: [],
  typography: { present: false },
  negative: 'photo, text, watermark',
  seedBase: 1234,
  measured: {
    line: { strokeDensity: 0.04, edgeEnergy: 0.08 },
    tone: {
      saturation: { mean: 0.5, p95: 0.8 },
      contrast: { mean: 0.2, p95: 0.5 },
      brightness: { mean: 0.6, p95: 0.9 },
    },
    aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
    safeArea: { edgeContentRatio: 0.04, margin: 0.08 },
    frameCount: 8,
  },
  source: { adapter: 'heuristic', degradedFrom: [] },
});

let db: Database;
let pool: Pool;
let boss: PgBoss;
let workspaceId: string;
let styleId: string;
let videoId: string;
let mp3: Uint8Array;
let durationMs: number;

async function purgeStepQueues(): Promise<void> {
  for (const step of ['create-scenes', 'create-vocal', 'create-images', 'create-captions', 'render'] as const) {
    await boss.purgeQueue(queueFor(step));
  }
}

async function deleteVideoRows(): Promise<void> {
  // Explicit order: `narration.asset_id` and `scene.image_asset_id` restrict.
  await db.delete(captionTrack).where(eq(captionTrack.video_id, videoId));
  await db.delete(narration).where(eq(narration.video_id, videoId));
  await db.delete(scene).where(eq(scene.video_id, videoId));
  await db.delete(creditLedger).where(eq(creditLedger.video_id, videoId));
  await db.delete(asset).where(eq(asset.workspace_id, workspaceId));
  await db.delete(video).where(eq(video.id, videoId));
  await db.delete(artStyle).where(eq(artStyle.id, styleId));
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
      const slot = Math.floor(durationMs / count);

      return {
        requestId: 'resume-test-request',
        audio: mp3,
        mime: 'audio/mpeg',
        durationMs,
        segments: request.segments.map((segment, index) => {
          const startMs = index * slot;
          const spanMs = index === count - 1 ? durationMs - startMs : slot;
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function ledgerRows(): Promise<
  Array<{ action: string; units: number; delta: number }>
> {
  const rows = await db
    .select({
      action: creditLedger.action,
      units: creditLedger.units,
      delta: creditLedger.delta,
    })
    .from(creditLedger)
    .where(eq(creditLedger.video_id, videoId));
  return rows.map((row) => ({
    action: row.action,
    units: Number(row.units),
    delta: Number(row.delta),
  }));
}

async function assetSnapshot(): Promise<Array<{ id: string; key: string; bytes: number }>> {
  const rows = await db
    .select({ id: asset.id, key: asset.key, bytes: asset.bytes })
    .from(asset)
    .where(eq(asset.workspace_id, workspaceId));
  return rows
    .map((row) => ({ id: row.id, key: row.key, bytes: row.bytes }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

describe('kill-and-resume across a committed step (Postgres)', () => {
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
    const source = join(ARTIFACT_DIR, 'source.mp3');
    const encode = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100:duration=2.4',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '128k',
        source,
      ],
      { encoding: 'utf8' },
    );
    if (encode.status !== 0) {
      throw new Error(`ffmpeg could not build the test MP3: ${encode.stderr}`);
    }

    const probe = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', source],
      { encoding: 'utf8' },
    );
    if (probe.status !== 0) {
      throw new Error(`ffprobe could not read the test MP3: ${probe.stderr}`);
    }
    durationMs = Math.round(Number(probe.stdout.trim()) * 1_000);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error(`ffprobe returned an unusable duration: ${probe.stdout}`);
    }
    mp3 = new Uint8Array(await readFile(source));
  });

  afterAll(async () => {
    await stopBoss(boss);
    await pool.end();
    await rm(join(ARTIFACT_DIR, 'source.mp3'), { force: true });
  });

  beforeEach(async () => {
    await purgeStepQueues();
    const workspaces = await db
      .insert(workspace)
      .values({ name: `resume-${randomUUID()}`, credits: START_CREDITS })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const styles = await db
      .insert(artStyle)
      .values({
        workspace_id: workspaceId,
        name: 'Resume integration style',
        formats: ['landscape'],
        profile,
        status: 'ready',
      })
      .returning({ id: artStyle.id });
    styleId = styles[0]!.id;

    const body = createAiVideoV3RequestSchema.parse({
      artStyleId: styleId,
      script: SCRIPT,
      size: 'landscape',
      captions: true,
      captionTemplateId: TEMPLATE_ID,
      render: {},
    });
    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'ai-video-v3', body },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;
  });

  afterEach(async () => {
    await deleteVideoRows();
    await purgeStepQueues();
  });

  it('redelivers a committed step as stale, then finishes from the committed state', async () => {
    const scenes = createCreateScenesHandler({
      db,
      pool,
      boss,
      planner: createHeuristicPlanner(),
    });
    const vocal = createCreateVocalHandler({
      db,
      pool,
      boss,
      tts: fakeTts(),
      defaultPairId: PAIR.id,
      ttsUnitCost: TTS_UNIT_COST,
    });
    const images = createCreateImagesHandler({
      db,
      pool,
      boss,
      image: createImageChainFromEnv({ env: { IMAGE: 'procedural' }, logger: () => {} }),
      imageUnitCost: IMAGE_UNIT_COST,
    });
    const captions = createCreateCaptionsHandler({
      db,
      pool,
      boss,
      subtitleUnitCost: SUBTITLE_UNIT_COST,
    });

    await scenes(job('create-scenes', 'scenes-1'));

    let stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-vocal');
    const sceneRows = (
      await db.select().from(scene).where(eq(scene.video_id, videoId)).orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(sceneRows.length).toBeGreaterThan(0);
    expect(await ledgerRows()).toHaveLength(0);
    expect(await boss.getQueueSize(queueFor('create-vocal'))).toBe(1);

    await vocal(job('create-vocal', 'vocal-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-images');
    const afterVocal = await ledgerRows();
    expect(afterVocal.map((row) => row.action)).toEqual(['tts']);
    expect(afterVocal[0]!.units).toBeGreaterThan(0);
    expect(await boss.getQueueSize(queueFor('create-images'))).toBe(1);

    await images(job('create-images', 'images-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('create-captions');
    expect(stored.status).toBe('processing');

    const committedAssets = await assetSnapshot();
    const committedLedger = await ledgerRows();

    expect(committedAssets.filter((row) => row.key.includes('/frames/'))).toHaveLength(
      sceneRows.length,
    );
    expect(committedLedger.map((row) => row.action).sort()).toEqual(['image', 'tts']);
    expect(await boss.getQueueSize(queueFor('create-captions'))).toBe(1);

    // The crash: the process died after the commit, so pg-boss redelivers the
    // same step. `video.step` has already moved on, so this must be stale.
    await images(job('create-images', 'images-redelivered'));

    const resumed = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(resumed.step).toBe('create-captions');
    expect(resumed.plan).toEqual(stored.plan);
    expect(await assetSnapshot()).toEqual(committedAssets);
    expect(await ledgerRows()).toEqual(committedLedger);
    expect(await boss.getQueueSize(queueFor('create-captions'))).toBe(1);

    const outcomes = (
      await db
        .select({ step: jobEvent.step, outcome: jobEvent.outcome })
        .from(jobEvent)
        .where(eq(jobEvent.video_id, videoId))
    ).map((row) => `${row.step}:${row.outcome}`);
    expect(outcomes.filter((entry) => entry.endsWith(':committed'))).toHaveLength(3);
    expect(outcomes.filter((entry) => entry.endsWith(':stale'))).toEqual([
      'create-images:stale',
    ]);

    // Resume: the next job is already queued; running it completes the steps
    // that never happened, using only committed artifacts.
    await captions(job('create-captions', 'captions-1'));

    stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stored.step).toBe('render');
    expect(stored.status).toBe('rendering');

    const finalAssets = await assetSnapshot();
    expect(finalAssets.filter((row) => row.key.includes('/captions.'))).toHaveLength(4);
    expect(await db.select().from(captionTrack).where(eq(captionTrack.video_id, videoId)))
      .toHaveLength(1);
    expect(await boss.getQueueSize(queueFor('render'))).toBe(1);

    const finalLedger = await ledgerRows();
    expect(finalLedger.map((row) => row.action).sort()).toEqual([
      'image',
      'subtitles',
      'tts',
    ]);
    const spent = finalLedger.reduce((total, row) => total + Math.abs(row.delta), 0);
    const expectedSpend =
      finalLedger.find((row) => row.action === 'tts')!.units * TTS_UNIT_COST +
      finalLedger.find((row) => row.action === 'image')!.units * IMAGE_UNIT_COST +
      SUBTITLE_UNIT_COST;
    expect(spent).toBeCloseTo(expectedSpend, 2);

    const [balance] = await db
      .select({ credits: workspace.credits })
      .from(workspace)
      .where(eq(workspace.id, workspaceId));
    expect(Number(balance?.credits)).toBeCloseTo(START_CREDITS - expectedSpend, 2);

    const firstFrame = finalAssets.find((row) => row.key.includes('/frames/'))!;
    const frameBytes = await readFile(resolveStorageKey(dataDir(), firstFrame.key));
    const frameSha = sha256(frameBytes);
    await writeFile(
      join(ARTIFACT_DIR, 'summary.json'),
      `${JSON.stringify(
        {
          scenes: sceneRows.length,
          frames: finalAssets.filter((row) => row.key.includes('/frames/')).length,
          captions: finalAssets.filter((row) => row.key.includes('/captions.')).length,
          ledger: finalLedger.map((row) => ({ ...row, delta: Math.abs(row.delta) })),
          spent,
          creditsAfter: Number(balance?.credits),
          firstFrame: { key: firstFrame.key, bytes: frameBytes.byteLength, sha256: frameSha },
          outcomes,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(join(ARTIFACT_DIR, 'frame-0001.png'), frameBytes);
  });

  it('runs every step exactly once when the whole chain is delivered twice', async () => {
    const expected = await createHeuristicPlanner().plan({ script: SCRIPT });
    const handler: StepHandler = createCreateScenesHandler({
      db,
      pool,
      boss,
      planner: createHeuristicPlanner(),
    });

    await handler(job('create-scenes', 'scenes-1'));
    await handler(job('create-scenes', 'scenes-1-again'));

    const rows = await db.select().from(scene).where(eq(scene.video_id, videoId));
    expect(rows).toHaveLength(expected.scenes.length);
    expect(await boss.getQueueSize(queueFor('create-vocal'))).toBe(1);
    expect(await ledgerRows()).toHaveLength(0);
  });
});
