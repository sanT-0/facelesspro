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
  artStyle,
  authenticateApiKey,
  createApiKey,
  createDb,
  databaseFor,
  databaseUrl,
  findVideo,
  findVisibleArtStyle,
  findWorkspace,
  insertVideo,
  listApiKeys,
  listBalanceLogs,
  listBackgroundVideos,
  listBuiltInCaptionTemplates,
  listCreditLogs,
  listSoundEffects,
  listVisibleArtStyles,
  listVoices,
  loadEnv,
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
import type { CreateAiVideoV3RequestParsed, VideoRow } from '@facelesspro/contracts';

import { createApp } from './app';
import type { ArtStyleSubmission } from './art-styles';
import { createRateLimiter, rateLimitOptionsFromEnv } from './rate-limit';
import { createQueueRender, createQueueRetry } from './video-queues';

loadEnv();

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

  const submitVideo = async (input: {
    readonly workspaceId: string;
    readonly body: {
      readonly kind: 'ai-video-v3';
      readonly body: CreateAiVideoV3RequestParsed;
    };
  }): Promise<VideoRow> => {
    const boss = await producer();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const txDb = databaseFor(client);
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
      const key = `files/${randomUUID()}`;
      const dir = join(storageRoot, 'files');
      await mkdir(dir, { recursive: true });
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(join(dir, key), buf);
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
      const dir = join(storageRoot, 'tts');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, key), audioBuf);
      return {
        audioUrl: `${process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'http://127.0.0.1:3001'}/${key}`,
        durationMs: Number(body.total_duration_ms) ?? 0,
        voiceId: input.voiceId ?? 'default',
      };
    },
    listArtStyles: (workspaceId) => listVisibleArtStyles(db, workspaceId),
    readArtStyle: (workspaceId, id) => findVisibleArtStyle(db, workspaceId, id),
    listCaptionTemplates: () => listBuiltInCaptionTemplates(db),
    listVoices: (workspaceId) => listVoices(db, workspaceId),
    listSoundEffects: listSoundEffects,
    listBackgroundVideos: listBackgroundVideos,
    findWorkspace: (workspaceId) => findWorkspace(db, workspaceId),
    listCreditLogs: (workspaceId) => listCreditLogs(db, workspaceId),
    listBalanceLogs: (workspaceId) => listBalanceLogs(db, workspaceId),
    readVideo: (workspaceId, id) => findVideo(db, workspaceId, id),
    queueRender: createQueueRender(pool, producer),
    queueRetry: createQueueRetry(pool, producer),
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
    console.log(`facelesspro-api listening on http://127.0.0.1:${info.port}`);
  });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`[api] ${signal} — closing`);
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
  console.error('[api] fatal', error);
  process.exit(1);
});
