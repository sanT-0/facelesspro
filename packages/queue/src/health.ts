/**
 * Queue health (`GET /health.queue`).
 *
 * "Is the queue ok?" cannot be answered by a TCP connect: the failure mode that
 * matters is *silently missing queues* — a worker that never started, a schema
 * that was never migrated, a renamed step. So the check reads pg-boss's own
 * `queue` table and requires every name this instance expects.
 *
 * It runs on the api's existing pool: no `PgBoss` instance is started here,
 * because starting one also starts supervision, and the health endpoint must
 * never become a second scheduler.
 */

import { VIDEO_STEPS } from '@facelesspro/contracts';

import { queueFor } from './jobs';
import { ART_STYLE_QUEUE } from './art-style';
import { PING_QUEUE } from './ping';

/** pg-boss's default schema; override with `PGBOSS_SCHEMA`. */
export const PGBOSS_DEFAULT_SCHEMA = 'pgboss';

/**
 * Every queue this instance must have: the five pipeline steps, the art-style
 * build and the smoke test. Order is the contract order, so a log line reads
 * like the pipeline.
 */
export function expectedQueueNames(): readonly string[] {
  return [...VIDEO_STEPS.map((step) => queueFor(step)), ART_STYLE_QUEUE, PING_QUEUE];
}

/**
 * The minimum of `pg`'s `Pool` this check needs. Narrow on purpose: a test can
 * satisfy it with a function, and nothing here can open a connection.
 */
export interface SqlExecutor {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

/** Postgres identifiers we are willing to interpolate (schema is config, not input). */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export interface CheckQueuesOptions {
  readonly schema?: string;
  readonly expected?: readonly string[];
}

/**
 * Resolves when every expected queue row exists; throws otherwise (the api turns
 * a throw into `queue: "error"`).
 */
export async function checkQueues(
  db: SqlExecutor,
  options: CheckQueuesOptions = {},
): Promise<void> {
  const schema = options.schema ?? PGBOSS_DEFAULT_SCHEMA;
  if (!IDENTIFIER.test(schema)) {
    throw new Error(`invalid pg-boss schema name: ${JSON.stringify(schema)}`);
  }

  const expected = options.expected ?? expectedQueueNames();
  if (expected.length === 0) return;

  // Queue names travel as a parameter; only the schema is interpolated, and only
  // after the identifier check above.
  const { rows } = await db.query(
    `select name from "${schema}".queue where name = any($1::text[])`,
    [expected],
  );

  const present = new Set(
    rows
      .map((row) => row.name)
      .filter((name): name is string => typeof name === 'string'),
  );
  const missing = expected.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(`queue(s) missing: ${missing.join(', ')}`);
  }
}
