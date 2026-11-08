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

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Interface as ReadlineInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

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
  jobLock,
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
const SOURCE_MP3 = join(ARTIFACT_DIR, 'source.mp3');
const WORKER_FIXTURE = fileURLToPath(
  new URL('./process-kill-worker.fixture.ts', import.meta.url),
);
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

// --- real worker process ----------------------------------------------------

interface WorkerRun {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: ReadlineInterface;
  readonly output: () => string;
  closed: boolean;
}

/** Every child is killed in `afterEach`, even when an assertion throws. */
const workers: WorkerRun[] = [];

/**
 * Start the fixture as a separate OS process, exactly as `apps/worker` runs in
 * production (`node --import tsx`). The test controls only its providers.
 */
function spawnWorker(mode: 'hang' | 'resume'): WorkerRun {
  const child = spawn(process.execPath, ['--import', 'tsx', WORKER_FIXTURE], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KILL_FIXTURE_MODE: mode,
      KILL_FIXTURE_MP3: SOURCE_MP3,
      KILL_FIXTURE_DURATION_MS: String(durationMs),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let output = '';
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    output += chunk;
  });

  const run: WorkerRun = {
    child,
    lines: createInterface({ input: child.stdout }),
    output: () => output,
    closed: false,
  };
  workers.push(run);
  return run;
}

function waitForLine(run: WorkerRun, needle: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      run.lines.off('line', onLine);
      run.child.off('exit', onExit);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onLine = (line: string): void => {
      if (line.includes(needle)) finish();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(
        new Error(
          `worker exited before "${needle}" (${String(code)}/${String(signal)})\n${run.output()}`,
        ),
      );
    };
    const timer = setTimeout(() => {
      finish(
        new Error(`worker did not print "${needle}" in ${timeoutMs} ms\n${run.output()}`),
      );
    }, timeoutMs);

    run.lines.on('line', onLine);
    run.child.once('exit', onExit);
  });
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`worker did not exit in ${timeoutMs} ms`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function stopWorker(run: WorkerRun): Promise<void> {
  if (run.child.exitCode === null && run.child.signalCode === null) {
    run.child.kill('SIGTERM');
    try {
      await waitForExit(run.child, 15_000);
    } catch {
      run.child.kill('SIGKILL');
      await waitForExit(run.child, 5_000).catch(() => undefined);
    }
  }
  if (!run.closed) {
    run.closed = true;
    run.lines.close();
  }
}

/** Quote an identifier for the one raw SQL statement the kill test needs. */
function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

interface StepJobRow {
  readonly id: string;
  readonly state: string;
  readonly retry_count: number;
}

