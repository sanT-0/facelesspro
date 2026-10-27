/**
 * Liveness/readiness for the api.
 *
 * The probes are injected, not imported: the route has to be testable with no
 * database, and the server is the only place that knows how to reach Postgres
 * and pg-boss. A probe **resolves** when its component is usable and **throws**
 * when it is not; the mapping from throw to `"error"` lives here so every
 * component reports in the same vocabulary as `healthSchema`.
 *
 * Each probe runs under its own deadline. Without one, a hung TCP connect would
 * hold `/health` open forever — the one endpoint a load balancer cannot wait on.
 */

import type { ComponentState, HealthReport } from '@facelesspro/contracts';

export const API_SERVICE = 'facelesspro-api' as const;
export const API_VERSION = '0.1.0';

/** Never let a health request outlive its usefulness. */
export const HEALTH_TIMEOUT_MS = 2_000;

export type HealthProbe = () => Promise<void>;

export interface HealthProbes {
  readonly db: HealthProbe;
  readonly queue: HealthProbe;
}

export interface HealthDeps {
  readonly probes: HealthProbes;
  readonly version?: string;
  readonly timeoutMs?: number;
  /** Injected so a test can pin the timestamp. */
  readonly now?: () => Date;
}

async function probeState(
  probe: HealthProbe,
  timeoutMs: number,
): Promise<ComponentState> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      probe(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`probe timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        // A pending timer must not keep the process alive.
        timer.unref();
      }),
    ]);
    return 'ok';
  } catch {
    // The state is the report; the cause belongs in logs, which arrive with the
    // structured logger (docs/10 §7), not in a public response.
    return 'error';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Read every component, then derive `status` from them. */
export async function readHealth(deps: HealthDeps): Promise<HealthReport> {
  const timeoutMs = deps.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const [db, queue] = await Promise.all([
    probeState(deps.probes.db, timeoutMs),
    probeState(deps.probes.queue, timeoutMs),
  ]);

  return {
    status: db === 'ok' && queue === 'ok' ? 'ok' : 'degraded',
    service: API_SERVICE,
    version: deps.version ?? API_VERSION,
    time: (deps.now ?? (() => new Date()))().toISOString(),
    db,
    queue,
  };
}
