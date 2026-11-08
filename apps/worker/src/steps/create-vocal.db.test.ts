/**
 * The real `create-vocal` commit against Postgres + pg-boss.
 *
 * Run with `npm run test:db` after `docker compose up -d postgres` and
 * `npm run db:migrate`. The hermetic suite proves the decisions; this proves
 * that one transaction writes the audio asset, narration row, re-derived scene
 * timings, video duration, ledger row and the next job — and that a duplicate
 * delivery cannot do any of it twice.
 *
 * The narration bytes are a real ffmpeg-encoded MP3, not a fixture constant, so
 * the stored artifact is checked byte-for-byte and its duration comes from
 * ffprobe rather than from the fake adapter's opinion.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assetRowSchema,
  createAiVideoV3RequestSchema,
  narrationRowSchema,
  sceneRowSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type { SceneRow } from '@facelesspro/contracts';
import {
  asset,
  createDb,
  creditLedger,
  databaseUrl,
  narration,
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

import type { TtsPort } from '../ports/tts';
import { startWorker } from '../worker';
import { dataDir, resolveStorageKey } from '../art-style/storage';
import { createCreateVocalHandler, narrationKey } from './create-vocal';

const TAMIL = 'வணக்கம் நண்பர்களே.';
const ENGLISH = 'Today we plan one useful scene.';
const SCRIPT = `${TAMIL} ${ENGLISH}`;
const ARTIFACT_DIR = '.data/artifacts/p5-create-vocal';

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
let durationMs: number;

async function purgeStepQueues(): Promise<void> {
  await boss.purgeQueue(queueFor('create-vocal'));
  await boss.purgeQueue(queueFor('create-images'));
}

async function deleteVideoRows(): Promise<void> {
  // Explicit order: `narration.asset_id` restricts asset deletion, so a bare
  // workspace cascade is not guaranteed to pick a legal order.
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

/**
 * A fake TTS that answers with the real MP3 bytes and a timeline that follows
 * the request. Its spans are deterministic and contiguous, so the scene
 * offsets asserted below come from the step's derivation, not from luck.
 */
