/**
 * `@facelesspro/queue` — the pipeline's job layer.
 *
 * The worker imports `withStep`, one `consumeStep` per queue, and `createBoss`;
 * the api imports `createBoss` + `enqueueStep`. Nothing else should talk to
 * pg-boss directly.
 */

export {
  ensureQueues,
  STEP_QUEUE_OPTIONS,
  consumeStep,
  createBoss,
  enqueueStep,
  stopBoss,
} from './boss';
export type { BossOptions, ConsumedJob, EnqueueOptions, StepHandler } from './boss';

export {
  InvalidJobError,
  jobData,
  parseJob,
  queueFor,
  stepForQueue,
} from './jobs';
export type { StepJob } from './jobs';

export {
  DEFAULT_LOCK_TTL_MS,
  StepFailure,
  nextStepOf,
  withStep,
} from './step';
export type {
  ChargeInput,
  CommitTx,
  StepBody,
  StepContext,
  StepDeps,
  StepOutcome,
  StepResult,
  StepWork,
} from './step';
