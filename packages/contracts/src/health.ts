/**
 * `GET /health` (docs/10 §8).
 *
 * The report is deliberately flat — `curl localhost:3001/health` should be
 * readable at a glance, and parity scripts grep for `"db":"ok"`.
 *
 * `status` is *derived* from the components, not a second opinion: a report
 * that says `ok` while a component says `error` is a bug in the probe wiring,
 * so the schema refuses to represent it. `media` and `storage` join this shape
 * when those ports land (P3/P4); they are absent now rather than faked as `ok`.
 */

import { z } from 'zod';

import { isoDateTimeSchema } from './common';

export const COMPONENT_STATES = ['ok', 'error'] as const;
export const componentStateSchema = z.enum(COMPONENT_STATES);
export type ComponentState = z.infer<typeof componentStateSchema>;

export const HEALTH_STATUSES = ['ok', 'degraded'] as const;
export const healthStatusSchema = z.enum(HEALTH_STATUSES);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const healthSchema = z
  .strictObject({
    status: healthStatusSchema,
    service: z.literal('facelesspro-api'),
    version: z.string().min(1),
    time: isoDateTimeSchema,
    db: componentStateSchema,
    queue: componentStateSchema,
  })
  .superRefine((report, ctx) => {
    const allOk = report.db === 'ok' && report.queue === 'ok';
    if (allOk !== (report.status === 'ok')) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'status must be "ok" exactly when every component is "ok"',
      });
    }
  });
export type HealthReport = z.infer<typeof healthSchema>;
