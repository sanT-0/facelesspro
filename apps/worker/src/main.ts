/**
 * `facelesspro-worker` entry point.
 *
 * One boss, one process, graceful drain on Ctrl-C: finishing the job in hand is
 * cheaper than letting it expire and be re-fetched (every step is idempotent, so
 * both work — one just wastes a minute).
 */

import { createDb, databaseUrl, loadEnv } from '@facelesspro/db';
import { createBoss, consume, stopBoss, WEBHOOK_QUEUE } from '@facelesspro/queue';
import { extractThumbnail, renderVideo } from '@facelesspro/art';

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

async function main(): Promise<void> {
  const schema = process.env.PGBOSS_SCHEMA || undefined;
  const boss = await createBoss({
    connectionString: databaseUrl(),
    ...(schema === undefined ? {} : { schema }),
  });

  const { db, pool } = createDb();
  const createScenes = createCreateScenesHandler({
    db,
    pool,
    boss,
    planner: createPlannerChainFromEnv({ env: process.env }),
    asr: createMediaAsrPort({
      baseUrl: process.env.MEDIA_SERVICE_URL,
      timeoutMs: envNumber(process.env.MEDIA_ASR_TIMEOUT_MS),
    }),
  });
  const createVocal = createCreateVocalHandler({
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
  const createImages = createCreateImagesHandler({
    db,
    pool,
    boss,
    image: createImageChainFromEnv({ env: process.env }),
    imageUnitCost: envNumber(process.env.IMAGE_UNIT_COST) ?? 0,
  });
  const createCaptions = createCreateCaptionsHandler({
    db,
    pool,
    boss,
    subtitleUnitCost:
      envNumber(process.env.SUBTITLE_UNIT_COST) ?? DEFAULT_SUBTITLE_UNIT_COST,
  });
  const render = createCreateRenderHandler({
    db,
    pool,
    boss,
    renderVideo,
    extractThumbnail,
    renderUnitCost: envNumber(process.env.RENDER_UNIT_COST) ?? DEFAULT_RENDER_UNIT_COST,
  });

  const worker = await startWorker({
    boss,
    artStyle: createArtStyleBuildHandler({ db, env: process.env }),
    steps: {
      'create-scenes': createScenes,
      'create-vocal': createVocal,
      'create-images': createImages,
      'create-captions': createCaptions,
      render,
    },
  });
  console.log(`[worker] consuming ${worker.queues.join(', ')}`);

  // Webhook delivery: consume jobs from the webhook-delivery queue. Each job
  // carries { videoId, event, payload }; processWebhookDelivery reads the
  // current attempt count, delivers via HTTP, and schedules retries on the
  // documented backoff schedule.
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

  let stopping = false;

  async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} — draining`);
    await worker.stop();
    await boss.offWork(WEBHOOK_QUEUE).catch(() => undefined);
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
  console.error('[worker] fatal', error);
  process.exit(1);
});
