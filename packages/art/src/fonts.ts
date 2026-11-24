/**
 * Bundled font locations shared by the render adapters.
 *
 * Constants only: nothing here reads a file at import, so this module is safe
 * to pull into any process. Callers that need real paths call
 * `bundledCaptionFontFiles()`.
 */

import { fileURLToPath } from 'node:url';

export const DEFAULT_CAPTION_FONT_FAMILY = 'Noto Sans Tamil';
export const CAPTION_FONT_FALLBACK_FAMILY = 'Noto Sans';

/** Resolve with `fileURLToPath` before passing to ffmpeg/fontconfig. */
export const BUNDLED_CAPTION_FONTS_URL = new URL('../fonts/ttf/', import.meta.url);
export const BUNDLED_FONTCONFIG_URL = new URL('../fonts/fonts.conf', import.meta.url);

export const BUNDLED_CAPTION_FONT_FILES = [
  'NotoSansTamil-Variable.ttf',
  'NotoSans-Variable.ttf',
  'NotoEmoji-Variable.ttf',
] as const;

/** Rendered only for `Cue.emoji`; the ASS writer names it inline. */
export const BUNDLED_EMOJI_FONT_FAMILY = 'Noto Emoji';

/** Absolute paths to the bundled TTFs, in the order they are declared. */
export function bundledCaptionFontFiles(): string[] {
  return BUNDLED_CAPTION_FONT_FILES.map((file) => fileURLToPath(new URL(file, BUNDLED_CAPTION_FONTS_URL)));
}
