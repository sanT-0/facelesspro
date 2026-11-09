/**
 * `npm run e2e:auth` — the P6 workspace-scoping artifact check, made repeatable.
 *
 * Needs a running api and a bootstrap key for the workspace that will make the
 * calls:
 *
 *   npm run dev:api
 *   npm run key:create -- --name "local smoke"     # prints vp_...
 *   FACELESS_API_KEY=vp_... npm run e2e:auth
 *
 * The script creates a stranger workspace, one video in each workspace, a
 * private art style in the stranger workspace, and a throwaway key. It then
 * proves through HTTP that every existing `/v1` router requires a key, that the
 * owner can read its own video, that the stranger's key gets `404` (not `403`)
 * for it, and that a revoked key is `401` on a non-key route.
 *
 * It never prints a secret. Everything it creates is removed in `finally`.
 */

import { randomUUID } from 'node:crypto';

import {
  apiKey,
  artStyle,
  authenticateApiKey,
  createApiKey,
  createDb,
  loadEnv,
  video,
  workspace,
} from '@facelesspro/db';
import { createAiVideoV3RequestSchema } from '@facelesspro/contracts';
import { eq } from 'drizzle-orm';

loadEnv();

const base = (
  process.env.PUBLIC_BASE_URL?.trim() || 'http://127.0.0.1:3001'
).replace(/\/+$/, '');
const token = process.env.FACELESS_API_KEY?.trim();

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Probe {
  readonly step: string;
  readonly status: number;
  readonly code: string | null;
  readonly wwwAuthenticate: string | null;
}

async function probe(
  step: string,
  path: string,
  init: RequestInit = {},
  bearer?: string,
): Promise<Probe> {
  const headers = new Headers(init.headers);
  if (bearer !== undefined) headers.set('authorization', `Bearer ${bearer}`);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const text = await response.text();
  let code: string | null = null;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string } };
    code = parsed.error?.code ?? null;
  } catch {
    // A success body is not JSON with an `error` field; that is expected.
  }
  return {
    step,
    status: response.status,
    code,
    wwwAuthenticate: response.headers.get('www-authenticate'),
  };
}

function assertProbe(
  probeResult: Probe,
  status: number,
  code: string | null,
): void {
  expect(
    probeResult.status === status,
    `${probeResult.step}: expected ${status}, got ${probeResult.status}`,
  );
  expect(
    probeResult.code === code,
    `${probeResult.step}: expected code ${code}, got ${probeResult.code}`,
  );
}

