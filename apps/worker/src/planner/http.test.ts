import { describe, expect, it, vi } from 'vitest';

import { UpstreamError, postJson } from './http';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const base = {
  url: 'https://example.test/v1/chat',
  headers: { Authorization: 'Bearer test' },
  body: { model: 'x' },
  adapter: 'groq' as const,
  timeoutMs: 1_000,
};

describe('postJson', () => {
  it('POSTs JSON with the caller headers and returns the body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    await expect(postJson({ ...base, fetchImpl })).resolves.toEqual({ ok: true });

    const [url, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock
      .calls[0]!;
    expect(url).toBe(base.url);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test',
    });
    expect(JSON.parse(String(init.body))).toEqual({ model: 'x' });
  });

  it('classifies a network failure as retryable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const error = await postJson({ ...base, fetchImpl }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(UpstreamError);
    if (!(error instanceof UpstreamError)) throw error;
    expect(error.retryable).toBe(true);
    expect(error.adapter).toBe('groq');
    expect(error.message).toContain('fetch failed');
  });

  it('classifies a timeout as retryable and names the limit', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const abort = new Error('aborted');
          abort.name = 'AbortError';
          reject(abort);
        });
      })) as unknown as typeof fetch;

    const error = await postJson({ ...base, timeoutMs: 5, fetchImpl }).catch(
      (thrown: unknown) => thrown,
    );
    if (!(error instanceof UpstreamError)) throw error;
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('timed out after 5 ms');
  });

  it('treats 429 and 5xx as retryable', async () => {
    for (const status of [429, 503]) {
      const fetchImpl = (async () =>
        new Response('slow down', { status })) as unknown as typeof fetch;
      const error = await postJson({ ...base, fetchImpl }).catch((thrown: unknown) => thrown);
      if (!(error instanceof UpstreamError)) throw error;
      expect(error.retryable, `status ${status}`).toBe(true);
      expect(error.status).toBe(status);
    }
  });

  it('treats 4xx client errors as permanent', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const fetchImpl = (async () =>
        new Response('bad request', { status })) as unknown as typeof fetch;
      const error = await postJson({ ...base, fetchImpl }).catch((thrown: unknown) => thrown);
      if (!(error instanceof UpstreamError)) throw error;
      expect(error.retryable, `status ${status}`).toBe(false);
    }
  });

  it('includes a truncated provider body in the error', async () => {
    const fetchImpl = (async () =>
      new Response('x'.repeat(500), { status: 400 })) as unknown as typeof fetch;
    const error = await postJson({ ...base, fetchImpl }).catch((thrown: unknown) => thrown);
    if (!(error instanceof UpstreamError)) throw error;
    expect(error.message).toContain('HTTP 400');
    expect(error.message.length).toBeLessThan(400);
  });

  it('treats a 200 with an unreadable body as permanent', async () => {
    const fetchImpl = (async () =>
      new Response('<html>not json</html>', { status: 200 })) as unknown as typeof fetch;
    const error = await postJson({ ...base, fetchImpl }).catch((thrown: unknown) => thrown);
    if (!(error instanceof UpstreamError)) throw error;
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('was not JSON');
  });
});
