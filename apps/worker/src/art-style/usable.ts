/**
 * One rule for "may this workspace render with this style" (docs/04 §1).
 *
 * `create-scenes` and `create-images` both read the same `art_style` row, so the
 * visibility/status/orientation checks live here rather than being duplicated
 * and allowed to drift.
 */

import type { ArtStyleRow, Size } from '@facelesspro/contracts';
import { StepFailure } from '@facelesspro/queue';

export function assertStyleUsable(
  selected: ArtStyleRow | null,
  workspaceId: string,
  size: Size,
): asserts selected is ArtStyleRow {
  if (selected === null) {
    throw new StepFailure('not_found', 'art style does not exist');
  }
  if (!selected.published && selected.workspace_id !== workspaceId) {
    throw new StepFailure('forbidden', 'art style is not available to this workspace');
  }
  if (selected.status !== 'ready') {
    throw new StepFailure('conflict', `art style is ${selected.status}, not ready`);
  }
  if (!selected.formats.includes(size)) {
    throw new StepFailure('invalid_request', `art style does not support ${size}`);
  }
}
