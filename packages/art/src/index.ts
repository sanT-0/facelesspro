/** Stable asset locations for render adapters. No files are read at import. */

export const DEFAULT_CAPTION_FONT_FAMILY = 'Noto Sans Tamil';
export const CAPTION_FONT_FALLBACK_FAMILY = 'Noto Sans';

/** Resolve with `fileURLToPath` before passing to ffmpeg/fontconfig. */
export const BUNDLED_CAPTION_FONTS_URL = new URL('../fonts/ttf/', import.meta.url);
export const BUNDLED_FONTCONFIG_URL = new URL('../fonts/fonts.conf', import.meta.url);

export const BUNDLED_CAPTION_FONT_FILES = [
  'NotoSansTamil-Variable.ttf',
  'NotoSans-Variable.ttf',
] as const;
