/**
 * Job health over a time window (docs/10 §7.1).
 *
 * This is the shape behind `npm run jobs:health`: the operator's dashboard and
 * the failure-rate alert share one report, so "the screen said degraded" and
 * "the cron job exited 1" can never disagree.
 *
 * Rates are computed only from **terminal** outcomes (`committed`, `reused`,
 * `failed`). `retryable` is reported beside them but is not a failure: pg-boss
 * is still going to try again. `stale`, `locked`, `superseded` and `missing`
 * are coordination noise and never move the rate.
 */

import { z } from 'zod';

import { isoDateTimeSchema, videoStepSchema } from './common';

export const jobStepHealthSchema = z.strictObject({
  step: videoStepSchema,
  /** Every `job_event` row in the window, whatever the outcome. */
  events: z.int().min(0),
  /** `committed` + `reused`. */
  succeeded: z.int().min(0),
  /** Terminal failures; each one left a video `status = failed`. */
  failed: z.int().min(0),
  /** Failures that were rethrown for pg-boss to retry. */
  retryable: z.int().min(0),
  /** `failed / max(1, succeeded + failed)`, rounded to four decimals. */
  failureRate: z.number().min(0).max(1),
});
export type JobStepHealth = z.infer<typeof jobStepHealthSchema>;

export const jobHealthStatusSchema = z.enum(['ok', 'degraded']);
export type JobHealthStatus = z.infer<typeof jobHealthStatusSchema>;

export const jobHealthSchema = z.strictObject({
  since: isoDateTimeSchema,
  windowMinutes: z.int().min(1),
  threshold: z.number().min(0).max(1),
  status: jobHealthStatusSchema,
  events: z.int().min(0),
  succeeded: z.int().min(0),
  failed: z.int().min(0),
  retryable: z.int().min(0),
  failureRate: z.number().min(0).max(1),
  /** Always one entry per pipeline step, in pipeline order, zeros included. */
  steps: z.array(jobStepHealthSchema),
});
export type JobHealthReport = z.infer<typeof jobHealthSchema>;

/** Documented defaults: a one-hour window and a 20 % terminal failure rate. */
export const JOB_HEALTH_WINDOW_MINUTES = 60;
export const JOB_FAILURE_THRESHOLD = 0.2;
