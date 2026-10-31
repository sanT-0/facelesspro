import { Hono } from 'hono';

import { apiError } from '@facelesspro/contracts';
import { readHealth } from './health';
import type { HealthDeps } from './health';
import { planVideo } from './plan';
import { createArtStyleRoutes } from './art-styles';
import type { ArtStyleDeps } from './art-styles';

/**
 * The api as a set of routes over injected dependencies.
 *
 * There is no module-level `app` on purpose: the real probes talk to Postgres,
 * and a top-level export would make every test that imports the app a silent
 * integration test. `server.ts` builds the real deps; tests build fakes.
 */
export interface ApiDeps extends HealthDeps, ArtStyleDeps {}

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

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
   * No auth yet (API keys are P6) and no database touch — this route must stay
   * fast and available even when Postgres is down.
   */
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
   * and returns `202`. No auth yet (P6).
   */
  app.route('/v1/art-styles', createArtStyleRoutes(deps));

  return app;
}
