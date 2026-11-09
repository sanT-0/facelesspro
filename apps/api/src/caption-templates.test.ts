import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captionTemplateListSchema,
  type CaptionTemplateRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

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
  return testClient(createApp({
    probes: { db: healthy, queue: healthy },
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates,
    findWorkspace: async () => null,
    listCreditLogs: async () => [],
    listVoices: async () => [],    listSoundEffects: async () => [],
    listBackgroundVideos: async () => [],    synthesizeTts: async () => ({
      audioUrl: "http://api.test/files/tts/abc.mp3",
      durationMs: 5000,
      voiceId: "edge:ta-IN-ValluvarNeural",
    }),


    listBalanceLogs: async () => [],
    readVideo: async () => null,
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    ...testAuth(WORKSPACE_ID),
    createApiKey: async () => {
      throw new Error('api keys are not used in this suite');
    },
    listApiKeys: async () => [],
    revokeApiKey: async () => null,
    submitVideo: async () => {
      throw new Error("ai-videos-v3 is not used in this suite");
    },
    storeFile: async () => ({
      key: "test-key",
      bytes: 0,
      mime: "application/octet-stream",
    }),

    publicBaseUrl: 'http://api.test',
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /v1/caption-templates', () => {
  it('answers 401 without a key', async () => {
    const response = await appWith(async () => rows).raw('/v1/caption-templates');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

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