/** pg-boss's own bookkeeping for this video's job on one queue. */
async function stepJobRow(step: ConsumedJob['step']): Promise<StepJobRow> {
  const schema = quoteIdent(process.env.PGBOSS_SCHEMA || 'pgboss');
  const result = await pool.query<StepJobRow>(
    `SELECT id, state, retry_count FROM ${schema}.job
      WHERE name = $1 AND data->>'videoId' = $2
      ORDER BY created_on DESC LIMIT 1`,
    [queueFor(step), videoId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no ${step} job for ${videoId}`);
  return row;
}

async function waitForCompletion(run: WorkerRun, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = (await db.select().from(video).where(eq(video.id, videoId)))[0];
    if (row !== undefined) {
      if (row.status === 'completed') return;
      if (row.status === 'failed') {
        throw new Error(`video failed: ${JSON.stringify(row.error)}\n${run.output()}`);
      }
    }
    if (run.child.exitCode !== null || run.child.signalCode !== null) {
      throw new Error(`worker exited before the video completed\n${run.output()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`video did not complete in ${timeoutMs} ms\n${run.output()}`);
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
    const source = SOURCE_MP3;
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
    await rm(SOURCE_MP3, { force: true });
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
    for (const run of workers.splice(0)) {
      await stopWorker(run);
    }
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

  it('resumes after a real SIGKILL mid-claim with one artifact set and one debit', async () => {
    await createCreateScenesHandler({ db, pool, boss, planner: createHeuristicPlanner() })(
      job('create-scenes', 'scenes-before-kill'),
    );

    const sceneRows = (
      await db.select().from(scene).where(eq(scene.video_id, videoId)).orderBy(asc(scene.idx))
    ).map((row) => sceneRowSchema.parse(row));
    expect(sceneRows.length).toBeGreaterThan(0);
    const beforeKill = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(beforeKill.step).toBe('create-vocal');
    expect(beforeKill.status).toBe('processing');
    expect(await ledgerRows()).toHaveLength(0);

    // 1. A real worker process claims create-vocal and blocks inside TTS.
    const hanging = spawnWorker('hang');
    await waitForLine(hanging, 'KILL_READY', 60_000);

    const claimed = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(claimed.step).toBe('create-vocal');
    const locksAtKill = await db
      .select({ step: jobLock.step, attempt: jobLock.attempt })
      .from(jobLock)
      .where(eq(jobLock.video_id, videoId));
    expect(locksAtKill).toEqual([{ step: 'create-vocal', attempt: 1 }]);
    const active = await stepJobRow('create-vocal');
    expect(active.state).toBe('active');
    expect(await db.select().from(narration).where(eq(narration.video_id, videoId))).toHaveLength(0);
    expect(await db.select().from(asset).where(eq(asset.workspace_id, workspaceId))).toHaveLength(0);
    expect(await ledgerRows()).toHaveLength(0);

    // 2. SIGKILL: no unwind, no lock release, no job ack. The row a crashed
    // consumer leaves behind is an active job plus a live `job_lock`.
    hanging.child.kill('SIGKILL');
    const killed = await waitForExit(hanging.child, 10_000);
    expect(killed.signal).toBe('SIGKILL');
    expect((await stepJobRow('create-vocal')).state).toBe('active');
    const locksAfterKill = await db
      .select({ attempt: jobLock.attempt })
      .from(jobLock)
      .where(eq(jobLock.video_id, videoId));
    expect(locksAfterKill).toEqual([{ attempt: 1 }]);

    // 3. Fast-forward the two production recovery clocks, then let pg-boss's
    // own timeout SQL expire the job. Job expiry (1 h) must outlast the step
    // lock (30 min), otherwise the retry bounces off a live lock and is dropped.
    const bossSchema = quoteIdent(process.env.PGBOSS_SCHEMA || 'pgboss');
    await pool.query(
      `UPDATE ${bossSchema}.job SET started_on = now() - interval '2 hours' WHERE id = $1`,
      [active.id],
    );
    await pool.query(
      `UPDATE job_lock SET started_at = now() - interval '31 minutes'
        WHERE video_id = $1 AND step = 'create-vocal'`,
      [videoId],
    );
    await boss.expire();

    const retried = await stepJobRow('create-vocal');
    expect(retried.state).toBe('retry');
    expect(retried.retry_count).toBe(0);
    expect(await ledgerRows()).toHaveLength(0);
    const stillClaimed = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(stillClaimed.step).toBe('create-vocal');

    // 4. Restart the worker. A fresh process fetches the retried job, takes the
    // expired lock over (`attempt = 2`) and finishes the pipeline.
    const resume = spawnWorker('resume');
    await waitForCompletion(resume, 180_000);
    const resumeJob = await stepJobRow('create-vocal');
    expect(resumeJob.state).toBe('completed');
    expect(resumeJob.retry_count).toBe(1);
    await stopWorker(resume);

    const finished = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    expect(finished.status).toBe('completed');
    expect(finished.step).toBeNull();
    expect(finished.duration_ms).toBe(durationMs);
    expect(finished.video_url).toContain('render-1080p-30-standard.mp4');

    const narrations = await db
      .select()
      .from(narration)
      .where(eq(narration.video_id, videoId));
    expect(narrations).toHaveLength(1);
    expect(narrations[0]?.duration_ms).toBe(durationMs);
    expect(
      await db.select().from(captionTrack).where(eq(captionTrack.video_id, videoId)),
    ).toHaveLength(1);

    const assets = await db.select().from(asset).where(eq(asset.workspace_id, workspaceId));
    const countKind = (kind: string): number => assets.filter((row) => row.kind === kind).length;
    expect(countKind('audio')).toBe(1);
    expect(countKind('image')).toBe(sceneRows.length);
    expect(countKind('caption')).toBe(4);
    expect(countKind('render')).toBe(1);
    expect(countKind('thumbnail')).toBe(1);

    // One debit per action: the killed attempt committed nothing, so a second
    // tts row would mean the rerun charged for work that was already paid for.
    const ledger = await ledgerRows();
    expect(ledger.map((row) => row.action).sort()).toEqual([
      'image',
      'render',
      'subtitles',
      'tts',
    ]);
    const spent = ledger.reduce((total, row) => total + Math.abs(row.delta), 0);
    const expectedSpend =
      ledger.find((row) => row.action === 'tts')!.units * TTS_UNIT_COST +
      ledger.find((row) => row.action === 'image')!.units * IMAGE_UNIT_COST +
      SUBTITLE_UNIT_COST +
      ledger.find((row) => row.action === 'render')!.units * 10;
    expect(spent).toBeCloseTo(expectedSpend, 2);

    const [balance] = await db
      .select({ credits: workspace.credits })
      .from(workspace)
      .where(eq(workspace.id, workspaceId));
    expect(Number(balance?.credits)).toBeCloseTo(START_CREDITS - expectedSpend, 2);

    const events = (
      await db
        .select({
          step: jobEvent.step,
          outcome: jobEvent.outcome,
          attempt: jobEvent.attempt,
        })
        .from(jobEvent)
        .where(eq(jobEvent.video_id, videoId))
    ).map((row) => ({ step: row.step, outcome: row.outcome, attempt: row.attempt }));
    const vocalEvents = events.filter((event) => event.step === 'create-vocal');
    expect(vocalEvents).toEqual([{ step: 'create-vocal', outcome: 'committed', attempt: 2 }]);
    expect(events.filter((event) => event.outcome === 'committed')).toHaveLength(5);
    expect(
      events.filter((event) => event.outcome === 'failed' || event.outcome === 'retryable'),
    ).toHaveLength(0);

    const renderAsset = assets.find((row) => row.kind === 'render');
    if (renderAsset === undefined) throw new Error('no render asset after resume');
    const renderPath = resolveStorageKey(dataDir(), renderAsset.key);
    const renderBytes = new Uint8Array(await readFile(renderPath));
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await writeFile(join(ARTIFACT_DIR, 'process-kill.mp4'), renderBytes);
    await writeFile(
      join(ARTIFACT_DIR, 'process-kill-summary.json'),
      `${JSON.stringify(
        {
          kill: {
            pid: hanging.child.pid ?? -1,
            signal: 'SIGKILL',
            jobId: active.id,
            stateAtKill: active.state,
            lockAttempt: 1,
          },
          recovery: {
            jobExpireFastForwarded: '2 hours',
            lockTtlFastForwarded: '31 minutes',
            stateAfterExpire: retried.state,
            retryCountAfterFetch: resumeJob.retry_count,
            stateAfterResume: resumeJob.state,
          },
          video: {
            status: finished.status,
            step: finished.step,
            durationMs: finished.duration_ms,
            url: finished.video_url,
          },
          assets: {
            audio: countKind('audio'),
            frames: countKind('image'),
            captions: countKind('caption'),
            render: countKind('render'),
            thumbnail: countKind('thumbnail'),
          },
          ledger: ledger.map((row) => ({ ...row, delta: Math.abs(row.delta) })),
          spent,
          creditsAfter: Number(balance?.credits),
          outcomes: events,
          mp4: { bytes: renderBytes.byteLength, sha256: sha256(renderBytes) },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }, 240_000);
});
