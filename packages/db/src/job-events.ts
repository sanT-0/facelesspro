/**
 * Job telemetry reads (docs/04 §9, docs/10 §7.1).
 *
 * `buildJobHealthReport` is pure: it turns grouped `job_event` counts into the
 * documented report, so the dashboard's arithmetic is testable without a
 * database. `summariseJobs` is the grouped query that feeds it.
 */

import { and, eq, gte, sql } from 'drizzle-orm';

import {
  JOB_FAILURE_THRESHOLD,
  VIDEO_STEPS,
  jobHealthSchema,
} from '@facelesspro/contracts';
import type {
  JobHealthReport,
  JobStepHealth,
  JobEventOutcome,
  VideoStep,
} from '@facelesspro/contracts';

import type { Database } from './client';
import { jobEvent, video } from './schema';

export interface JobEventCount {
  readonly step: VideoStep;
  readonly outcome: JobEventOutcome;
  readonly count: number;
}

export interface BuildJobHealthInput {
  readonly since: Date;
  readonly windowMinutes: number;
  /** Rate above which the report is `degraded`. */
  readonly threshold?: number;
  readonly counts: readonly JobEventCount[];
}

/** Four decimals is enough to compare and round-trip through JSON. */
function rate(failed: number, succeeded: number): number {
  const considered = failed + succeeded;
  if (considered === 0) return 0;
  return Math.round((failed / considered) * 10_000) / 10_000;
}

function emptyStep(step: VideoStep): {
  step: VideoStep;
  events: number;
  succeeded: number;
  failed: number;
  retryable: number;
} {
  return { step, events: 0, succeeded: 0, failed: 0, retryable: 0 };
}

/**
 * Fold raw counts into one report.
 *
 * Every step appears, in pipeline order, even with no events: a dashboard that
 * silently drops a step looks like the step is fine.
 */
export function buildJobHealthReport(input: BuildJobHealthInput): JobHealthReport {
  const threshold = input.threshold ?? JOB_FAILURE_THRESHOLD;
  const byStep = new Map<VideoStep, ReturnType<typeof emptyStep>>();
  for (const step of VIDEO_STEPS) byStep.set(step, emptyStep(step));

  for (const row of input.counts) {
    const entry = byStep.get(row.step);
    // An outcome for a step this build does not know about is ignored rather
    // than thrown on: telemetry must never break the report.
    if (entry === undefined || row.count <= 0) continue;

    entry.events += row.count;
    if (row.outcome === 'committed' || row.outcome === 'reused') entry.succeeded += row.count;
    else if (row.outcome === 'failed') entry.failed += row.count;
    else if (row.outcome === 'retryable') entry.retryable += row.count;
  }

  const steps: JobStepHealth[] = VIDEO_STEPS.map((step) => {
    const entry = byStep.get(step) ?? emptyStep(step);
    return {
      step: entry.step,
      events: entry.events,
      succeeded: entry.succeeded,
      failed: entry.failed,
      retryable: entry.retryable,
      failureRate: rate(entry.failed, entry.succeeded),
    };
  });

  const total = steps.reduce(
    (sum, step) => ({
      events: sum.events + step.events,
      succeeded: sum.succeeded + step.succeeded,
      failed: sum.failed + step.failed,
      retryable: sum.retryable + step.retryable,
    }),
    { events: 0, succeeded: 0, failed: 0, retryable: 0 },
  );
  const failureRate = rate(total.failed, total.succeeded);

  return jobHealthSchema.parse({
    since: input.since.toISOString(),
    windowMinutes: input.windowMinutes,
    threshold,
    status: failureRate > threshold ? 'degraded' : 'ok',
    ...total,
    failureRate,
    steps,
  });
}

export interface SummariseJobsOptions {
  /** Events at or after this instant. */
  readonly since: Date;
  readonly windowMinutes: number;
  readonly threshold?: number;
  /** Restrict to one workspace's videos. Omit for the whole install. */
  readonly workspaceId?: string;
}

/**
 * Group `job_event` rows in the window and build the report.
 *
 * The join to `video` exists only for workspace scoping; `job_event` has no
 * workspace column of its own because a video owns its events.
 */
export async function summariseJobs(
  db: Database,
  options: SummariseJobsOptions,
): Promise<JobHealthReport> {
  const window = gte(jobEvent.created_at, options.since.toISOString());
  const rows = await db
    .select({
      step: jobEvent.step,
      outcome: jobEvent.outcome,
      count: sql<number>`count(*)::int`,
    })
    .from(jobEvent)
    .innerJoin(video, eq(video.id, jobEvent.video_id))
    .where(
      options.workspaceId === undefined
        ? window
        : and(window, eq(video.workspace_id, options.workspaceId)),
    )
    .groupBy(jobEvent.step, jobEvent.outcome);

  return buildJobHealthReport({
    since: options.since,
    windowMinutes: options.windowMinutes,
    ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
    counts: rows,
  });
}
