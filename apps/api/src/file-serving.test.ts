/**
 * Public `/files/*` artifact serving.
 *
 * Every URL the api emits for a render, still, preview or TTS clip is
 * `<base>/files/<key>`, and the key is relative to `DATA_DIR` (docs/10). These
 * tests pin the boundary of that public prefix: it needs no key, it reports the
 * real MIME type, it supports a single byte range (video seeking), and it never
 * lets a request path escape the storage root. A missing artifact is a plain
 * `404`, not the internal-error envelope.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { testClient } from './test-auth';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const BASE = 'http://api.test';

/** Not a decodable image on purpose: serving is byte-exact, not re-encoding. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const KEY = `ws/${WORKSPACE_ID}/images/one.png`;
const SECRET = 'this file sits outside the public key space';

let storageRoot: string;

beforeEach(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'faceless-api-files-'));
  await mkdir(join(storageRoot, 'ws', WORKSPACE_ID, 'images'), { recursive: true });
  await writeFile(join(storageRoot, KEY), PNG);
  await writeFile(join(storageRoot, 'secret.txt'), SECRET);
});

afterEach(async () => {
  await rm(storageRoot, { recursive: true, force: true });
});

function client() {
  return testClient(createApp({
    probes: { db: async () => {}, queue: async () => {} },
    storageRoot,
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [],
    findWorkspace: async () => null,
    listCreditLogs: async () => [],
    listVoices: async () => [],
    listSoundEffects: async () => [],
    listBackgroundVideos: async () => [],
    synthesizeTts: async () => ({
      audioUrl: `${BASE}/files/tts/abc.mp3`,
      durationMs: 5_000,
      voiceId: 'edge:ta-IN-ValluvarNeural',
    }),
    listBalanceLogs: async () => [],
    readVideo: async () => null,
    readVideoScenes: async () => [],
    readVideoVoicePlan: async () => null,
    readVideoCaptions: async () => null,
    readVideoNarrationKey: async () => null,
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    authenticateApiKey: async () => null,
    rateLimit: { check: () => ({ allowed: true, retryAfterSeconds: 0 }) },
    createApiKey: async () => {
      throw new Error('api keys are not used in this suite');
    },
    listApiKeys: async () => [],
    revokeApiKey: async () => null,
    submitVideo: async () => {
      throw new Error('ai-videos-v3 is not used in this suite');
    },
    storeFile: async () => ({ key: 'unused', bytes: 0, mime: 'application/octet-stream' }),
    publicBaseUrl: BASE,
  }));
}

describe('GET /files/*', () => {
  it('serves a stored artifact without a key and with its real MIME type', async () => {
    const response = await client().raw(`/files/${KEY}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(PNG.byteLength));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  });

  it('answers a single byte range so a video can seek', async () => {
    const response = await client().raw(`/files/${KEY}`, {
      headers: { range: 'bytes=0-3' },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBe(`bytes 0-3/${PNG.byteLength}`);
    expect(response.headers.get('content-length')).toBe('4');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG.subarray(0, 4));
  });

  it('supports HEAD without reading the body', async () => {
    const response = await client().raw(`/files/${KEY}`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(PNG.byteLength));
    expect(await response.text()).toBe('');
  });

  it('answers 404 for a key that was never written', async () => {
    const response = await client().raw(`/files/ws/${WORKSPACE_ID}/images/missing.png`);

    expect(response.status).toBe(404);
  });

  it('never escapes the storage root through the request path', async () => {
    for (const path of [
      '/files/../secret.txt',
      '/files/%2e%2e/secret.txt',
      '/files/..%2fsecret.txt',
      '/files//etc/passwd',
      '/files/ws/%2e%2e/%2e%2e/secret.txt',
    ]) {
      const response = await client().raw(path);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain(SECRET);
    }
  });

  it('does not turn an unknown video id into a public artifact', async () => {
    const response = await client().raw(`/files/ws/${WORKSPACE_ID}/videos/${VIDEO_ID}/nope.mp4`);

    expect(response.status).toBe(404);
  });

  it('leaves /v1 authenticated', async () => {
    const response = await client().raw(`/v1/videos/${VIDEO_ID}`);

    expect(response.status).toBe(401);
  });
});
