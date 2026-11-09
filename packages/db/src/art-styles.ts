/**
 * Read queries for the art-style catalog.
 *
 * The api may not import `drizzle-orm` or `pg` (eslint enforces the boundary), so
 * API-facing queries live here and are injected into routes as plain functions.
 * Rows are parsed through `artStyleRowSchema` on the way out: the route layer
 * should never meet a shape the rest of the system does not know.
 *
 * Two lookups exist on purpose. The worker loads a style by id and then checks
 * visibility itself (`assertStyleUsable`), so an internal read stays unscoped.
 * The API only ever uses the `Visible` variants: a foreign private id must look
 * missing, not forbidden.
 */

import { artStyleRowSchema } from '@facelesspro/contracts';
import type { ArtStyleRow } from '@facelesspro/contracts';
import { and, desc, eq, or } from 'drizzle-orm';

import type { Database } from './client';
import { artStyle } from './schema';

/**
 * Published styles are global; an unpublished row is private to the workspace
 * that uploaded it.
 */
function visibleTo(workspaceId: string) {
  return or(eq(artStyle.published, true), eq(artStyle.workspace_id, workspaceId));
}

/** Ready styles visible to one workspace, newest first. */
export async function listVisibleArtStyles(
  db: Database,
  workspaceId: string,
): Promise<ArtStyleRow[]> {
  const rows = await db
    .select()
    .from(artStyle)
    .where(and(eq(artStyle.status, 'ready'), visibleTo(workspaceId)))
    .orderBy(desc(artStyle.created_at));

  return rows.map((row) => artStyleRowSchema.parse(row));
}

/** One style by id, whatever its status, for callers that check visibility. */
export async function findArtStyle(db: Database, id: string): Promise<ArtStyleRow | null> {
  const rows = await db.select().from(artStyle).where(eq(artStyle.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : artStyleRowSchema.parse(row);
}

/** One style visible to this workspace, whatever its status, for 404 vs 409. */
export async function findVisibleArtStyle(
  db: Database,
  workspaceId: string,
  id: string,
): Promise<ArtStyleRow | null> {
  const rows = await db
    .select()
    .from(artStyle)
    .where(and(eq(artStyle.id, id), visibleTo(workspaceId)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : artStyleRowSchema.parse(row);
}
