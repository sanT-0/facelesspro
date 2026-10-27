import { Hono } from 'hono';

import { readHealth } from './health';
import type { HealthDeps } from './health';

/**
 * The api as a set of routes over injected dependencies.
 *
 * There is no module-level `app` on purpose: the real probes talk to Postgres,
 * and a top-level export would make every test that imports the app a silent
 * integration test. `server.ts` builds the real deps; tests build fakes.
 */
export function createApp(deps: HealthDeps): Hono {
  const app = new Hono();

  /**
   * `200 {status:"ok"}` when every component is usable, `503 degraded`
   * otherwise — the body always parses as `healthSchema`, so a monitor can read
   * which component failed without knowing anything else.
   */
  app.get('/health', async (c) => {
    const report = await readHealth(deps);
    return report.status === 'ok' ? c.json(report, 200) : c.json(report, 503);
  });

  return app;
}
