import { describe, expect, it } from 'vitest';

import {
  DB_TABLES,
  apiKeyRowSchema,
  artStyleRowSchema,
  assetRowSchema,
  balanceLedgerRowSchema,
  captionTemplateRowSchema,
  captionTrackRowSchema,
  creditLedgerRowSchema,
  jobLockRowSchema,
  memberRowSchema,
  narrationRowSchema,
  renderRowSchema,
  sceneRowSchema,
  userRowSchema,
  videoRowSchema,
  voiceRowSchema,
  webhookEventRowSchema,
  workspaceRowSchema,
} from './db';

const WS = '0190a0a0-0000-7000-8000-000000000010';
const USER = '0190a0a0-0000-7000-8000-000000000011';
const VIDEO = '0190a0a0-0000-7000-8000-000000000012';
const ASSET = '0190a0a0-0000-7000-8000-000000000013';
const STYLE = '0190a0a0-0000-7000-8000-000000000014';
const NOW = '2026-10-26T17:00:00.000Z';

describe('database rows', () => {
  it('names every table once', () => {
    expect(DB_TABLES).toHaveLength(17);
    expect(new Set(DB_TABLES).size).toBe(DB_TABLES.length);
  });

  it('parses one realistic row per table', () => {
    expect(
      workspaceRowSchema.parse({
        id: WS,
        name: 'Personal',
        plan_id: 'selfhost',
        credits: null,
        balance_cents: 0,
        created_at: NOW,
      }).credits,
    ).toBeNull();

    expect(
      userRowSchema.parse({ id: USER, email: 'me@example.com', name: 'Me' }).email,
    ).toBe('me@example.com');

    expect(
      memberRowSchema.parse({ workspace_id: WS, user_id: USER, role: 'owner' }).role,
    ).toBe('owner');

    expect(
      apiKeyRowSchema.parse({
        id: '0190a0a0-0000-7000-8000-000000000015',
        workspace_id: WS,
        name: 'laptop',
        hash: 'c'.repeat(64),
        prefix: 'vp_0190a0a0',
      }).hash,
    ).toHaveLength(64);

    expect(
      creditLedgerRowSchema.parse({
        id: '0190a0a0-0000-7000-8000-000000000016',
        workspace_id: WS,
        video_id: VIDEO,
        action: 'tts',
        units: 1_234,
        unit_cost: 0,
        delta: -1_234,
        created_at: NOW,
      }).delta,
    ).toBe(-1_234);

    expect(
      balanceLedgerRowSchema.parse({
        id: '0190a0a0-0000-7000-8000-000000000017',
        workspace_id: WS,
        kind: 'topup',
        amount_cents: 1_900,
        meta: { provider: 'stripe' },
        created_at: NOW,
      }).meta,
    ).toEqual({ provider: 'stripe' });

    expect(
      artStyleRowSchema.parse({
        id: STYLE,
        name: 'Whiteboard explainer',
        published: true,
        formats: ['landscape', 'portrait'],
        profile: { palette: ['#ffffff'] },
        sample_video_urls: ['https://cdn.example.com/s.mp4'],
        status: 'ready',
        created_at: NOW,
      }).formats,
    ).toEqual(['landscape', 'portrait']);

    expect(
      voiceRowSchema.parse({
        id: 'ta-IN-PallaviNeural',
        engine: 'edge',
        external_id: 'ta-IN-PallaviNeural',
        name: 'Pallavi (Tamil)',
        languages: ['ta'],
        meta: { mixesEnglish: true },
      }).id,
    ).toBe('ta-IN-PallaviNeural');

    expect(
      captionTemplateRowSchema.parse({
        id: -1,
        name: 'Bold Tamil',
        spec: { fontSize: 72, wordLimit: 4 },
      }).id,
    ).toBe(-1);

    expect(
      assetRowSchema.parse({
        id: ASSET,
        workspace_id: WS,
        kind: 'image',
        key: `ws/${WS}/videos/${VIDEO}/frames/0001.png`,
        bytes: 91_234,
        mime: 'image/png',
        meta: {},
        created_at: NOW,
      }).kind,
    ).toBe('image');

    expect(
      videoRowSchema.parse({
        id: VIDEO,
        workspace_id: WS,
        kind: 'ai-video-v3',
        status: 'processing',
        step: 'create-scenes',
        request: { kind: 'ai-video-v3', body: { script: 'vanakkam' } },
        webhook_url: 'https://example.com/hook',
        created_at: NOW,
        updated_at: NOW,
      }).step,
    ).toBe('create-scenes');

    expect(
      sceneRowSchema.parse({
        id: '0190a0a0-0000-7000-8000-000000000018',
        video_id: VIDEO,
        idx: 0,
        text: 'வணக்கம்',
        image_asset_id: ASSET,
        motion: { zoom: 1.05 },
        start_ms: 0,
        end_ms: 3_000,
      }).idx,
    ).toBe(0);

    expect(
      narrationRowSchema.parse({
        video_id: VIDEO,
        asset_id: ASSET,
        duration_ms: 2_966,
        word_timings: [{ text: 'வணக்கம்', start_ms: 0, end_ms: 900 }],
        voice_plan: {
          script: 'vanakkam',
          spokenText: 'வணக்கம்',
          runs: [
            {
              text: 'வணக்கம்',
              lang: 'ta',
              voice: 'ta-IN-PallaviNeural',
              script: 'tanglish',
            },
          ],
          overrides: [],
          pair: 'pallavi-neerja',
        },
      }).word_timings,
    ).toHaveLength(1);

    expect(
      captionTrackRowSchema.parse({
        video_id: VIDEO,
        template_id: -1,
        cues: [{ text: 'vanakkam', startMs: 0, endMs: 900 }],
      }).cues,
    ).toHaveLength(1);

    expect(
      renderRowSchema.parse({
        id: '0190a0a0-0000-7000-8000-000000000019',
        video_id: VIDEO,
        resolution: 1080,
        fps: 30,
        format: 'standard',
        asset_id: ASSET,
        status: 'completed',
        created_at: NOW,
      }).fps,
    ).toBe(30);

    expect(
      jobLockRowSchema.parse({
        video_id: VIDEO,
        step: 'create-vocal',
        attempt: 1,
        started_at: NOW,
      }).attempt,
    ).toBe(1);

    expect(
      webhookEventRowSchema.parse({
        id: '0190a0a0-0000-7000-8000-000000000020',
        video_id: VIDEO,
        event: 'completed',
        attempts: 0,
        next_at: NOW,
        payload: { event: 'completed' },
      }).attempts,
    ).toBe(0);
  });

  it('credits is required and nullable, never missing', () => {
    const row = {
      id: WS,
      name: 'Personal',
      plan_id: 'selfhost',
      balance_cents: 0,
      created_at: NOW,
    };
    expect(workspaceRowSchema.safeParse(row).success).toBe(false);
    expect(workspaceRowSchema.safeParse({ ...row, credits: 100 }).success).toBe(true);
  });

  it('caption template id 0 is neither a built-in nor a row', () => {
    expect(
      captionTemplateRowSchema.safeParse({ id: 0, name: 'x', spec: {} }).success,
    ).toBe(false);
  });

  it("does not accept the upstream's leaked step spelling", () => {
    const base = {
      id: VIDEO,
      workspace_id: WS,
      kind: 'ai-video-v3',
      status: 'processing',
      request: { kind: 'ai-video-v3', body: {} },
      created_at: NOW,
      updated_at: NOW,
    };
    expect(videoRowSchema.safeParse({ ...base, step: 'create image' }).success).toBe(
      false,
    );
    expect(videoRowSchema.safeParse({ ...base, step: 'create-images' }).success).toBe(
      true,
    );
  });

  it('a narration row without a voice plan is rejected', () => {
    expect(
      narrationRowSchema.safeParse({
        video_id: VIDEO,
        asset_id: ASSET,
        duration_ms: 1,
        word_timings: [],
      }).success,
    ).toBe(false);
  });
});
