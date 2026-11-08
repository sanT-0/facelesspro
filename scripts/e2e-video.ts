/**
 * P5 gate: one real three-minute mixed-language video through every step.
 *
 * This is an *artifact check*, not a unit test. It drives the production step
 * handlers against the real Postgres, the real media service (edge-tts) and
 * real ffmpeg, with no fake providers at all. The only thing it does not use is
 * the HTTP API: it inserts the video row directly so the run is reproducible
 * and does not need an api process.
 *
 *   npx tsx scripts/e2e-video.ts --dry-run     # estimate only, no services
 *   npx tsx scripts/e2e-video.ts               # full 3-minute landscape gate (~5–10 min)
 *   npx tsx scripts/e2e-video.ts --portrait    # 1080×1920 ~40 s Short, same steps
 *
 * Requires: `docker compose up -d postgres`, a media service on
 * `MEDIA_SERVICE_URL` (default http://127.0.0.1:8000), and ffmpeg/ffprobe.
 * Writes `.data/artifacts/p5-gate/` (or `p5-portrait/` for `--portrait`) with
 * the MP4, thumbnail, captions and a `summary.json` that records exactly what
 * was observed.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createAiVideoV3RequestSchema,
  narrationRowSchema,
  sceneRowSchema,
  styleProfileSchema,
  videoRowSchema,
} from '@facelesspro/contracts';
import type { StyleProfile } from '@facelesspro/contracts';
import { estimateScenePlan, renderDimensions } from '@facelesspro/core';
import {
  artStyle,
  asset,
  captionTemplate,
  createDb,
  creditLedger,
  databaseUrl,
  jobEvent,
  loadEnv,
  narration,
  scene,
  video,
  workspace,
} from '@facelesspro/db';
import {
  createBoss,
  stopBoss,
} from '@facelesspro/queue';
import type { ConsumedJob } from '@facelesspro/queue';
import { asc, eq } from 'drizzle-orm';

import { createMediaTtsPort } from '../apps/worker/src/tts/media';
import { dataDir, resolveStorageKey } from '../apps/worker/src/art-style/storage';
import { createImageChainFromEnv } from '../apps/worker/src/image/factory';
import { createHeuristicPlanner } from '../apps/worker/src/planner/heuristic';
import { createCreateCaptionsHandler } from '../apps/worker/src/steps/create-captions';
import { createCreateImagesHandler } from '../apps/worker/src/steps/create-images';
import { createCreateScenesHandler } from '../apps/worker/src/steps/create-scenes';
import { createCreateVocalHandler } from '../apps/worker/src/steps/create-vocal';
import { createCreateRenderHandler } from '../apps/worker/src/steps/render';

const PORTRAIT = process.argv.includes('--portrait');
const SIZE = PORTRAIT ? ('portrait' as const) : ('landscape' as const);
const ARTIFACT_DIR = PORTRAIT ? '.data/artifacts/p5-portrait' : '.data/artifacts/p5-gate';
/** Seconds of finished video the gate accepts, per orientation. */
const DURATION_WINDOW = PORTRAIT ? { min: 30, max: 60 } : { min: 150, max: 240 };
/** Word timings floor: a ~40 s Short narrates ~80 words, the gate ~320. */
const MIN_WORD_TIMINGS = PORTRAIT ? 40 : 100;
const TEMPLATE_ID = -3;
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * A hand-written Tanglish script, roughly 3 minutes at 130/150 wpm. Tamil is
 * the spine; English carries the tool names a Tamil creator would actually say.
 */
