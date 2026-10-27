import { describe, expect, it, vi } from 'vitest';

import { API_SERVICE, API_VERSION, readHealth } from './health';
import type { HealthDeps, HealthProbe } from './health';

const NOW = new Date('2026-10-27T09:00:00.000Z');

function deps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    probes: {
      db: async () => {},
      queue: async () => {},
    },
    now: () => NOW,
    ...overrides,
  };
}

function failing(message = 'boom'): HealthProbe {
  return async () => {
    throw new Error(message);
  };
}

describe('readHealth', () => {
  it('reports ok when every probe resolves', async () => {
    await expect(readHealth(deps())).resolves.toEqual({
      status: 'ok',
      service: API_SERVICE,
      version: API_VERSION,
      time: NOW.toISOString(),
      db: 'ok',
      queue: 'ok',
    });
  });

  it('degrades when the database is down, keeping the queue result', async () => {
    const report = await readHealth(deps({ probes: { db: failing(), queue: async () => {} } }));
    expect(report).toMatchObject({ status: 'degraded', db: 'error', queue: 'ok' });
  });

  it('degrades when the queue is down, keeping the database result', async () => {
    const report = await readHealth(deps({ probes: { db: async () => {}, queue: failing() } }));
    expect(report).toMatchObject({ status: 'degraded', db: 'ok', queue: 'error' });
  });

  it('degrades when both are down', async () => {
    const report = await readHealth(
      deps({ probes: { db: failing(), queue: failing() } }),
    );
    expect(report).toMatchObject({ status: 'degraded', db: 'error', queue: 'error' });
  });

  it('turns a hung probe into an error instead of hanging the request', async () => {
    const hung: HealthProbe = () => new Promise<void>(() => {});

    const report = await readHealth(
      deps({ probes: { db: hung, queue: async () => {} }, timeoutMs: 20 }),
    );

    expect(report).toMatchObject({ status: 'degraded', db: 'error', queue: 'ok' });
  });

  it('runs the probes concurrently', async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number): HealthProbe => async () => {
      order.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(`${name}:end`);
    };

    await readHealth(
      deps({ probes: { db: slow('db', 20), queue: slow('queue', 1) } }),
    );

    // Sequential execution would be db:start db:end queue:start queue:end.
    expect(order.slice(0, 2)).toEqual(['db:start', 'queue:start']);
  });

  it('uses an injected clock and version', async () => {
    const report = await readHealth(deps({ version: '9.9.9' }));
    expect(report.version).toBe('9.9.9');
    expect(report.time).toBe('2026-10-27T09:00:00.000Z');
  });

  it('never leaks the probe error into the response', async () => {
    const report = await readHealth(
      deps({
        probes: {
          db: failing('password authentication failed for user "faceless"'),
          queue: async () => {},
        },
      }),
    );
    expect(JSON.stringify(report)).not.toContain('password');
  });

  it('does not call a probe twice', async () => {
    const db = vi.fn(async () => {});
    const queue = vi.fn(async () => {});
    await readHealth(deps({ probes: { db, queue } }));
    expect(db).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledTimes(1);
  });
});
