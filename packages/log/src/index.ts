/**
 * `@facelesspro/log` — one JSON object per line (docs/10 §7).
 *
 * The logger owns formatting and redaction, not I/O: `write` and `now` are
 * injected, so a test can pin the clock and capture lines. Production callers
 * use `loggerFromEnv()`, which is the only place that reads `process.env`.
 *
 * User narration is private. Any field whose key is in `PRIVATE_KEYS` is
 * replaced with `"[redacted]"` unless the deployment sets `LOG_SCRIPTS=1`,
 * and that includes nested objects (`request.body.script`).
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = { readonly [key: string]: unknown };

export interface LogConfig {
  readonly level: LogLevel;
  readonly scripts: boolean;
  /** Append a stack trace to logged `Error` values. Off by default. */
  readonly stacks: boolean;
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger that adds `context` to every line it emits. */
  child(context: LogFields): Logger;
}

export interface LoggerOptions {
  /** `svc` on every line: `worker`, `api`, `mcp`, … */
  readonly svc: string;
  readonly config?: Partial<LogConfig>;
  readonly context?: LogFields;
  /** One line per call, without the trailing newline. Defaults to stdout. */
  readonly write?: (line: string) => void;
  /** Injected so a test can pin `ts`. */
  readonly now?: () => Date;
}

export const DEFAULT_LOG_CONFIG: LogConfig = {
  level: 'info',
  scripts: false,
  stacks: false,
};

/**
 * Keys whose values are user content. Matched case-insensitively, at any depth.
 *
 * `body` is included because the create request carries the script verbatim;
 * logging it by accident would put a whole narration in the docker log.
 */
const PRIVATE_KEYS = new Set(
  [
    'script',
    'scripts',
    'text',
    'texts',
    'narration',
    'transcript',
    'voiceover',
    'prompt',
    'body',
    'messages',
    'conversations',
  ].map((key) => key.toLowerCase()),
);

const REDACTED = '[redacted]';
const CIRCULAR = '[circular]';
const MAX_DEPTH = 6;

/**
 * Make a value JSON-safe without ever throwing.
 *
 * `JSON.stringify` throws on a bigint and on a circular reference; a logger
 * that throws while reporting a failure is worse than a missing field, so both
 * turn into a marker instead.
 */
function serialise(
  value: unknown,
  config: LogConfig,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return `${String(value)}n`;
  if (type === 'function' || type === 'symbol') return undefined;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const error: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };
    if (config.stacks && value.stack !== undefined) error.stack = value.stack;
    // `cause` is where adapters keep the provider status/body.
    if (value.cause !== undefined) {
      error.cause = serialise(value.cause, config, seen, depth + 1);
    }
    return error;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return CIRCULAR;
    if (depth >= MAX_DEPTH) return '[depth]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => serialise(item, config, seen, depth + 1));
    }

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!config.scripts && PRIVATE_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED;
        continue;
      }
      const serialised = serialise(item, config, seen, depth + 1);
      if (serialised !== undefined) out[key] = serialised;
    }
    return out;
  }

  return String(value);
}

/** Replace a private key's value unless the deployment opted in. */
function redact(key: string, value: unknown, config: LogConfig): unknown {
  if (!config.scripts && PRIVATE_KEYS.has(key.toLowerCase())) return REDACTED;
  return serialise(value, config, new WeakSet(), 0);
}

/** `LOG_LEVEL`, `LOG_SCRIPTS=1`, `LOG_STACKS=1`; an unknown level is `info`. */
export function logConfigFromEnv(
  env: { readonly [key: string]: string | undefined } = process.env,
): LogConfig {
  const level = env.LOG_LEVEL?.trim().toLowerCase();
  return {
    level: LOG_LEVELS.includes(level as LogLevel)
      ? (level as LogLevel)
      : DEFAULT_LOG_CONFIG.level,
    scripts: env.LOG_SCRIPTS === '1',
    stacks: env.LOG_STACKS === '1',
  };
}

function severity(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

export function createLogger(options: LoggerOptions): Logger {
  const config: LogConfig = { ...DEFAULT_LOG_CONFIG, ...options.config };
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const context = options.context ?? {};
  const threshold = severity(config.level);

  const emit = (level: LogLevel, event: string, fields?: LogFields): void => {
    if (severity(level) < threshold) return;

    const record: Record<string, unknown> = {
      ts: now().toISOString(),
      level,
      svc: options.svc,
      event,
    };
    for (const [key, item] of Object.entries({ ...context, ...fields })) {
      const value = redact(key, item, config);
      if (value !== undefined) record[key] = value;
    }

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      // Not expected after `serialise`, but logging must not throw.
      line = JSON.stringify({ ts: record.ts, level, svc: options.svc, event });
    }

    try {
      write(line);
    } catch {
      // A broken sink (closed pipe on shutdown) is not the caller's problem.
    }
  };

  const logger: Logger = {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (extra) =>
      createLogger({ ...options, config, context: { ...context, ...extra } }),
  };

  return logger;
}

/** The production logger for a service, configured from the environment. */
export function loggerFromEnv(
  svc: string,
  options: Omit<LoggerOptions, 'svc'> = {},
): Logger {
  return createLogger({
    ...options,
    svc,
    config: { ...logConfigFromEnv(), ...options.config },
  });
}

/** Discards everything. The default in tests and in templates. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};
