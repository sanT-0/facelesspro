/**
 * The art-style build job — `build-art-style` on the queue.
 *
 * Deliberately separate from the video `StepJob`: an art style is not a video
 * step, has no `video.step` cursor and is not charged. Its payload is still
 * tiny and carries only what the worker cannot derive:
 *
 * - `styleId` — the row to load and later mark `ready`/`failed`;
 * - `referenceKey` — the uploaded video, as a storage key relative to
 *   `DATA_DIR` (`references/<uuid>.mp4`).
 *
 * The key is validated here because it crosses a process boundary and is later
 * joined onto a filesystem path. A key with `..`, a leading `/`, a backslash or
 * a NUL is a producer bug, not something the worker should sanitise silently.
 */

import { z } from 'zod';

import { idSchema } from './common';

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A relative storage key: POSIX separators, no empty/`.`/`..` segment, no
 * absolute paths. Matches the keys `storage/disk.ts` is allowed to resolve.
 */
export const storageKeySchema = z
  .string()
  .min(1)
  .max(512)
  .refine((key) => key.split('/').every((segment) => SEGMENT.test(segment)), {
    message: 'storage key must be relative, with plain segments (no "..", no leading "/")',
  });

export const artStyleBuildJobSchema = z.strictObject({
  styleId: idSchema,
  referenceKey: storageKeySchema,
});
export type ArtStyleBuildJob = z.infer<typeof artStyleBuildJobSchema>;
