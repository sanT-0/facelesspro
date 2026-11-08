/** Database boundary for the public built-in caption-template library. */

import {
  captionTemplateRowSchema,
  type CaptionTemplateRow,
} from '@facelesspro/contracts';
import { desc, eq, isNull } from 'drizzle-orm';

import type { Database } from './client';
import { captionTemplate } from './schema';

/** Built-ins only (`workspace_id IS NULL`), in their stable -1, -2, ... order. */
export async function listBuiltInCaptionTemplates(
  db: Database,
): Promise<CaptionTemplateRow[]> {
  const rows = await db
    .select()
    .from(captionTemplate)
    .where(isNull(captionTemplate.workspace_id))
    .orderBy(desc(captionTemplate.id));

  return rows.map((row) => captionTemplateRowSchema.parse(row));
}

/** One built-in or workspace template by its stable non-zero id. */
export async function findCaptionTemplate(
  db: Database,
  id: number,
): Promise<CaptionTemplateRow | null> {
  const rows = await db
    .select()
    .from(captionTemplate)
    .where(eq(captionTemplate.id, id))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : captionTemplateRowSchema.parse(row);
}
