/**
 * Read queries for the art-style catalog.
 *
 * The api may not import `drizzle-orm` or `pg` (eslint enforces the boundary), so
 * API-facing queries live here and are injected into routes as plain functions.
 * Rows are parsed through `artStyleRowSchema` on the way out: the route layer
 * should never meet a shape the rest of the system does not know.
 */

import { artStyleRowSchema } from '@facelesspro/contracts';
import type { ArtStyleRow } from '@facelesspro/contracts';
import { desc, eq } from 'drizzle-orm';

import type { Database } from './client';
import { artStyle } from './schema';

/** Built styles, newest first. Building/failed rows are not part of the library. */
export async function listReadyArtStyles(db: Database): Promise<ArtStyleRow[]> {
  const rows = await db
    .select()
    .from(artStyle)
    .where(eq(artStyle.status, 'ready'))
    .orderBy(desc(artStyle.created_at));

  return rows.map((row) => artStyleRowSchema.parse(row));
}

/** One style by id, whatever its status, so the route can answer 404/409. */
export async function findArtStyle(db: Database, id: string): Promise<ArtStyleRow | null> {
  const rows = await db.select().from(artStyle).where(eq(artStyle.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : artStyleRowSchema.parse(row);
}
