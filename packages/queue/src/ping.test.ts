import { describe, expect, it, vi } from 'vitest';

import { consume } from './boss';
import type { JobConsumer } from './boss';
import { InvalidJobError } from './jobs';
import {
  PING_QUEUE,
  PING_QUEUE_OPTIONS,
  parsePing,
  pingPayloadSchema,
} from './ping';

/**
 * A pg-boss stand-in: records what was subscribed and lets a test push a batch
 * through the handler. No connection is opened, which is the point — the queue
 * wiring is testable without Postgres.
 */
function fakeConsumer() {
  const subscriptions: Array<{
    queue: string;
    options: { readonly batchSize?: number };
    handler: (
      jobs: ReadonlyArray<{ readonly id: string; readonly data: unknown }>,
    ) => Promise<void>;
  }> = [];

  const consumer: JobConsumer = {
    async work(queue, options, handler) {
      subscriptions.push({ queue, options, handler });
      return `worker-${subscriptions.length}`;
    },
    async offWork() {},
  };

  return { consumer, subscriptions };
}

describe('ping payload', () => {
  it('accepts an empty object and a note', () => {
    expect(parsePing({})).toEqual({});
    expect(parsePing({ note: 'hello' })).toEqual({ note: 'hello' });
  });

  it('trims the note', () => {
    expect(parsePing({ note: '  spaces  ' })).toEqual({ note: 'spaces' });
  });

  it('rejects a blank, oversized or non-string note', () => {
    expect(() => parsePing({ note: '' })).toThrow(InvalidJobError);
    expect(() => parsePing({ note: '   ' })).toThrow(InvalidJobError);
    expect(() => parsePing({ note: 'x'.repeat(201) })).toThrow(InvalidJobError);
    expect(() => parsePing({ note: 7 })).toThrow(InvalidJobError);
  });

  it('rejects a payload that is not an object, and unknown keys', () => {
    for (const data of [null, undefined, 'ping', 1, []]) {
      expect(() => parsePing(data)).toThrow(InvalidJobError);
    }
    // A producer adding a field the consumer does not know is drift, not harmless.
    expect(() => parsePing({ note: 'hi', step: 'render' })).toThrow(
      /unrecognized|unexpected/i,
    );
  });

  it('is strict at the schema level too', () => {
    expect(pingPayloadSchema.safeParse({ other: true }).success).toBe(false);
  });
});

describe('ping queue policy', () => {
  it('does not retry a wiring problem, and keeps the row for a day', () => {
    expect(PING_QUEUE_OPTIONS.retryLimit).toBe(0);
    expect(PING_QUEUE_OPTIONS.expireInSeconds).toBe(60);
    expect(PING_QUEUE_OPTIONS.retentionSeconds).toBe(86_400);
  });

  it('is not a pipeline step', () => {
    // `ping` must never leak into `video.step`; it is a diagnostic queue.
    expect(PING_QUEUE).toBe('ping');
  });
});

describe('consume', () => {
  it('subscribes to the queue once, with a single job per batch', async () => {
    const { consumer, subscriptions } = fakeConsumer();
    await consume(consumer, PING_QUEUE, parsePing, async () => {});

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.queue).toBe(PING_QUEUE);
    expect(subscriptions[0]?.options).toEqual({ batchSize: 1 });
  });

  it('parses every job and hands the handler the validated payload', async () => {
    const { consumer, subscriptions } = fakeConsumer();
    const seen: Array<{ id: string; payload: unknown }> = [];

    await consume(consumer, PING_QUEUE, parsePing, async (job) => {
      seen.push(job);
    });

    await subscriptions[0]?.handler([
      { id: 'job-1', data: {} },
      { id: 'job-2', data: { note: 'second' } },
    ]);

    expect(seen).toEqual([
      { id: 'job-1', payload: {} },
      { id: 'job-2', payload: { note: 'second' } },
    ]);
  });

  it('fails the batch on a malformed payload instead of skipping it', async () => {
    const { consumer, subscriptions } = fakeConsumer();
    const handler = vi.fn(async () => {});
    await consume(consumer, PING_QUEUE, parsePing, handler);

    await expect(
      subscriptions[0]?.handler([{ id: 'job-1', data: null }]),
    ).rejects.toThrow(InvalidJobError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops at the first failing job in a batch', async () => {
    const { consumer, subscriptions } = fakeConsumer();
    const handler = vi.fn(async () => {});
    await consume(consumer, PING_QUEUE, parsePing, handler);

    await expect(
      subscriptions[0]?.handler([
        { id: 'job-1', data: {} },
        { id: 'job-2', data: 'nope' },
        { id: 'job-3', data: {} },
      ]),
    ).rejects.toThrow(InvalidJobError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
