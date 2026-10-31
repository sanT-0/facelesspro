/**
 * `build-art-style` — the queue behind `POST /v1/art-styles`.
 *
 * Not a video step: no `video.step` cursor, no charge, no `job_lock` row. It is
 * its own queue because the work is a whole style build (frames → numeric →
 * vision → merge → previews), not one scene of a video.
 *
 * `singletonKey: styleId` makes a duplicate enqueue while a build is still
 * queued or active a no-op (returns `null`). Two builds would overwrite the
 * same preview keys and race the `status` update; one is enough, and the
 * `status` column is the authoritative guard for "already ready".
 *
 * Retry policy: one retry, not the two the pipeline steps use. Frame sampling
 * and previews are deterministic, so a second failure is almost certainly a
 * bad reference or a missing binary, and a third attempt only wastes ffmpeg
 * time. A failed build marks the row `failed`; the user can re-upload.
 */

import { artStyleBuildJobSchema } from '@facelesspro/contracts';
import type { ArtStyleBuildJob } from '@facelesspro/contracts';
import type PgBoss from 'pg-boss';

import { InvalidJobError } from './jobs';
import type { EnqueueOptions } from './boss';

export const ART_STYLE_QUEUE = 'build-art-style';

/**
 * 15 minutes: a 10-minute reference is sampled to at most 24 frames, each
 * decoded at 128 px, then one short VLM call and two short ffmpeg renders. The
 * ceiling is generous for a cold machine but bounded, so a hung ffmpeg cannot
 * hold the slot for an hour.
 */
export const ART_STYLE_QUEUE_OPTIONS = {
  retryLimit: 1,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
  retentionSeconds: 24 * 60 * 60,
} as const satisfies Omit<PgBoss.Queue, 'name'>;

/** Parse a job off the queue. A malformed payload is a producer bug. */
export function parseArtStyleJob(data: unknown): ArtStyleBuildJob {
  const parsed = artStyleBuildJobSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new InvalidJobError(
      `invalid ${ART_STYLE_QUEUE} job: ${issue?.path.join('.') ?? 'payload'} ${issue?.message ?? ''}`.trim(),
    );
  }
  return parsed.data;
}

export async function enqueueArtStyleBuild(
  boss: PgBoss,
  job: ArtStyleBuildJob,
  options: EnqueueOptions = {},
): Promise<string | null> {
  return boss.send(ART_STYLE_QUEUE, job, {
    ...ART_STYLE_QUEUE_OPTIONS,
    singletonKey: job.styleId,
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.startAfter === undefined ? {} : { startAfter: options.startAfter }),
  });
}
