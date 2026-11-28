/**
 * `facelesspro-worker` entry point.
 *
 * One boss, one process, graceful drain on Ctrl-C: finishing the job in hand is
 * cheaper than letting it expire and be re-fetched (every step is idempotent, so
 * both work — one just wastes a minute).
 */

import { createDb, databaseUrl, loadEnv } from '@facelesspro/db';
import { createBoss, consume, stopBoss, WEBHOOK_QUEUE } from '@facelesspro/queue';
import type { StepHandler } from '@facelesspro/queue';
import type { VideoStep } from '@facelesspro/contracts';
import { extractThumbnail, renderVideo } from '@facelesspro/art';
import { loggerFromEnv } from '@facelesspro/log';

import { join } from 'node:path';
import { serviceRole } from './role';
import { startWorker } from './worker';
import { createArtStyleBuildHandler } from './art-style/runtime';
import { createPlannerChainFromEnv } from './planner/factory';
import { createImageChainFromEnv } from './image/factory';
import {
  DEFAULT_SUBTITLE_UNIT_COST,
  createCreateCaptionsHandler,
} from './steps/create-captions';
import { createCreateImagesHandler } from './steps/create-images';
import { createCreateScenesHandler } from './steps/create-scenes';
import { createCreateVocalHandler } from './steps/create-vocal';
import {
  DEFAULT_RENDER_UNIT_COST,
  createCreateRenderHandler,
} from './steps/render';
import { createMediaAsrPort } from './asr/media';
import { createMediaTtsPort } from './tts/media';
import { processWebhookDelivery } from './webhook-delivery';

loadEnv();

const log = loggerFromEnv('facelesspro-worker');

/** Adapter factories warn instead of throwing when a provider is missing. */
const warn = (message: string): void => log.warn('worker.adapter_fallback', { message });

async function main(): Promise<void> {
  // Health check HTTP server for Docker healthchecks (using Node.js http module)
  const healthPort = Number(process.env.HEALTH_PORT ?? 9090);
  const { createServer } = await import('node:http');
  const healthServer = createServer((req, res) => {
    if (req.url?.endsWith('/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'facelesspro-worker' }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  healthServer.listen(healthPort, () => {
    log.info('worker.health_listening', { port: healthPort });
  });

  const role = serviceRole(process.env.RENDER_SERVICE);

  const schema = process.env.PGBOSS_SCHEMA || undefined;
  const boss = await createBoss({
    connectionString: databaseUrl(),
    ...(schema === undefined ? {} : { schema }),
  });

  const { db, pool } = createDb();

  // Build only the handlers this process consumes. The compose stack runs a
  // pipeline `worker` and a dedicated `render` consumer; a single process with
  // RENDER_SERVICE unset runs everything. Building an adapter that will never
  // be called only adds startup warnings and dead configuration.
  const steps: Partial<Record<VideoStep, StepHandler>> = {};

  if (role !== 'render') {
    steps['create-scenes'] = createCreateScenesHandler({
      db,
      pool,
      boss,
      planner: createPlannerChainFromEnv({
        env: process.env,
        logger: warn,
      }),
      asr: createMediaAsrPort({
        baseUrl: process.env.MEDIA_SERVICE_URL,
        timeoutMs: envNumber(process.env.MEDIA_ASR_TIMEOUT_MS),
      }),
      readStorageFile: async (key: string) => {
        const { readFile } = await import('node:fs/promises');
        const { dataDir } = await import('./art-style/storage');
        return readFile(join(dataDir(), key));
      },
    });
    steps['create-vocal'] = createCreateVocalHandler({
      db,
      pool,
      boss,
      tts: createMediaTtsPort({
        baseUrl: process.env.MEDIA_SERVICE_URL,
        synthesisTimeoutMs: envNumber(process.env.MEDIA_TTS_TIMEOUT_MS),
      }),
      defaultPairId: process.env.TTS_PAIR?.trim() || 'valluvar',
      ttsUnitCost: envNumber(process.env.TTS_UNIT_COST) ?? 0,
    });
    steps['create-images'] = createCreateImagesHandler({
      db,
      pool,
      boss,
      image: createImageChainFromEnv({ env: process.env, logger: warn }),
      imageUnitCost: envNumber(process.env.IMAGE_UNIT_COST) ?? 0,
    });
    steps['create-captions'] = createCreateCaptionsHandler({
      db,
      pool,
      boss,
      subtitleUnitCost:
        envNumber(process.env.SUBTITLE_UNIT_COST) ?? DEFAULT_SUBTITLE_UNIT_COST,
    });
  }

  if (role !== 'worker') {
    steps.render = createCreateRenderHandler({
      db,
      pool,
      boss,
      renderVideo,
      extractThumbnail,
      renderUnitCost: envNumber(process.env.RENDER_UNIT_COST) ?? DEFAULT_RENDER_UNIT_COST,
    });
  }

  const worker = await startWorker({
    boss,
    log: (line) => log.info('worker.message', { message: line }),
    ...(role === 'render'
      ? {}
      : {
          artStyle: createArtStyleBuildHandler({
            db,
            env: process.env,
            log: (line) => log.info('art_style.build', { message: line }),
          }),
        }),
    steps,
  });
  log.info('worker.consuming', { queues: worker.queues, role });

  // Webhook delivery: consume jobs from the webhook-delivery queue. Each job
  // carries { videoId, event, payload }; processWebhookDelivery reads the
  // current attempt count, delivers via HTTP, and schedules retries on the
  // documented backoff schedule. The dedicated render consumer must not also
  // deliver webhooks, or every event is attempted twice.
  if (role !== 'render') {
    await consume(
      boss,
      WEBHOOK_QUEUE,
      (data) => data,
      async ({ payload }) => {
        await processWebhookDelivery(db, boss, payload as {
          readonly videoId: string;
          readonly event: 'completed' | 'failed';
          readonly payload: Record<string, unknown>;
        });
      },
    );
  }

  let stopping = false;

  async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    log.info('worker.draining', { signal });
    await worker.stop();
    if (role !== 'render') {
      await boss.offWork(WEBHOOK_QUEUE).catch(() => undefined);
    }
    await stopBoss(boss);
    await pool.end();
    process.exit(0);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

/** Non-negative number from env, or `undefined` when unset/invalid. */
function envNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

main().catch((error: unknown) => {
  log.error('worker.fatal', { error });
  process.exit(1);
});
