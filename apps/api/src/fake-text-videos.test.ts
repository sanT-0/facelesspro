/**
 * `POST /v1/fake-text-videos` — the Fake Text video create door.
 *
 * Fake Text's conversations live in the request, so this route only validates
 * the shared contract and hands one normalised body to the injected
 * `submitVideo` transaction.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  apiErrorBodySchema,
  createVideoResponseSchema,
  type VideoRow,
} from '@facelesspro/contracts';

import { createApp } from './app';
import { testAuth, testClient, NOW, WORKSPACE_ID } from './test-auth';
import type { SubmitVideo, SubmitVideoInput } from './video-submit';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const BASE = 'http://api.test';
const WEBHOOK = 'https://hooks.example.com/facelesspro';

const VALID_CONVERSATION = {
  template: 'whatsapp',
  characters: [
    { id: 'a', name: 'Arun', side: 'left' as const },
    { id: 'b', name: 'Bala', side: 'right' as const },
  ],
  messages: [
    { text: 'hi' },
    { text: 'vanakkam', characterId: 'b' },
  ],
};

function makeApp(submitVideo: SubmitVideo) {
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
      submitVideo,
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
      listVoices: async () => [],
      listSoundEffects: async () => [],
      listBackgroundVideos: async () => [],
      synthesizeTts: async () => ({
        audioUrl: 'http://api.test/files/tts/abc.mp3',
        durationMs: 5000,
        voiceId: 'edge:ta-IN-ValluvarNeural',
      }),
      publicBaseUrl: BASE,
      listMembers: async () => [],
      checkSeatLimit: async () => ({ limit: 10, current: 1, exceeded: false }),
      findUserByEmail: async () => null,
      createUser: async () => ({ id: "test-user", email: "test@test.com", name: "Test" }),
      addMember: async () => ({ id: "test-user", workspaceId: WORKSPACE_ID, userId: "test-user", email: "test@test.com", name: "Test", role: "editor", joinedAt: NOW.toISOString() }),
      updateMemberRole: async () => ({ id: "test-user", workspaceId: WORKSPACE_ID, userId: "test-user", email: "test@test.com", name: "Test", role: "editor", joinedAt: NOW.toISOString() }),
      removeMember: async () => {},
    }),
  );
}

async function doPost(
  app: ReturnType<typeof makeApp>,
  payload: unknown,
): Promise<Response> {
  return app.request('/v1/fake-text-videos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

async function getErrorBody(response: Response) {
  const text = await response.text();
  if (!text) throw new Error('empty response body');
  return apiErrorBodySchema.parse(JSON.parse(text));
}

function storedRow(input: SubmitVideoInput): VideoRow {
  return {
    id: VIDEO_ID,
    workspace_id: input.workspaceId,
    kind: 'fake-text',
    status: 'processing',
    step: 'create-scenes',
    error: null,
    request: { kind: 'fake-text', body: input.body.body },
    plan: null,
    redraw: null,
    revocal: null,
    webhook_url: input.body.body.webhookUrl ?? null,
    duration_ms: null,
    video_url: null,
    editor_seen_at: null,
    created_at: '2026-11-22T09:00:00.000Z',
    updated_at: '2026-11-22T09:00:00.000Z',
  };
}

describe('POST /v1/fake-text-videos', () => {
  it('answers 401 without a key and never validates or stores anything', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const rawApp = makeApp(submitVideo);

    const response = await rawApp.raw('/v1/fake-text-videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversations: [VALID_CONVERSATION] }),
    });

    expect(response.status).toBe(401);
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('stores a Fake Text request with the documented defaults', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, { conversations: [VALID_CONVERSATION] });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(
      createVideoResponseSchema.parse({
        id: VIDEO_ID,
        status: 'processing',
        render: false,
        createdAt: '2026-11-22T09:00:00.000Z',
        editorUrl: `${BASE}/editor?id=${VIDEO_ID}`,
      }),
    );
    expect(submitVideo).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      body: {
        kind: 'fake-text',
        body: {
          conversations: [
            {
              template: 'whatsapp',
              language: 'en',
              characters: [
                { id: 'a', name: 'Arun', side: 'left' },
                { id: 'b', name: 'Bala', side: 'right' },
              ],
              messages: [
                { text: 'hi' },
                { text: 'vanakkam', characterId: 'b' },
              ],
              autoSplit: false,
              useVoiceV2: false,
              tinderMatch: false,
            },
          ],
        },
      },
    });
  });

  it('keeps explicit language, autoSplit, useVoiceV2, groupName, groupPhoto, tinderMatch, render and webhookUrl', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, {
      conversations: [
        {
          ...VALID_CONVERSATION,
          language: 'ta',
          autoSplit: true,
          useVoiceV2: true,
          groupName: 'Family',
          groupPhoto: 'https://example.com/photo.jpg',
          tinderMatch: true,
        },
      ],
      render: { resolution: 1080, frameRate: 30, format: 'standard' },
      webhookUrl: WEBHOOK,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ render: true });
    expect(submitVideo).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      body: {
        kind: 'fake-text',
        body: {
          conversations: [
            {
              template: 'whatsapp',
              language: 'ta',
              characters: [
                { id: 'a', name: 'Arun', side: 'left' },
                { id: 'b', name: 'Bala', side: 'right' },
              ],
              messages: [
                { text: 'hi' },
                { text: 'vanakkam', characterId: 'b' },
              ],
              autoSplit: true,
              groupName: 'Family',
              groupPhoto: 'https://example.com/photo.jpg',
              tinderMatch: true,
              useVoiceV2: true,
            },
          ],
          render: { resolution: 1080, frameRate: 30, format: 'standard' },
          webhookUrl: WEBHOOK,
        },
      },
    });
  });

  it.each([
    ['an unknown template', { conversations: [{ ...VALID_CONVERSATION, template: 'blackberry' }] }, 'conversations.0.template'],
    ['a message with unknown characterId', { conversations: [{ ...VALID_CONVERSATION, messages: [{ text: 'hi', characterId: 'ghost' }] }] }, 'conversations.0.messages.0.characterId'],
    ['too many messages across conversations', {
      conversations: [{ ...VALID_CONVERSATION, messages: Array.from({ length: 1001 }, () => ({ text: 'hi' })) }],
    }, 'conversations'],
    ['an empty conversations array', { conversations: [] }, 'conversations'],
    ['a non-array conversations', { conversations: 'not-array' }, 'conversations'],
    ['a missing conversations field', { otherField: 'value' }, 'conversations'],
  ])('rejects %s without storing', async (_label, payload, field) => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, payload);

    expect(response.status).toBe(400);
    expect(submitVideo).not.toHaveBeenCalled();
    const body = await getErrorBody(response);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.field).toBe(field);
  });

  it('rejects a non-object body', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, 'not-an-object');

    expect(response.status).toBe(400);
    expect(submitVideo).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body', async () => {
    const submitVideo = vi.fn<SubmitVideo>(async (input) => storedRow(input));
    const app = makeApp(submitVideo);

    const response = await doPost(app, '{not valid json}');

    expect(response.status).toBe(400);
    expect(submitVideo).not.toHaveBeenCalled();
    const body = await getErrorBody(response);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.message).toBe('request body must be JSON');
  });
});