import { healthSchema } from '@facelesspro/contracts';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { API_VERSION } from './health';

const NOW = new Date('2026-10-27T09:00:00.000Z');

function appWith(probes: {
  db: () => Promise<void>;
  queue: () => Promise<void>;
}) {
  return createApp({
    probes,
    now: () => NOW,
    timeoutMs: 20,
    db: {
      insertArtStyle: async () => {},
    },
  });
}

const healthy = async () => {};

describe('GET /health', () => {
  it('returns 200 and a report that parses through healthSchema', async () => {
    const res = await appWith({ db: healthy, queue: healthy }).request('/health');
    expect(res.status).toBe(200);

    const body = healthSchema.parse(await res.json());
    expect(body).toMatchObject({
      status: 'ok',
      service: 'facelesspro-api',
      version: API_VERSION,
      time: NOW.toISOString(),
      db: 'ok',
      queue: 'ok',
    });
  });

  it('returns 503 with the failing component named', async () => {
    const res = await appWith({
      db: healthy,
      queue: async () => {
        throw new Error('queue(s) missing: render');
      },
    }).request('/health');

    expect(res.status).toBe(503);
    const body = healthSchema.parse(await res.json());
    expect(body).toMatchObject({ status: 'degraded', db: 'ok', queue: 'error' });
  });

  it('returns 503 when both components are down', async () => {
    const down = async () => {
      throw new Error('down');
    };
    const res = await appWith({ db: down, queue: down }).request('/health');

    expect(res.status).toBe(503);
    expect(healthSchema.parse(await res.json())).toMatchObject({
      db: 'error',
      queue: 'error',
    });
  });
});

describe('unknown routes', () => {
  it('returns 404', async () => {
    const res = await appWith({ db: healthy, queue: healthy }).request('/nope');
    expect(res.status).toBe(404);
  });
});
