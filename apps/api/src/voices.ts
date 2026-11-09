/**
 * `GET /v1/voices` — voice library for the authenticated workspace.
 *
 * Returns bundled voices plus workspace-specific voices from the `voice` table.
 * Responses carry ETag and Cache-Control for slow-changing library data.
 */

import { createHash } from 'node:crypto';

import { Hono } from 'hono';

import {
  voiceListSchema,
} from '@facelesspro/contracts';

import { withWorkspace } from './auth';
import type { AuthDeps, WorkspaceEnv } from './auth';

function contentEtag(json: string): string {
  return `"${createHash('sha256').update(json).digest('hex')}"`;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate === etag || candidate === `W/${etag}`);
}

export interface VoicesRouteDeps extends AuthDeps {
  /** Voices visible to a workspace, newest first. */
  readonly listVoices: (
    workspaceId: string,
  ) => Promise<Array<{
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly gender?: string;
    readonly accent?: string;
    readonly age?: string;
    readonly useCase?: string;
    readonly previewUrl?: string;
    readonly languages: readonly string[];
    readonly mixesEnglish: boolean;
    readonly engine: string;
    readonly sampleRate?: number;
    readonly wordTimings: boolean;
  }>>;
}

export function createVoicesRoutes(deps: VoicesRouteDeps): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();

  app.use('*', withWorkspace(deps));

  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId');
    const rows = await deps.listVoices(workspaceId);
    const body = voiceListSchema.parse({
      voices: rows.map((row) => ({
        id: row.id,
        name: row.name,
        ...(row.description !== undefined ? { description: row.description } : {}),
        ...(row.gender !== undefined ? { gender: row.gender } : {}),
        ...(row.accent !== undefined ? { accent: row.accent } : {}),
        ...(row.age !== undefined ? { age: row.age } : {}),
        ...(row.useCase !== undefined ? { useCase: row.useCase } : {}),
        ...(row.previewUrl !== undefined ? { previewUrl: row.previewUrl } : {}),
        languages: row.languages,
        mixesEnglish: row.mixesEnglish,
        engine: row.engine,
        ...(row.sampleRate !== undefined ? { sampleRate: row.sampleRate } : {}),
        wordTimings: row.wordTimings,
      })),
    });
    const json = JSON.stringify(body);
    const etag = contentEtag(json);

    c.header('Cache-Control', 'private, max-age=300');
    c.header('ETag', etag);
    if (etagMatches(c.req.header('If-None-Match'), etag)) {
      return c.body(null, 304);
    }
    return c.json(body, 200);
  });

  return app;
}
