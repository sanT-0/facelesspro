/** Database boundary for the public built-in caption-template library. */

import {
  captionTemplateRowSchema,
  type CaptionTemplateRow,
} from '@facelesspro/contracts';
import { desc, isNull } from 'drizzle-orm';

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
