import { describe, expect, it } from 'vitest';
import { app } from './app';

describe('GET /health', () => {
  it('returns 200 with service metadata', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('stickman-api');
    expect(typeof body.time).toBe('string');
    expect(Number.isNaN(Date.parse(String(body.time)))).toBe(false);
  });
});

describe('unknown routes', () => {
  it('returns 404', async () => {
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
  });
});
