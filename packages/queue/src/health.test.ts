import { VIDEO_STEPS } from '@facelesspro/contracts';
import { describe, expect, it } from 'vitest';

import {
  PGBOSS_DEFAULT_SCHEMA,
  checkQueues,
  expectedQueueNames,
} from './health';
import type { SqlExecutor } from './health';
import { PING_QUEUE } from './ping';
import { ART_STYLE_QUEUE } from './art-style';

interface Call {
  readonly text: string;
  readonly values?: readonly unknown[];
}

function fakeDb(names: readonly string[]) {
  const calls: Call[] = [];
  const db: SqlExecutor = {
    async query(text, values) {
      calls.push(values === undefined ? { text } : { text, values });
      return { rows: names.map((name) => ({ name })) };
    },
  };
  return { db, calls };
}

describe('expectedQueueNames', () => {
  it('is every pipeline step in contract order, plus the art-style build and the smoke test', () => {
    expect(expectedQueueNames()).toEqual([...VIDEO_STEPS, ART_STYLE_QUEUE, PING_QUEUE]);
  });
});

describe('checkQueues', () => {
  it('resolves when every expected queue exists', async () => {
    const { db } = fakeDb(expectedQueueNames());
    await expect(checkQueues(db)).resolves.toBeUndefined();
  });

  it('names the queues that are missing', async () => {
    const present = expectedQueueNames().filter((name) => name !== 'render');
    const { db } = fakeDb(present);
    await expect(checkQueues(db)).rejects.toThrow(/queue\(s\) missing: render/);
  });

  it('reports every missing queue, not just the first', async () => {
    const { db } = fakeDb([]);
    await expect(checkQueues(db)).rejects.toThrow(
      new RegExp(`missing: ${expectedQueueNames().join(', ')}`),
    );
  });

  it('queries the pg-boss schema by default and passes names as a parameter', async () => {
    const { db, calls } = fakeDb(expectedQueueNames());
    await checkQueues(db);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain(`"${PGBOSS_DEFAULT_SCHEMA}".queue`);
    // Queue names are data, never interpolated into the statement.
    expect(calls[0]?.text).not.toContain('create-scenes');
    expect(calls[0]?.values).toEqual([expectedQueueNames()]);
  });

  it('honours a custom schema', async () => {
    const { db, calls } = fakeDb(expectedQueueNames());
    await checkQueues(db, { schema: 'job_queue' });
    expect(calls[0]?.text).toContain('"job_queue".queue');
  });

  it('refuses a schema name that is not a plain identifier', async () => {
    const { db, calls } = fakeDb([]);
    for (const schema of ['pgboss; drop table video', 'pg boss', '', 'a"."b']) {
      await expect(checkQueues(db, { schema })).rejects.toThrow(
        /invalid pg-boss schema/i,
      );
    }
    expect(calls).toHaveLength(0);
  });

  it('checks an explicit subset when asked', async () => {
    const { db, calls } = fakeDb(['ping']);
    await expect(
      checkQueues(db, { expected: ['ping'] }),
    ).resolves.toBeUndefined();
    expect(calls[0]?.values).toEqual([['ping']]);
  });

  it('skips the query when there is nothing to expect', async () => {
    const { db, calls } = fakeDb([]);
    await expect(checkQueues(db, { expected: [] })).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('propagates a database error (missing schema, no connection)', async () => {
    const db: SqlExecutor = {
      async query() {
        throw new Error('relation "pgboss.queue" does not exist');
      },
    };
    await expect(checkQueues(db)).rejects.toThrow(/does not exist/);
  });
});
