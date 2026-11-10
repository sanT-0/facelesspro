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
        }
      : {}),
    error: null,
    editorUrl: `http://127.0.0.1:3103/editor?id=${VIDEO_ID}`,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
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

    if (method === 'GET' && path === `/v1/videos/${VIDEO_ID}`) {
      videoReads += 1;
      await json(route, 200, video(videoReads >= completeAfter ? 'completed' : 'processing'));
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
