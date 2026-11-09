/**
 * `GET /v1/voices` — voice library for the authenticated workspace.
 *
 * Returns bundled voices plus workspace-specific voices from the `voice` table.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  voiceListSchema,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const BASE = 'http://api.test';

function appWith(options: {
  listVoices?: (workspaceId: string) => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly gender?: string;
    readonly accent?: string;
    readonly age?: string;
    readonly useCase?: string;
    readonly previewUrl?: string;
    readonly languages: readonly string[];
    readonly mixesEnglish: boolean;
    readonly engine: string;
    readonly sampleRate?: number;
    readonly wordTimings: boolean;
  }>>;
  listSoundEffects?: () => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly durationMs?: number;
    readonly tags?: readonly string[];
  }>>;
  listBackgroundVideos?: () => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly durationMs?: number;
    readonly thumbnailUrl?: string;
    readonly tags?: readonly string[];
  }>>;
  synthesizeTts?: (
    input: { readonly text: string; readonly voiceId?: string; readonly voiceStyle?: unknown },
  ) => Promise<{
    readonly audioUrl: string;
    readonly durationMs: number;
    readonly voiceId: string;
  }>;
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
      listVoices: options.listVoices ?? (async () => []),
      listSoundEffects: options.listSoundEffects ?? (async () => []),
      listBackgroundVideos: options.listBackgroundVideos ?? (async () => []),
      synthesizeTts: options.synthesizeTts ?? (async () => ({
        audioUrl: 'http://api.test/files/tts/abc.mp3',
        durationMs: 5000,
        voiceId: 'edge:ta-IN-ValluvarNeural',
      })),
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

describe('GET /v1/voices', () => {
  it('answers 401 without a key', async () => {
    const response = await appWith().raw('/v1/voices');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('returns voices that parse through voiceListSchema', async () => {
    const listVoices = vi.fn(async (): Promise<Array<{
      readonly id: string;
      readonly name: string;
      readonly languages: readonly string[];
      readonly mixesEnglish: boolean;
      readonly engine: string;
      readonly wordTimings: boolean;
    }>> => [
      {
        id: 'edge:ta-IN-ValluvarNeural',
        name: 'Valluvar (Tamil)',
        languages: ['ta'],
        mixesEnglish: true,
        engine: 'edge',
        wordTimings: true,
      },
      {
        id: 'edge:ta-IN-PallaviNeural',
        name: 'Pallavi (Tamil)',
        languages: ['ta'],
        mixesEnglish: true,
        engine: 'edge',
        wordTimings: true,
      },
    ]);

    const response = await appWith({ listVoices }).request('/v1/voices');
    expect(response.status).toBe(200);

    const body = voiceListSchema.parse(await response.json());
    expect(body.voices).toHaveLength(2);
    expect(body.voices[0]!.id).toBe('edge:ta-IN-ValluvarNeural');
    expect(body.voices[0]!.name).toBe('Valluvar (Tamil)');
    expect(body.voices[0]!.languages).toEqual(['ta']);
    expect(body.voices[0]!.mixesEnglish).toBe(true);
    expect(body.voices[0]!.engine).toBe('edge');
    expect(body.voices[0]!.wordTimings).toBe(true);

    expect(listVoices).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it('returns empty voices list when none available', async () => {
    const listVoices = vi.fn(async () => []);
    const response = await appWith({ listVoices }).request('/v1/voices');
    expect(response.status).toBe(200);

    const body = voiceListSchema.parse(await response.json());
    expect(body.voices).toEqual([]);
  });
});
