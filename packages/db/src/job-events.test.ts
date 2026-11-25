import { VIDEO_STEPS } from '@facelesspro/contracts';
import { describe, expect, it } from 'vitest';

import { buildJobHealthReport } from './job-events';
import type { JobEventCount } from './job-events';

const SINCE = new Date('2026-11-25T09:00:00.000Z');

function report(counts: JobEventCount[], threshold?: number) {
  return buildJobHealthReport({
    since: SINCE,
    windowMinutes: 60,
    ...(threshold === undefined ? {} : { threshold }),
    counts,
  });
}

describe('buildJobHealthReport', () => {
  it('reports every pipeline step in order, zeros included', () => {
    const health = report([]);

    expect(health.steps.map((step) => step.step)).toEqual([...VIDEO_STEPS]);
    expect(health.steps.every((step) => step.events === 0)).toBe(true);
    expect(health).toMatchObject({
      since: SINCE.toISOString(),
      windowMinutes: 60,
      threshold: 0.2,
      status: 'ok',
      events: 0,
      succeeded: 0,
      failed: 0,
      retryable: 0,
      failureRate: 0,
    });
  });

  it('counts committed and reused as success and failed as failure', () => {
    const health = report([
      { step: 'create-scenes', outcome: 'committed', count: 3 },
      { step: 'create-scenes', outcome: 'reused', count: 1 },
      { step: 'create-scenes', outcome: 'failed', count: 1 },
    ]);

    expect(health.steps[0]).toMatchObject({
      step: 'create-scenes',
      events: 5,
      succeeded: 4,
      failed: 1,
      retryable: 0,
      failureRate: 0.2,
    });
    expect(health.failed).toBe(1);
    expect(health.failureRate).toBe(0.2);
  });

  it('reports retryable but keeps it out of the failure rate', () => {
    const health = report([
      { step: 'create-vocal', outcome: 'committed', count: 1 },
      { step: 'create-vocal', outcome: 'retryable', count: 9 },
    ]);

    expect(health.steps[1]).toMatchObject({
      step: 'create-vocal',
      events: 10,
      succeeded: 1,
      failed: 0,
      retryable: 9,
      failureRate: 0,
    });
    expect(health.status).toBe('ok');
  });

  it('ignores coordination outcomes when computing the rate', () => {
    const health = report([
      { step: 'render', outcome: 'committed', count: 2 },
      { step: 'render', outcome: 'failed', count: 2 },
      { step: 'render', outcome: 'stale', count: 50 },
      { step: 'render', outcome: 'locked', count: 50 },
      { step: 'render', outcome: 'superseded', count: 50 },
      { step: 'render', outcome: 'missing', count: 1 },
    ]);

    const render = health.steps.find((step) => step.step === 'render');
    expect(render).toMatchObject({ events: 155, succeeded: 2, failed: 2, failureRate: 0.5 });
  });

  it('degrades only when the rate is strictly above the threshold', () => {
    const counts: JobEventCount[] = [
      { step: 'render', outcome: 'committed', count: 8 },
      { step: 'render', outcome: 'failed', count: 2 },
    ];

    expect(report(counts, 0.2).status).toBe('ok');
    expect(report(counts, 0.19).status).toBe('degraded');
  });

  it('rounds the rate to four decimals', () => {
    const health = report([
      { step: 'create-images', outcome: 'committed', count: 2 },
      { step: 'create-images', outcome: 'failed', count: 1 },
    ]);

    expect(health.failureRate).toBe(0.3333);
  });

  it('ignores negative and unknown-step rows instead of throwing', () => {
    const health = report([
      { step: 'render', outcome: 'committed', count: -3 },
      { step: 'not-a-step' as never, outcome: 'failed', count: 4 },
    ]);

    expect(health.events).toBe(0);
    expect(health.status).toBe('ok');
  });

  it('never divides by zero when nothing terminal happened', () => {
    const health = report([{ step: 'render', outcome: 'stale', count: 3 }]);

    expect(health.failureRate).toBe(0);
    expect(health.steps.every((step) => step.failureRate === 0)).toBe(true);
  });
});
