/**
 * Generate the six listening-gate clips.
 *
 * This is the only script that runs the real pipeline end to end:
 *
 *   buildNarrationPlan (numbers → overrides → segment → transliterate → voices)
 *     → POST /synthesize (trim → loudnorm → gaps → fades → master)
 *     → samples/tts/NN-name.mp3 + report.json + README.md
 *
 * `TTS_OUT_DIR` writes a second set elsewhere instead of overwriting the
 * approved masters — e.g. `TTS_PAIR=emma TTS_OUT_DIR=samples/tts/female`.
 *
 * It starts the media service itself, so `npm run sample:tts` works from a clean
 * checkout with ffmpeg and the Python deps installed. The service's own catalogue
 * is the source of truth for voice ids; nothing is hardcoded here.
 */

import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { buildNarrationPlan, planToSegments } from '../packages/core/src/index';

interface Sample {
  file: string;
  title: string;
  text: string;
  listenFor: string;
}

const SAMPLES: readonly Sample[] = [
  {
    file: '01-tamil-pure.mp3',
    title: 'Tamil only',
    text:
      'இன்று நாம் ஒரு முக்கியமான விஷயத்தைப் பற்றிப் பேசப் போகிறோம். ' +
      'வெற்றி என்பது ஒரே இரவில் வராது; தினமும் ஒரு சிறிய முயற்சி தான் அதை உருவாக்குகிறது.',
    listenFor: 'Natural Tamil rhythm, no English accent leaking into vowels.',
  },
  {
    file: '02-english-pure.mp3',
    title: 'English only',
    text:
      'Today we are going to talk about something important. ' +
      'Success does not arrive overnight; it is built by one small effort every single day.',
    listenFor: 'Indian English, not a US/UK accent. Sentence pause longer than the comma pause.',
  },
  {
    file: '03-mixed-paragraph.mp3',
    title: 'Mixed paragraph (the seam test)',
    text:
      'இன்று நாம் ஒரு முக்கியமான விஷயத்தைப் பற்றிப் பேசுவோம். ' +
      'Building a faceless channel is not about luck. ' +
      'அதற்கு ஒரு தெளிவான திட்டம் வேண்டும். ' +
      'If you publish one video every week, the algorithm starts to understand you. ' +
      'அதனால் தொடர்ந்து செய்யுங்கள்.',
    listenFor: 'One speaker, not two. No click or volume jump where the voice changes.',
  },
  {
    file: '04-mixed-one-sentence.mp3',
    title: 'Mixed inside one sentence',
    text:
      'இந்த வீடியோவில் நாம் பேசுவது about money and freelancing, ' +
      'அதாவது எப்படி ஒரு நல்ல business கட்டுவது.',
    listenFor: 'The language switch should sound like code-mixing, not a cut between clips.',
  },
  {
    file: '05-tanglish.mp3',
    title: 'Tanglish',
    text: 'vanakkam machan, epdi irukka? today we talk about money.',
    listenFor:
      'Romanised Tamil is spoken as Tamil, and "today we talk about money" stays English.',
  },
  {
    file: '06-numbers-dates.mp3',
    title: 'Numbers, money, dates, percent',
    text:
      '2024 ஆம் ஆண்டில் எங்கள் business ₹1,20,000 லாபம் ஈட்டியது, அதாவது 15% வளர்ச்சி. ' +
      'The next review is at 3pm on 15 August 2025, and the budget is ₹50,000.',
    listenFor:
      'Tamil numbers read as Tamil words (not digits), English numbers read as English, ₹ as rupees.',
  },
];

const PORT = Number(process.env.TTS_PORT ?? 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const PAIR_ID = process.env.TTS_PAIR ?? 'valluvar';

const ROOT = resolve(import.meta.dirname, '..');
const MEDIA_DIR = join(ROOT, 'services', 'media');
// Two approved sets live side by side: the male default in `samples/tts` and the
// female line in `samples/tts/female`, so re-rendering one never destroys the
// other's listening-gate evidence.
const OUT_DIR =
  process.env.TTS_OUT_DIR === undefined
    ? join(ROOT, 'samples', 'tts')
    : resolve(ROOT, process.env.TTS_OUT_DIR);
const DATA_DIR = join(OUT_DIR, '.runs');

const PYTHON =
  process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

interface Pair {
  id: string;
  ta: string;
  en: string;
}

interface ClipReport {
  file: string;
  title: string;
  text: string;
  listenFor: string;
  duration_ms: number;
  runs: number;
  languages: { ta: number; en: number };
  words: number;
  gaps_ms: number[];
  master_gain_db: number | null;
  master_limited: boolean;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`media service did not become healthy on ${BASE}`);
}

async function resolvePair(): Promise<Pair> {
  const res = await fetch(`${BASE}/voices/${encodeURIComponent(PAIR_ID)}`);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`unknown voice pair ${PAIR_ID}: ${detail}`);
  }
  return (await res.json()) as Pair;
}

interface Timeline {
  gaps_ms: number[];
  master?: {
    gain_db: number | null;
    limited: boolean;
    input_lufs: number | null;
    input_dbtp: number | null;
  } | null;
}

