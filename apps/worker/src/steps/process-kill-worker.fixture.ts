/**
 * A real worker process for the SIGKILL resume test (`test:db`).
 *
 * `pipeline-resume.db.test.ts` spawns this file with `node --import tsx`,
 * waits until the fake TTS has entered the step body, then kills it with
 * `SIGKILL`. The providers that would need a network are local fakes (an
 * offline heuristic planner, a real ffmpeg MP3 for TTS, the procedural image
 * adapter); everything else — pg-boss, Postgres, `withStep`, `job_lock`, the
 * actual handlers and ffmpeg for captions/render — is production code.
 *
 * Not collected by vitest (the file name is not `*.test.ts`) and not imported
 * by `main.ts`; only the process-kill test starts it.
 *
 * Env:
 *   KILL_FIXTURE_MODE        `hang` (block inside TTS after printing the
 *                            marker) or `resume` (finish normally)
 *   KILL_FIXTURE_MP3         path to the pre-encoded MP3 both modes return
 *   KILL_FIXTURE_DURATION_MS the probe-reported length of that MP3
 */

import { readFile } from 'node:fs/promises';

import { extractThumbnail, renderVideo } from '@facelesspro/art';
import { createDb, databaseUrl, loadEnv } from '@facelesspro/db';
import { createBoss, stopBoss } from '@facelesspro/queue';

import { createImageChainFromEnv } from '../image/factory';
import { createHeuristicPlanner } from '../planner/heuristic';
import type { TtsPort } from '../ports/tts';
import { startWorker } from '../worker';
import { createCreateCaptionsHandler } from './create-captions';
import { createCreateImagesHandler } from './create-images';
import { createCreateRenderHandler } from './render';
import { createCreateScenesHandler } from './create-scenes';
import { createCreateVocalHandler } from './create-vocal';

const PAIR = {
  id: 'valluvar',
  ta: 'ta-IN-ValluvarNeural',
  en: 'ta-IN-ValluvarNeural',
  notes: 'one speaker reads both languages',
};

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

function fakeTts(
  audio: Uint8Array,
  durationMs: number,
  hang: boolean,
): TtsPort {
  return {
    resolvePair: async (pairId) => {
      if (pairId !== PAIR.id) throw new Error(`unexpected pair ${pairId}`);
      return PAIR;
    },
    synthesize: async (request) => {
      if (hang) {
        // The parent waits for this line, then SIGKILLs the process. Reaching
        // it means `withStep` has already claimed the step and written the
        // `job_lock` row, but nothing has been committed yet.
        console.log('KILL_READY');
        await new Promise<never>(() => {});
      }

      const count = request.segments.length;
      const slot = Math.floor(durationMs / count);

      return {
        requestId: 'process-kill-request',
        audio,
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

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function envMode(): 'hang' | 'resume' {
  const mode = required('KILL_FIXTURE_MODE');
  if (mode !== 'hang' && mode !== 'resume') {
    throw new Error(`KILL_FIXTURE_MODE must be hang or resume, got ${mode}`);
  }
  return mode;
}

async function main(): Promise<void> {
  loadEnv();
  const mode = envMode();
  const durationMs = Number(required('KILL_FIXTURE_DURATION_MS'));
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('KILL_FIXTURE_DURATION_MS must be a positive number');
  }
  const audio = new Uint8Array(await readFile(required('KILL_FIXTURE_MP3')));

  const boss = await createBoss({
    connectionString: databaseUrl(),
    schedule: false,
  });
  const { db, pool } = createDb();

  const worker = await startWorker({
    boss,
    steps: {
      'create-scenes': createCreateScenesHandler({
        db,
        pool,
        boss,
        planner: createHeuristicPlanner(),
      }),
      'create-vocal': createCreateVocalHandler({
        db,
        pool,
        boss,
        tts: fakeTts(audio, durationMs, mode === 'hang'),
        defaultPairId: PAIR.id,
        ttsUnitCost: 1,
      }),
      'create-images': createCreateImagesHandler({
        db,
        pool,
        boss,
        image: createImageChainFromEnv({ env: { IMAGE: 'procedural' }, logger: () => {} }),
        imageUnitCost: 5,
      }),
      'create-captions': createCreateCaptionsHandler({
        db,
        pool,
        boss,
        subtitleUnitCost: 2,
      }),
      render: createCreateRenderHandler({
        db,
        pool,
        boss,
        renderVideo,
        extractThumbnail,
      }),
    },
  });

  console.log(`[kill-fixture] ${mode} consuming ${worker.queues.join(', ')}`);

  let stopping = false;
  async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    console.log(`[kill-fixture] ${signal} — draining`);
    await worker.stop();
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

main().catch((error: unknown) => {
  console.error('[kill-fixture] fatal', error);
  process.exit(1);
});
