/**
 * Job payloads.
 *
 * One queue per pipeline step, named exactly after the step id. Queue names are
 * therefore part of the same public vocabulary as `video.step`: renaming one
 * would strand in-flight jobs, so the names come from the contract tuple rather
 * than from string literals scattered across the worker.
 *
 * The payload is deliberately tiny — `{ videoId }`. Everything else the step
 * needs is in `video.request`, which was normalised at intake. A fat payload
 * would be a second, silently diverging copy of the request.
 */

import { idSchema, videoStepSchema } from '@facelesspro/contracts';
import type { VideoStep } from '@facelesspro/contracts';

export interface StepJob {
  readonly videoId: string;
  readonly step: VideoStep;
}

export class InvalidJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobError';
  }
}

/** Queue name for a step. The identity is intentional, not an accident. */
export function queueFor(step: VideoStep): string {
  return step;
}

export function stepForQueue(queue: string): VideoStep {
  const parsed = videoStepSchema.safeParse(queue);
  if (!parsed.success) throw new InvalidJobError(`unknown queue "${queue}"`);
  return parsed.data;
}

export function jobData(job: StepJob): { videoId: string } {
  return { videoId: job.videoId };
}

/**
 * Validate a job that came off a queue. A malformed payload means the producer
 * and the consumer disagree, which is a bug to surface, never to guess around.
 */
export function parseJob(queue: string, data: unknown): StepJob {
  const step = stepForQueue(queue);

  if (typeof data !== 'object' || data === null) {
    throw new InvalidJobError(`job on "${queue}" has no payload object`);
  }

  const videoId = idSchema.safeParse((data as { videoId?: unknown }).videoId);
  if (!videoId.success) {
    throw new InvalidJobError(`job on "${queue}" has no valid videoId`);
  }

  return { videoId: videoId.data, step };
}