const GATE_SCRIPT = `வணக்கம் நண்பர்களே, இன்று நாம் ஒரு சிறிய online தொழிலை எப்படி தொடங்குவது என்று படிப்படியாக பார்ப்போம்.
முதலில் ஒரு யோசனையை தேர்ந்தெடுக்க வேண்டும். அது உங்களுக்கு பிடித்ததாகவும், மற்றவர்களுக்கு பயனுள்ளதாகவும் இருக்க வேண்டும்.
உதாரணமாக, தமிழ் கற்றுக்கொள்ளும் குழந்தைகளுக்கு எழுத்து பயிற்சி வீடியோக்கள் செய்யலாம். அல்லது சிறு வணிகங்களுக்கு WhatsApp மூலம் order எடுக்க உதவலாம்.
இரண்டாவது படி, சந்தையை சரிபார்க்க வேண்டும். உங்கள் யோசனையை யாராவது ஏற்கனவே செய்கிறார்களா என்று தேடுங்கள்.
அவர்கள் எப்படி வேலை செய்கிறார்கள், எவ்வளவு கட்டணம் வசூலிக்கிறார்கள் என்று பாருங்கள். நீங்கள் வேறு எப்படி சிறப்பாக செய்ய முடியும் என்று யோசியுங்கள்.
வாடிக்கையாளர்களிடம் நேரடியாக பேசுங்கள். அவர்களின் பிரச்சினை என்ன என்று கேளுங்கள். பத்து பேர் சொல்வதை கேட்டால் போதும்.
மூன்றாவது படி, ஒரு சிறிய சோதனை செய்யுங்கள். பெரிய முதலீடு வேண்டாம். ஒரு எளிய landing page உருவாக்குங்கள்.
ஒரு WhatsApp குழு தொடங்குங்கள். முதல் வாடிக்கையாளருக்கு இலவசமாக உதவுங்கள். அவர்களிடம் என்ன தேவை என்று தெரிந்து கொள்ளுங்கள்.
இந்த சோதனை மூலம் உங்கள் யோசனை வேலை செய்கிறதா என்று தெரியும்.
நான்காவது படி, விலையை நிர்ணயம் செய்யுங்கள். மிகக் குறைவாக வைக்க வேண்டாம். உங்கள் நேரம், உழைப்பு, மற்றும் செலவுகளை கணக்கில் எடுத்துக்கொள்ளுங்கள்.
ஒரு மாத சந்தா அல்லது ஒரு வேலைக்கு ஒரு கட்டணம் என்று தேர்வு செய்யலாம். வாடிக்கையாளர் மகிழ்ச்சியாக இருந்தால், அவர்கள் மற்றவர்களுக்கு பரிந்துரை செய்வார்கள்.
பரிந்துரை தான் மிக சிறந்த விளம்பரம்.
ஐந்தாவது படி, எளிய கருவிகளை பயன்படுத்துங்கள். Google Sheets, Notion, Canva, மற்றும் WhatsApp போதும். ஆரம்பத்தில் பெரிய மென்பொருள் தேவை இல்லை.
வேலை நடக்க வேண்டும், அவ்வளவு தான். ஒவ்வொரு வாரமும் என்ன நடந்தது என்று எழுதி வையுங்கள். எந்த வாடிக்கையாளர் எதற்கு பணம் கொடுத்தார் என்று பாருங்கள்.
ஆறாவது படி, பொறுமையாக இருங்கள். முதல் மாதத்தில் பெரிய வருமானம் வராது. ஆனால் ஒவ்வொரு நாளும் ஒரு சிறிய முன்னேற்றம் செய்யுங்கள்.
ஒரு புதிய வாடிக்கையாளர், ஒரு புதிய வீடியோ, ஒரு புதிய பாடம். மூன்று மாதங்களில் உங்களுக்கு தெளிவான படம் கிடைக்கும். எது வேலை செய்கிறது, எது வேலை செய்யவில்லை என்று தெரியும்.
ஏழாவது படி, பதிவுகளை சரியாக வைத்திருங்கள். வருமானம், செலவு, மற்றும் நேரம். ஒரு எளிய Excel sheet போதும். வரி பற்றி தெரிந்து கொள்ளுங்கள்.
சரியான ஆவணங்கள் இருந்தால் பின்னர் பிரச்சினை வராது.
எட்டாவது படி, உங்களை கவனித்துக் கொள்ளுங்கள். தினமும் எட்டு மணி நேரம் தூங்குங்கள். உடற்பயிற்சி செய்யுங்கள். குடும்பத்துடன் நேரம் செலவிடுங்கள்.
தொழில் ஒரு ஓட்டம், வாழ்க்கை அல்ல. சோர்வாக இருந்தால், ஒரு நாள் ஓய்வு எடுங்கள். நீண்ட காலத்திற்கு தொடர்வது தான் முக்கியம்.
Start small, stay consistent, and talk to your customers every week. That is the whole secret.
இறுதியாக, ஒரு சிறிய குழுவை உருவாக்குங்கள். உங்களை போலவே தொடங்கியவர்களுடன் பேசுங்கள். அவர்களின் அனுபவத்தை கேளுங்கள். உங்கள் அனுபவத்தை பகிருங்கள்.
ஒரு நல்ல சமூகம் பல தவறுகளை தவிர்க்க உதவும். நன்றி நண்பர்களே, நாளை மற்றொரு பயனுள்ள விஷயத்துடன் வருகிறேன்.`;

