import { apiErrorBodySchema, healthSchema } from '@facelesspro/contracts';
import { createLogger } from '@facelesspro/log';
import type { Logger } from '@facelesspro/log';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { API_VERSION } from './health';
import { testAuth, testClient, NOW, WORKSPACE_ID } from './test-auth';


function appWith(
  probes: {
    db: () => Promise<void>;
    queue: () => Promise<void>;
  },
  logger?: Logger,
) {
  return createApp({
    ...(logger === undefined ? {} : { logger }),
    probes,
    now: () => NOW,
    timeoutMs: 20,
    storageRoot: '.data-test',
    submitArtStyle: async () => {},
    listArtStyles: async () => [],
    readArtStyle: async () => null,
    listCaptionTemplates: async () => [],
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
    readVideoScenes: async () => [],
    readVideoVoicePlan: async () => null,
    readVideoCaptions: async () => null,
    readVideoNarrationKey: async () => null,
    readVideoWordTimings: async () => null,
    queueRender: async () => ({ kind: 'not_found' as const }),
    queueRetry: async () => ({ kind: 'not_found' as const }),
    queueRedraw: async () => ({ kind: 'not_found' as const }),
    queueRevocal: async () => ({ kind: 'not_found' as const }),
    queueRecaption: async () => ({ kind: 'not_found' as const }),
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
    storeFile: async () => ({
      key: "test-key",
      bytes: 0,
      mime: "application/octet-stream",
    }),

    publicBaseUrl: 'http://api.test',
    listMembers: async () => [],
    checkSeatLimit: async () => ({ limit: 10, current: 1, exceeded: false }),
    findUserByEmail: async () => null,
    createUser: async () => ({ id: "test-user", email: "test@test.com", name: "Test" }),
    addMember: async () => ({ id: "test-user", workspaceId: WORKSPACE_ID, userId: "test-user", email: "test@test.com", name: "Test", role: "editor", joinedAt: NOW.toISOString() }),
    updateMemberRole: async () => ({ id: "test-user", workspaceId: WORKSPACE_ID, userId: "test-user", email: "test@test.com", name: "Test", role: "editor", joinedAt: NOW.toISOString() }),
    removeMember: async () => {},
  });
}

const healthy = async () => {};

function capture(level: 'debug' | 'info' = 'info'): {
  logger: Logger;
  lines: Array<Record<string, unknown>>;
} {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    svc: 'facelesspro-api',
    now: () => NOW,
    config: { level },
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { logger, lines };
}

describe('request logging', () => {
  it('writes one line per request with method, path, status and ms', async () => {
    const { logger, lines } = capture();
    const res = await testClient(appWith({ db: healthy, queue: healthy }, logger)).request(
      '/nope',
    );

    expect(res.status).toBe(404);
    const line = lines.find((entry) => entry.event === 'http.request');
    expect(line).toMatchObject({
      method: 'GET',
      path: '/nope',
      status: 404,
      level: 'warn',
    });
    expect(typeof line?.ms).toBe('number');
  });

  it('keeps /health at debug so a ten-second probe does not flood the log', async () => {
    const { logger, lines } = capture();
    await testClient(appWith({ db: healthy, queue: healthy }, logger)).request('/health');

    expect(lines.filter((entry) => entry.event === 'http.request')).toHaveLength(0);
  });

  it('does not log artifact range requests', async () => {
    const { logger, lines } = capture();
    await testClient(appWith({ db: healthy, queue: healthy }, logger)).request(
      '/files/renders/missing.mp4',
    );

    expect(lines.filter((entry) => entry.event === 'http.request')).toHaveLength(0);
  });
});

