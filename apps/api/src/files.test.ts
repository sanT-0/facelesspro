/**
 * `POST /v1/files` — multipart file upload.
 *
 * Accepts a file, stores it under the shared DATA_DIR, and returns
 * `{key, url, bytes, mime}` where `url` is `/files/<key>`.
 */

import { describe, expect, it, vi } from 'vitest';

import { apiErrorBodySchema, fileUploadResponseSchema } from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const BASE = 'http://api.test';

function appWith(options: {
  storageRoot?: string;
  storeFile?: (
    file: { readonly name: string; readonly type: string; readonly arrayBuffer: () => Promise<ArrayBuffer> },
  ) => Promise<{
    readonly key: string;
    readonly bytes: number;
    readonly mime: string;
  }>;
} = {}) {
  return testClient(
    createApp({
      probes: { db: async () => {}, queue: async () => {} },
      storageRoot: options.storageRoot ?? '.data-test',
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
      storeFile:
        options.storeFile ??
        (async (file) => {
          const buf = Buffer.from(await file.arrayBuffer());
          return {
            key: `files/${crypto.randomUUID()}`,
            bytes: buf.byteLength,
            mime: file.type,
          };
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

async function errorBody(response: Response) {
  return apiErrorBodySchema.parse(await response.json());
}

function multipartBody(fields: Record<string, string | File>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return form;
}

describe('POST /v1/files', () => {
  it('answers 401 without a key', async () => {
    const storeFile = vi.fn();
    const response = await appWith({ storeFile }).raw('/v1/files', {
      method: 'POST',
      body: multipartBody({ file: new File(['hello'], 'hello.txt', { type: 'text/plain' }) }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(storeFile).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is provided', async () => {
    const storeFile = vi.fn();
    const response = await appWith({ storeFile }).request('/v1/files', {
      method: 'POST',
      body: multipartBody({}),
    });
    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({
      error: { code: 'invalid_request', message: 'file is required', field: 'file' },
    });
    expect(storeFile).not.toHaveBeenCalled();
  });

  it('returns 400 when the file field is not a File', async () => {
    const storeFile = vi.fn();
    const response = await appWith({ storeFile }).request('/v1/files', {
      method: 'POST',
      body: multipartBody({ file: 'not-a-file' }),
    });
    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({
      error: { code: 'invalid_request', message: 'file is required', field: 'file' },
    });
    expect(storeFile).not.toHaveBeenCalled();
  });

  it('stores the file and returns {key, url, bytes, mime}', async () => {
    const storeFile = vi.fn(async (file: {
      readonly name: string;
      readonly type: string;
      readonly arrayBuffer: () => Promise<ArrayBuffer>;
    }) => {
      const buf = Buffer.from(await file.arrayBuffer());
      return {
        key: `files/test-key-123`,
        bytes: buf.byteLength,
        mime: file.type,
      };
    });

    const fileContent = 'Hello, FacelessPro!';
    const response = await appWith({ storeFile }).request('/v1/files', {
      method: 'POST',
      body: multipartBody({
        file: new File([fileContent], 'test.txt', { type: 'text/plain' }),
      }),
    });

    expect(response.status).toBe(200);

    const body = fileUploadResponseSchema.parse(await response.json());
    expect(body.key).toBe('files/test-key-123');
    expect(body.url).toBe(`${BASE}/files/test-key-123`);
    expect(body.bytes).toBe(fileContent.length);
    expect(body.mime).toBe('text/plain');

    expect(storeFile).toHaveBeenCalledOnce();
    const call = storeFile.mock.calls[0]![0];
    expect(call.name).toBe('test.txt');
    expect(call.type).toBe('text/plain');
    const buf = Buffer.from(await call.arrayBuffer());
    expect(buf.toString()).toBe(fileContent);
  });

  it('rejects files over the size limit', async () => {
    const storeFile = vi.fn();
    const bigContent = 'x'.repeat(6 * 1024 * 1024); // 6 MB > 5 MB test limit
    const response = await appWith({ storeFile }).request('/v1/files', {
      method: 'POST',
      body: multipartBody({
        file: new File([bigContent], 'big.txt', { type: 'text/plain' }),
      }),
    });

    expect(response.status).toBe(413);
    expect(await errorBody(response)).toEqual({
      error: { code: 'payload_too_large', message: 'file exceeds 5 MB limit', field: 'file' },
    });
    expect(storeFile).not.toHaveBeenCalled();
  });

  it('rewrites the storage key to a /files/* URL', async () => {
    const storeFile = vi.fn(async () => ({
      key: 'uploads/abc-123.png',
      bytes: 1234,
      mime: 'image/png',
    }));

    const response = await appWith({ storeFile }).request('/v1/files', {
      method: 'POST',
      body: multipartBody({
        file: new File([], 'image.png', { type: 'image/png' }),
      }),
    });

    expect(response.status).toBe(200);
    const body = fileUploadResponseSchema.parse(await response.json());
    expect(body.url).toBe(`${BASE}/uploads/abc-123.png`);
  });
});
