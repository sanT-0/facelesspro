/** Stable asset locations for render adapters. No files are read at import. */

export {
  DEFAULT_CAPTION_FONT_FAMILY,
  CAPTION_FONT_FALLBACK_FAMILY,
  BUNDLED_CAPTION_FONTS_URL,
  BUNDLED_FONTCONFIG_URL,
  BUNDLED_CAPTION_FONT_FILES,
  BUNDLED_EMOJI_FONT_FAMILY,
  bundledCaptionFontFiles,
} from './fonts';

export { renderVideo } from './render';
export type { RenderResult } from './render';
export { extractThumbnail } from './thumbnail';
export type { ThumbnailResult } from './thumbnail';
export {
  renderChatSkin,
  chatSkinSvgToPng,
  chatSkinFontOptions,
  chatSkinSeed,
  type ChatTemplate,
  type ChatRenderOptions,
  type ChatSkinFontOptions,
} from './chat-skin';
