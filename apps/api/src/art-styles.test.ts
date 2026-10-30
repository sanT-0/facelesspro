import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiErrorBodySchema, createArtStyleResponseSchema } from '@facelesspro/contracts';

import { createApp } from './app';
import type { ArtStyleSubmission } from './art-styles';

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
const submitArtStyle = vi.fn(async (_submission: ArtStyleSubmission) => {});
let storageRoot = '';
let app: ReturnType<typeof createApp>;

function appWith(probes: { db: () => Promise<void>; queue: () => Promise<void> }) {
  return createApp({
    probes,
    now: () => new Date('2026-10-27T09:00:00.000Z'),
    storageRoot,
    submitArtStyle,
  });
}

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
  const validMp4 = new File(['fake video content'], '../../my reference video.mp4', {
    type: 'video/mp4',
  });

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'faceless-api-art-style-'));
    submitArtStyle.mockClear();
    app = appWith({ db: healthy, queue: healthy });
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('returns 202 with building status for a valid video', async () => {
    const res = await multipartRequest(validMp4);
    expect(res.status).toBe(202);

    const body = createArtStyleResponseSchema.parse(await res.json());
    expect(body.status).toBe('building');
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBe('2026-10-27T09:00:00.000Z');

    expect(submitArtStyle).toHaveBeenCalledOnce();
    const submission = submitArtStyle.mock.calls[0]![0];
    expect(submission.row).toMatchObject({
      id: body.id,
      name: `Style ${body.id.slice(0, 8)}`,
      status: 'building',
      formats: ['landscape'],
      published: false,
      created_at: body.createdAt,
    });
    expect(submission.job).toEqual({
      styleId: body.id,
      referenceKey: `references/${body.id}.mp4`,
    });

    // The original filename is untrusted and never becomes part of a path.
    const stored = await readFile(join(storageRoot, ...submission.job.referenceKey.split('/')));
    expect(stored.toString()).toBe('fake video content');
  });

  it('uses provided name and formats', async () => {
    const res = await multipartRequest(validMp4, {
      name: 'My Custom Style',
      formats: JSON.stringify(['portrait']),
      published: 'true',
    });
    expect(res.status).toBe(202);

    const submission = submitArtStyle.mock.calls[0]![0];
    expect(submission.row.name).toBe('My Custom Style');
    expect(submission.row.formats).toEqual(['portrait']);
    expect(submission.row.published).toBe(true);
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

  it('does not submit an art style when validation fails', async () => {
    const png = new File(['fake png'], 'test.png', { type: 'image/png' });
    await multipartRequest(png);
    expect(submitArtStyle).not.toHaveBeenCalled();
  });
});
