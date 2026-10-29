import { describe, expect, it, vi, beforeEach } from 'vitest';

import { apiErrorBodySchema, createArtStyleResponseSchema } from '@facelesspro/contracts';

import { createApp } from './app';

// Mock video-probe to avoid needing real ffprobe in tests
vi.mock('./video-probe', () => ({
  validateReferenceVideo: vi.fn(async () => ({
    durationSeconds: 60,
    hasAudio: true,
    width: 1920,
    height: 1080,
    format: 'mp4',
  })),
  MIN_REF_DURATION_S: 30,
  MAX_REF_DURATION_S: 600,
}));

const healthy = async () => {};
const mockDb = { insertArtStyle: vi.fn(async () => {}) };

function appWith(probes: { db: () => Promise<void>; queue: () => Promise<void> }) {
  return createApp({
    probes,
    now: () => new Date('2026-10-27T09:00:00.000Z'),
    db: mockDb,
  });
}

const app = appWith({ db: healthy, queue: healthy });

async function errorBody(res: Response) {
  return apiErrorBodySchema.parse(await res.json());
}

async function multipartRequest(file: File, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return app.request('/v1/art-styles', {
    method: 'POST',
    body: form,
  });
}

describe('POST /v1/art-styles', () => {
  const validMp4 = new File(['fake video content'], 'test.mp4', { type: 'video/mp4' });

  beforeEach(() => {
    mockDb.insertArtStyle.mockClear();
  });

  it('returns 202 with building status for a valid video', async () => {
    const res = await multipartRequest(validMp4);
    expect(res.status).toBe(202);

    const body = createArtStyleResponseSchema.parse(await res.json());
    expect(body.status).toBe('building');
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();

    expect(mockDb.insertArtStyle).toHaveBeenCalledOnce();
    const calls = mockDb.insertArtStyle.mock.calls as unknown as Array<[{
      id: string;
      name: string;
      published: boolean;
      formats: string[];
      status: string;
    }]>;
    const call = calls[0]![0]!;
    expect(call.id).toBe(body.id);
    expect(call.name).toBe(`Style ${body.id.slice(0, 8)}`);
    expect(call.status).toBe('building');
    expect(call.formats).toEqual(['landscape']);
    expect(call.published).toBe(false);
  });

  it('uses provided name and formats', async () => {
    const res = await multipartRequest(validMp4, {
      name: 'My Custom Style',
      formats: JSON.stringify(['portrait']),
      published: 'true',
    });
    expect(res.status).toBe(202);

    const calls = mockDb.insertArtStyle.mock.calls as unknown as Array<[{
      name: string;
      formats: string[];
      published: boolean;
    }]>;
    const call = calls[0]![0]!;
    expect(call.name).toBe('My Custom Style');
    expect(call.formats).toEqual(['portrait']);
    expect(call.published).toBe(true);
  });

  it('rejects missing file', async () => {
    const form = new FormData();
    const res = await app.request('/v1/art-styles', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('file');
  });

  it('rejects non-video file', async () => {
    const png = new File(['fake png'], 'test.png', { type: 'image/png' });
    const res = await multipartRequest(png);
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('file');
  });

  it('rejects invalid formats array', async () => {
    const res = await multipartRequest(validMp4, {
      formats: JSON.stringify(['square']),
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('formats');
  });

  it('rejects empty formats array', async () => {
    const res = await multipartRequest(validMp4, {
      formats: JSON.stringify([]),
    });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('formats');
  });

  it('rejects empty name', async () => {
    const res = await multipartRequest(validMp4, { name: '' });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
  });

  it('rejects invalid JSON in formats field', async () => {
    const res = await multipartRequest(validMp4, { formats: 'not json' });
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('formats');
  });

  it('does not call insertArtStyle when validation fails', async () => {
    const png = new File(['fake png'], 'test.png', { type: 'image/png' });
    await multipartRequest(png);
    expect(mockDb.insertArtStyle).not.toHaveBeenCalled();
  });
});