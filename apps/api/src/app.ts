import { mkdirSync } from 'node:fs';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

import { apiError } from '@facelesspro/contracts';
import { readHealth } from './health';
import type { HealthDeps } from './health';
import { planVideo } from './plan';
import { withWorkspace } from './auth';
import { createApiKeyRoutes } from './api-keys';
import type { ApiKeyRouteDeps } from './api-keys';
import { createArtStyleRoutes } from './art-styles';
import type { ArtStyleDeps } from './art-styles';
import { createCaptionTemplateRoutes } from './caption-templates';
import type { CaptionTemplateDeps } from './caption-templates';
import { createAiVideosV3Routes } from './ai-videos-v3';
import { createAiVideosRoutes } from './ai-videos';
import { createQuizVideosRoutes } from './quiz-videos';
import { createFakeTextVideosRoutes } from './fake-text-videos';
import type { SubmitVideo } from './video-submit';
import { createBackgroundVideosRoutes } from './background-videos';
import { createFilesRoutes } from './files';
import { createSoundEffectsRoutes } from './sound-effects';
import { createTtsRoutes } from './text-to-speech';
import { createVoicesRoutes } from './voices';
import { createWorkspaceRoutes } from './workspaces';
import type { WorkspaceRouteDeps } from './workspaces';
import { createVideoRoutes } from './videos';
import type { VideoRouteDeps } from './videos';

/**
 * The api as a set of routes over injected dependencies.
 *
 * There is no module-level `app` on purpose: the real probes talk to Postgres,
 * and a top-level export would make every test that imports the app a silent
 * integration test. `server.ts` builds the real deps; tests build fakes.
 */
export interface ApiDeps
  extends HealthDeps,
    ArtStyleDeps,
    CaptionTemplateDeps,
    VideoRouteDeps,
    ApiKeyRouteDeps,
    WorkspaceRouteDeps {
  /** Insert the video row and enqueue `create-scenes` in one transaction. */
  readonly submitVideo: SubmitVideo;
  /** Store an uploaded file and return its key, byte count and mime type. */
  readonly storeFile: (
    file: {
      readonly name: string;
      readonly type: string;
      readonly arrayBuffer: () => Promise<ArrayBuffer>;
    },
  ) => Promise<{
    readonly key: string;
    readonly bytes: number;
    readonly mime: string;
  }>;
  /** Voices visible to a workspace, newest first. */
  readonly listVoices: (
    workspaceId: string,
  ) => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly gender?: string;
    readonly accent?: string;
    readonly age?: string;
    readonly useCase?: string;
    readonly previewUrl?: string;
    readonly languages: readonly string[];
    readonly mixesEnglish: boolean;
    readonly engine: string;
    readonly sampleRate?: number;
    readonly wordTimings: boolean;
  }>>;
  /** Built-in sound effects. */
  readonly listSoundEffects: () => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly durationMs?: number;
    readonly tags?: readonly string[];
  }>>;
  /** Built-in background videos. */
  readonly listBackgroundVideos: () => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly durationMs?: number;
    readonly thumbnailUrl?: string;
    readonly tags?: readonly string[];
  }>>;
  /** Synthesize speech from text via the media service. */
  readonly synthesizeTts: (
    input: {
      readonly text: string;
      readonly voiceId?: string;
      readonly voiceStyle?: unknown;
    },
  ) => Promise<{
    readonly audioUrl: string;
    readonly durationMs: number;
    readonly voiceId: string;
  }>;
}

/**
 * Public, unauthenticated artifact serving (docs/10).
 *
 * Every `videoUrl`/`imageUrl`/preview URL the api emits is `<base>/files/<key>`,
 * and a key is relative to `storageRoot`. `serveStatic` handles MIME types,
 * HEAD and single byte ranges (video seeking); it rejects `..`, `//` and `\`
 * before touching the filesystem. The handler is built lazily so a fresh
 * install does not fail at boot when nothing has been written yet.
 */