/**
 * A hand-written ~40 s Tanglish Short: hook, three steps, close. The same
 * voice and pipeline as the gate, cut for a vertical feed.
 */
const SHORT_SCRIPT = `வணக்கம் நண்பர்களே! இன்று நாம் ஒரு சிறிய online தொழிலை மூன்று படிகளில் தொடங்குவது என்று பார்ப்போம்.
முதல் படி, ஒரு யோசனையை தேர்ந்தெடுங்கள். அது உங்களுக்கு பிடித்ததாகவும், மற்றவர்களுக்கு பயனுள்ளதாகவும் இருக்க வேண்டும்.
தமிழ் கற்றுக்கொள்ளும் குழந்தைகளுக்கு எழுத்து பயிற்சி வீடியோக்கள் செய்யலாம். அல்லது சிறு வணிகங்களுக்கு WhatsApp மூலம் order எடுக்க உதவலாம்.
இரண்டாவது படி, சந்தையை சரிபார்த்து, பத்து வாடிக்கையாளர்களிடம் நேரடியாக பேசுங்கள்.
மூன்றாவது படி, ஒரு எளிய landing page உருவாக்குங்கள். முதல் வாடிக்கையாளருக்கு இலவசமாக உதவுங்கள்.
ஒரு எளிய Excel sheet போதும். வருவாய், செலவு எழுதி வையுங்கள். பெரிய முதலீடு வேண்டாம்.
Start small, stay consistent, and talk to your customers every week. நன்றி நண்பர்களே, நாளை மற்றொரு பயனுள்ள விஷயத்துடன் வருகிறேன்.`;

const SCRIPT = PORTRAIT ? SHORT_SCRIPT : GATE_SCRIPT;

