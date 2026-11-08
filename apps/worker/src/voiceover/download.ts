/**
 * Fetching a caller-supplied `voiceoverUrl` (docs/04 §1b).
 *
 * This is the one place the worker touches an arbitrary host, so the guardrails
 * are all here and all non-negotiable:
 *
 * - HTTPS only. A redirect is re-validated, so an https URL cannot bounce us to
 *   plaintext or to a non-audio document.
 * - The extension allow-list is `AUDIO_EXTENSIONS`; the extension also picks
 *   the mime the ASR call sends.
 * - `MAX_VOICEOVER_BYTES` is enforced twice: a declared `content-length` is
 *   rejected before the body is read, and the stream is cut mid-flight if the
 *   header lied (or was absent).
 * - Redirects are bounded and the whole operation is time-boxed.
 *
 * `fetchImpl` is injectable so the unit tests never open a socket. The fetch is
 * called with `redirect: 'manual'`: following redirects ourselves is the only
 * way to re-check each hop.
 */

import {
  AUDIO_EXTENSIONS,
  MAX_VOICEOVER_BYTES,
} from '@facelesspro/contracts';
import type { ErrorCode } from '@facelesspro/contracts';

import { isRetryableHttpStatus } from '../planner/http';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_REDIRECTS = 4;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const AUDIO_MIME: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

export type VoiceoverDownloadCode = Extract<
  ErrorCode,
  'invalid_request' | 'payload_too_large' | 'upstream_failed'
>;

/** A guardrail or upstream failure with the retry decision already made. */
export class VoiceoverDownloadError extends Error {
  override readonly name = 'VoiceoverDownloadError';
  readonly code: VoiceoverDownloadCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    message: string,
    options: {
      readonly code: VoiceoverDownloadCode;
      readonly retryable: boolean;
      readonly status?: number | null;
    },
  ) {
    super(message);
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

export interface VoiceoverDownloadOptions {
  /** Injected so unit tests never open a socket. */
  fetchImpl?: typeof fetch;
  /** Defaults to `MAX_VOICEOVER_BYTES`. */
  maxBytes?: number;
  /** Redirect hops allowed after the first request. */
  maxRedirects?: number;
  timeoutMs?: number;
}

export interface VoiceoverDownload {
  bytes: Uint8Array;
  /** Mime for the ASR call, derived from the final URL's extension. */
  mime: string;
  /** After redirects; what the extension and mime came from. */
  finalUrl: string;
}

/** Extension of a URL's pathname, lowercased; `null` when there is none. */
export function extensionOf(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const slash = pathname.lastIndexOf('/');
  const basename = pathname.slice(slash + 1);
  const dot = basename.lastIndexOf('.');
  if (dot <= 0 || dot === basename.length - 1) return null;
  return basename.slice(dot + 1).toLowerCase();
}

/** `null` for anything outside the allow-list, so the caller can refuse early. */
export function mimeForAudioExtension(extension: string): string | null {
  return Object.hasOwn(AUDIO_MIME, extension) ? AUDIO_MIME[extension] ?? null : null;
}

function isAudioExtension(extension: string | null): boolean {
  return (
    extension !== null &&
    (AUDIO_EXTENSIONS as readonly string[]).includes(extension)
  );
}

interface ValidatedUrl {
  url: URL;
  mime: string;
}

/**
 * The same check runs for the first URL and for every redirect hop, but the
 * error class differs: a bad input is the caller's fault (`invalid_request`),
 * a bad redirect is the remote host's (`upstream_failed`).
 */
function validateUrl(
  raw: string,
  failure: { code: 'invalid_request' | 'upstream_failed'; retryable: boolean },
): ValidatedUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new VoiceoverDownloadError(`voiceover URL is not a URL: ${raw}`, failure);
  }
  if (url.protocol !== 'https:') {
    throw new VoiceoverDownloadError(
      `voiceover URL must use https (got ${url.protocol})`,
      failure,
    );
  }
  const extension = extensionOf(url.toString());
  const mime = extension === null ? null : mimeForAudioExtension(extension);
  if (!isAudioExtension(extension) || mime === null) {
    throw new VoiceoverDownloadError(
      `voiceover URL must point at ${AUDIO_EXTENSIONS.join('/')} (got .${
        extension ?? 'none'
      })`,
      failure,
    );
  }
  return { url, mime };
}

function requestFailure(error: unknown, timeoutMs: number): VoiceoverDownloadError {
  const aborted = error instanceof Error && error.name === 'AbortError';
  return new VoiceoverDownloadError(
    aborted
      ? `voiceover download timed out after ${timeoutMs} ms`
      : `voiceover download failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
    { code: 'upstream_failed', retryable: true },
  );
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** Download `url` with every guardrail applied. */
export async function downloadVoiceover(
  url: string,
  options: VoiceoverDownloadOptions = {},
): Promise<VoiceoverDownload> {
  const maxBytes = options.maxBytes ?? MAX_VOICEOVER_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  let current = validateUrl(url, { code: 'invalid_request', retryable: false });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let redirects = 0; ; redirects += 1) {
      let response: Response;
      try {
        response = await doFetch(current.url, {
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        throw requestFailure(error, timeoutMs);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        await discard(response);
        if (redirects >= maxRedirects) {
          throw new VoiceoverDownloadError(
            `voiceover download exceeded ${maxRedirects} redirects`,
            { code: 'upstream_failed', retryable: false, status: response.status },
          );
        }
        if (location === null || location.length === 0) {
          throw new VoiceoverDownloadError(
            'voiceover download redirect had no Location header',
            { code: 'upstream_failed', retryable: false, status: response.status },
          );
        }
        let next: string;
        try {
          next = new URL(location, current.url).toString();
        } catch {
          throw new VoiceoverDownloadError(
            `voiceover redirect target is not a URL: ${location}`,
            { code: 'upstream_failed', retryable: false, status: response.status },
          );
        }
        // Re-validates https and the extension on every hop.
        current = validateUrl(next, { code: 'upstream_failed', retryable: false });
        continue;
      }

      if (!response.ok) {
        await discard(response);
        throw new VoiceoverDownloadError(
          `voiceover download returned HTTP ${response.status}`,
          {
            code: 'upstream_failed',
            retryable: isRetryableHttpStatus(response.status),
            status: response.status,
          },
        );
      }

      return await readCapped(response, current, maxBytes);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(
  response: Response,
  source: ValidatedUrl,
  maxBytes: number,
): Promise<VoiceoverDownload> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      // Refuse before touching the body: a hostile host can declare the lie.
      // Deliberately no `cancel()` either — that can cause a pull on some
      // undici versions, and the body must stay unread.
      throw new VoiceoverDownloadError(
        `voiceover is larger than the ${maxBytes}-byte cap (content-length ${length})`,
        { code: 'payload_too_large', retryable: false },
      );
    }
  }

  if (response.body === null) {
    throw new VoiceoverDownloadError('voiceover download returned an empty body', {
      code: 'upstream_failed',
      retryable: false,
    });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new VoiceoverDownloadError(
          `voiceover is larger than the ${maxBytes}-byte cap`,
          { code: 'payload_too_large', retryable: false },
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof VoiceoverDownloadError) throw error;
    throw requestFailure(error, DEFAULT_TIMEOUT_MS);
  }

  if (total === 0) {
    throw new VoiceoverDownloadError('voiceover download returned an empty body', {
      code: 'upstream_failed',
      retryable: false,
    });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes, mime: source.mime, finalUrl: source.url.toString() };
}
