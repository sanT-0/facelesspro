/**
 * Fake `/v1` API for the browser specs.
 *
 * Every response matches the zod shapes in `@facelesspro/contracts`, so a spec
 * fails when the UI stops consuming the documented contract. Requests are
 * recorded so a spec can assert what the form actually sent.
 */

import type { Page, Request, Route } from '@playwright/test';

export const API_KEY = `vp_${'a'.repeat(40)}`;
export const OTHER_KEY = `vp_${'b'.repeat(40)}`;

export const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
export const VIDEO_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
export const STYLE_ID = 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f';
const CREATED_AT = '2026-11-10T09:00:00.000Z';
const UPDATED_AT = '2026-11-10T09:05:00.000Z';

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export interface FakeApiOptions {
  /**
   * The Nth `GET /v1/videos/:id` (1-based) that returns `completed`.
   * Default 2: processing on mount, completed on the first poll.
   */
  readonly completeAfter?: number;
  /** Video status returned for the create response. */
  readonly createStatus?: string;
  /** Whether the caption track exists; default true. */
  readonly captions?: boolean;
}

export interface FakeApi {
  readonly requests: RecordedRequest[];
  /** Calls to `GET /v1/videos/:id` so a spec can prove polling happened. */
  videoReads(): number;
}

const ART_STYLE = {
  id: STYLE_ID,
  name: 'Tamil Comic',
  published: true,
  formats: ['landscape', 'portrait'],
  previewUrl: '/files/styles/tamil-comic.png',
  sampleVideoUrls: [],
  status: 'ready',
  createdAt: CREATED_AT,
};

const VOICES = [
  {
    id: 'ta-female-1',
    name: 'Tamil Female',
    languages: ['ta', 'en'],
    mixesEnglish: true,
    engine: 'edge',
    wordTimings: true,
  },
  {
    id: 'ta-male-1',
    name: 'Tamil Male',
    languages: ['ta', 'en'],
    mixesEnglish: true,
    engine: 'edge',
    wordTimings: true,
  },
];

const SCENES = [
  {
    id: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70',
    idx: 0,
    text: 'தமிழ் முதல் காட்சி',
    imageUrl: '/files/scenes/0.png',
    startMs: 0,
    endMs: 3200,
  },
  {
    id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7081',
    idx: 1,
    text: 'இரண்டாவது காட்சி',
    imageUrl: '/files/scenes/1.png',
    startMs: 3200,
    endMs: 6400,
  },
];

const PLAN = {
  scenes: [
    {
      text: 'தமிழ் முதல் காட்சி',
      imagePrompt: 'a Tamil street at dawn, cinematic',
      motion: 'kenburns-in',
      emphasis: ['தமிழ்'],
      startMs: 0,
      endMs: 3200,
    },
    {
      text: 'இரண்டாவது காட்சி',
      imagePrompt: 'a second Tamil street, warm light',
      motion: 'pan-left',
      emphasis: [],
      startMs: 3200,
      endMs: 6400,
    },
  ],
  adapter: 'heuristic',
  degradedFrom: [],
  totalMs: 6400,
};

const VOICE_PLAN = {  script: 'வணக்கம் நண்பர்களே. Today fire!',
  spokenText: 'வணக்கம் நண்பர்களே. Today fire!',
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
      voice: 'en-IN-NeerjaNeural',
      script: 'latin',
    },
  ],
  overrides: [],
  pair: null,
};

const CAPTION_DOCUMENT = {
  version: 1,
  durationMs: 6400,
  cues: [
    {
      index: 1,
      startMs: 0,
      endMs: 3200,
      lines: ['தமிழ் முதல் காட்சி'],
      words: [
        { text: 'தமிழ்', startMs: 0, endMs: 1000 },
        { text: 'முதல்', startMs: 1000, endMs: 2000 },
        { text: 'காட்சி', startMs: 2000, endMs: 3200 },
      ],
    },
    {
      index: 2,
      startMs: 3200,
      endMs: 6400,
      lines: ['இரண்டாவது காட்சி'],
      words: [
        { text: 'இரண்டாவது', startMs: 3200, endMs: 4800 },
        { text: 'காட்சி', startMs: 4800, endMs: 6400 },
      ],
    },
  ],
};

export const NARRATION_URL = `/files/ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/audio/narration.wav`;
export const NARRATION_DURATION_MS = 6400;

export const CAPTION_TEMPLATES = [
  {
    id: -1,
    name: 'Built-in',
    spec: { fontFamily: 'Noto Sans Tamil', fontSize: 64 },
  },
  {
    id: 7,
    name: 'One word',
    spec: { wordLimit: 1, maxLines: 1 },
  },
];

