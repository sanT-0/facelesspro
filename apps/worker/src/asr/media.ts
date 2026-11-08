/**
 * The media-service adapter for `AsrPort` (docs/04 §1b).
 *
 * One call: `POST /transcribe` with the audio bytes as the raw body. The
 * service owns decoding and the model; this side only checks that it sent
 * something transcribable and that the answer matches the shared contract.
 *
 * Failure taxonomy mirrors the TTS adapter (network/timeout/429/5xx retryable,
 * 4xx and an unreadable 200 permanent) with one deliberate exception: the
 * service's 502 means "decoded, but no usable speech" — repeating the same
 * bytes cannot fix it, so it is permanent. A 503 stays retryable: that is the
 * engine missing or not loaded, which a deployment change can fix.
 */

import { transcribeResponseSchema } from '@facelesspro/contracts';

import { isRetryableHttpStatus } from '../planner/http';
import type {
  AsrPort,
  AsrRequest,
  AsrTranscription,
} from '../ports/asr';
import { AsrPortError } from '../ports/asr';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
/** A three-minute clip on CPU can take a while; this is the ceiling. */
const DEFAULT_TIMEOUT_MS = 600_000;
/** Only real container types; the service would 415/422 a JSON body anyway. */
const AUDIO_MIME_PATTERN = /^audio\/[a-z0-9][a-z0-9.+-]*$/iu;

export interface MediaAsrOptions {
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  /** Injected so unit tests never open a socket. */
  fetchImpl?: typeof fetch;
}

export function createMediaAsrPort(options: MediaAsrOptions = {}): AsrPort {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  return {
    async transcribe({ audio, mime }: AsrRequest): Promise<AsrTranscription> {
      if (audio.byteLength === 0) {
        throw new AsrPortError('cannot transcribe empty audio', { retryable: false });
      }
      if (!AUDIO_MIME_PATTERN.test(mime)) {
        throw new AsrPortError(`cannot transcribe mime ${mime}`, { retryable: false });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': mime },
          body: audio,
          signal: controller.signal,
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        throw new AsrPortError(
          aborted
            ? `media service timed out after ${timeoutMs} ms`
            : `media service request failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
          { retryable: true },
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // The same audio will produce the same 502; only infrastructure is
        // worth retrying.
        const retryable =
          response.status === 502
            ? false
            : isRetryableHttpStatus(response.status);
        throw new AsrPortError(
          `media service HTTP ${response.status}${describeDetail(detail)}`,
          { status: response.status, retryable },
        );
      }

      let body: unknown;
      try {
        body = (await response.json()) as unknown;
      } catch (error) {
        throw new AsrPortError(
          `media service returned unreadable JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { status: response.status, retryable: false },
        );
      }

      const parsed = transcribeResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new AsrPortError('media service returned an invalid transcript', {
          status: response.status,
          retryable: false,
        });
      }

      return {
        requestId: parsed.data.request_id,
        language: parsed.data.language,
        durationMs: parsed.data.duration_ms,
        text: parsed.data.text,
        segments: parsed.data.segments.map((segment) => ({
          text: segment.text,
          startMs: segment.start_ms,
          endMs: segment.end_ms,
          words: segment.words.map((word) => ({
            text: word.text,
            startMs: word.start_ms,
            endMs: word.end_ms,
          })),
        })),
      };
    },
  };
}

/** FastAPI puts a human message in `detail`; keep it short and single-line. */
function describeDetail(raw: string): string {
  if (raw.length === 0) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'detail' in parsed &&
      typeof parsed.detail === 'string'
    ) {
      return `: ${parsed.detail.slice(0, 200)}`;
    }
  } catch {
    // Not JSON: fall through to the raw body.
  }
  return `: ${raw.slice(0, 200)}`;
}
