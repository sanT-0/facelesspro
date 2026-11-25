import { describe, expect, it } from 'vitest';

import {
  createLogger,
  DEFAULT_LOG_CONFIG,
  logConfigFromEnv,
  loggerFromEnv,
  noopLogger,
} from './index';

const NOW = new Date('2026-11-25T10:00:00.000Z');

function capture(options: Partial<Parameters<typeof createLogger>[0]> = {}): {
  logger: ReturnType<typeof createLogger>;
  lines: string[];
  records: () => Array<Record<string, unknown>>;
} {
  const lines: string[] = [];
  const logger = createLogger({
    svc: 'worker',
    now: () => NOW,
    write: (line) => lines.push(line),
    ...options,
  });
  return {
    logger,
    lines,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('one line per event', () => {
  it('writes a single JSON object with ts, level, svc and event', () => {
    const { logger, lines, records } = capture();

    logger.info('step.committed', { videoId: 'v1', step: 'render', ms: 1234 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(records()[0]).toEqual({
      ts: '2026-11-25T10:00:00.000Z',
      level: 'info',
      svc: 'worker',
      event: 'step.committed',
      videoId: 'v1',
      step: 'render',
      ms: 1234,
    });
  });

  it('drops the level below the configured threshold', () => {
    const { logger, records } = capture({ config: { level: 'warn' } });

    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    expect(records().map((record) => record.event)).toEqual(['c', 'd']);
    expect(records().map((record) => record.level)).toEqual(['warn', 'error']);
  });

  it('adds child context to every line without leaking into the parent', () => {
    const { logger, records } = capture();
    const child = logger.child({ videoId: 'v1', step: 'create-vocal' });

    child.info('started');
    logger.info('other', { videoId: 'v2' });

    expect(records()[0]).toMatchObject({ videoId: 'v1', step: 'create-vocal' });
    expect(records()[1]).toMatchObject({ videoId: 'v2' });
    expect(records()[1]).not.toHaveProperty('step');
  });

  it('lets a call field override child context', () => {
    const { logger, records } = capture();
    logger.child({ step: 'create-scenes' }).warn('retry', { step: 'render' });

    expect(records()[0]?.step).toBe('render');
  });
});

describe('private content', () => {
  it('redacts narration fields at any depth by default', () => {
    const { logger, records } = capture();

    logger.info('request.received', {
      request: { kind: 'ai-video', body: { script: 'வணக்கம்', resolution: 1080 } },
      text: 'secret line',
    });

    expect(records()[0]?.request).toEqual({
      kind: 'ai-video',
      body: '[redacted]',
    });
    expect(records()[0]?.text).toBe('[redacted]');
  });

  it('logs private fields when the deployment opts in', () => {
    const { logger, records } = capture({ config: { scripts: true } });

    logger.info('request.received', { script: 'வணக்கம்' });

    expect(records()[0]?.script).toBe('வணக்கம்');
  });

  it('matches private keys case-insensitively', () => {
    const { logger, records } = capture();
    logger.info('x', { Text: 'line' });

    expect(records()[0]?.Text).toBe('[redacted]');
  });
});

describe('values that JSON cannot serialise', () => {
  it('turns an Error into name and message, not a stack', () => {
    const { logger, records } = capture();

    logger.error('step.failed', { error: new Error('pg-boss is down') });

    expect(records()[0]?.error).toEqual({ name: 'Error', message: 'pg-boss is down' });
  });

  it('keeps the cause chain so an adapter status survives', () => {
    const { logger, records } = capture();

    const error = new Error('tts failed', {
      cause: { status: 429, retryAfter: 30 },
    });
    logger.warn('tts.retry', { error });

    expect(records()[0]?.error).toMatchObject({
      message: 'tts failed',
      cause: { status: 429, retryAfter: 30 },
    });
  });

  it('includes the stack only when enabled', () => {
    const off = capture();
    off.logger.error('x', { error: new Error('boom') });
    expect(off.records()[0]?.error).not.toHaveProperty('stack');

    const on = capture({ config: { stacks: true } });
    on.logger.error('x', { error: new Error('boom') });
    expect(on.records()[0]?.error).toHaveProperty('stack');
  });

  it('survives a circular object and a bigint', () => {
    const { logger, records } = capture();
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    expect(() => logger.info('odd', { circular, big: 10n })).not.toThrow();
    expect(records()[0]?.circular).toEqual({ name: 'loop', self: '[circular]' });
    expect(records()[0]?.big).toBe('10n');
  });

  it('serialises dates as ISO strings and skips undefined', () => {
    const { logger, records } = capture();

    logger.info('x', { at: new Date('2026-01-02T03:04:05.000Z'), missing: undefined });

    expect(records()[0]?.at).toBe('2026-01-02T03:04:05.000Z');
    expect(records()[0]).not.toHaveProperty('missing');
  });

  it('never throws when the sink does', () => {
    const logger = createLogger({
      svc: 'api',
      write: () => {
        throw new Error('EPIPE');
      },
    });

    expect(() => logger.error('shutdown', {})).not.toThrow();
  });
});

describe('environment configuration', () => {
  it('defaults to info with private content redacted', () => {
    expect(logConfigFromEnv({})).toEqual(DEFAULT_LOG_CONFIG);
  });

  it('reads LOG_LEVEL case-insensitively and ignores junk', () => {
    expect(logConfigFromEnv({ LOG_LEVEL: 'DEBUG' }).level).toBe('debug');
    expect(logConfigFromEnv({ LOG_LEVEL: 'chatty' }).level).toBe('info');
  });

  it('enables scripts and stacks only for exactly "1"', () => {
    expect(logConfigFromEnv({ LOG_SCRIPTS: '1', LOG_STACKS: '1' })).toMatchObject({
      scripts: true,
      stacks: true,
    });
    expect(logConfigFromEnv({ LOG_SCRIPTS: 'true', LOG_STACKS: '0' })).toMatchObject({
      scripts: false,
      stacks: false,
    });
  });

  it('loggerFromEnv stamps the service name', () => {
    const lines: string[] = [];
    const logger = loggerFromEnv('api', {
      now: () => NOW,
      write: (line) => lines.push(line),
      config: { level: 'debug' },
    });

    logger.debug('boot');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ svc: 'api', level: 'debug' });
  });
});

describe('noopLogger', () => {
  it('accepts every call and stays silent', () => {
    expect(() => {
      noopLogger.debug('a');
      noopLogger.info('b', { x: 1 });
      noopLogger.warn('c');
      noopLogger.error('d');
      noopLogger.child({ videoId: 'v' }).info('e');
    }).not.toThrow();
  });
});
