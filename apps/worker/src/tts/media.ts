/**
 * The media-service adapter for `TtsPort` (docs/04 §2).
 *
 * Two calls: `GET /voices/:pairId` resolves the one speaker who reads both
 * languages, then `POST /synthesize` returns the stitched master plus global
 * word timings. The adapter reads the encoded master into memory and hands the
 * step bytes, so the step never depends on the service's `MEDIA_DATA_DIR`.
 *
 * Failure taxonomy mirrors the planner transport: network failure, timeout,
 * 408/425/429 and 5xx are retryable; 4xx and an unreadable 200 are permanent.
 * A malformed body is permanent because repeating the same call cannot fix it.
 */

import { readFile } from 'node:fs/promises';

import {
  mediaVoicePairSchema,
  synthesizeRequestSchema,
  synthesizeResponseSchema,
} from '@facelesspro/contracts';
import type { SynthesizeRequest } from '@facelesspro/contracts';

import { isRetryableHttpStatus } from '../planner/http';
import type { TtsPort, TtsSynthesis, VoicePair } from '../ports/tts';
import { TtsPortError } from '../ports/tts';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
/** A three-minute narration can take longer than a model call; this is the ceiling. */
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 600_000;
const DEFAULT_PAIR_TIMEOUT_MS = 30_000;

export interface MediaTtsOptions {
  baseUrl?: string | undefined;
  synthesisTimeoutMs?: number | undefined;
  pairTimeoutMs?: number | undefined;
  /** Injected so unit tests never open a socket. */
  fetchImpl?: typeof fetch;
  /** Injected so unit tests do not need a real media workspace. */
  readFileImpl?: (path: string) => Promise<Uint8Array>;
}

interface RequestOptions {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
}

export function createMediaTtsPort(options: MediaTtsOptions = {}): TtsPort {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const synthesisTimeoutMs =
    options.synthesisTimeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS;
  const pairTimeoutMs = options.pairTimeoutMs ?? DEFAULT_PAIR_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const doReadFile = options.readFileImpl ?? readFile;

  async function requestJson(request: RequestOptions): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    let response: Response;
    try {
      response = await doFetch(request.url, {
        method: request.method,
        ...(request.body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(request.body),
            }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new TtsPortError(
        aborted
          ? `media service timed out after ${request.timeoutMs} ms`
          : `media service request failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
        { retryable: true },
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new TtsPortError(
        `media service HTTP ${response.status}${describeDetail(detail)}`,
        {
          status: response.status,
          retryable: isRetryableHttpStatus(response.status),
        },
      );
    }

    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new TtsPortError(
        `media service returned unreadable JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { status: response.status, retryable: false },
      );
    }
  }

  return {
    async resolvePair(pairId: string): Promise<VoicePair> {
      if (pairId.trim().length === 0) {
        throw new TtsPortError('voice pair id is empty', { retryable: false });
      }
      const body = await requestJson({
        url: `${baseUrl}/voices/${encodeURIComponent(pairId)}`,
        method: 'GET',
        timeoutMs: pairTimeoutMs,
      });
      const parsed = mediaVoicePairSchema.safeParse(body);
      if (!parsed.success) {
        throw new TtsPortError('media service returned an invalid voice pair', {
          status: 200,
          retryable: false,
        });
      }
      return parsed.data;
    },

    async synthesize(request: SynthesizeRequest): Promise<TtsSynthesis> {
      const input = synthesizeRequestSchema.safeParse(request);
      if (!input.success) {
        throw new TtsPortError('synthesize request does not match the contract', {
          retryable: false,
        });
      }

      const body = await requestJson({
        url: `${baseUrl}/synthesize`,
        method: 'POST',
        body: input.data,
        timeoutMs: synthesisTimeoutMs,
      });
      const parsed = synthesizeResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new TtsPortError('media service returned an invalid synthesize response', {
          status: 200,
          retryable: false,
        });
      }

      let audio: Uint8Array;
      try {
        audio = new Uint8Array(await doReadFile(parsed.data.master_mp3_path));
      } catch (error) {
        throw new TtsPortError(
          `media service master is unreadable: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { retryable: false },
        );
      }
      if (audio.byteLength === 0) {
        throw new TtsPortError('media service master is empty', { retryable: false });
      }

      return {
        requestId: parsed.data.request_id,
        audio,
        mime: 'audio/mpeg',
        durationMs: parsed.data.total_duration_ms,
        segments: parsed.data.segments.map((segment) => ({
          index: segment.index,
          voice: segment.voice,
          text: segment.text,
          startMs: segment.start_ms,
          durationMs: segment.duration_ms,
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
