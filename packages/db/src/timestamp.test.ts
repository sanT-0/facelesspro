import { isoDateTimeSchema } from '@facelesspro/contracts';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { workspace } from './schema';
import { toIsoTimestamp } from './timestamp';

describe('toIsoTimestamp', () => {
  it('rewrites the Postgres text format into ISO 8601 UTC', () => {
    // The literal shape the driver hands back for a `timestamptz` column.
    expect(toIsoTimestamp('2026-10-26 18:12:34.567+00')).toBe(
      '2026-10-26T18:12:34.567Z',
    );
  });

  it('converts a real offset to UTC instead of dropping it', () => {
    expect(toIsoTimestamp('2026-10-26 18:12:34.567+05:30')).toBe(
      '2026-10-26T12:42:34.567Z',
    );
    expect(toIsoTimestamp('2026-10-26 18:12:34.567-04:00')).toBe(
      '2026-10-26T22:12:34.567Z',
    );
    // A 45-minute offset is the case a naive "strip the offset" fix gets wrong.
    expect(toIsoTimestamp('2026-10-26 18:12:34.567+05:45')).toBe(
      '2026-10-26T12:27:34.567Z',
    );
  });

  it('accepts input that is already ISO and leaves it stable', () => {
    for (const value of [
      '2026-10-26T18:12:34.567Z',
      '2026-10-26T18:12:34.567+00:00',
      '2026-10-26T18:12:34.567+00',
    ]) {
      expect(toIsoTimestamp(value)).toBe('2026-10-26T18:12:34.567Z');
    }
  });

  it('fills milliseconds when Postgres omits a fraction', () => {
    expect(toIsoTimestamp('2026-10-26 00:00:00+00')).toBe(
      '2026-10-26T00:00:00.000Z',
    );
  });

  it('always produces something the wire contract accepts', () => {
    for (const value of [
      '2026-10-26 18:12:34.567+00',
      '2026-10-26 18:12:34.567891+00',
      '2028-02-29 23:59:59.999+00',
    ]) {
      const iso = toIsoTimestamp(value);
      expect(isoDateTimeSchema.safeParse(iso).success, iso).toBe(true);
    }
  });

  it('truncates microseconds, which is a documented limit not a bug', () => {
    expect(toIsoTimestamp('2026-10-26 18:12:34.567891+00')).toBe(
      '2026-10-26T18:12:34.567Z',
    );
  });

  it('passes an unparseable value through so the row schema can name the column', () => {
    expect(toIsoTimestamp('not a timestamp')).toBe('not a timestamp');
    expect(
      isoDateTimeSchema.safeParse(toIsoTimestamp('not a timestamp')).success,
    ).toBe(false);
  });

  it('keeps PostgreSQL infinity instead of inventing a date', () => {
    expect(toIsoTimestamp('infinity')).toBe('infinity');
    expect(toIsoTimestamp('-infinity')).toBe('-infinity');
  });
});

describe('the timestamptz column type', () => {
  it('normalises on read, so drizzle results are already contract-shaped', () => {
    const column = getTableColumns(workspace).created_at;
    const raw = '2026-10-26 17:51:32.880204+00';

    // This is the exact value `select created_at from workspace` returns to
    // drizzle: it maps per column and ignores `pg`'s own parser table.
    expect(column.mapFromDriverValue(raw)).toBe('2026-10-26T17:51:32.880Z');
    expect(isoDateTimeSchema.safeParse(column.mapFromDriverValue(raw)).success).toBe(
      true,
    );
  });

  it('is a timestamptz at the Postgres level, not a text column', () => {
    expect(getTableColumns(workspace).created_at.getSQLType()).toBe('timestamptz');
  });
});
