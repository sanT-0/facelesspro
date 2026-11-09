/**
 * Contract tests for webhook delivery (docs/01 §9, docs/07 §3).
 *
 * Signing: HMAC-SHA256 over `t + "." + body`, header `t=<ts>,v1=<hex>`.
 * Retry schedule: 10 attempts at 30 s, 2 m, 10 m, 30 m, 1 h, 2 h, 4 h, 8 h, 8 h.
 * Event id: `evt_<uuid>`. Signature: `t=<seconds>,v1=<64 hex>`.
 */

import { describe, expect, it } from 'vitest';

import {
  formatSignatureHeader,
  webhookEventIdSchema,
  webhookEventSchema,
  webhookSigningPayload,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_MS,
  WEBHOOK_TIMEOUT_MS,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
} from './webhooks';

describe('webhook contract', () => {
  it('defines the retry schedule: 10 attempts, ~24 h total', () => {
    expect(WEBHOOK_RETRY_SCHEDULE_MS).toHaveLength(9);
    // First attempt is immediate, then 9 gaps = 10 attempts total.
    const totalSeconds = WEBHOOK_RETRY_SCHEDULE_MS.reduce(
      (sum, gap) => sum + gap,
      0,
    ) / 1000;
    expect(totalSeconds).toBeLessThanOrEqual(24 * 60 * 60);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(10);
    expect(WEBHOOK_TIMEOUT_MS).toBe(10_000);
  });

  it('names the dedupe and signature headers', () => {
    expect(WEBHOOK_EVENT_HEADER).toBe('X-Faceless-Event-Id');
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('X-Faceless-Signature');
  });

  it('accepts evt_<uuid> event ids', () => {
    expect(webhookEventIdSchema.parse('evt_11111111-1111-4111-8111-111111111111')).toBe(
      'evt_11111111-1111-4111-8111-111111111111',
    );
    expect(() => webhookEventIdSchema.parse('not-an-id')).toThrow();
    expect(() => webhookEventIdSchema.parse('uuid-without-prefix')).toThrow();
  });

  it('validates the webhook event body', () => {
    const valid = webhookEventSchema.parse({
      event: 'completed',
      video: {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'ai-video-v3',
        status: 'completed',
        step: null,
        render: true,
        editorUrl: 'http://example.com/editor?id=11111111-1111-4111-8111-111111111111',
        createdAt: '2026-11-09T09:00:00.000Z',
        updatedAt: '2026-11-09T09:00:00.000Z',
      },
    });
    expect(valid.event).toBe('completed');

    expect(() =>
      webhookEventSchema.parse({ event: 'processing', video: {} }),
    ).toThrow();
  });

  it('builds the signing payload as t.<body>', () => {
    const body = JSON.stringify({ event: 'completed' });
    expect(webhookSigningPayload(1690000000, body)).toBe('1690000000.' + body);
    // Fractional timestamps are truncated.
    expect(webhookSigningPayload(1690000000.9, body)).toBe('1690000000.' + body);
  });

  it('formats the signature header as t=<ts>,v1=<hex>', () => {
    const header = formatSignatureHeader(1690000000, 'deadbeef'.repeat(8));
    expect(header).toBe('t=1690000000,v1=' + 'deadbeef'.repeat(8));
    expect(header.startsWith('t=')).toBe(true);
    expect(header.includes(',v1=')).toBe(true);
  });
});
