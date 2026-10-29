/**
 * Timestamps, in one place.
 *
 * Postgres prints `timestamptz` as `2026-10-26 18:12:34.567+00` — a space
 * instead of `T` and a two-digit offset. `Date` parses that; our wire contract
 * (`isoDateTimeSchema` in `@facelesspro/contracts`) does not. Loosening the
 * contract to absorb a driver quirk would put a Postgres detail into every
 * client, so the conversion happens at the database boundary instead: every
 * timestamp a query returns is ISO 8601 UTC.
 *
 * Why a column type and not `types.setTypeParser(1184, …)`: drizzle replaces
 * `pg`'s parser table with an identity function and maps values per column, so
 * a global parser is never consulted for a drizzle query. It looks like a fix
 * and does nothing. The mapping belongs on the column.
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * Normalise one Postgres timestamp string to ISO 8601 UTC.
 *
 * Precision note: `timestamptz` stores microseconds, `Date` holds milliseconds,
 * so sub-millisecond digits are truncated. Nothing in the pipeline needs them —
 * audio timing is integer milliseconds in the media service — and `created_at`
 * could not be a total ordering anyway, because Postgres `now()` is
 * transaction-scoped, so rows written in one transaction share a value. Order
 * by an explicit tiebreaker, never by `created_at` alone.
 *
 * An unparseable value is returned untouched rather than thrown: the row schema
 * then reports which column is wrong, with the offending value in the message.
 */
export function toIsoTimestamp(value: string): string {
  const trimmed = value.trim();
  if (trimmed === 'infinity' || trimmed === '-infinity') return trimmed;

  const normalised = trimmed
    .replace(' ', 'T')
    // `+00` / `-05` -> `+00:00` / `-05:00`. A full offset is left alone.
    .replace(/([+-]\d{2})$/, '$1:00');

  const parsed = new Date(normalised);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString();
}

/**
 * `timestamptz` that is a string everywhere: on insert, on select and in
 * `$inferSelect`. That is what lets `$inferSelect` match a contract row type
 * exactly instead of needing a Date→ISO conversion at every read.
 */
export const timestamptz = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'timestamptz';
  },
  fromDriver(value) {
    return toIsoTimestamp(value);
  },
  toDriver(value) {
    return value;
  },
});