function fakeTts(): {
  port: TtsPort;
  state: { segments: Array<{ text: string; voice: string }> };
} {
  const state: { segments: Array<{ text: string; voice: string }> } = { segments: [] };

  const port: TtsPort = {
    resolvePair: async (pairId) => {
      if (pairId !== PAIR.id) throw new Error(`unexpected pair ${pairId}`);
      return PAIR;
    },
    synthesize: async (request) => {
      state.segments = request.segments.map((segment) => ({
        text: segment.text,
        voice: segment.voice,
      }));
      const count = request.segments.length;
      const slot = Math.floor(durationMs / count);

      return {
        requestId: 'db-test-request',
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

  return { port, state };
}

describe('create-vocal step (Postgres)', () => {
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
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nw=1:nk=1',
        source,
      ],
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
  });

  beforeEach(async () => {
    await purgeStepQueues();
    const workspaces = await db
      .insert(workspace)
      .values({ name: `create-vocal-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    workspaceId = workspaces[0]!.id;

    const body = createAiVideoV3RequestSchema.parse({
      artStyleId: randomUUID(),
      script: SCRIPT,
      size: 'landscape',
    });
    const videos = await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-vocal',
        request: { kind: 'ai-video-v3', body },
      })
      .returning({ id: video.id });
    videoId = videos[0]!.id;

    // The scene split create-scenes would have stored: one sentence per scene,
    // joined with a space it reconstructs the request script exactly.
    await db.insert(scene).values([
      { video_id: videoId, idx: 0, text: TAMIL, motion: {}, start_ms: 0, end_ms: 1_000 },
      {
        video_id: videoId,
        idx: 1,
        text: ENGLISH,
        motion: {},
        start_ms: 1_000,
        end_ms: 2_000,
      },
    ]);
  });

  afterEach(async () => {
    await deleteVideoRows();
    await purgeStepQueues();
  });

  it('atomically stores the narration, re-derives scene timings and advances once', async () => {
    const tts = fakeTts();
    const handler = createCreateVocalHandler({
      db,
      pool,
      boss,
      tts: tts.port,
      defaultPairId: 'valluvar',
    });
    const job = { jobId: 'manual-create-vocal', videoId, step: 'create-vocal' as const };

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
        'create-vocal': async (queued) => {
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
      const queued = await enqueueStep(boss, { videoId, step: 'create-vocal' });
      expect(queued).not.toBeNull();
      await handled;
    } finally {
      await worker.stop();
    }

    const storedVideo = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(storedVideo.step).toBe('create-images');
    expect(storedVideo.status).toBe('processing');
    expect(storedVideo.duration_ms).toBe(durationMs);

    const sceneRows = (
      await db
        .select()
        .from(scene)
        .where(eq(scene.video_id, videoId))
        .orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row)) satisfies SceneRow[];
    expect(sceneRows).toHaveLength(2);
    expect(sceneRows[0]?.text).toBe(TAMIL);
    expect(sceneRows[1]?.text).toBe(ENGLISH);
    expect(sceneRows[0]?.start_ms).toBe(0);
    // The next scene's first run starts exactly where this scene ends, and the
    // final scene ends on the probed master duration.
    expect(sceneRows[0]?.end_ms).toBe(sceneRows[1]?.start_ms);
    expect(sceneRows[1]?.end_ms).toBe(durationMs);

    const storedNarration = narrationRowSchema.parse(
      (await db.select().from(narration).where(eq(narration.video_id, videoId)))[0],
    );
    expect(storedNarration.duration_ms).toBe(durationMs);
    expect(storedNarration.voice_plan.script).toBe(SCRIPT);
    expect(storedNarration.voice_plan.pair).toBe('valluvar');
    expect(storedNarration.voice_plan.runs.map((run) => run.lang)).toEqual(['ta', 'en']);
    expect(storedNarration.word_timings.length).toBeGreaterThanOrEqual(2);
    expect(storedNarration.word_timings.at(-1)?.end_ms).toBeLessThanOrEqual(durationMs);

    const assets = (
      await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))
    ).map((row) => assetRowSchema.parse(row));
    expect(assets).toHaveLength(1);
    const storedAsset = assets[0]!;
    expect(storedAsset.kind).toBe('audio');
    expect(storedAsset.mime).toBe('audio/mpeg');
    expect(storedAsset.key).toBe(narrationKey(workspaceId, videoId));
    expect(storedAsset.bytes).toBe(mp3.byteLength);
    expect(storedNarration.asset_id).toBe(storedAsset.id);

    const storedBytes = await readFile(resolveStorageKey(dataDir(), storedAsset.key));
    expect(storedBytes.byteLength).toBe(mp3.byteLength);
    const sha256 = createHash('sha256').update(storedBytes).digest('hex');
    expect(sha256).toBe(createHash('sha256').update(mp3).digest('hex'));

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.video_id, videoId));
    const units = tts.state.segments.reduce(
      (total, segment) => total + [...segment.text].length,
      0,
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      action: 'tts',
      units,
      unit_cost: 0,
      delta: 0,
    });

    expect(await boss.getQueueSize(queueFor('create-images'))).toBe(1);

    await mkdir(ARTIFACT_DIR, { recursive: true });
    await writeFile(join(ARTIFACT_DIR, 'narration.mp3'), storedBytes);
    await writeFile(
      join(ARTIFACT_DIR, 'narration.json'),
      `${JSON.stringify(
        {
          sha256,
          bytes: storedBytes.byteLength,
          durationMs,
          requestId: 'db-test-request',
          voicePair: PAIR.id,
          scenes: sceneRows.map((row) => ({
            idx: row.idx,
            text: row.text,
            startMs: row.start_ms,
            endMs: row.end_ms,
          })),
          wordTimings: storedNarration.word_timings,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // A stale redelivery of the same job must not write a second asset, advance
    // again or enqueue another create-images job.
    await handler({ ...job, jobId: 'duplicate-create-vocal' });

    expect(await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))).toHaveLength(1);
    expect(
      await db.select().from(narration).where(eq(narration.video_id, videoId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(creditLedger).where(eq(creditLedger.video_id, videoId)),
    ).toHaveLength(1);
    expect(await boss.getQueueSize(queueFor('create-images'))).toBe(1);
  });
});
