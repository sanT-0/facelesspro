/**
 * `facelesspro-api` entry point: wire the real probes, serve, shut down cleanly.
 *
 * The pool is the same one `@facelesspro/db` gives every process, so the health
 * check tests the connection path the routes will actually use.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  checkVideoLimits,
  estimateMinutes,
  LimitExceededError,
} from '@facelesspro/contracts';
import {
  artStyle,
  authenticateApiKey,
  createApiKey,
  createDb,
  databaseFor,
  databaseUrl,
  findVideo,
  findVisibleArtStyle,
  findWorkspace,
  importVoice,
  insertVideo,
  listApiKeys,
  listBalanceLogs,
  listBackgroundVideos,
  listBuiltInCaptionTemplates,
  listCreditLogs,
  listSoundEffects,
  listVisibleArtStyles,
  listVideoScenes,
  listVoices,
  loadEnv,
  readVideoCaptions,
  readVideoNarrationKey,
  readVideoVoicePlan,
  readVideoWordTimings,
  revokeApiKey,
} from '@facelesspro/db';
import {
  checkQueues,
  createBoss,
  enqueueArtStyleBuild,
  enqueueStep,
  stopBoss,
} from '@facelesspro/queue';
import { serve } from '@hono/node-server';

import { createApp } from './app';
import { loggerFromEnv } from '@facelesspro/log';
import type { ArtStyleSubmission } from './art-styles';
import { createRateLimiter, rateLimitOptionsFromEnv } from './rate-limit';
import type { SubmitVideo } from './video-submit';
import {
  createQueueRecaption,
  createQueueRedraw,
  createQueueRender,
  createQueueRetry,
  createQueueRevocal,
} from './video-queues';

loadEnv();

const log = loggerFromEnv('facelesspro-api');

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3001);
  const queueSchema = process.env.PGBOSS_SCHEMA || undefined;
  const connectionString = databaseUrl();
  const { pool } = createDb(connectionString);
  const db = databaseFor(pool);
  let bossPromise: ReturnType<typeof createBoss> | undefined;

  // Keep startup lazy: `/health` must still come up as 503 when Postgres is
  // unavailable instead of the whole API process exiting before it can report
  // the failing component. A recovered database gets a fresh initialization
  // attempt because a rejected promise is not cached.
  const producer = (): ReturnType<typeof createBoss> => {
    if (bossPromise === undefined) {
      bossPromise = createBoss({
        connectionString,
        ...(queueSchema === undefined ? {} : { schema: queueSchema }),
        // The worker owns expiry/schedule maintenance. This process only produces.
        supervise: false,
        schedule: false,
      }).catch((error: unknown) => {
        bossPromise = undefined;
        throw error;
      });
    }
    return bossPromise;
  };

  const submitArtStyle = async (submission: ArtStyleSubmission): Promise<void> => {
    const boss = await producer();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const txDb = databaseFor(client);
      await txDb.insert(artStyle).values(submission.row);
      await enqueueArtStyleBuild(boss, submission.job, {
        db: {
          executeSql: async (text, values) => {
            const result = await client.query(text, values);
            return { rows: result.rows };
          },
        },
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const submitVideo: SubmitVideo = async (input) => {
    const boss = await producer();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const txDb = databaseFor(client);

      // Load workspace with plan and current usage for limit checks
      const workspace = await findWorkspace(txDb, input.workspaceId);
      if (workspace === null) {
        throw new Error('workspace not found');
      }

      // Estimate minutes and check limits
      const estimatedMinutes = estimateMinutes(input.body);
      const resolution = input.body.body.render?.resolution ?? 1080;

      // Get current month's usage from credit ledger
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const creditLogs = await listCreditLogs(txDb, input.workspaceId);
      const currentMonthUsage = creditLogs
        .filter((log) => new Date(log.createdAt) >= monthStart)
        .reduce((sum, log) => sum + Math.abs(log.delta), 0);
      const currentMinutes = creditLogs
        .filter((log) => new Date(log.createdAt) >= monthStart && log.action === 'render')
        .reduce((sum, log) => sum + log.units * 10, 0); // rough: render costs 10 credits per minute

      const plan = {
        ...workspace.plan,
        id: workspace.plan.id as 'free' | 'pro' | 'premium' | 'premium_plus' | 'max' | 'selfhost',
      };

      const violations = checkVideoLimits(
        {
          plan,
          currentUsage: { minutes: currentMinutes, credits: currentMonthUsage },
          currentSeats: 1, // TODO: count members when teams are implemented
        },
        { estimatedMinutes, resolution },
      );

      if (violations.length > 0) {
        // Sort by status: 402 before 403, then by kind for determinism
        const sorted = [...violations].sort((a, b) => a.status - b.status || a.kind.localeCompare(b.kind));
        const v = sorted[0];
        if (v === undefined) {
          await client.query('rollback');
          throw new Error('internal: limit violation array unexpectedly empty after length check');
        }
        await client.query('rollback');
        const err = new LimitExceededError(v.kind, v);
        throw err;
      }

      const row = await insertVideo(txDb, {
        workspaceId: input.workspaceId,
        kind: input.body.kind,
        status: 'processing',
        step: 'create-scenes',
        request: { kind: input.body.kind, body: input.body.body },
        webhookUrl: input.body.body.webhookUrl ?? null,
      });
      await enqueueStep(
        boss,
        { videoId: row.id, step: 'create-scenes' },
        {
          db: {
            executeSql: async (text: string, values: unknown[]) => {
              const result = await client.query(text, values);
              return { rows: result.rows };
            },
          },
        },
      );
      await client.query('commit');
      return row;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const storageRoot = resolve(process.env.DATA_DIR?.trim() || '.data');

  const app = createApp({
    logger: log,
    probes: {
      db: async () => {
        await pool.query('select 1');
      },
      queue: async () => {
        await checkQueues(pool, queueSchema === undefined ? {} : { schema: queueSchema });
      },
    },
    storageRoot,
    submitArtStyle,
    submitVideo,
    storeFile: async (file) => {
      // One public prefix (`/files/*`) for every artifact: the key is relative
      // to `DATA_DIR` and `files.ts` appends it to `<base>/files/`.
      const key = `uploads/${randomUUID()}`;
      const dir = join(storageRoot, 'uploads');
      await mkdir(dir, { recursive: true });
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(join(storageRoot, key), buf);
      return { key, bytes: buf.byteLength, mime: file.type };
    },
    synthesizeTts: async (input) => {
      const baseUrl = process.env.MEDIA_SERVICE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:8000';
      const res = await fetch(`${baseUrl}/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: input.text,
          voice: input.voiceId,
          voice_style: input.voiceStyle,
        }),
      });
      if (!res.ok) {
        throw new Error(`media service synthesize failed: ${res.status}`);
      }
      const body = await res.json() as { readonly master_mp3_path: string; readonly total_duration_ms: unknown };
      // Store the audio file
      const audioResp = await fetch(`${baseUrl}${body.master_mp3_path}`);
      if (!audioResp.ok) {
        throw new Error(`media service audio fetch failed: ${audioResp.status}`);
      }
      const audioBuf = Buffer.from(await audioResp.arrayBuffer());
      const key = `tts/${randomUUID()}.mp3`;
      await mkdir(join(storageRoot, 'tts'), { recursive: true });
      await writeFile(join(storageRoot, key), audioBuf);
      return {
        audioUrl: `${(process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:3001')}/files/${key}`,
        durationMs: Number(body.total_duration_ms) ?? 0,
        voiceId: input.voiceId ?? 'default',
      };
    },
    listArtStyles: (workspaceId) => listVisibleArtStyles(db, workspaceId),
    readArtStyle: (workspaceId, id) => findVisibleArtStyle(db, workspaceId, id),
    listCaptionTemplates: () => listBuiltInCaptionTemplates(db),
    listVoices: (workspaceId) => listVoices(db, workspaceId),
    importVoice: (workspaceId: string, input: { name: string; sampleUrl: string }) =>
      importVoice(db, workspaceId, input),
    listSoundEffects: listSoundEffects,
    listBackgroundVideos: listBackgroundVideos,
    findWorkspace: (workspaceId) => findWorkspace(db, workspaceId),
    listCreditLogs: (workspaceId) => listCreditLogs(db, workspaceId),
    listBalanceLogs: (workspaceId) => listBalanceLogs(db, workspaceId),
    readVideo: (workspaceId, id) => findVideo(db, workspaceId, id),
    readVideoScenes: (workspaceId, id) => listVideoScenes(db, workspaceId, id),
    readVideoVoicePlan: (workspaceId, id) => readVideoVoicePlan(db, workspaceId, id),
    readVideoCaptions: (workspaceId, id) => readVideoCaptions(db, workspaceId, id),
    readVideoNarrationKey: (workspaceId, id) => readVideoNarrationKey(db, workspaceId, id),
    readVideoWordTimings: (workspaceId, id) => readVideoWordTimings(db, workspaceId, id),
    queueRender: createQueueRender(pool, producer),
    queueRetry: createQueueRetry(pool, producer),
    queueRedraw: createQueueRedraw(pool, producer),
    queueRevocal: createQueueRevocal(pool, producer),
    queueRecaption: createQueueRecaption(pool, producer),
    authenticateApiKey: (token) => authenticateApiKey(db, token),
    rateLimit: createRateLimiter(rateLimitOptionsFromEnv(process.env)),
    createApiKey: (input) => createApiKey(db, input),
    listApiKeys: (workspaceId) => listApiKeys(db, workspaceId),
    revokeApiKey: (workspaceId, id) => revokeApiKey(db, workspaceId, id),
    // `editorUrl`/`videoUrl` are absolute on the wire. Operators behind a proxy
    // set PUBLIC_BASE_URL; the listen address is only a local-dev fallback.
    publicBaseUrl:
      process.env.PUBLIC_BASE_URL?.trim() || `http://127.0.0.1:${port}`,
  });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    log.info('api.listening', { port: info.port });
  });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info('api.shutdown', { signal });
    server.close();
    const activeBoss = bossPromise;
    if (activeBoss !== undefined) {
      await activeBoss.then(stopBoss).catch(() => undefined);
    }
    await pool.end();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

main().catch((error: unknown) => {
  log.error('api.fatal', { error });
  process.exit(1);
});
