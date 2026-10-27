import { describe, expect, it } from 'vitest';

import { healthSchema } from './health';

const OK = {
  status: 'ok',
  service: 'facelesspro-api',
  version: '0.1.0',
  time: '2026-10-27T09:00:00.000Z',
  db: 'ok',
  queue: 'ok',
} as const;

describe('healthSchema', () => {
  it('accepts a fully healthy report', () => {
    expect(healthSchema.parse(OK)).toEqual(OK);
  });

  it('accepts a degraded report with any component failing', () => {
    const report = { ...OK, status: 'degraded', queue: 'error' };
    expect(healthSchema.parse(report)).toEqual(report);
  });

  it('accepts an offset timestamp', () => {
    expect(
      healthSchema.parse({ ...OK, time: '2026-10-27T14:30:00.000+05:30' }),
    ).toBeTruthy();
  });

  it('rejects an unknown component state', () => {
    const result = healthSchema.safeParse({ ...OK, db: 'degraded' });
    expect(result.success).toBe(false);
  });

  it('rejects a status that contradicts the components', () => {
    const result = healthSchema.safeParse({ ...OK, db: 'error' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['status']);
  });

  it('rejects a degraded status when every component is ok', () => {
    const result = healthSchema.safeParse({ ...OK, status: 'degraded' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing component and an unknown key', () => {
    const { db: _db, ...withoutDb } = OK;
    expect(healthSchema.safeParse(withoutDb).success).toBe(false);
    expect(healthSchema.safeParse({ ...OK, media: 'ok' }).success).toBe(false);
  });

  it('rejects a non-ISO time and an empty version', () => {
    expect(
      healthSchema.safeParse({ ...OK, time: 'yesterday' }).success,
    ).toBe(false);
    expect(healthSchema.safeParse({ ...OK, version: '' }).success).toBe(false);
  });

  it('rejects another service name', () => {
    expect(
      healthSchema.safeParse({ ...OK, service: 'facelesspro-media' }).success,
    ).toBe(false);
  });
});