describe('GET /health', () => {
  it('returns 200 and a report that parses through healthSchema', async () => {
    const res = await appWith({ db: healthy, queue: healthy }).request('/health');
    expect(res.status).toBe(200);

    const body = healthSchema.parse(await res.json());
    expect(body).toMatchObject({
      status: 'ok',
      service: 'facelesspro-api',
      version: API_VERSION,
      time: NOW.toISOString(),
      db: 'ok',
      queue: 'ok',
    });
  });

  it('returns 503 with the failing component named', async () => {
    const res = await appWith({
      db: healthy,
      queue: async () => {
        throw new Error('queue(s) missing: render');
      },
    }).request('/health');

    expect(res.status).toBe(503);
    const body = healthSchema.parse(await res.json());
    expect(body).toMatchObject({ status: 'degraded', db: 'ok', queue: 'error' });
  });

  it('returns 503 when both components are down', async () => {
    const down = async () => {
      throw new Error('down');
    };
    const res = await appWith({ db: down, queue: down }).request('/health');

    expect(res.status).toBe(503);
    expect(healthSchema.parse(await res.json())).toMatchObject({
      db: 'error',
      queue: 'error',
    });
  });
});

describe('unknown routes', () => {
  it('returns 404', async () => {
    const res = await appWith({ db: healthy, queue: healthy }).request('/nope');
    expect(res.status).toBe(404);
  });
});

describe('unexpected errors', () => {
  it('returns the documented envelope, never plain text or internals', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const logger = createLogger({
      svc: 'facelesspro-api',
      now: () => NOW,
      write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    });
    const app = createApp({
      logger,
      probes: { db: healthy, queue: healthy },
      now: () => NOW,
      storageRoot: '.data-test',
      submitArtStyle: async () => {},
      listArtStyles: async () => {
        throw new Error('boom at D:\\srv\\secret\\preview.png');
      },
      readArtStyle: async () => null,
      listCaptionTemplates: async () => [],
      findWorkspace: async () => null,
      listCreditLogs: async () => [],
      listBalanceLogs: async () => [],
      readVideo: async () => null,
      readVideoScenes: async () => [],
      readVideoVoicePlan: async () => null,
      readVideoCaptions: async () => null,
      readVideoNarrationKey: async () => null,
      readVideoWordTimings: async () => null,
      queueRender: async () => ({ kind: 'not_found' as const }),
      queueRetry: async () => ({ kind: 'not_found' as const }),
      queueRedraw: async () => ({ kind: 'not_found' as const }),
      queueRevocal: async () => ({ kind: 'not_found' as const }),
      queueRecaption: async () => ({ kind: 'not_found' as const }),
      ...testAuth(WORKSPACE_ID),
      createApiKey: async () => {
        throw new Error('api keys are not used in this suite');
      },
      listApiKeys: async () => [],
      revokeApiKey: async () => null,
      submitVideo: async () => {
        throw new Error('ai-videos-v3 is not used in this suite');
      },
      storeFile: async () => ({
        key: 'test-key',
        bytes: 0,
        mime: 'application/octet-stream',
      }),
      listVoices: async () => [],
      listSoundEffects: async () => [],
      listBackgroundVideos: async () => [],
      synthesizeTts: async () => ({
        audioUrl: 'http://api.test/files/tts/abc.mp3',
        durationMs: 5000,
        voiceId: 'edge:ta-IN-ValluvarNeural',
      }),
      publicBaseUrl: 'http://api.test',
      listMembers: async () => [],
      checkSeatLimit: async () => ({ limit: 10, current: 1, exceeded: false }),
      findUserByEmail: async () => null,
      createUser: async () => ({ id: "test-user", email: "test@test.com", name: "Test" }),
      addMember: async () => ({ id: "test-user", workspaceId: WORKSPACE_ID, userId: "test-user", email: "test@test.com", name: "Test", role: "editor", joinedAt: NOW.toISOString() }),
      updateMemberRole: async () => ({ id: "test-user", workspaceId: WORKSPACE_ID, userId: "test-user", email: "test@test.com", name: "Test", role: "editor", joinedAt: NOW.toISOString() }),
      removeMember: async () => {},
    });

    const res = await testClient(app).request('/v1/art-styles');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('secret');

    const events = lines.map((line) => line.event);
    expect(events).toContain('api.unhandled_error');
    // The failure is a server error on the wire, so the request line says 500.
    expect(lines.find((line) => line.event === 'http.request')).toMatchObject({
      path: '/v1/art-styles',
      status: 500,
      level: 'error',
    });
  });
});
