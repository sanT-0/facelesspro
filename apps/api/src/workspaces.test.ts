/**
 * `GET /v1/workspace`, `GET /v1/credit-logs`, `GET /v1/balance-logs` —
 * workspace-scoped reads for the authenticated key's workspace.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorBodySchema,
  balanceLogListSchema,
  creditLogListSchema,
  workspaceSchema,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient } from './test-auth';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const BASE = 'http://api.test';

function appWith(options: {
  findWorkspace?: (
    workspaceId: string,
  ) => Promise<{
    readonly id: string;
    readonly name: string;
    readonly plan: {
      readonly id: string;
      readonly minutesPerMonth: number | null;
      readonly creditsPerMonth: number | null;
      readonly maxVideoMinutes: number;
      readonly maxResolution: 1080 | 1440 | 2160;
      readonly seats: number;
    };
    readonly credits: number | null;
    readonly owner: {
      readonly id: string;
      readonly email: string;
      readonly name: string;
    };
  } | null>;
  listCreditLogs?: (
    workspaceId: string,
  ) => Promise<Array<{
    readonly id: string;
    readonly videoId: string | null;
    readonly action: string;
    readonly units: number;
    readonly unitCost: number;
    readonly delta: number;
    readonly createdAt: string;
  }>>;
  listBalanceLogs?: (
    workspaceId: string,
  ) => Promise<Array<{
    readonly id: string;
    readonly kind: string;
    readonly amountCents: number;
    readonly meta: Record<string, unknown> | null;
    readonly createdAt: string;
  }>>;
  listVoices?: (
    workspaceId: string,
  ) => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly languages: readonly string[];
    readonly mixesEnglish: boolean;
    readonly engine: string;
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
      findWorkspace: options.findWorkspace ?? (async () => null),
      listCreditLogs: options.listCreditLogs ?? (async () => []),
      listBalanceLogs: options.listBalanceLogs ?? (async () => []),
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
      ...testAuth(WORKSPACE_ID),
      createApiKey: async () => {
        throw new Error('api keys are not used in this suite');
      },
      listApiKeys: async () => [],
      revokeApiKey: async () => null,
      storeFile: async () => ({
        key: 'test-key',
        bytes: 0,
        mime: 'application/octet-stream',
      }),
      publicBaseUrl: BASE,
    }),
  );
}

async function errorBody(response: Response) {
  return apiErrorBodySchema.parse(await response.json());
}

describe('GET /v1/workspace', () => {
  it('answers 401 without a key', async () => {
    const response = await appWith().raw('/v1/workspace');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('returns the workspace with plan, credits and owner', async () => {
    const findWorkspace = vi.fn(async (): Promise<{
      readonly id: string;
      readonly name: string;
      readonly plan: {
        readonly id: string;
        readonly minutesPerMonth: number | null;
        readonly creditsPerMonth: number | null;
        readonly maxVideoMinutes: number;
        readonly maxResolution: 1080 | 1440 | 2160;
        readonly seats: number;
      };
      readonly credits: number | null;
      readonly owner: {
        readonly id: string;
        readonly email: string;
        readonly name: string;
      };
    } | null> => ({
      id: WORKSPACE_ID,
      name: 'My Workspace',
      plan: {
        id: 'pro',
        minutesPerMonth: 60,
        creditsPerMonth: 600,
        maxVideoMinutes: 30,
        maxResolution: 1440,
        seats: 1,
      },
      credits: 450.25,
      owner: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'owner@example.com',
        name: 'Owner Name',
      },
    }));

    const response = await appWith({ findWorkspace }).request('/v1/workspace');
    expect(response.status).toBe(200);

    const body = workspaceSchema.parse(await response.json());
    expect(body.id).toBe(WORKSPACE_ID);
    expect(body.name).toBe('My Workspace');
    expect(body.plan.id).toBe('pro');
    expect(body.plan.minutesPerMonth).toBe(60);
    expect(body.plan.creditsPerMonth).toBe(600);
    expect(body.plan.maxVideoMinutes).toBe(30);
    expect(body.plan.maxResolution).toBe(1440);
    expect(body.plan.seats).toBe(1);
    expect(body.credits).toBe(450.25);
    expect(body.owner.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.owner.email).toBe('owner@example.com');
    expect(body.owner.name).toBe('Owner Name');

    expect(findWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it('returns 404 when the workspace does not exist', async () => {
    const findWorkspace = vi.fn(async () => null);
    const response = await appWith({ findWorkspace }).request('/v1/workspace');
    expect(response.status).toBe(404);
    expect(await errorBody(response)).toEqual({
      error: { code: 'not_found', message: 'workspace not found' },
    });
  });
});

describe('GET /v1/credit-logs', () => {
  it('answers 401 without a key', async () => {
    const response = await appWith().raw('/v1/credit-logs');
    expect(response.status).toBe(401);
  });

  it('returns credit log entries that parse through the schema', async () => {
    const listCreditLogs = vi.fn(async (): Promise<Array<{
      readonly id: string;
      readonly videoId: string | null;
      readonly action: string;
      readonly units: number;
      readonly unitCost: number;
      readonly delta: number;
      readonly createdAt: string;
    }>> => [
      {
        id: '33333333-3333-4333-8333-333333333333',
        videoId: '11111111-1111-4111-8111-111111111111',
        action: 'tts',
        units: 10,
        unitCost: 2,
        delta: -20,
        createdAt: '2026-11-09T09:00:00.000Z',
      },
    ]);

    const response = await appWith({ listCreditLogs }).request(
      '/v1/credit-logs',
    );
    expect(response.status).toBe(200);

    const body = creditLogListSchema.parse(await response.json());
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0]!.action).toBe('tts');
    expect(body.logs[0]!.units).toBe(10);
    expect(body.logs[0]!.delta).toBe(-20);

    expect(listCreditLogs).toHaveBeenCalledWith(WORKSPACE_ID);
  });
});

describe('GET /v1/balance-logs', () => {
  it('answers 401 without a key', async () => {
    const response = await appWith().raw('/v1/balance-logs');
    expect(response.status).toBe(401);
  });

  it('returns balance log entries that parse through the schema', async () => {
    const listBalanceLogs = vi.fn(async (): Promise<Array<{
      readonly id: string;
      readonly kind: string;
      readonly amountCents: number;
      readonly meta: Record<string, unknown> | null;
      readonly createdAt: string;
    }>> => [
      {
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'topup',
        amountCents: 5000,
        meta: { source: 'stripe' },
        createdAt: '2026-11-09T09:00:00.000Z',
      },
    ]);

    const response = await appWith({ listBalanceLogs }).request(
      '/v1/balance-logs',
    );
    expect(response.status).toBe(200);

    const body = balanceLogListSchema.parse(await response.json());
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0]!.kind).toBe('topup');
    expect(body.logs[0]!.amountCents).toBe(5000);

    expect(listBalanceLogs).toHaveBeenCalledWith(WORKSPACE_ID);
  });
});
