import { describe, expect, it } from 'vitest';

import { apiErrorBodySchema, planVideoResponseSchema } from '@facelesspro/contracts';

import { createApp } from './app';

function appWith(probes: { db: () => Promise<void>; queue: () => Promise<void> }) {
  return createApp({
    probes,
    now: () => new Date('2026-10-27T09:00:00.000Z'),
    db: {
      insertArtStyle: async () => {},
    },
  });
}

const healthy = async () => {};
const app = appWith({ db: healthy, queue: healthy });

const baseScript = 'வணக்கம் நண்பர்களே. இன்று ஒரு சிறிய விஷயம் பேசுவோம்.';

async function errorBody(res: Response) {
  return apiErrorBodySchema.parse(await res.json());
}
describe('POST /v1/videos/plan', () => {
  it('returns 200 with an estimate that parses through the response schema', async () => {
    const res = await app.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: baseScript }),
    });
    expect(res.status).toBe(200);

    const body = planVideoResponseSchema.parse(await res.json());
    expect(body.adapter).toBe('heuristic');
    expect(body.sceneCount).toBe(body.scenes.length);
    expect(body.totalMs).toBe(body.scenes.at(-1)!.endMs);
    expect(body.scenes[0]!.startMs).toBe(0);
  });

  it('joins back to the script and never overlaps', async () => {
    const res = await app.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: baseScript }),
    });
    const body = planVideoResponseSchema.parse(await res.json());

    expect(body.scenes.map((scene) => scene.text).join(' ')).toContain(
      baseScript.trim(),
    );
    for (let i = 1; i < body.scenes.length; i += 1) {
      expect(body.scenes[i]!.startMs).toBeGreaterThanOrEqual(
        body.scenes[i - 1]!.endMs,
      );
    }
  });

  it('reports mixed language for a Tamil/English script', async () => {
    const res = await app.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: 'வணக்கம் நண்பர்களே. Hello friends.' }),
    });
    const body = planVideoResponseSchema.parse(await res.json());
    expect(body.language.run).toBe('mixed');
    expect(body.language.words.ta).toBeGreaterThan(0);
    expect(body.language.words.en).toBeGreaterThan(0);
  });

  it('does not touch the database: a throwing probe still returns 200', async () => {
    const exploding = appWith({
      db: async () => {
        throw new Error('db is down');
      },
      queue: healthy,
    });
    const res = await exploding.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: baseScript }),
    });
    expect(res.status).toBe(200);
    expect(planVideoResponseSchema.parse(await res.json()).adapter).toBe(
      'heuristic',
    );
  });

  it('rejects invalid JSON with invalid_request', async () => {
    const res = await app.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
  });

  it('rejects a blank script with field script', async () => {
    const res = await app.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: '   ' }),
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('script');
  });

  it('rejects punctuation-only input with field script', async () => {
    const res = await app.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: '...!!!' }),
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('script');
  });

  it('rejects a script over the portrait ceiling with field script', async () => {
    const res = await app.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: 'portrait', script: 'x'.repeat(4001) }),
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('script');
  });

  it('rejects an unknown key instead of dropping it', async () => {
    const res = await app.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: baseScript, voiceId: 'pallavi' }),
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
  });

  it('requires a script', async () => {
    const res = await app.request('/v1/videos/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('script');
  });
});
