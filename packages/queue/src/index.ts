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
  consume,
  consumeStep,
  createBoss,
  enqueuePing,
  enqueueStep,
  stopBoss,
} from './boss';
export type {
  BossOptions,
  ConsumedJob,
  EnqueueOptions,
  JobConsumer,
  StepHandler,
} from './boss';

export {
  InvalidJobError,
  jobData,
  parseJob,
  queueFor,
  stepForQueue,
} from './jobs';
export type { StepJob } from './jobs';

export {
  ART_STYLE_QUEUE,
  ART_STYLE_QUEUE_OPTIONS,
  enqueueArtStyleBuild,
  parseArtStyleJob,
} from './art-style';

export {
  PING_QUEUE,
  PING_QUEUE_OPTIONS,
  parsePing,
  pingPayloadSchema,
} from './ping';
export type { PingPayload } from './ping';

export {
  PGBOSS_DEFAULT_SCHEMA,
  checkQueues,
  expectedQueueNames,
} from './health';
export type { CheckQueuesOptions, SqlExecutor } from './health';

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
