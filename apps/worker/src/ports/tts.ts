/**
 * The narration port (docs/04 §2, docs/05).
 *
 * `create-vocal` asks for a *pair* — one speaker reading both languages — and
 * then for one synthesised master with global word timings. It never names an
 * engine: edge-tts, IndicF5 and Piper are adapters behind this interface and
 * the media service is the first one.
 *
 * `audio` is bytes rather than a path on purpose. The media service writes its
 * working files under its own `MEDIA_DATA_DIR`; the pipeline owns the artifact
 * under `DATA_DIR`. Returning bytes keeps that hand-off explicit, so the step
 * never depends on where the service put its files. The current adapter reads
 * `master_mp3_path` from disk, which means the worker and service share that
 * root on one host; a remote deployment needs a download endpoint first.
 */

import type { MediaVoicePair, SynthesizeRequest } from '@facelesspro/contracts';

export type VoicePair = MediaVoicePair;

export interface TtsWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** One run, already rebased so every word is global. */
export interface TtsSegmentResult {
  index: number;
  voice: string;
  text: string;
  startMs: number;
  durationMs: number;
  words: TtsWord[];
}

export interface TtsSynthesis {
  requestId: string;
  /** Encoded master (MP3) that becomes the narration asset. */
  audio: Uint8Array;
  mime: 'audio/mpeg';
  durationMs: number;
  segments: TtsSegmentResult[];
}

export interface TtsPort {
  /**
   * Resolve `voiceId` as a pair id. A bare engine voice id is rejected by the
   * catalogue, because it cannot say which speaker was chosen (docs/05 §3.5).
   */
  resolvePair(pairId: string): Promise<VoicePair>;
  synthesize(request: SynthesizeRequest): Promise<TtsSynthesis>;
}

/**
 * A media-service failure with the retry decision already made.
 *
 * `status` is kept so the step can distinguish a bad selector (404/422, a
 * permanent user error) from a synthesizer that is down (5xx/network, worth
 * retrying).
 */
export class TtsPortError extends Error {
  override readonly name = 'TtsPortError';
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
