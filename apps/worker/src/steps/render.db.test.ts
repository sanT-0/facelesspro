/**
 * The real `render` commit: Postgres + pg-boss + ffmpeg + libass.
 *
 * The hermetic suite proves decisions. This drives one queued job through the
 * production worker and checks the actual MP4, thumbnail, render row, assets,
 * ledger row and terminal video state. The retained MP4 is the P5 artifact.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assetRowSchema,
  captionCueSchema,
  createAiVideoV3RequestSchema,
  renderRowSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import { buildAss, buildCaptionCues } from '@facelesspro/core';
import type { CaptionWord } from '@facelesspro/core';
import {
  asset,
  beginRender,
  captionTrack,
  createDb,
  creditLedger,
  databaseUrl,
  jobEvent,
  narration,
  render,
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

import {
  dataDir,
  ensureParentPath,
  resolveStorageKey,
} from '../art-style/storage';
import { captionKey } from './create-captions';
import {
  createCreateRenderHandler,
  renderKey,
  thumbnailKey,
} from './render';
import { startWorker } from '../worker';

const ARTIFACT_DIR = '.data/artifacts/p5-render';
const SCRIPT = 'வணக்கம் நண்பர்களே. Today fire!';
const WORDS: CaptionWord[] = [
  { text: 'வணக்கம்', startMs: 0, endMs: 400 },
  { text: 'நண்பர்களே.', startMs: 400, endMs: 800 },
  { text: 'Today', startMs: 1_000, endMs: 1_300 },
  { text: 'fire!', startMs: 1_300, endMs: 1_600 },
];

let db: Database;
let pool: Pool;
let boss: PgBoss;
let workspaceId: string;
let videoId: string;

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

async function deleteVideoRows(): Promise<void> {
  await db.delete(creditLedger).where(eq(creditLedger.video_id, videoId));
  // Cascades scenes, narration, caption_track, render and job_lock.
  await db.delete(video).where(eq(video.id, videoId));
  await db.delete(asset).where(eq(asset.workspace_id, workspaceId));
  await db.delete(workspace).where(eq(workspace.id, workspaceId));
}

describe('render step (Postgres + ffmpeg)', () => {
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
    await boss.purgeQueue(queueFor('render'));

    const workspaces = await db
      .insert(workspace)
      .values({ name: `render-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const request = createAiVideoV3RequestSchema.parse({
      artStyleId: randomUUID(),
      script: SCRIPT,
      size: 'landscape',
      captions: true,
      captionTemplateId: -1,
      render: { resolution: 1080, frameRate: 30, format: 'standard' },
    });
    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'rendering',
        step: 'render',
        request: { kind: 'ai-video-v3', body: request },
        duration_ms: 2_000,
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    const root = dataDir();
    const frameKeys = [
      `ws/${workspaceId}/videos/${videoId}/frames/0001.png`,
      `ws/${workspaceId}/videos/${videoId}/frames/0002.png`,
    ];
    const colours = ['0x101820', '0x204060'];
    for (const [index, key] of frameKeys.entries()) {
      const path = resolveStorageKey(root, key);
      await ensureParentPath(path);
      run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=${colours[index]}:s=1024x576`,
        '-frames:v', '1', path,
      ]);
    }

    const audioKey = `ws/${workspaceId}/videos/${videoId}/audio/narration.mp3`;
    const audioPath = resolveStorageKey(root, audioKey);
    await ensureParentPath(audioPath);
    run('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-t', '2', '-c:a', 'libmp3lame', '-q:a', '9', audioPath,
    ]);

    const insertedAudio = await db
      .insert(asset)
      .values({
        workspace_id: workspaceId,
        kind: 'audio',
        key: audioKey,
        bytes: (await stat(audioPath)).size,
        mime: 'audio/mpeg',
        meta: {},
      })
      .returning({ id: asset.id });

    await db.insert(narration).values({
      video_id: videoId,
      asset_id: insertedAudio[0]!.id,
      duration_ms: 2_000,
      word_timings: WORDS.map((word) => ({
        text: word.text,
        start_ms: word.startMs,
        end_ms: word.endMs,
      })),
      voice_plan: { script: SCRIPT, spokenText: SCRIPT, runs: [], overrides: [], pair: 'valluvar' },
    });

    const frameAssets = await db
      .insert(asset)
      .values(
        frameKeys.map((key, index) => ({
          workspace_id: workspaceId,
          kind: 'image' as const,
          key,
          bytes: 0,
          mime: 'image/png',
          meta: { idx: index },
        })),
      )
      .returning({ id: asset.id });
    for (const stored of frameAssets) {
      const row = await db
        .select({ key: asset.key })
        .from(asset)
        .where(eq(asset.id, stored.id));
      const path = resolveStorageKey(root, row[0]!.key);
      await db
        .update(asset)
        .set({ bytes: (await stat(path)).size })
        .where(eq(asset.id, stored.id));
    }

    await db.insert(scene).values([
      {
        video_id: videoId,
        idx: 0,
        text: 'வணக்கம் நண்பர்களே.',
        image_asset_id: frameAssets[0]!.id,
        motion: { preset: 'kenburns-in', emphasis: [] },
        start_ms: 0,
        end_ms: 1_000,
      },
      {
        video_id: videoId,
        idx: 1,
        text: 'Today fire!',
        image_asset_id: frameAssets[1]!.id,
        motion: { preset: 'pan-left', emphasis: [] },
        start_ms: 1_000,
        end_ms: 2_000,
      },
    ]);

    const cues = buildCaptionCues(WORDS, {
      wordLimit: 4,
      maxLines: 2,
      maxCharsPerLine: 32,
    }).map((cue) => captionCueSchema.parse(cue));
    const ass = buildAss(cues, { width: 1_920, height: 1_080 }, {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 64,
    });
    const assPath = resolveStorageKey(root, captionKey(workspaceId, videoId, 'ass'));
    await ensureParentPath(assPath);
    await writeFile(assPath, ass, 'utf8');
    await db.insert(captionTrack).values({ video_id: videoId, template_id: -1, cues });
  });

  afterEach(async () => {
    await deleteVideoRows();
    await boss.purgeQueue(queueFor('render'));
  });

  it('renders one MP4 and thumbnail, then completes the video in a single commit', async () => {
    const handler = createCreateRenderHandler({ db, pool, boss, storageRoot: dataDir });

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
        render: async (queued) => {
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
      expect(await enqueueStep(boss, { videoId, step: 'render' })).not.toBeNull();
      await handled;
    } finally {
      await worker.stop();
    }

    const storedVideo = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(storedVideo.status).toBe('completed');
    expect(storedVideo.step).toBeNull();
    expect(storedVideo.duration_ms).toBe(2_000);
    expect(storedVideo.video_url).toBe(renderKey(workspaceId, videoId, 1_080, 30, 'standard'));

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
    const renderAsset = assets.find((row) => row.kind === 'render');
    const thumbnailAsset = assets.find((row) => row.kind === 'thumbnail');
    expect(renderAsset?.key).toBe(renderKey(workspaceId, videoId, 1_080, 30, 'standard'));
    expect(renderAsset?.mime).toBe('video/mp4');
    expect(thumbnailAsset?.key).toBe(
      thumbnailKey(workspaceId, videoId, 1_080, 30, 'standard'),
    );
    expect(thumbnailAsset?.mime).toBe('image/png');

    const root = dataDir();
    const mp4Path = resolveStorageKey(root, renderAsset!.key);
    const mp4 = new Uint8Array(await readFile(mp4Path));
    expect(renderAsset!.bytes).toBe(mp4.byteLength);

    const probe = JSON.parse(
      run('ffprobe', [
        '-v', 'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,channels,sample_rate:format=duration',
        '-of', 'json',
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
    expect(Math.abs(Number(probe.format.duration) - 2) * 1_000).toBeLessThan(100);

    const pngPath = resolveStorageKey(root, thumbnailAsset!.key);
    const png = new Uint8Array(await readFile(pngPath));
    expect(Buffer.from(png.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
    expect(Buffer.from(png).readUInt32BE(16)).toBe(1_280);
    expect(Buffer.from(png).readUInt32BE(20)).toBe(720);
    expect(thumbnailAsset!.bytes).toBe(png.byteLength);

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      action: 'render',
      units: 0.03,
      unit_cost: 10,
      delta: -0.3,
    });

    await mkdir(ARTIFACT_DIR, { recursive: true });
    await copyFile(mp4Path, join(ARTIFACT_DIR, 'final.mp4'));
    await copyFile(pngPath, join(ARTIFACT_DIR, 'thumbnail.png'));
    await writeFile(
      join(ARTIFACT_DIR, 'summary.json'),
      `${JSON.stringify(
        {
          video: { width: 1_920, height: 1_080, fps: 30, durationMs: 2_000 },
          mp4: { bytes: mp4.byteLength, sha256: sha256(mp4) },
          thumbnail: { width: 1_280, height: 720, bytes: png.byteLength, sha256: sha256(png) },
          probe,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // A stale delivery must not charge, insert or replace anything again.
    await handler({ jobId: 'duplicate-render', videoId, step: 'render' });
    expect(await db.select().from(render).where(eq(render.video_id, videoId))).toHaveLength(1);
    expect(
      (await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))).filter(
        (row) => row.kind === 'render' || row.kind === 'thumbnail',
      ),
    ).toHaveLength(2);
    expect(
      await db.select().from(creditLedger).where(eq(creditLedger.video_id, videoId)),
    ).toHaveLength(1);
  }, 120_000);

  it('re-renders a completed video at 60 fps as a new artifact and a doubled charge', async () => {
    const handler = createCreateRenderHandler({ db, pool, boss, storageRoot: dataDir });

    // First render: the ordinary 1080p/30 result the user already has.
    await handler({ jobId: 'first-render', videoId, step: 'render' });
    const firstKey = renderKey(workspaceId, videoId, 1_080, 30, 'standard');
    const firstPath = resolveStorageKey(dataDir(), firstKey);
    const firstBytes = new Uint8Array(await readFile(firstPath));
    const firstHash = sha256(firstBytes);
    const completed = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(completed.status).toBe('completed');
    expect(completed.video_url).toBe(firstKey);

    // The production transition: `completed` only, cursor moves to render, the
    // previous mp4 stays playable until the step replaces it.
    const begun = await beginRender(db, {
      videoId,
      render: { resolution: 1_080, frameRate: 60, format: 'standard' },
    });
    expect(begun.kind).toBe('queued');
    if (begun.kind !== 'queued') throw new Error('re-render was not queued');
    expect(begun.video.status).toBe('rendering');
    expect(begun.video.step).toBe('render');
    expect(begun.video.video_url).toBe(firstKey);
    expect(begun.video.duration_ms).toBe(2_000);

    await handler({ jobId: 'second-render', videoId, step: 'render' });

    const stored = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    const secondKey = renderKey(workspaceId, videoId, 1_080, 60, 'standard');
    expect(stored.status).toBe('completed');
    expect(stored.step).toBeNull();
    expect(stored.video_url).toBe(secondKey);
    expect(stored.duration_ms).toBe(2_000);

    // Every run appends one row instead of rewriting history.
    const renders = (await db.select().from(render).where(eq(render.video_id, videoId))).map(
      (row) => renderRowSchema.parse(row),
    );
    expect(renders.map((row) => row.fps).sort((a, b) => a - b)).toEqual([30, 60]);
    expect(renders.every((row) => row.status === 'completed')).toBe(true);

    const assets = (
      await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))
    ).map((row) => assetRowSchema.parse(row));
    const renderKeys = assets
      .filter((row) => row.kind === 'render')
      .map((row) => row.key)
      .sort();
    expect(renderKeys).toEqual(
      [
        renderKey(workspaceId, videoId, 1_080, 30, 'standard'),
        secondKey,
      ].sort(),
    );
    expect(assets.filter((row) => row.kind === 'thumbnail')).toHaveLength(2);

    // The first artifact is untouched on disk.
    expect(sha256(new Uint8Array(await readFile(firstPath)))).toBe(firstHash);

    const secondPath = resolveStorageKey(dataDir(), secondKey);
    const secondBytes = new Uint8Array(await readFile(secondPath));
    const probe = JSON.parse(
      run('ffprobe', [
        '-v', 'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,channels,sample_rate:format=duration',
        '-of', 'json',
        secondPath,
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
      r_frame_rate: '60/1',
    });
    expect(audioStream).toMatchObject({
      codec_name: 'aac',
      channels: 2,
      sample_rate: '48000',
    });
    expect(Math.abs(Number(probe.format.duration) - 2) * 1_000).toBeLessThan(100);

    // 60 fps costs twice the 30 fps rate; the first render is not re-charged.
    const ledger = (
      await db.select().from(creditLedger).where(eq(creditLedger.video_id, videoId))
    ).sort((a, b) => Number(a.unit_cost) - Number(b.unit_cost));
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({ action: 'render', units: 0.03, unit_cost: 10, delta: -0.3 });
    expect(ledger[1]).toMatchObject({ action: 'render', units: 0.03, unit_cost: 20, delta: -0.6 });

    const events = (
      await db.select().from(jobEvent).where(eq(jobEvent.video_id, videoId))
    ).filter((row) => row.step === 'render');
    expect(events).toHaveLength(2);
    expect(events.every((row) => row.outcome === 'committed')).toBe(true);

    await mkdir(ARTIFACT_DIR, { recursive: true });
    await copyFile(secondPath, join(ARTIFACT_DIR, 'rerender-60fps.mp4'));
    await writeFile(
      join(ARTIFACT_DIR, 'rerender-summary.json'),
      `${JSON.stringify(
        {
          first: { key: firstKey, bytes: firstBytes.byteLength, sha256: firstHash },
          rerender: {
            key: secondKey,
            fps: 60,
            bytes: secondBytes.byteLength,
            sha256: sha256(secondBytes),
            unitCost: 20,
          },
          ledger: ledger.map((row) => ({
            units: Number(row.units),
            unitCost: Number(row.unit_cost),
            delta: Number(row.delta),
          })),
          jobEvents: events.map((row) => row.outcome),
          probe,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }, 120_000);
});
