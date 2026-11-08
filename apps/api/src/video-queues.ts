/**
 * Real pipeline actions: guard + transition + enqueue in one transaction.
 *
 * `beginRender` and `beginRetry` both take a row lock and rewrite the cursor.
 * The job insert goes through the same client, so either the video is in the
 * new state with a queued job or nothing changed — there is no state where the
 * cursor promises work nobody will run.
 */

import { beginRender, beginRetry, databaseFor } from '@facelesspro/db';
import type { createDb, Database } from '@facelesspro/db';
import { enqueueStep } from '@facelesspro/queue';

import type { QueueRender, QueueRetry } from './videos';

type Pool = ReturnType<typeof createDb>['pool'];
type Boss = Parameters<typeof enqueueStep>[0];
type Client = Exclude<Parameters<typeof databaseFor>[0], Pool>;

/** pg-boss inserts its job through the caller's open transaction. */
function enqueueThrough(client: Client) {
  return {
    db: {
      executeSql: async (text: string, values: unknown[]) => {
        const executed = await client.query(text, values);
        return { rows: executed.rows };
      },
    },
  };
}

async function withTransaction<T>(
  pool: Pool,
  work: (txDb: Database, client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(databaseFor(client), client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createQueueRender(
  pool: Pool,
  getBoss: () => Promise<Boss>,
): QueueRender {
  return async (input) => {
    // Resolve the producer before opening the transaction: boss initialization
    // may connect on its own schedule, and it should not extend the row lock.
    const boss = await getBoss();
    return withTransaction(pool, async (txDb, client) => {
      const result = await beginRender(txDb, input);
      if (result.kind === 'queued') {
        await enqueueStep(
          boss,
          { videoId: input.videoId, step: 'render' },
          enqueueThrough(client),
        );
      }
      return result;
    });
  };
}

export function createQueueRetry(
  pool: Pool,
  getBoss: () => Promise<Boss>,
): QueueRetry {
  return async (videoId) => {
    const boss = await getBoss();
    return withTransaction(pool, async (txDb, client) => {
      const result = await beginRetry(txDb, videoId);
      if (result.kind === 'queued') {
        await enqueueStep(
          boss,
          { videoId, step: result.step },
          enqueueThrough(client),
        );
      }
      return result;
    });
  };
}
