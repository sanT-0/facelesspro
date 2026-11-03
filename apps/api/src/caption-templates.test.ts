import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captionTemplateListSchema,
  type CaptionTemplateRow,
} from '@facelesspro/contracts';

import { createApp } from './app';

const rows = [
  {
    id: -1,
    workspace_id: null,
    name: 'Bold Tamil',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 72,
      wordLimit: 4,
      maxLines: 2,
      uppercase: false,
      emoji: false,
      position: 'bottom' as const,
      highlightColor: '#FFD400',
      outlineColor: '#000000',
      outlineWidth: 6,
    },
  },
  {
    id: -2,
    workspace_id: null,
    name: 'Clean Sans',
    spec: {
      fontFamily: 'Noto Sans Tamil',
      fontSize: 56,
      wordLimit: 6,
      maxLines: 2,
      uppercase: false,
      emoji: false,
      position: 'bottom' as const,
      outlineColor: '#000000',
      outlineWidth: 4,
    },
  },
] satisfies CaptionTemplateRow[];

const healthy = async () => {};

function appWith(listCaptionTemplates: () => Promise<readonly CaptionTemplateRow[]>) {
  return createApp({
    probes: { db: healthy, queue: healthy },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /v1/caption-templates', () => {
  it('returns contract-shaped public templates without database fields', async () => {
    const listCaptionTemplates = vi.fn(async () => rows);
    const response = await appWith(listCaptionTemplates).request(
      '/v1/caption-templates',
    );

    expect(response.status).toBe(200);
    const body = captionTemplateListSchema.parse(await response.json());
    expect(body.templates).toHaveLength(2);
    expect(body.templates.map((template) => template.id)).toEqual([-1, -2]);
    expect(body.templates[0]?.spec.fontFamily).toBe('Noto Sans Tamil');
    expect(JSON.stringify(body)).not.toContain('workspace_id');
    expect(listCaptionTemplates).toHaveBeenCalledTimes(1);
  });

  it('sets the documented private cache policy and a content-derived ETag', async () => {
    const response = await appWith(async () => rows).request(
      '/v1/caption-templates',
    );
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('answers 304 with no body when If-None-Match matches', async () => {
    const app = appWith(async () => rows);
    const first = await app.request('/v1/caption-templates');
    const etag = first.headers.get('etag');
    expect(etag).not.toBeNull();

    const second = await app.request('/v1/caption-templates', {
      headers: { 'If-None-Match': etag ?? '' },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    expect(second.headers.get('etag')).toBe(etag);
  });

  it('returns an empty contract-shaped library', async () => {
    const response = await appWith(async () => []).request(
      '/v1/caption-templates',
    );
    expect(captionTemplateListSchema.parse(await response.json())).toEqual({
      templates: [],
    });
  });

  it('turns a malformed stored template into the fixed internal envelope', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const malformed = [{ ...rows[0], id: 0 }] as CaptionTemplateRow[];
    const response = await appWith(async () => malformed).request(
      '/v1/caption-templates',
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'unexpected error' },
    });
  });
});
