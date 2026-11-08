/**
 * `npm run key:create -- --name "CI renderer" [--workspace <uuid>]`
 *
 * The bootstrap path for the first key: `POST /v1/keys` itself requires an API
 * key, so a fresh install needs a way to mint one from the host shell. The key
 * is printed once. Nothing else about it is recoverable.
 */

import { pathToFileURL } from 'node:url';

import { createApiKeyRequestSchema, idSchema } from '@facelesspro/contracts';
import { eq } from 'drizzle-orm';

import { createApiKey } from './api-keys';
import { createDb, loadEnv } from './client';
import { workspace } from './schema';
import { DEV_WORKSPACE_ID } from './seed';

interface Options {
  readonly name: string;
  readonly workspaceId: string;
}

const USAGE = 'usage: npm run key:create -- --name "<label>" [--workspace <uuid>]';

function readOption(args: readonly string[], name: string): string | undefined {
  const flag = `--${name}`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
    if (arg === flag) {
      const next = args[index + 1];
      // A following flag is a missing value, not a value.
      return next === undefined || next.startsWith('--') ? undefined : next;
    }
  }
  return undefined;
}

export function parseOptions(args: readonly string[]): Options {
  const rawName = readOption(args, 'name');
  if (rawName === undefined) throw new Error(`missing --name\n${USAGE}`);

  const name = createApiKeyRequestSchema.safeParse({ name: rawName });
  if (!name.success) {
    throw new Error(`invalid --name: ${name.error.issues[0]?.message ?? 'invalid'}\n${USAGE}`);
  }

  const hasWorkspaceFlag = args.some(
    (arg) => arg === '--workspace' || arg.startsWith('--workspace='),
  );
  const rawWorkspace = readOption(args, 'workspace');
  if (hasWorkspaceFlag && rawWorkspace === undefined) {
    throw new Error(`invalid --workspace: expected a UUID\n${USAGE}`);
  }
  const workspaceId = rawWorkspace ?? DEV_WORKSPACE_ID;
  if (!idSchema.safeParse(workspaceId).success) {
    throw new Error(`invalid --workspace: expected a UUID\n${USAGE}`);
  }

  return { name: name.data.name, workspaceId };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  loadEnv();
  const { db, pool } = createDb();
  try {
    const existing = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, options.workspaceId))
      .limit(1);
    if (existing[0] === undefined) {
      throw new Error(
        `workspace ${options.workspaceId} does not exist; run npm run db:seed first`,
      );
    }

    const created = await createApiKey(db, options);
    console.log(`created API key "${created.apiKey.name}" (${created.apiKey.prefix})`);
    console.log(created.key);
    console.log('store it now: this is the only time the key is shown');
  } finally {
    await pool.end();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
