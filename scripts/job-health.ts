#!/usr/bin/env node
/**
 * Job dashboard + failure-rate alert (docs/10 §7.1).
 *
 * Usage:
 *   npm run jobs:health                       # last 60 min, 20 % threshold
 *   npm run jobs:health -- 180                # window in minutes
 *   npm run jobs:health -- 60 --workspace <id>
 *   JOB_FAILURE_THRESHOLD=0.05 npm run jobs:health
 *
 * Exit codes are the alert contract:
 *   0  ok
 *   1  degraded — terminal failure rate above the threshold
 *   2  could not read the database
 *
 * Run from cron / Uptime Kuma / a compose sidecar; nothing else is needed.
 * The numbers come from the durable `job_event` table, not from log scraping.
 */

import { JOB_FAILURE_THRESHOLD, JOB_HEALTH_WINDOW_MINUTES } from '@facelesspro/contracts';
import { createDb, databaseUrl, loadEnv, summariseJobs } from '@facelesspro/db';

loadEnv();

function numberFrom(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const args = process.argv.slice(2);
const workspaceIndex = args.indexOf('--workspace');
const workspaceId =
  workspaceIndex === -1 ? undefined : args[workspaceIndex + 1]?.trim() || undefined;
const positional = args.filter(
  (arg, index) => !arg.startsWith('--') && index !== workspaceIndex + 1,
);
const windowMinutes = Math.max(
  1,
  Math.round(numberFrom(positional[0], numberFrom(process.env.JOB_HEALTH_WINDOW_MINUTES, JOB_HEALTH_WINDOW_MINUTES))),
);
const threshold = numberFrom(process.env.JOB_FAILURE_THRESHOLD, JOB_FAILURE_THRESHOLD);

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

async function main(): Promise<number> {
  const { db, pool } = createDb(databaseUrl());
  try {
    const since = new Date(Date.now() - windowMinutes * 60_000);
    const report = await summariseJobs(db, {
      since,
      windowMinutes,
      threshold,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });

    const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
    console.log(
      `job health · last ${report.windowMinutes} min · since ${report.since}` +
        (workspaceId === undefined ? '' : ` · workspace ${workspaceId}`),
    );
    console.log(
      ['step'.padEnd(16), pad('events', 7), pad('ok', 6), pad('failed', 7), pad('retry', 6), pad('rate', 7)].join(' '),
    );
    for (const step of report.steps) {
      console.log(
        [
          step.step.padEnd(16),
          pad(step.events, 7),
          pad(step.succeeded, 6),
          pad(step.failed, 7),
          pad(step.retryable, 6),
          pad(percent(step.failureRate), 7),
        ].join(' '),
      );
    }
    console.log(
      [
        'total'.padEnd(16),
        pad(report.events, 7),
        pad(report.succeeded, 6),
        pad(report.failed, 7),
        pad(report.retryable, 6),
        pad(percent(report.failureRate), 7),
      ].join(' '),
    );
    console.log(
      `\nstatus: ${report.status.toUpperCase()} (threshold ${percent(report.threshold)} terminal failure rate)`,
    );

    if (report.status === 'degraded') {
      console.error(
        `ALERT: ${report.failed} of ${report.succeeded + report.failed} terminal jobs failed in the last ${report.windowMinutes} min`,
      );
      return 1;
    }
    return 0;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error('[jobs:health] could not read job telemetry:', error);
    process.exit(2);
  });