async function synthesize(
  pair: Pair,
  sample: Sample,
): Promise<{ clip: ClipReport; masterMp3: string }> {
  const plan = buildNarrationPlan(sample.text, {
    ta: pair.ta,
    en: pair.en,
    pair: pair.id,
  });
  const segments = planToSegments(plan);
  if (segments.length === 0) {
    throw new Error(`${sample.file}: plan produced no segments`);
  }

  const res = await fetch(`${BASE}/synthesize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`${sample.file}: synthesize failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as {
    master_path: string;
    total_duration_ms: number;
    segments: { words: unknown[] }[];
  };
  const masterMp3 = body.master_path.replace(/master\.wav$/u, 'master.mp3');
  const timeline = JSON.parse(
    await readFile(join(dirname(body.master_path), 'timeline.json'), 'utf8'),
  ) as Timeline;

  const languages = { ta: 0, en: 0 };
  for (const run of plan.runs) languages[run.lang] += 1;

  return {
    masterMp3,
    clip: {
      file: sample.file,
      title: sample.title,
      text: sample.text,
      listenFor: sample.listenFor,
      duration_ms: body.total_duration_ms,
      runs: body.segments.length,
      languages,
      words: body.segments.reduce((total, segment) => total + segment.words.length, 0),
      gaps_ms: timeline.gaps_ms,
      master_gain_db: timeline.master?.gain_db ?? null,
      master_limited: timeline.master?.limited ?? false,
    },
  };
}

function describePair(pair: Pair): string {
  return pair.ta === pair.en
    ? `${pair.ta}, one speaker for both languages`
    : `${pair.ta} + ${pair.en}`;
}

function readme(clips: ClipReport[], pair: Pair): string {
  const lines = [
    '# Listening gate — P1',
    '',
    `Generated by \`npm run sample:tts\` with \`${pair.id}\` (${describePair(pair)}).`,
    '',
    'P1 is not done until all six pass. For each clip: **does it sound like one person, in the',
    'right language, without a seam?** The notes are what the unit tests cannot judge.',
    '',
  ];
  for (const clip of clips) {
    lines.push(
      `## ${clip.file}`,
      '',
      `**${clip.title}** — ${(clip.duration_ms / 1000).toFixed(2)} s, ` +
        `${clip.runs} run${clip.runs === 1 ? '' : 's'} (${clip.languages.ta} ta / ` +
        `${clip.languages.en} en), ${clip.words} words.`,
      '',
      clip.master_gain_db === null
        ? 'Master stage: not run.'
        : `Master stage: ${clip.master_gain_db >= 0 ? '+' : ''}${clip.master_gain_db.toFixed(2)} dB` +
          `${clip.master_limited ? ', limiter engaged' : ', no limiting needed'}.`,
      '',
      `> ${clip.text}`,
      '',
      `Listen for: ${clip.listenFor}`,
      '',
      '- [ ] sounds right',
      '- [ ] no seam / click / volume jump',
      '- [ ] Tamil words are not mangled',
      '',
    );
  }
  lines.push(
    'Report any clip that fails with what you heard; the fix goes into the lexicon',
    '(`packages/core/data/tanglish-ta.json`), the number words, or the stitch settings,',
    'and this gate is re-run.',
    '',
  );
  return lines.join('\n');
}

async function readmeOnly(): Promise<void> {
  const report = JSON.parse(
    await readFile(join(OUT_DIR, 'report.json'), 'utf8'),
  ) as { pair: string; ta: string; en: string; clips: ClipReport[] };
  await writeFile(
    join(OUT_DIR, 'README.md'),
    readme(report.clips, { id: report.pair, ta: report.ta, en: report.en }),
  );
  log(`rewrote samples/tts/README.md from report.json (no audio regenerated)`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--readme-only')) {
    await readmeOnly();
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });

  log(`starting media service on ${BASE} …`);
  const server = spawn(
    PYTHON,
    [
      '-m',
      'uvicorn',
      'app.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--log-level',
      'warning',
    ],
    {
      cwd: MEDIA_DIR,
      env: {
        ...process.env,
        MEDIA_DATA_DIR: DATA_DIR,
        PYTHONIOENCODING: 'utf-8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let serverLog = '';
  server.stdout?.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString();
  });
  server.stderr?.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString();
  });

  const clips: ClipReport[] = [];
  try {
    await waitForHealth(30_000);
    const pair = await resolvePair();
    log(`pair ${pair.id}: ${describePair(pair)}`);

    for (const sample of SAMPLES) {
      const { clip, masterMp3 } = await synthesize(pair, sample);
      const target = join(OUT_DIR, sample.file);
      await copyFile(masterMp3, target);
      const size = (await stat(target)).size;
      if (size < 5_000) {
        throw new Error(`${sample.file}: suspiciously small (${size} bytes)`);
      }
      clips.push(clip);
      log(
        `  ${sample.file.padEnd(28)} ${(clip.duration_ms / 1000)
          .toFixed(2)
          .padStart(6)} s  ${String(clip.runs).padStart(2)} runs  ${String(
          clip.words,
        ).padStart(3)} words  ${(size / 1024).toFixed(0)} KiB  ` +
          `${clip.master_limited ? 'limit' : 'gain '} ${(
            clip.master_gain_db ?? 0
          ).toFixed(2)} dB`,
      );
    }

    const report = {
      generated_at: new Date().toISOString(),
      pair: pair.id,
      ta: pair.ta,
      en: pair.en,
      clips,
    };
    await writeFile(join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(join(OUT_DIR, 'README.md'), readme(clips, pair));
    log(`\nwrote ${clips.length} clips + report.json + README.md to ${OUT_DIR}`);
    log(`Now listen: ${relative(ROOT, OUT_DIR).replaceAll('\\', '/')}/README.md`);
  } catch (error) {
    if (serverLog.trim().length > 0) {
      log(`\nmedia service log:\n${serverLog.trim()}`);
    }
    throw error;
  } finally {
    server.kill();
    await new Promise((done) => setTimeout(done, 500));
    if (server.exitCode === null) {
      spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`sample:tts failed: ${String(error)}\n`);
  process.exitCode = 1;
});
