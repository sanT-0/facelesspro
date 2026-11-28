/**
 * Which queues a worker process consumes.
 *
 * The compose stack splits the pipeline across two consumers, and
 * `RENDER_SERVICE` is the switch:
 *
 *   unset / anything else → every step + webhooks (single-process dev)
 *   `worker`              → pipeline steps + webhooks, never `render`
 *   `render` / `true` / `1` → the `render` step only
 *
 * This used to be ignored, so the "dedicated" render container consumed all
 * five step queues and webhook delivery too; two consumers raced for every job
 * and every webhook was delivered twice.
 */
export type ServiceRole = 'all' | 'worker' | 'render';

export function serviceRole(raw: string | undefined): ServiceRole {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'render' || value === 'true' || value === '1') return 'render';
  if (value === 'worker') return 'worker';
  return 'all';
}