/** A deliberately different grouping, so a preview cannot look like the stored track. */
const CAPTION_PREVIEW_DOCUMENT = {
  version: 1,
  durationMs: 6400,
  cues: [
    {
      index: 1,
      startMs: 0,
      endMs: 2000,
      lines: ['தமிழ் முதல்'],
      words: [
        { text: 'தமிழ்', startMs: 0, endMs: 1000 },
        { text: 'முதல்', startMs: 1000, endMs: 2000 },
      ],
      emoji: '🔥',
    },
    {
      index: 2,
      startMs: 2000,
      endMs: 4800,
      lines: ['காட்சி இரண்டாவது'],
      words: [
        { text: 'காட்சி', startMs: 2000, endMs: 3200 },
        { text: 'இரண்டாவது', startMs: 3200, endMs: 4800 },
      ],
    },
    {
      index: 3,
      startMs: 4800,
      endMs: 6400,
      lines: ['காட்சி'],
      words: [{ text: 'காட்சி', startMs: 4800, endMs: 6400 }],
    },
  ],
};

/**
 * A real 16-bit PCM WAV, so the editor's `decodeAudioData` path runs instead of
 * being stubbed. The amplitude is modulated so the drawn envelope is not a
 * flat block a blank canvas could accidentally match.
 */
function buildNarrationWav(): Buffer {
  const sampleRate = 8_000;
  const sampleCount = Math.round((NARRATION_DURATION_MS / 1000) * sampleRate);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < sampleCount; i += 1) {
    const seconds = i / sampleRate;
    const envelope = 0.25 + 0.2 * Math.sin(2 * Math.PI * 1.5 * seconds);
    const sample = Math.sin(2 * Math.PI * 220 * seconds) * envelope;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  return buffer;
}

const CAPTION_SIDECARS: Record<string, { mime: string; body: string }> = {  srt: {
    mime: 'application/x-subrip; charset=utf-8',
    body: '1\n00:00:00,000 --> 00:00:03,200\nதமிழ் முதல் காட்சி\n\n2\n00:00:03,200 --> 00:00:06,400\nஇரண்டாவது காட்சி\n',
  },
  vtt: {
    mime: 'text/vtt; charset=utf-8',
    body: 'WEBVTT\n\n00:00:00.000 --> 00:00:03.200\nதமிழ் முதல் காட்சி\n',
  },
  ass: {
    mime: 'text/x-ssa; charset=utf-8',
    body: '[Script Info]\nPlayResX: 1920\nPlayResY: 1080\n',
  },
  json: {
    mime: 'application/json; charset=utf-8',
    body: JSON.stringify(CAPTION_DOCUMENT),
  },
};

