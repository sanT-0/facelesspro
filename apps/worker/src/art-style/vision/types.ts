/**
 * Shared vision-adapter plumbing.
 *
 * `VisionFrame.data` is base64 without a data-URL prefix: Cloudflare wants the
 * raw string in `image[]`, Gemini wants it in `inline_data.data`. MIME type is
 * fixed to JPEG by `frames.ts`, but is carried so the Gemini body does not
 * hard-code it.
 */

export interface VisionFrame {
  /** Original sampled frame, for diagnostics only. */
  path: string;
  mimeType: 'image/jpeg';
  /** Base64 bytes, no `data:` prefix. */
  data: string;
}

/** Injected by tests so adapters never shell out to ffmpeg. */
export type LoadVisionFrames = (paths: readonly string[]) => Promise<VisionFrame[]>;
