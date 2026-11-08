/**
 * The real `create-captions` commit against Postgres + pg-boss.
 *
 * The hermetic suite proves decisions. This proves that one claimed job writes
 * all four UTF-8 sidecars, four caption assets, one lossless cue track, one
 * subtitles ledger row and the render enqueue in a fenced transaction. The
 * retained ASS is also rendered through real ffmpeg/libass with bundled Tamil
 * and emoji fonts so the artifact is more than a database assertion.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assetRowSchema,
  captionJsonExportSchema,
  captionTrackRowSchema,
  createAiVideoV3RequestSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import {
  asset,
  captionTemplate,
  captionTrack,
  createDb,
  creditLedger,
  databaseUrl,
  narration,
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
import { startWorker } from '../worker';
import {
  captionKey,
  createCreateCaptionsHandler,
} from './create-captions';

const ARTIFACT_DIR = '.data/artifacts/p5-create-captions';
const FONT_DIR = 'packages/art/fonts/ttf';
const TEMPLATE_ID = -3;
const SCRIPT = 'வணக்கம் நண்பர்களே. Today fire!';

let db: Database;
let pool: Pool;
let boss: PgBoss;
let workspaceId: string;
let videoId: string;

async function purgeStepQueues(): Promise<void> {
  await boss.purgeQueue(queueFor('create-captions'));
  await boss.purgeQueue(queueFor('render'));
}

async function deleteVideoRows(): Promise<void> {
  await db.delete(captionTrack).where(eq(captionTrack.video_id, videoId));
  await db.delete(narration).where(eq(narration.video_id, videoId));
  await db.delete(creditLedger).where(eq(creditLedger.video_id, videoId));
  await db.delete(asset).where(eq(asset.workspace_id, workspaceId));
  await db.delete(video).where(eq(video.id, videoId));
  await db.delete(workspace).where(eq(workspace.id, workspaceId));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('create-captions step (Postgres)', () => {
  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    pool = created.pool;
    boss = await createBoss({
      connectionString: databaseUrl(),
      supervise: false,
      schedule: false,
    });

    const seeded = await db
      .select({ id: captionTemplate.id })
      .from(captionTemplate)
      .where(eq(captionTemplate.id, TEMPLATE_ID));
    if (seeded[0] === undefined) {
      throw new Error('built-in caption templates are not seeded; run npm run db:migrate');
    }
  });

  afterAll(async () => {
    await stopBoss(boss);
    await pool.end();
  });

  beforeEach(async () => {
    await purgeStepQueues();
    const workspaces = await db
      .insert(workspace)
      .values({ name: `create-captions-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const body = createAiVideoV3RequestSchema.parse({
      artStyleId: randomUUID(),
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
        step: 'create-captions',
        request: { kind: 'ai-video-v3', body },
        duration_ms: 2_400,
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    const audioAssets = await db
      .insert(asset)
      .values({
        workspace_id: workspaceId,
        kind: 'audio',
        key: `ws/${workspaceId}/videos/${videoId}/audio/narration.mp3`,
        bytes: 1,
        mime: 'audio/mpeg',
        meta: {},
      })
      .returning({ id: asset.id });

    await db.insert(narration).values({
      video_id: videoId,
      asset_id: audioAssets[0]!.id,
      duration_ms: 2_400,
      word_timings: [
        { text: 'வணக்கம்', start_ms: 0, end_ms: 400 },
        { text: 'நண்பர்களே.', start_ms: 400, end_ms: 900 },
        { text: 'Today', start_ms: 1_000, end_ms: 1_300 },
        { text: 'fire!', start_ms: 1_300, end_ms: 1_700 },
      ],
      voice_plan: {
        script: SCRIPT,
        spokenText: SCRIPT,
        runs: [
          {
            text: 'வணக்கம் நண்பர்களே.',
            lang: 'ta',
            voice: 'ta-IN-ValluvarNeural',
            script: 'tamil',
          },
          {
            text: 'Today fire!',
            lang: 'en',
            voice: 'ta-IN-ValluvarNeural',
            script: 'latin',
          },
        ],
        overrides: [],
        pair: 'valluvar',
      },
    });
  });

  afterEach(async () => {
    await deleteVideoRows();
    await purgeStepQueues();
  });

  it('stores four sidecars and one lossless cue track, then advances exactly once', async () => {
    const handler = createCreateCaptionsHandler({ db, pool, boss });
    const job = {
      jobId: 'manual-create-captions',
      videoId,
      step: 'create-captions' as const,
    };

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
        'create-captions': async (queued) => {
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
      const queued = await enqueueStep(boss, { videoId, step: 'create-captions' });
      expect(queued).not.toBeNull();
      await handled;
    } finally {
      await worker.stop();
    }

    const storedVideo = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(storedVideo.step).toBe('render');
    expect(storedVideo.status).toBe('rendering');

    const assets = (
      await db
        .select()
        .from(asset)
        .where(eq(asset.workspace_id, workspaceId))
        .orderBy(asc(asset.key))
    ).map((row) => assetRowSchema.parse(row));
    const captionAssets = assets.filter((row) => row.kind === 'caption');
    expect(captionAssets).toHaveLength(4);
    expect(captionAssets.map((row) => row.key)).toEqual(
      (['ass', 'json', 'srt', 'vtt'] as const).map((format) =>
        captionKey(workspaceId, videoId, format),
      ),
    );

    const bytesByFormat = new Map<string, Uint8Array>();
    for (const stored of captionAssets) {
      const bytes = new Uint8Array(
        await readFile(resolveStorageKey(dataDir(), stored.key)),
      );
      expect(stored.bytes).toBe(bytes.byteLength);
      expect(stored.meta).toMatchObject({ templateId: TEMPLATE_ID, cueCount: 2 });
      bytesByFormat.set(String(stored.meta.format), bytes);
    }

    const ass = Buffer.from(bytesByFormat.get('ass')!).toString('utf8');
    const srt = Buffer.from(bytesByFormat.get('srt')!).toString('utf8');
    const vtt = Buffer.from(bytesByFormat.get('vtt')!).toString('utf8');
    const jsonBytes = bytesByFormat.get('json')!;
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('Noto Sans Tamil');
    expect(ass).toContain('{\\fnNoto Emoji}🔥');
    expect(srt).toContain('வணக்கம் நண்பர்களே.');
    expect(srt).toContain('Today fire! 🔥');
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);

    const jsonDocument = captionJsonExportSchema.parse(
      JSON.parse(Buffer.from(jsonBytes).toString('utf8')) as unknown,
    );
    expect(jsonDocument.cues).toHaveLength(2);
    expect(jsonDocument.cues[1]?.emoji).toBe('🔥');

    const track = captionTrackRowSchema.parse(
      (await db.select().from(captionTrack).where(eq(captionTrack.video_id, videoId)))[0],
    );
    expect(track.template_id).toBe(TEMPLATE_ID);
    expect(track.cues).toEqual(
      jsonDocument.cues.map(({ index: _index, ...cue }) => cue),
    );

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      action: 'subtitles',
      units: 1,
      unit_cost: 20,
      delta: -20,
    });
    expect(await boss.getQueueSize(queueFor('render'))).toBe(1);

    await mkdir(ARTIFACT_DIR, { recursive: true });
    for (const [format, bytes] of bytesByFormat) {
      await writeFile(join(ARTIFACT_DIR, `captions.${format}`), bytes);
    }

    const assArtifact = join(ARTIFACT_DIR, 'captions.ass').replaceAll('\\', '/');
    const framePath = join(ARTIFACT_DIR, 'caption-frame.png');
    const render = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'verbose',
        '-f',
        'lavfi',
        '-i',
        'color=c=0x14213d:s=1920x1080:r=1:d=2',
        '-vf',
        `ass='${assArtifact}':fontsdir='${FONT_DIR}'`,
        '-frames:v',
        '1',
        '-pix_fmt',
        'rgb24',
        framePath,
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    if (render.error !== undefined) throw render.error;
    expect(render.status, render.stderr).toBe(0);
    expect(render.stderr).toMatch(/NotoSansTamil-Variable\.ttf/i);

    const frame = new Uint8Array(await readFile(framePath));
    expect(Buffer.from(frame.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');
    expect(Buffer.from(frame).readUInt32BE(16)).toBe(1920);
    expect(Buffer.from(frame).readUInt32BE(20)).toBe(1080);

    await writeFile(
      join(ARTIFACT_DIR, 'summary.json'),
      `${JSON.stringify(
        {
          templateId: TEMPLATE_ID,
          cueCount: track.cues.length,
          sidecars: Object.fromEntries(
            [...bytesByFormat].map(([format, bytes]) => [
              format,
              { bytes: bytes.byteLength, sha256: sha256(bytes) },
            ]),
          ),
          frame: { bytes: frame.byteLength, sha256: sha256(frame) },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // A stale delivery must not create a second track/set of assets/charge/job.
    await handler({ ...job, jobId: 'duplicate-create-captions' });
    expect(
      (await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))).filter(
        (row) => row.kind === 'caption',
      ),
    ).toHaveLength(4);
    expect(
      await db.select().from(captionTrack).where(eq(captionTrack.video_id, videoId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(creditLedger).where(eq(creditLedger.video_id, videoId)),
    ).toHaveLength(1);
    expect(await boss.getQueueSize(queueFor('render'))).toBe(1);
  });
});
