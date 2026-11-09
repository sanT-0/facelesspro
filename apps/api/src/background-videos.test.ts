/**
 * `GET /v1/background-videos` — built-in background video library.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  backgroundVideoListSchema,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const BASE = 'http://api.test';

function appWith(options: {
  listBackgroundVideos?: () => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly durationMs?: number;
    readonly thumbnailUrl?: string;
    readonly tags?: readonly string[];
  }>>;
} = {}) {
  return testClient(
    createApp({
      probes: { db: async () => {}, queue: async () => {} },
      storageRoot: '.data-test',
      submitArtStyle: async () => {},
      listArtStyles: async () => [],
      readArtStyle: async () => null,
      listCaptionTemplates: async () => [],
      findWorkspace: async () => null,
      listCreditLogs: async () => [],
      listBalanceLogs: async () => [],
      listVoices: async () => [],
      listSoundEffects: async () => [],
      listBackgroundVideos:
        options.listBackgroundVideos ?? (async () => []),
      synthesizeTts: async () => ({
        audioUrl: 'http://api.test/files/tts/abc.mp3',
        durationMs: 5000,
        voiceId: 'edge:ta-IN-ValluvarNeural',
      }),
      readVideo: async () => null,
      queueRender: async () => ({ kind: 'not_found' as const }),
      queueRetry: async () => ({ kind: 'not_found' as const }),
      submitVideo: async () => {
        throw new Error('ai-videos-v3 is not used in this suite');
      },
      storeFile: async () => ({
        key: 'test-key',
        bytes: 0,
        mime: 'application/octet-stream',
      }),
      ...testAuth(WORKSPACE_ID),
      createApiKey: async () => {
        throw new Error('api keys are not used in this suite');
      },
      listApiKeys: async () => [],
      revokeApiKey: async () => null,
      publicBaseUrl: BASE,
    }),
  );
}

describe('GET /v1/background-videos', () => {
  it('answers 401 without a key', async () => {
    const response = await appWith().raw('/v1/background-videos');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('returns background videos that parse through backgroundVideoListSchema', async () => {
    const listBackgroundVideos = vi.fn(async (): Promise<Array<{
      readonly id: string;
      readonly name: string;
      readonly url: string;
      readonly durationMs?: number;
      readonly thumbnailUrl?: string;
      readonly tags?: readonly string[];
    }>> => [
      {
        id: 'minecraft-gameplay',
        name: 'Minecraft Gameplay',
        url: '/backgrounds/minecraft.mp4',
        durationMs: 600_000,
        thumbnailUrl: '/backgrounds/minecraft-thumb.jpg',
        tags: ['gameplay', 'sandbox'],
      },
    ]);

    const response = await appWith({ listBackgroundVideos }).request(
      '/v1/background-videos',
    );
    expect(response.status).toBe(200);

    const body = backgroundVideoListSchema.parse(await response.json());
    expect(body.backgroundVideos).toHaveLength(1);
    expect(body.backgroundVideos[0]!.id).toBe('minecraft-gameplay');
    expect(body.backgroundVideos[0]!.name).toBe('Minecraft Gameplay');
    expect(body.backgroundVideos[0]!.url).toBe('/backgrounds/minecraft.mp4');
    expect(body.backgroundVideos[0]!.durationMs).toBe(600_000);
    expect(body.backgroundVideos[0]!.thumbnailUrl).toBe(
      '/backgrounds/minecraft-thumb.jpg',
    );
    expect(body.backgroundVideos[0]!.tags).toEqual(['gameplay', 'sandbox']);

    expect(listBackgroundVideos).toHaveBeenCalledWith();
  });

  it('returns empty list when none available', async () => {
    const listBackgroundVideos = vi.fn(async () => []);
    const response = await appWith({ listBackgroundVideos }).request(
      '/v1/background-videos',
    );
    expect(response.status).toBe(200);

    const body = backgroundVideoListSchema.parse(await response.json());
    expect(body.backgroundVideos).toEqual([]);
  });
});
