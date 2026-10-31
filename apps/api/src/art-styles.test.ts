import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiErrorBodySchema, artStyleExportSchema, artStyleListSchema, createArtStyleResponseSchema } from '@facelesspro/contracts';
import type { ArtStyleRow, StyleProfile } from '@facelesspro/contracts';

import { createApp } from './app';
import type { ArtStyleDeps, ArtStyleSubmission } from './art-styles';

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
const emptyCatalog = { listArtStyles: async () => [], readArtStyle: async () => null };
let storageRoot = '';
let app: ReturnType<typeof createApp>;

function appWith(
  probes: { db: () => Promise<void>; queue: () => Promise<void> },
  catalog: Pick<ArtStyleDeps, 'listArtStyles' | 'readArtStyle'> = emptyCatalog,
) {
  return createApp({
    probes,
    now: () => new Date('2026-10-27T09:00:00.000Z'),
    storageRoot,
    submitArtStyle,
    ...catalog,
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

const styleProfile: StyleProfile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene',
  palette: {
    hex: ['#14213d', '#fca311', '#ffffff'],
    weights: [0.5, 0.3, 0.2],
  },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple background',
  composition: 'centred subject',
  characters: [],
  typography: { present: false },
  negative: 'photo, text, watermark',
  seedBase: 1234,
  measured: {
    line: { strokeDensity: 0.04, edgeEnergy: 0.08 },
    tone: {
      saturation: { mean: 0.5, p95: 0.8 },
      contrast: { mean: 0.2, p95: 0.5 },
      brightness: { mean: 0.6, p95: 0.9 },
    },
    aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
    safeArea: { edgeContentRatio: 0.04, margin: 0.08 },
    frameCount: 8,
  },
  source: { adapter: 'heuristic', degradedFrom: [] },
};

const STYLE_ID = '550e8400-e29b-41d4-a716-446655440000';

function rowOf(overrides: Partial<ArtStyleRow> = {}): ArtStyleRow {
  return {
    id: STYLE_ID,
    workspace_id: null,
    name: 'Whiteboard explainer',
    published: true,
    formats: ['landscape'],
    profile: styleProfile as unknown as Record<string, unknown>,
    preview_url: `art-styles/${STYLE_ID}/preview.png`,
    portrait_preview_url: null,
    sample_video_urls: [],
    status: 'ready',
    created_at: '2026-10-31T10:00:00.000Z',
    ...overrides,
  };
}

function catalogWith(rows: readonly ArtStyleRow[]) {
  return {
    listArtStyles: async () => rows,
    readArtStyle: async (id: string) => rows.find((row) => row.id === id) ?? null,
  };
}

describe('GET /v1/art-styles', () => {
  beforeEach(() => {
    storageRoot = 'unused';
  });

  it('lists only ready styles with public preview paths', async () => {
    const other = '660e8400-e29b-41d4-a716-446655440000';
    app = appWith(
      { db: healthy, queue: healthy },
      catalogWith([
        rowOf({
          portrait_preview_url: `art-styles/${STYLE_ID}/preview-portrait.png`,
          sample_video_urls: [`art-styles/${STYLE_ID}/preview.mp4`],
        }),
        rowOf({ id: other, status: 'building' }),
        rowOf({ id: other, status: 'failed' }),
      ]),
    );

    const res = await app.request('/v1/art-styles');
    expect(res.status).toBe(200);

    const body = artStyleListSchema.parse(await res.json());
    expect(body.styles).toHaveLength(1);
    expect(body.styles[0]).toEqual({
      id: STYLE_ID,
      name: 'Whiteboard explainer',
      published: true,
      formats: ['landscape'],
      previewUrl: `/files/art-styles/${STYLE_ID}/preview.png`,
      portraitPreviewUrl: `/files/art-styles/${STYLE_ID}/preview-portrait.png`,
      sampleVideoUrls: [`/files/art-styles/${STYLE_ID}/preview.mp4`],
      status: 'ready',
      createdAt: '2026-10-31T10:00:00.000Z',
    });
  });

  it('keeps absolute URLs and omits an absent portrait preview', async () => {
    app = appWith(
      { db: healthy, queue: healthy },
      catalogWith([
        rowOf({
          preview_url: 'https://cdn.example/preview.png',
          sample_video_urls: ['https://cdn.example/sample.mp4'],
        }),
      ]),
    );

    const body = artStyleListSchema.parse(await (await app.request('/v1/art-styles')).json());
    expect(body.styles[0]?.previewUrl).toBe('https://cdn.example/preview.png');
    expect(body.styles[0]?.sampleVideoUrls).toEqual(['https://cdn.example/sample.mp4']);
    expect(body.styles[0]).not.toHaveProperty('portraitPreviewUrl');
  });

  it('returns an empty list when nothing is ready', async () => {
    app = appWith({ db: healthy, queue: healthy }, catalogWith([]));

    const res = await app.request('/v1/art-styles');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ styles: [] });
  });
});

describe('GET /v1/art-styles/:id/export', () => {
  beforeEach(() => {
    storageRoot = 'unused';
  });

  it('exports the portable document without database-only fields', async () => {
    app = appWith({ db: healthy, queue: healthy }, catalogWith([rowOf()]));

    const res = await app.request(`/v1/art-styles/${STYLE_ID}/export`);
    expect(res.status).toBe(200);

    const body = artStyleExportSchema.parse(await res.json());
    expect(body).toEqual({
      version: 1,
      name: 'Whiteboard explainer',
      formats: ['landscape'],
      profile: styleProfile,
    });
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('previewUrl');
  });

  it('answers 409 for a style that has not finished building', async () => {
    app = appWith(
      { db: healthy, queue: healthy },
      catalogWith([rowOf({ status: 'building' })]),
    );

    const res = await app.request(`/v1/art-styles/${STYLE_ID}/export`);
    expect(res.status).toBe(409);
    const body = await errorBody(res);
    expect(body.error.code).toBe('conflict');
    expect(body.error.message).toContain('building');
  });

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    app = appWith({ db: healthy, queue: healthy }, catalogWith([]));

    const missing = await app.request(
      '/v1/art-styles/550e8400-e29b-41d4-a716-446655440001/export',
    );
    expect(missing.status).toBe(404);
    expect((await errorBody(missing)).error.code).toBe('not_found');

    const malformed = await app.request('/v1/art-styles/not-a-uuid/export');
    expect(malformed.status).toBe(400);
    const body = await errorBody(malformed);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe('id');
  });

  it('refuses to export a corrupt stored profile', async () => {
    app = appWith(
      { db: healthy, queue: healthy },
      catalogWith([rowOf({ profile: { version: 1 } })]),
    );

    const res = await app.request(`/v1/art-styles/${STYLE_ID}/export`);
    expect(res.status).toBe(500);
    expect((await errorBody(res)).error.code).toBe('internal');
  });
});