const STYLE_PROFILE: StyleProfile = styleProfileSchema.parse({
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene, thick clean outlines, warm South Indian palette',
  palette: { hex: ['#14213d', '#fca311', '#e5e5e5'], weights: [0.5, 0.35, 0.15] },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple geometric background',
  composition: 'centred subject with generous safe area',
  characters: [],
  typography: { present: false },
  negative: 'photo, text, watermark, logo',
  seedBase: 20261108,
  measured: {
    line: { strokeDensity: 0.04, edgeEnergy: 0.08 },
    tone: {
      saturation: { mean: 0.5, p95: 0.8 },
      contrast: { mean: 0.2, p95: 0.5 },
      brightness: { mean: 0.6, p95: 0.9 },
    },
    aspect: PORTRAIT
      ? { width: 1080, height: 1920, ratio: 0.5625, orientation: 'portrait' }
      : { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
    safeArea: { edgeContentRatio: 0.04, margin: 0.08 },
    frameCount: 8,
  },
  source: { adapter: 'heuristic', degradedFrom: [] },
});

function log(message: string): void {
  console.log(`[e2e] ${message}`);
}

function fatal(message: string): never {
  throw new Error(message);
}

function ffprobe(path: string): Record<string, unknown> {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      path,
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (probe.status !== 0) fatal(`ffprobe failed: ${probe.stderr}`);
  return JSON.parse(probe.stdout) as Record<string, unknown>;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
}

function streamsOf(probe: Record<string, unknown>): ProbeStream[] {
  const streams = probe.streams;
  return Array.isArray(streams) ? (streams as ProbeStream[]) : [];
}

async function main(): Promise<void> {
  loadEnv();

  const estimate = estimateScenePlan(SCRIPT);
  log(
    `script: ${estimate.language.words.ta} Tamil + ${estimate.language.words.en} English words ` +
      `→ ${estimate.sceneCount} scenes, ${(estimate.totalMs / 1000).toFixed(1)} s estimated`,
  );

  if (DRY_RUN) {
    console.log(JSON.stringify(estimate, null, 2));
    return;
  }

  const { db, pool } = createDb();
  const boss = await createBoss({
    connectionString: databaseUrl(),
    supervise: false,
    schedule: false,
  });

  const workspaceId = (
    await db
      .insert(workspace)
      .values({ name: `p5-gate-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id })
  )[0]!.id;
  const styleId = (
    await db
      .insert(artStyle)
      .values({
        workspace_id: workspaceId,
        name: 'P5 gate style',
        formats: ['landscape'],
        profile: STYLE_PROFILE,
        status: 'ready',
      })
      .returning({ id: artStyle.id })
  )[0]!.id;

  const template = await db
    .select({ id: captionTemplate.id })
    .from(captionTemplate)
    .where(eq(captionTemplate.id, TEMPLATE_ID));
  if (template[0] === undefined) {
    fatal('built-in caption templates are not seeded; run npm run db:migrate');
  }

  const body = createAiVideoV3RequestSchema.parse({
    artStyleId: styleId,
    script: SCRIPT,
    size: 'landscape',
    captions: true,
    captionTemplateId: TEMPLATE_ID,
    render: { resolution: 1080, frameRate: 30, format: 'standard' },
  });

  const videoId = (
    await db
      .insert(video)
      .values({
        workspace_id: workspaceId,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'ai-video-v3', body },
      })
      .returning({ id: video.id })
  )[0]!.id;
  log(`video ${videoId}`);

  const mediaUrl = process.env.MEDIA_SERVICE_URL?.trim() || 'http://127.0.0.1:8000';
  const handlers = {
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
      tts: createMediaTtsPort({
        baseUrl: mediaUrl,
        synthesisTimeoutMs: Number(process.env.MEDIA_TTS_TIMEOUT_MS ?? 900_000),
      }),
      defaultPairId: process.env.TTS_PAIR?.trim() || 'valluvar',
      ttsUnitCost: Number(process.env.TTS_UNIT_COST ?? 0),
    }),
    'create-images': createCreateImagesHandler({
      db,
      pool,
      boss,
      image: createImageChainFromEnv({ env: process.env }),
      imageUnitCost: Number(process.env.IMAGE_UNIT_COST ?? 0),
    }),
    'create-captions': createCreateCaptionsHandler({
      db,
      pool,
      boss,
      subtitleUnitCost: Number(process.env.SUBTITLE_UNIT_COST ?? 1),
    }),
    render: createCreateRenderHandler({
      db,
      pool,
      boss,
      renderUnitCost: Number(process.env.RENDER_UNIT_COST ?? 10),
    }),
  } as const;

  const timings: Array<{ step: string; ms: number }> = [];
  const order = [
    'create-scenes',
    'create-vocal',
    'create-images',
    'create-captions',
    'render',
  ] as const;

  for (const step of order) {
    const started = Date.now();
    log(`${step} …`);
    const job: ConsumedJob = { jobId: `e2e-${step}`, videoId, step };
    await handlers[step](job);
    const elapsed = Date.now() - started;
    timings.push({ step, ms: elapsed });
    const row = videoRowSchema.parse(
      (await db.select().from(video).where(eq(video.id, videoId)))[0],
    );
    log(`${step} done in ${(elapsed / 1000).toFixed(1)} s → status=${row.status} step=${row.step}`);
  }

  await stopBoss(boss);

  const stored = videoRowSchema.parse(
    (await db.select().from(video).where(eq(video.id, videoId)))[0],
  );
  if (stored.status !== 'completed' || stored.video_url === null) {
    fatal(`video did not complete: status=${stored.status} url=${stored.video_url}`);
  }

  const scenes = (
    await db.select().from(scene).where(eq(scene.video_id, videoId)).orderBy(asc(scene.idx))
  ).map((row) => sceneRowSchema.parse(row));
  const narrationRow = narrationRowSchema.parse(
    (await db.select().from(narration).where(eq(narration.video_id, videoId)))[0],
  );
  const assets = await db.select().from(asset).where(eq(asset.workspace_id, workspaceId));
  const ledger = await db.select().from(creditLedger).where(eq(creditLedger.video_id, videoId));
  const events = await db.select().from(jobEvent).where(eq(jobEvent.video_id, videoId));

  const renderAsset = assets.find((row) => row.kind === 'render');
  if (renderAsset === undefined) fatal('no render asset recorded');
  const mp4Path = resolveStorageKey(dataDir(), renderAsset.key);
  const probe = ffprobe(mp4Path);
  const format = probe.format as { duration?: string; size?: string } | undefined;
  const durationS = Number(format?.duration ?? '0');
  const streams = streamsOf(probe);
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  if (videoStream === undefined || audioStream === undefined) {
    fatal('render has no video or audio stream');
  }

  const failures: string[] = [];
  if (durationS < DURATION_WINDOW.min || durationS > DURATION_WINDOW.max) {
    failures.push(`duration ${durationS}s outside ${DURATION_WINDOW.min}–${DURATION_WINDOW.max}s`);
  }
  const expected = renderDimensions(1080, SIZE);
  if (videoStream.width !== expected.width || videoStream.height !== expected.height) {
    failures.push(`geometry ${String(videoStream.width)}x${String(videoStream.height)}`);
  }
  if (videoStream.r_frame_rate !== '30/1') failures.push(`fps ${videoStream.r_frame_rate}`);
  if (videoStream.codec_name !== 'h264') failures.push(`codec ${videoStream.codec_name}`);
  if (audioStream.codec_name !== 'aac') failures.push(`audio ${audioStream.codec_name}`);
  if (stored.duration_ms === null || Math.abs(stored.duration_ms - durationS * 1000) > 100) {
    failures.push(`stored duration ${stored.duration_ms} vs container ${durationS * 1000}`);
  }
  if (Math.abs((narrationRow.duration_ms ?? 0) - durationS * 1000) > 100) {
    failures.push('narration duration disagrees with the container');
  }
  if (scenes.length === 0 || scenes.length > 120) failures.push(`scene count ${scenes.length}`);
  if (narrationRow.word_timings.length < MIN_WORD_TIMINGS) {
    failures.push(`only ${narrationRow.word_timings.length} word timings`);
  }

  const actions = ledger.map((row) => row.action).sort();
  for (const expected of ['tts', 'image', 'subtitles', 'render'] as const) {
    if (actions.filter((action) => action === expected).length !== 1) {
      failures.push(`ledger action ${expected} appears ${actions.filter((a) => a === expected).length}×`);
    }
  }

  const assAsset = assets.find((row) => row.key.endsWith('captions.ass'));
  if (assAsset === undefined) fatal('no captions.ass asset');
  const assText = await readFile(resolveStorageKey(dataDir(), assAsset.key), 'utf8');
  if (!/\p{Script=Tamil}/u.test(assText)) failures.push('ASS has no Tamil text');

  if (failures.length > 0) {
    fatal(`gate checks failed:\n- ${failures.join('\n- ')}`);
  }

  await mkdir(ARTIFACT_DIR, { recursive: true });
  await copyFile(mp4Path, join(ARTIFACT_DIR, 'video.mp4'));
  const thumbnailAsset = assets.find((row) => row.kind === 'thumbnail');
  if (thumbnailAsset !== undefined) {
    await copyFile(
      resolveStorageKey(dataDir(), thumbnailAsset.key),
      join(ARTIFACT_DIR, 'thumbnail.png'),
    );
  }
  await copyFile(resolveStorageKey(dataDir(), assAsset.key), join(ARTIFACT_DIR, 'captions.ass'));

  const mp4Bytes = await readFile(mp4Path);
  const summary = {
    videoId,
    workspaceId,
    size: SIZE,
    scriptWords: estimate.language.words,
    scenes: scenes.length,
    sceneSpanMs: scenes.map((row) => [row.start_ms, row.end_ms]),
    wordTimings: narrationRow.word_timings.length,
    narrationDurationMs: narrationRow.duration_ms,
    containerDurationS: durationS,
    storedDurationMs: stored.duration_ms,
    streams: streams.map((stream) => ({
      type: stream.codec_type,
      codec: stream.codec_name,
      width: stream.width,
      height: stream.height,
      fps: stream.r_frame_rate,
      sampleRate: stream.sample_rate,
      channels: stream.channels,
    })),
    mp4: {
      bytes: mp4Bytes.byteLength,
      sha256: createHash('sha256').update(mp4Bytes).digest('hex'),
    },
    ledger: ledger.map((row) => ({
      action: row.action,
      units: Number(row.units),
      unitCost: Number(row.unit_cost),
      delta: Number(row.delta),
    })),
    jobEvents: events.map((row) => ({ step: row.step, outcome: row.outcome })),
    stepSeconds: timings.map((timing) => ({
      step: timing.step,
      seconds: Number((timing.ms / 1000).toFixed(1)),
    })),
    mediaServiceUrl: mediaUrl,
    observedAt: new Date().toISOString(),
  };
  await writeFile(
    join(ARTIFACT_DIR, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  log(`gate passed: ${durationS.toFixed(2)} s, ${scenes.length} scenes`);
  log(`artifact: ${join(ARTIFACT_DIR, 'video.mp4')}`);
  await pool.end();
}

main().catch((error: unknown) => {
  console.error('[e2e] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