async function main(): Promise<void> {
  if (token === undefined || token.length === 0) {
    throw new Error(
      'FACELESS_API_KEY is required; mint one with npm run key:create -- --name "local smoke"',
    );
  }

  const { db, pool } = createDb();
  let ownerWorkspaceId: string | null = null;
  let strangerWorkspaceId: string | null = null;
  let ownerVideoId: string | null = null;
  let strangerVideoId: string | null = null;
  let strangerStyleId: string | null = null;
  let throwawayKeyId: string | null = null;

  try {
    const owner = await authenticateApiKey(db, token);
    expect(owner !== null, 'FACELESS_API_KEY does not authenticate');
    ownerWorkspaceId = owner.workspace_id;

    const strangerRows = await db
      .insert(workspace)
      .values({ name: `e2e-auth-${randomUUID()}`, credits: null })
      .returning({ id: workspace.id });
    strangerWorkspaceId = strangerRows[0]!.id;

    const body = createAiVideoV3RequestSchema.parse({
      artStyleId: '33333333-3333-4333-8333-333333333333',
      script: 'வணக்கம் நண்பர்களே. Scoping check.',
      captions: true,
    });

    const videos = await db
      .insert(video)
      .values([
        {
          workspace_id: ownerWorkspaceId,
          kind: 'ai-video-v3',
          status: 'processing',
          step: 'create-scenes',
          request: { kind: 'ai-video-v3', body },
        },
        {
          workspace_id: strangerWorkspaceId,
          kind: 'ai-video-v3',
          status: 'processing',
          step: 'create-scenes',
          request: { kind: 'ai-video-v3', body },
        },
      ])
      .returning({ id: video.id, workspace_id: video.workspace_id });
    ownerVideoId = videos.find((row) => row.workspace_id === ownerWorkspaceId)!.id;
    strangerVideoId = videos.find(
      (row) => row.workspace_id === strangerWorkspaceId,
    )!.id;

    const styles = await db
      .insert(artStyle)
      .values({
        workspace_id: strangerWorkspaceId,
        name: `e2e-private-${randomUUID()}`,
        published: false,
        formats: ['landscape'],
        profile: {},
        preview_url: 'e2e/preview.png',
        status: 'ready',
      })
      .returning({ id: artStyle.id });
    strangerStyleId = styles[0]!.id;

    const strangerKey = await createApiKey(db, {
      workspaceId: strangerWorkspaceId,
      name: `e2e-stranger-${randomUUID()}`,
    });
    const throwaway = await createApiKey(db, {
      workspaceId: ownerWorkspaceId,
      name: `e2e-revoke-${randomUUID()}`,
    });
    throwawayKeyId = throwaway.apiKey.id;

    const planBody = JSON.stringify({ script: 'வணக்கம். Plan check.' });
    const checks: Probe[] = [];

    checks.push(
      await probe('video without a key', `/v1/videos/${ownerVideoId}`),
    );
    checks.push(
      await probe('video with the owner key', `/v1/videos/${ownerVideoId}`, {}, token),
    );
    checks.push(
      await probe(
        'owner video with the stranger key',
        `/v1/videos/${ownerVideoId}`,
        {},
        strangerKey.key,
      ),
    );
    checks.push(
      await probe('plan without a key', '/v1/videos/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: planBody,
      }),
    );
    checks.push(
      await probe(
        'plan with the owner key',
        '/v1/videos/plan',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: planBody,
        },
        token,
      ),
    );
    checks.push(
      await probe('caption templates without a key', '/v1/caption-templates'),
    );
    checks.push(
      await probe('caption templates with the owner key', '/v1/caption-templates', {}, token),
    );
    checks.push(await probe('art styles without a key', '/v1/art-styles'));
    checks.push(
      await probe('art styles with the owner key', '/v1/art-styles', {}, token),
    );
    checks.push(
      await probe(
        'stranger private style export with the owner key',
        `/v1/art-styles/${strangerStyleId}/export`,
        {},
        token,
      ),
    );

    const revoke = await probe(
      'revoke a throwaway key',
      `/v1/keys/${throwawayKeyId}`,
      { method: 'DELETE' },
      token,
    );
    expect(revoke.status === 200, `revoke returned ${revoke.status}`);
    checks.push(
      await probe(
        'video with the revoked key',
        `/v1/videos/${ownerVideoId}`,
        {},
        throwaway.key,
      ),
    );

    const expectations: Array<[number, number, string, string | null]> = [
      [0, 401, 'unauthorized', 'Bearer'],
      [1, 200, null, null],
      [2, 404, 'not_found', null],
      [3, 401, 'unauthorized', 'Bearer'],
      [4, 200, null, null],
      [5, 401, 'unauthorized', 'Bearer'],
      [6, 200, null, null],
      [7, 401, 'unauthorized', 'Bearer'],
      [8, 200, null, null],
      [9, 404, 'not_found', null],
      [10, 401, 'unauthorized', 'Bearer'],
    ];
    for (const [index, status, code, wwwAuthenticate] of expectations) {
      const check = checks[index]!;
      assertProbe(check, status, code);
      if (wwwAuthenticate !== null) {
        expect(
          check.wwwAuthenticate === wwwAuthenticate,
          `${check.step}: expected WWW-Authenticate ${wwwAuthenticate}`,
        );
      }
    }

    const summary = {
      base,
      workspaceScoped: true,
      checks: checks.map((check) => ({
        step: check.step,
        status: check.status,
        code: check.code,
        ...(check.wwwAuthenticate === null
          ? {}
          : { wwwAuthenticate: check.wwwAuthenticate }),
      })),
      allPassed: true,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (ownerVideoId !== null) {
      await db.delete(video).where(eq(video.id, ownerVideoId));
    }
    if (strangerVideoId !== null) {
      await db.delete(video).where(eq(video.id, strangerVideoId));
    }
    if (strangerStyleId !== null) {
      await db.delete(artStyle).where(eq(artStyle.id, strangerStyleId));
    }
    if (throwawayKeyId !== null) {
      await db.delete(apiKey).where(eq(apiKey.id, throwawayKeyId));
    }
    if (strangerWorkspaceId !== null) {
      await db.delete(workspace).where(eq(workspace.id, strangerWorkspaceId));
    }
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
