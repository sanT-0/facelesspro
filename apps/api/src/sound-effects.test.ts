/**
 * `GET /v1/sound-effects` — built-in sound effect library.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  soundEffectListSchema,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const BASE = 'http://api.test';

function appWith(options: {
  listSoundEffects?: () => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly durationMs?: number;
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
      listSoundEffects:
        options.listSoundEffects ?? (async () => []),
      listBackgroundVideos: async () => [],
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

describe('GET /v1/sound-effects', () => {
  it('answers 401 without a key', async () => {
    const response = await appWith().raw('/v1/sound-effects');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('returns sound effects that parse through soundEffectListSchema', async () => {
    const listSoundEffects = vi.fn(async (): Promise<Array<{
      readonly id: string;
      readonly name: string;
      readonly url: string;
      readonly durationMs?: number;
      readonly tags?: readonly string[];
    }>> => [
      {
        id: 'swish',
        name: 'Swish',
        url: '/audio/sfx/swish.mp3',
        durationMs: 1200,
        tags: ['transition', 'whoosh'],
      },
    ]);

    const response = await appWith({ listSoundEffects }).request(
      '/v1/sound-effects',
    );
    expect(response.status).toBe(200);

    const body = soundEffectListSchema.parse(await response.json());
    expect(body.soundEffects).toHaveLength(1);
    expect(body.soundEffects[0]!.id).toBe('swish');
    expect(body.soundEffects[0]!.name).toBe('Swish');
    expect(body.soundEffects[0]!.url).toBe('/audio/sfx/swish.mp3');
    expect(body.soundEffects[0]!.durationMs).toBe(1200);
    expect(body.soundEffects[0]!.tags).toEqual(['transition', 'whoosh']);

    expect(listSoundEffects).toHaveBeenCalledWith();
  });

  it('returns empty list when none available', async () => {
    const listSoundEffects = vi.fn(async () => []);
    const response = await appWith({ listSoundEffects }).request(
      '/v1/sound-effects',
    );
    expect(response.status).toBe(200);

    const body = soundEffectListSchema.parse(await response.json());
    expect(body.soundEffects).toEqual([]);
  });
});