function serveFiles(storageRoot: string): MiddlewareHandler {
  let handler: MiddlewareHandler | undefined;
  return async (c, next) => {
    if (handler === undefined) {
      mkdirSync(storageRoot, { recursive: true });
      handler = serveStatic({
        root: storageRoot,
        rewriteRequestPath: (path) => path.replace(/^\/files/, ''),
      });
    }
    return handler(c, next);
  };
}

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  // Public artifacts stay reachable without a key; `/v1` keeps its own auth.
  app.use('/files/*', serveFiles(deps.storageRoot));

  /**
   * Last line of defence: an unexpected throw still returns the documented
   * envelope (`internal`), never Hono's plain-text body. The message is fixed so
   * an internal error cannot leak a stack, a SQL fragment or a storage path to a
   * client; the real error goes to the process log.
   */
  app.onError((err) => {
    console.error('[api] unhandled error', err);
    return new Response(JSON.stringify(apiError('internal', 'unexpected error')), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  });

  /**
   * `200 {status:"ok"}` when every component is usable, `503 degraded`
   * otherwise — the body always parses as `healthSchema`, so a monitor can read
   * which component failed without knowing anything else.
   */
  app.get('/health', async (c) => {
    const report = await readHealth(deps);
    return report.status === 'ok' ? c.json(report, 200) : c.json(report, 503);
  });

  /**
   * `POST /v1/videos/plan` — a dry-run estimate with no video row and no
   * charge. The body is parsed defensively: garbage JSON, missing keys, or a
   * blank script return `400 invalid_request` naming the field; anything else
   * is a `200` estimate that parses through `planVideoResponseSchema`.
   *
   * Authentication is the only database touch (the key row); the estimator has
   * no probe dependency, so a failing health probe cannot make planning fail.
   */
  app.use('/v1/videos/plan', withWorkspace(deps));
  app.post('/v1/videos/plan', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json(apiError('invalid_request', 'request body must be JSON'), 400);
    }

    const result = planVideo(input);
    return c.json(result.body, result.status);
  });

  /**
   * `POST /v1/art-styles` — upload a reference video for style cloning.
   * Validates with ffprobe (≥30s, has audio, ≤10min), stores file, inserts
   * `art_style` row with `status='building'`, enqueues the build atomically,
   * and returns `202` scoped to the authenticated workspace.
   */
  app.route('/v1/art-styles', createArtStyleRoutes(deps));

  /** Slow-changing built-ins behind the same workspace key. */
  app.route('/v1/caption-templates', createCaptionTemplateRoutes(deps));

  /**
   * `POST/GET/DELETE /v1/keys` — the first authenticated surface. The secret is
   * shown once; revocation is immediate and final.
   */
  app.route('/v1/keys', createApiKeyRoutes(deps));

  /**
   * `GET /v1/videos/:id` — the client's view of the pipeline. The stored render
   * key becomes an absolute `/files/*` URL; a failed video keeps `step` as the
   * retry resume point. Every read and transition is scoped to the key's
   * workspace, so another workspace's id is indistinguishable from a missing one.
   */
  app.route('/v1/videos', createVideoRoutes(deps));

  /**
   * `POST /v1/ai-videos-v3` — create a V3 video. Auth and rate limits come
   * from `withWorkspace()` inside the route; the submission dependency owns
   * the row insert and the `create-scenes` enqueue.
   */
  app.route('/v1/ai-videos-v3', createAiVideosV3Routes(deps));

  /**
   * `POST /v1/ai-videos` — create a V2 video: a fixed `imageStyle` preset
   * instead of a cloned art style. Shares the same submit transaction.
   */
  app.route('/v1/ai-videos', createAiVideosRoutes(deps));

  /**
   * `POST /v1/quiz-videos` — create a Quiz video: items (questions/comments),
   * answer template for narration, optional background and question image
   * generation. Uses the quiz-specific image style set.
   */
  app.route('/v1/quiz-videos', createQuizVideosRoutes(deps));

  /**
   * `POST /v1/fake-text-videos` — create a Fake Text video: conversations with
   * characters, messages, chat templates, and optional background video.
   * Uses per-character voices for TTS.
   */
  app.route('/v1/fake-text-videos', createFakeTextVideosRoutes(deps));

  /**
   * `POST /v1/files` — multipart file upload. Auth and rate limits come from
   * `withWorkspace()` inside the route; `storeFile` owns the actual storage.
   */
  app.route('/v1/files', createFilesRoutes(deps));

  /**
   * `GET /v1/voices` — voice library for the authenticated workspace.
   */
  app.route('/v1/voices', createVoicesRoutes(deps));

  /**
   * `GET /v1/sound-effects` — built-in sound effect library.
   */
  app.route('/v1/sound-effects', createSoundEffectsRoutes(deps));

  /**
   * `GET /v1/background-videos` — built-in background video library.
   */
  app.route('/v1/background-videos', createBackgroundVideosRoutes(deps));

  /**
   * `POST /v1/text-to-speech` — synthesize speech from text via the media service.
   */
  app.route('/v1/text-to-speech', createTtsRoutes(deps));

  /**
   * `GET /v1/workspace`, `GET /v1/credit-logs`, `GET /v1/balance-logs` —
   * workspace-scoped reads for the authenticated key's workspace.
   */
  app.route('/v1', createWorkspaceRoutes(deps));

  return app;
}