export async function installFakeApi(
  page: Page,
  options: FakeApiOptions = {},
): Promise<FakeApi> {
  const requests: RecordedRequest[] = [];
  let videoReads = 0;
  const completeAfter = options.completeAfter ?? 2;

  const video = (status: 'processing' | 'completed') => ({
    id: VIDEO_ID,
    kind: 'ai-video-v3',
    status,
    step: status === 'completed' ? null : 'create-scenes',
    render: true,
    ...(status === 'completed'
      ? {
          videoUrl: 'https://cdn.example.com/videos/facelesspro.mp4',
          thumbnailUrl: 'https://cdn.example.com/videos/facelesspro.jpg',
          durationMs: 6400,
          scenes: SCENES,
          voicePlan: VOICE_PLAN,
          narrationUrl: NARRATION_URL,
        }
      : {}),
    error: null,
    editorUrl: `http://127.0.0.1:3103/editor?id=${VIDEO_ID}`,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  });

  await page.route('**/files/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === NARRATION_URL) {
      await route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: buildNarrationWav(),
      });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });

  await page.route(/\/v1\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = readJsonBody(request);

    requests.push({ method, path, body });

    const authorized = request.headers()['authorization'] === `Bearer ${API_KEY}`;
    if (!authorized) {
      await json(route, 401, {
        error: { code: 'unauthorized', message: 'invalid or missing API key' },
      });
      return;
    }

    if (method === 'GET' && path === '/v1/workspace') {
      await json(route, 200, {
        id: WORKSPACE_ID,
        name: 'Test Workspace',
        plan: {
          id: 'selfhost',
          minutesPerMonth: null,
          creditsPerMonth: null,
          maxVideoMinutes: 120,
          maxResolution: 2160,
          seats: 1,
        },
        credits: null,
        owner: {
          id: 'f6a7b8c9-d0e1-4f2a-9b3c-4d5e6f708192',
          email: 'owner@example.com',
          name: 'Owner',
        },
      });
      return;
    }

    if (method === 'GET' && path === '/v1/caption-templates') {
      await json(route, 200, { templates: CAPTION_TEMPLATES });
      return;
    }

    if (method === 'GET' && path === '/v1/art-styles') {
      await json(route, 200, { styles: [ART_STYLE] });
      return;
    }

    if (method === 'GET' && path === '/v1/voices') {
      await json(route, 200, { voices: VOICES });
      return;
    }

    if (method === 'POST' && path === '/v1/ai-videos-v3') {
      await json(route, 202, {
        id: VIDEO_ID,
        status: options.createStatus ?? 'processing',
        render: true,
        createdAt: CREATED_AT,
        editorUrl: `http://127.0.0.1:3103/editor?id=${VIDEO_ID}`,
      });
      return;
    }

    if (method === 'GET' && path === `/v1/videos/${VIDEO_ID}/plan`) {
      await json(route, 200, { plan: PLAN, voicePlan: VOICE_PLAN });
      return;
    }

    if (method === 'GET' && path === `/v1/videos/${VIDEO_ID}`) {
      videoReads += 1;
      await json(route, 200, video(videoReads >= completeAfter ? 'completed' : 'processing'));
      return;
    }

    if (method === 'GET' && path === `/v1/videos/${VIDEO_ID}/captions`) {
      if (options.captions === false) {
        await json(route, 404, {
          error: { code: 'not_found', message: 'captions not available' },
        });
        return;
      }
      const format = new URL(request.url()).searchParams.get('format') ?? 'srt';
      const sidecar = CAPTION_SIDECARS[format];
      if (sidecar === undefined) {
        await json(route, 400, {
          error: { code: 'invalid_request', message: 'format must be srt, vtt, ass or json', field: 'format' },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: sidecar.mime,
        body: sidecar.body,
      });
      return;
    }

    if (method === 'POST' && path === `/v1/videos/${VIDEO_ID}/captions`) {
      // The API stores the style on the request and queues `create-captions`;
      // the fake echoes the transition without rebuilding anything.
      await json(route, 202, {
        ...video('completed'),
        status: 'processing',
        step: 'create-captions',
      });
      return;
    }

    if (method === 'POST' && path === `/v1/videos/${VIDEO_ID}/captions/preview`) {
      await json(route, 200, CAPTION_PREVIEW_DOCUMENT);
      return;
    }

    if (method === 'POST' && path === `/v1/videos/${VIDEO_ID}/render`) {
      await json(route, 202, {
        ...video('completed'),
        status: 'rendering',
        step: 'render',
      });
      return;
    }

    if (method === 'POST' && path === `/v1/videos/${VIDEO_ID}/retry`) {
      await json(route, 202, video('processing'));
      return;
    }

    // One-scene redraw: the API moves the video back to `create-images` and the
    // worker re-renders afterwards. The stills stay listed meanwhile.
    if (
      method === 'POST' &&
      new RegExp(`^/v1/videos/${VIDEO_ID}/scenes/\\d+/redraw$`).test(path)
    ) {
      await json(route, 202, {
        ...video('completed'),
        status: 'processing',
        step: 'create-images',
      });
      return;
    }

    // Selective re-narrate: the scene text has already been replaced in the
    // stored request, so the 202 body shows the new text while `create-vocal`
    // re-stitches the master.
    if (method === 'POST' && path === `/v1/videos/${VIDEO_ID}/narration`) {
      const edits =
        (body as { scenes?: { idx: number; text: string }[] } | undefined)?.scenes ?? [];
      const scenes = SCENES.map((scene) => {
        const edit = edits.find((candidate) => candidate.idx === scene.idx);
        return edit === undefined ? scene : { ...scene, text: edit.text };
      });
      await json(route, 202, {
        ...video('completed'),
        status: 'processing',
        step: 'create-vocal',
        scenes,
      });
      return;
    }

    await json(route, 404, {
      error: { code: 'not_found', message: `fake api has no ${method} ${path}` },
    });
  });

  return {
    requests,
    videoReads: () => videoReads,
  };
}

/** Put a token in localStorage before the first script runs. */
export async function signInAs(page: Page, key: string = API_KEY): Promise<void> {
  await page.addInitScript((token) => {
    window.localStorage.setItem('facelesspro_token', token);
  }, key);
}

function readJsonBody(request: Request): unknown {
  const data = request.postData();
  if (data === null || data === '') return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

async function json(
  route: Route,
  status: number,
  body: unknown,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}
