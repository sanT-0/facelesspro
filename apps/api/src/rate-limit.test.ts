import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KEY_REQUESTS_PER_MINUTE,
  DEFAULT_WORKSPACE_REQUESTS_PER_MINUTE,
  createRateLimiter,
  rateLimitOptionsFromEnv,
} from './rate-limit';

const START = Date.parse('2026-11-09T00:00:00.000Z');

function clock(start = START) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('fixed-window rate limiter', () => {
  it('allows exactly the key limit, then reports the window remainder', () => {
    const time = clock();
    const limiter = createRateLimiter({
      keyPerMinute: 2,
      workspacePerMinute: 100,
      now: time.now,
    });

    expect(limiter.check('key-1', 'ws-1')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(limiter.check('key-1', 'ws-1').allowed).toBe(true);
    expect(limiter.check('key-1', 'ws-1')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });

    time.advance(30_000);
    expect(limiter.check('key-1', 'ws-1')).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });

    time.advance(30_000);
    expect(limiter.check('key-1', 'ws-1')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('shares the workspace counter across different keys', () => {
    const time = clock();
    const limiter = createRateLimiter({
      keyPerMinute: 100,
      workspacePerMinute: 2,
      now: time.now,
    });

    expect(limiter.check('key-1', 'ws-1').allowed).toBe(true);
    expect(limiter.check('key-2', 'ws-1').allowed).toBe(true);
    expect(limiter.check('key-3', 'ws-1')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    // Another workspace is independent.
    expect(limiter.check('key-1', 'ws-2').allowed).toBe(true);
  });

  it('a key limit does not affect another key in the same workspace', () => {
    const limiter = createRateLimiter({
      keyPerMinute: 1,
      workspacePerMinute: 100,
      now: clock().now,
    });

    expect(limiter.check('key-1', 'ws-1').allowed).toBe(true);
    expect(limiter.check('key-1', 'ws-1').allowed).toBe(false);
    expect(limiter.check('key-2', 'ws-1').allowed).toBe(true);
  });

  it('does not let rejected retries extend the lockout', () => {
    const time = clock();
    const limiter = createRateLimiter({
      keyPerMinute: 1,
      workspacePerMinute: 100,
      now: time.now,
    });

    expect(limiter.check('key-1', 'ws-1').allowed).toBe(true);
    expect(limiter.check('key-1', 'ws-1').allowed).toBe(false);

    time.advance(59_000);
    expect(limiter.check('key-1', 'ws-1')).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });

    time.advance(1_000);
    expect(limiter.check('key-1', 'ws-1').allowed).toBe(true);
  });

  it('rejects a non-positive or fractional limit', () => {
    expect(() =>
      createRateLimiter({ keyPerMinute: 0, workspacePerMinute: 10 }),
    ).toThrow(/keyPerMinute/);
    expect(() =>
      createRateLimiter({ keyPerMinute: 10, workspacePerMinute: -1 }),
    ).toThrow(/workspacePerMinute/);
    expect(() =>
      createRateLimiter({ keyPerMinute: 1.5, workspacePerMinute: 10 }),
    ).toThrow(/keyPerMinute/);
  });
});

describe('rate limit environment options', () => {
  it('uses defaults when the variables are absent or blank', () => {
    expect(rateLimitOptionsFromEnv({})).toEqual({
      keyPerMinute: DEFAULT_KEY_REQUESTS_PER_MINUTE,
      workspacePerMinute: DEFAULT_WORKSPACE_REQUESTS_PER_MINUTE,
    });
    expect(
      rateLimitOptionsFromEnv({
        RATE_LIMIT_KEY_PER_MINUTE: '   ',
        RATE_LIMIT_WORKSPACE_PER_MINUTE: '',
      }),
    ).toEqual({
      keyPerMinute: DEFAULT_KEY_REQUESTS_PER_MINUTE,
      workspacePerMinute: DEFAULT_WORKSPACE_REQUESTS_PER_MINUTE,
    });
  });

  it('reads positive integer overrides', () => {
    expect(
      rateLimitOptionsFromEnv({
        RATE_LIMIT_KEY_PER_MINUTE: '5',
        RATE_LIMIT_WORKSPACE_PER_MINUTE: ' 9 ',
      }),
    ).toEqual({ keyPerMinute: 5, workspacePerMinute: 9 });
  });

  it.each([
    ['zero', '0', 'RATE_LIMIT_KEY_PER_MINUTE'],
    ['negative', '-2', 'RATE_LIMIT_KEY_PER_MINUTE'],
    ['fraction', '1.5', 'RATE_LIMIT_KEY_PER_MINUTE'],
    ['text', 'many', 'RATE_LIMIT_KEY_PER_MINUTE'],
  ])('rejects %s with the variable name', (_label, value, variable) => {
    expect(() =>
      rateLimitOptionsFromEnv({ [variable]: value }),
    ).toThrow(variable);
  });
});
