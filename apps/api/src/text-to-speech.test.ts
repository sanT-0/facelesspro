/**
 * `POST /v1/text-to-speech` — synthesize speech from text.
 *
 * Calls the injected TTS synthesis dependency and returns
 * `{audioUrl, durationMs, voiceId}`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorBodySchema,
  textToSpeechResponseSchema,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const BASE = 'http://api.test';

function appWith(options: {
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
      listVoices: async () => [],
      listSoundEffects: async () => [],
      listBackgroundVideos: async () => [],
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
      synthesizeTts:
        options.synthesizeTts ??
        (async () => ({
          audioUrl: 'http://api.test/files/tts/abc.mp3',
          durationMs: 5000,
          voiceId: 'edge:ta-IN-ValluvarNeural',
        })),
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

async function errorBody(response: Response) {
  return apiErrorBodySchema.parse(await response.json());
}

describe('POST /v1/text-to-speech', () => {
  it('answers 401 without a key', async () => {
    const response = await appWith().raw('/v1/text-to-speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('returns 400 for missing text', async () => {
    const synthesizeTts = vi.fn();
    const response = await appWith({ synthesizeTts }).request(
      '/v1/text-to-speech',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({
      error: { code: 'invalid_request', message: 'Invalid input: expected string, received undefined', field: 'text' },
    });
    expect(synthesizeTts).not.toHaveBeenCalled();
  });

  it('returns 400 for empty text', async () => {
    const synthesizeTts = vi.fn();
    const response = await appWith({ synthesizeTts }).request(
      '/v1/text-to-speech',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      },
    );
    expect(response.status).toBe(400);
    expect(synthesizeTts).not.toHaveBeenCalled();
  });

  it('synthesizes and returns {audioUrl, durationMs, voiceId}', async () => {
    const synthesizeTts = vi.fn(async (_input: {
      readonly text: string;
      readonly voiceId?: string;
      readonly voiceStyle?: unknown;
    }): Promise<{
      readonly audioUrl: string;
      readonly durationMs: number;
      readonly voiceId: string;
    }> => ({
      audioUrl: 'http://api.test/files/tts/abc.mp3',
      durationMs: 5000,
      voiceId: 'edge:ta-IN-ValluvarNeural',
    }));

    const response = await appWith({ synthesizeTts }).request(
      '/v1/text-to-speech',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'வணக்கம் நண்பர்களே.',
          voiceId: 'edge:ta-IN-ValluvarNeural',
        }),
      },
    );

    expect(response.status).toBe(200);

    const body = textToSpeechResponseSchema.parse(await response.json());
    expect(body.audioUrl).toBe('http://api.test/files/tts/abc.mp3');
    expect(body.durationMs).toBe(5000);
    expect(body.voiceId).toBe('edge:ta-IN-ValluvarNeural');

    expect(synthesizeTts).toHaveBeenCalledOnce();
    const call = synthesizeTts.mock.calls[0]![0];
    expect(call.text).toBe('வணக்கம் நண்பர்களே.');
    expect(call.voiceId).toBe('edge:ta-IN-ValluvarNeural');
  });

  it('uses default voice when voiceId omitted', async () => {
    const synthesizeTts = vi.fn(async (_input: {
      readonly text: string;
      readonly voiceId?: string;
      readonly voiceStyle?: unknown;
    }): Promise<{
      readonly audioUrl: string;
      readonly durationMs: number;
      readonly voiceId: string;
    }> => ({
      audioUrl: 'http://api.test/files/tts/def.mp3',
      durationMs: 3000,
      voiceId: 'edge:ta-IN-ValluvarNeural',
    }));

    const response = await appWith({ synthesizeTts }).request(
      '/v1/text-to-speech',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello world' }),
      },
    );

    expect(response.status).toBe(200);
    const call = synthesizeTts.mock.calls[0]![0];
    expect(call.text).toBe('Hello world');
    expect(call.voiceId).toBeUndefined();
  });

  it('rejects text over the max length', async () => {
    const synthesizeTts = vi.fn();
    const longText = 'x'.repeat(50_001);
    const response = await appWith({ synthesizeTts }).request(
      '/v1/text-to-speech',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: longText }),
      },
    );
    expect(response.status).toBe(400);
    expect(synthesizeTts).not.toHaveBeenCalled();
  });
});
