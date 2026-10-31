/**
 * One HTTP call, with the failure taxonomy the chain needs.
 *
 * The only thing this module decides is *whether a retry could help*:
 *
 * - network failure, timeout, 408/425/429, 5xx → retryable
 * - 400/401/403/404/422 and a 200 with an unreadable body → permanent
 *
 * That distinction matters because a blind retry of a validation bug burns
 * provider quota and time (docs/03 §2), and the step runner later uses it to
 * decide between "retry later" and "fail the video".
 */

/** Statuses that a retry may resolve. */
const RETRYABLE_STATUS = new Set([408, 425, 429]);

/** Shared by JSON and binary provider transports so their retry policy cannot drift. */
export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status) || status >= 500;
}

export interface PostOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /**
   * Provider name, for error messages that say who failed. A plain string, not
   * `PlannerAdapter`: the style-vision chain reuses this helper and its adapter
   * ids are a different enum.
   */
  adapter: string;
  timeoutMs: number;
  /** Injected so tests never open a socket. */
  fetchImpl?: typeof fetch;
}

export class UpstreamError extends Error {
  override readonly name = 'UpstreamError';
  readonly adapter: string;
  /** HTTP status, or null when the request never completed. */
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    adapter: string,
    message: string,
    options: { status?: number | null; retryable: boolean },
  ) {
    super(`${adapter}: ${message}`);
    this.adapter = adapter;
    this.status = options.status ?? null;
    this.retryable = options.retryable;
  }
}

/** POST JSON and return the parsed body. Throws `UpstreamError` on any failure. */
export async function postJson(options: PostOptions): Promise<unknown> {
  const { url, headers, body, adapter, timeoutMs } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new UpstreamError(
      adapter,
      aborted
        ? `request timed out after ${timeoutMs} ms`
        : `request failed: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new UpstreamError(
      adapter,
      `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      {
        status: response.status,
        retryable: isRetryableHttpStatus(response.status),
      },
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new UpstreamError(
      adapter,
      `response was not JSON: ${error instanceof Error ? error.message : String(error)}`,
      { status: response.status, retryable: false },
    );
  }
}
