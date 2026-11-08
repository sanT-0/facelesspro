/**
 * The real `create-images` commit against Postgres + pg-boss.
 *
 * The hermetic suite proves the decisions. This proves that the offline
 * procedural adapter, real ffmpeg post-processing and one Postgres transaction
 * produce two stored PNGs, linked scene rows, a manifest and one ledger row —
 * and that a stale duplicate delivery changes none of it.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createAiVideoV3RequestSchema,
  sceneManifestSchema,
  scenePlanSchema,
  sceneRowSchema,
  styleProfileSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type { ScenePlan, StyleProfile } from '@facelesspro/contracts';
import { sceneSeedFor } from '@facelesspro/core';
import {
  artStyle,
  asset,
  createDb,
  creditLedger,
  databaseUrl,
  scene,
  video,
  workspace,
} from '@facelesspro/db';
import type { Database } from '@facelesspro/db';
import {
  createBoss,
  enqueueStep,
  queueFor,
  stopBoss,
} from '@facelesspro/queue';
import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dataDir, resolveStorageKey } from '../art-style/storage';
import { createImageChainFromEnv } from '../image/factory';
import { startWorker } from '../worker';
import {
  createCreateImagesHandler,
  frameKey,
  framesManifestKey,
} from './create-images';

const ARTIFACT_DIR = '.data/artifacts/p5-create-images';

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

const TEXT = ['வணக்கம் நண்பர்களே.', 'Today we plan one useful scene.'] as const;

let db: Database;
let pool: Pool;
let boss: PgBoss;
let workspaceId: string;
let styleId: string;
let videoId: string;

async function purgeStepQueues(): Promise<void> {
  await boss.purgeQueue(queueFor('create-images'));
  await boss.purgeQueue(queueFor('create-captions'));
}

async function deleteVideoRows(): Promise<void> {
  // `scene.image_asset_id` restricts asset deletion, so release scenes first.
  await db.delete(scene).where(eq(scene.video_id, videoId));
  await db.delete(creditLedger).where(eq(creditLedger.video_id, videoId));
  await db.delete(asset).where(eq(asset.workspace_id, workspaceId));
  await db.delete(video).where(eq(video.id, videoId));
  await db.delete(artStyle).where(eq(artStyle.id, styleId));
  await db.delete(workspace).where(eq(workspace.id, workspaceId));
}

function planFor(scenes: ScenePlan['scenes']): ScenePlan {
  return {
    scenes,
    adapter: 'heuristic',
    degradedFrom: [],
    totalMs: scenes.at(-1)?.endMs ?? 0,
  };
}

describe('create-images step (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
    boss = await createBoss({
      connectionString: databaseUrl(),
      supervise: false,
      schedule: false,
    });
  });

  afterAll(async () => {
    await stopBoss(boss);
    await pool.end();
  });

  beforeEach(async () => {
    await purgeStepQueues();
    const workspaces = await db
      .insert(workspace)
      .values({ name: `create-images-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const styles = await db
      .insert(artStyle)
      .values({
        workspace_id: workspaceId,
        name: 'Create images integration style',
        formats: ['landscape'],
        profile,
        status: 'ready',
      })
      .returning({ id: artStyle.id });
    styleId = styles[0]!.id;

    const body = createAiVideoV3RequestSchema.parse({
      artStyleId: styleId,
      script: TEXT.join(' '),
      size: 'landscape',
    });
    const plan = planFor([
      {
        text: TEXT[0],
        imagePrompt: `${profile.promptPrefix}, a greeting, palette #14213d #fca311, no text`,
        motion: 'kenburns-in',
        emphasis: [],
        startMs: 0,
        endMs: 1_200,
      },
      {
        text: TEXT[1],
        imagePrompt: `${profile.promptPrefix}, a desk by a window, palette #14213d #fca311`,
        motion: 'pan-left',
        emphasis: ['useful'],
        startMs: 1_200,
        endMs: 2_400,
      },
    ]);

    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-images',
        request: { kind: 'ai-video-v3', body },
        plan,
        duration_ms: plan.totalMs,
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    await db.insert(scene).values(
      plan.scenes.map((planned, idx) => ({
        video_id: videoId,
        idx,
        text: planned.text,
        motion: { preset: planned.motion, emphasis: planned.emphasis },
        start_ms: planned.startMs,
        end_ms: planned.endMs,
      })),
    );
  });

  afterEach(async () => {
    await deleteVideoRows();
    await purgeStepQueues();
  });

  it('stores one post-processed PNG per scene, links them and advances once', async () => {
    const handler = createCreateImagesHandler({
      db,
      pool,
      boss,
      image: createImageChainFromEnv({
        env: { IMAGE: 'procedural' },
        logger: () => {},
      }),
    });
    const job = { jobId: 'manual-create-images', videoId, step: 'create-images' as const };

    let completed!: () => void;
    let failed!: (error: unknown) => void;
    const handled = new Promise<void>((resolve, reject) => {
      completed = resolve;
      failed = reject;
    });
    const worker = await startWorker({
      boss,
      log: () => {},
      steps: {
        'create-images': async (queued) => {
          try {
            await handler(queued);
            completed();
          } catch (error) {
            failed(error);
            throw error;
          }
        },
      },
    });

    try {
      const queued = await enqueueStep(boss, { videoId, step: 'create-images' });
      expect(queued).not.toBeNull();
      await handled;
    } finally {
      await worker.stop();
    }

    const storedVideo = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    const plan = scenePlanSchema.parse(storedVideo.plan);
    expect(storedVideo.step).toBe('create-captions');
    expect(storedVideo.status).toBe('processing');

    const sceneRows = (
      await db
        .select()
        .from(scene)
        .where(eq(scene.video_id, videoId))
        .orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(sceneRows).toHaveLength(2);

    const assets = await db.select().from(asset).where(eq(asset.workspace_id, workspaceId));
    expect(assets).toHaveLength(2);
    expect(assets.every((row) => row.kind === 'image' && row.mime === 'image/png')).toBe(true);

    const assetByKey = new Map(assets.map((row) => [row.key, row]));
    for (const [idx, row] of sceneRows.entries()) {
      const key = frameKey(workspaceId, videoId, idx);
      const stored = assetByKey.get(key);
      expect(stored).toBeDefined();
      expect(row.image_asset_id).toBe(stored?.id);

      const bytes = await readFile(resolveStorageKey(dataDir(), key));
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(stored?.bytes).toBe(bytes.byteLength);
      expect(stored?.meta.sha256).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
    }

    const manifestKey = framesManifestKey(workspaceId, videoId);
    const manifest = sceneManifestSchema.parse(
      JSON.parse(await readFile(resolveStorageKey(dataDir(), manifestKey), 'utf8')),
    );
    expect(manifest.frames.map((frame) => frame.idx)).toEqual([0, 1]);
    expect(manifest.frames.map((frame) => frame.seed)).toEqual(
      plan.scenes.map((_planned, idx) => sceneSeedFor(videoId, idx)),
    );
    expect(manifest.frames.every((frame) => frame.bytes > 0)).toBe(true);
    expect(manifest.frames[0]?.prompt).toContain(profile.promptPrefix);

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      action: 'image',
      units: 1,
      unit_cost: 0,
      delta: 0,
    });

    expect(await boss.getQueueSize(queueFor('create-captions'))).toBe(1);

    await mkdir(ARTIFACT_DIR, { recursive: true });
    const firstKey = frameKey(workspaceId, videoId, 0);
    const firstBytes = await readFile(resolveStorageKey(dataDir(), firstKey));
    await writeFile(join(ARTIFACT_DIR, 'frame-0001.png'), firstBytes);
    await writeFile(
      join(ARTIFACT_DIR, 'manifest.json'),
      await readFile(resolveStorageKey(dataDir(), manifestKey)),
    );
    await writeFile(
      join(ARTIFACT_DIR, 'summary.json'),
      `${JSON.stringify(
        {
          sha256: createHash('sha256').update(firstBytes).digest('hex'),
          bytes: firstBytes.byteLength,
          sceneCount: manifest.frames.length,
          frames: manifest.frames.map((frame) => ({
            idx: frame.idx,
            key: frame.key,
            seed: frame.seed,
            adapter: frame.adapter,
            bytes: frame.bytes,
            sha256: frame.sha256,
            regenerated: frame.consistency.regenerated,
            deltaE: frame.correction.deltaE,
          })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // A stale redelivery of the same job must not write a second set of assets,
    // charge again or enqueue another create-captions job.
    await handler({ ...job, jobId: 'duplicate-create-images' });

    expect(await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))).toHaveLength(
      2,
    );
    expect(
      await db.select().from(creditLedger).where(eq(creditLedger.video_id, videoId)),
    ).toHaveLength(1);
    expect(await boss.getQueueSize(queueFor('create-captions'))).toBe(1);
  });
});
