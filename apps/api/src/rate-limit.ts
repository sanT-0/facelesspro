/**
 * Per-key and per-workspace request limits (docs/07 §1.2, docs/09 P6).
 *
 * Fixed one-minute windows, checked after authentication and before a route
 * runs. Two counters exist because they answer different abuse questions: one
 * leaked key should not be able to exhaust a whole workspace, and one workspace
 * should not multiply its budget by minting more keys.
 *
 * Rejected requests do **not** increment a counter: a client that keeps retrying
 * must not extend its own lockout. `Retry-After` is whole seconds remaining in
 * the window that denied the request, always at least 1.
 *
 * State is in-process. That is honest for the single-api self-host deployment;
 * a multi-process deployment needs a shared limiter before it can rely on these
 * numbers. The interface is small enough to swap without touching the middleware.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Whole seconds until the denying window ends; `0` when allowed. */
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Both counters are consulted before either is incremented. */
  check(keyId: string, workspaceId: string): RateLimitDecision;
}

export interface RateLimitOptions {
  readonly keyPerMinute: number;
  readonly workspacePerMinute: number;
  /** Milliseconds since epoch; tests inject a clock, production uses `Date.now`. */
  readonly now?: () => number;
}

/** Generous for key management and ordinary automation; raise per deployment. */
export const DEFAULT_KEY_REQUESTS_PER_MINUTE = 60;
export const DEFAULT_WORKSPACE_REQUESTS_PER_MINUTE = 300;

const WINDOW_MS = 60_000;

interface Window {
  readonly start: number;
  readonly count: number;
}

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function readEnvInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/** Env-facing defaults so operators can tune without a code change. */
export function rateLimitOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): RateLimitOptions {
  return {
    keyPerMinute: readEnvInteger(
      env,
      'RATE_LIMIT_KEY_PER_MINUTE',
      DEFAULT_KEY_REQUESTS_PER_MINUTE,
    ),
    workspacePerMinute: readEnvInteger(
      env,
      'RATE_LIMIT_WORKSPACE_PER_MINUTE',
      DEFAULT_WORKSPACE_REQUESTS_PER_MINUTE,
    ),
  };
}

function currentWindow(
  windows: Map<string, Window>,
  id: string,
  at: number,
): Window {
  const existing = windows.get(id);
  if (existing === undefined || at - existing.start >= WINDOW_MS) {
    return { start: at, count: 0 };
  }
  return existing;
}

function denied(window: Window, at: number): RateLimitDecision {
  const remainingMs = window.start + WINDOW_MS - at;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
  };
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const keyLimit = positiveInteger(options.keyPerMinute, 'keyPerMinute');
  const workspaceLimit = positiveInteger(
    options.workspacePerMinute,
    'workspacePerMinute',
  );
  const now = options.now ?? Date.now;
  const keys = new Map<string, Window>();
  const workspaces = new Map<string, Window>();

  return {
    check(keyId, workspaceId) {
      const at = now();
      const keyWindow = currentWindow(keys, keyId, at);
      const workspaceWindow = currentWindow(workspaces, workspaceId, at);

      if (keyWindow.count >= keyLimit) return denied(keyWindow, at);
      if (workspaceWindow.count >= workspaceLimit) return denied(workspaceWindow, at);

      keys.set(keyId, { start: keyWindow.start, count: keyWindow.count + 1 });
      workspaces.set(workspaceId, {
        start: workspaceWindow.start,
        count: workspaceWindow.count + 1,
      });
      return ALLOWED;
    },
  };
}
