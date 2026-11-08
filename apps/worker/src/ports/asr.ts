/**
 * The speech-to-text port for voiceover intake (docs/04 §1b).
 *
 * `create-scenes` hands this port the already-downloaded audio and gets back
 * the transcript the pipeline treats as the script. Segments are the model's
 * sentence boundaries (so scene cuts land where the speaker breathes) and word
 * timings are **global** milliseconds: the pipeline adds no offsets to them,
 * exactly like the synthesize response's rebased words.
 *
 * The media service is the first adapter. Cloudflare's hosted whisper can join
 * behind the same interface without the step changing.
 */

export interface AsrWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** A sentence-level span; always carries at least one timed word. */
export interface AsrSegment {
  text: string;
  startMs: number;
  endMs: number;
  words: AsrWord[];
}

export interface AsrTranscription {
  requestId: string;
  /** ISO 639-1 code the model detected (`ta`, `en`, ...). */
  language: string;
  durationMs: number;
  /** The whole transcript; segments joined in order. */
  text: string;
  segments: AsrSegment[];
}

export interface AsrRequest {
  audio: Uint8Array;
  /** Container mime, derived from the downloaded file's extension. */
  mime: string;
}

export interface AsrPort {
  transcribe(request: AsrRequest): Promise<AsrTranscription>;
}

/**
 * A media-service failure with the retry decision already made.
 *
 * `status` is kept so the step can tell "these bytes cannot be transcribed"
 * (4xx/502) from "the engine is unavailable" (503/network, worth retrying).
 */
export class AsrPortError extends Error {
  override readonly name = 'AsrPortError';
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { readonly status?: number | null; readonly retryable: boolean },
  ) {
    super(message);
    this.status = options.status ?? null;
    this.retryable = options.retryable;
  }
}
