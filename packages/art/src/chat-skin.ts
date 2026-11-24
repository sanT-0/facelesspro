/**
 * Chat skin renderer — renders chat interfaces as SVG for fake-text videos.
 *
 * Nine templates are supported:
 * - iphone, iphone-dark
 * - whatsapp, whatsapp-dark
 * - instagram, instagram-dark
 * - tinder, tinder-dark
 * - cantina
 *
 * Each template defines its own visual style (bubble colors, fonts, layout).
 * The renderer produces SVG which is then converted to PNG via resvg.
 */

import { Resvg } from '@resvg/resvg-js';

import {
  CAPTION_FONT_FALLBACK_FAMILY,
  DEFAULT_CAPTION_FONT_FAMILY,
  bundledCaptionFontFiles,
} from './fonts';
import { measureText, textToPath } from './text-path';

/**
 * Template metrics are authored for a 375 px-wide phone. A larger request is
 * the same layout scaled up through the SVG `viewBox`, so text never has to be
 * sized per caller.
 */
const BASE_WIDTH = 375;
const DEFAULT_HEIGHT = 667;

export type ChatTemplate =
  | 'iphone'
  | 'iphone-dark'
  | 'whatsapp'
  | 'whatsapp-dark'
  | 'instagram'
  | 'instagram-dark'
  | 'tinder'
  | 'tinder-dark'
  | 'cantina';

export interface ChatMessage {
  text: string;
  side?: 'left' | 'right';
  name?: string;
  /** Speaker id; when `side`/`name` are absent they are resolved from here. */
  characterId?: string;
  time?: string;
}

export interface ChatCharacter {
  id: string;
  name: string;
  side: 'left' | 'right';
}

export interface ChatRenderOptions {
  template: ChatTemplate;
  characters: readonly ChatCharacter[];
  messages: readonly ChatMessage[];
  groupName?: string;
  groupPhoto?: string;
  tinderMatch?: boolean;
  width?: number;
  height?: number;
}

interface TemplateStyle {
  background: string;
  bubbleLeft: { bg: string; text: string; tail: 'left' | 'right' };
  bubbleRight: { bg: string; text: string; tail: 'left' | 'right' };
  fontFamily: string;
  fontSize: number;
  nameColor?: string;
  timeColor?: string;
  headerBackground?: string;
  headerTextColor?: string;
  statusBarColor?: string;
  messageSpacing: number;
  bubbleRadius: number;
  bubblePadding: { horizontal: number; vertical: number };
  maxBubbleWidth: number;
  showAvatar: boolean;
  avatarSize: number;
  groupHeader?: boolean;
}

/** Template styles — each defines the complete visual language for a chat skin. */
const TEMPLATE_STYLES: Record<string, TemplateStyle> = {
  'iphone': {
    background: '#F0F0F0',
    bubbleLeft: { bg: '#FFFFFF', text: '#000000', tail: 'left' },
    bubbleRight: { bg: '#007AFF', text: '#FFFFFF', tail: 'right' },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    fontSize: 16,
    nameColor: '#8E8E93',
    timeColor: '#8E8E93',
    headerBackground: '#F7F7F8',
    headerTextColor: '#000000',
    statusBarColor: '#000000',
    messageSpacing: 8,
    bubbleRadius: 18,
    bubblePadding: { horizontal: 16, vertical: 10 },
    maxBubbleWidth: 280,
    showAvatar: false,
    avatarSize: 0,
  },
  'iphone-dark': {
    background: '#1C1C1E',
    bubbleLeft: { bg: '#2C2C2E', text: '#FFFFFF', tail: 'left' },
    bubbleRight: { bg: '#007AFF', text: '#FFFFFF', tail: 'right' },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    fontSize: 16,
    nameColor: '#8E8E93',
    timeColor: '#8E8E93',
    headerBackground: '#1C1C1E',
    headerTextColor: '#FFFFFF',
    statusBarColor: '#000000',
    messageSpacing: 8,
    bubbleRadius: 18,
    bubblePadding: { horizontal: 16, vertical: 10 },
    maxBubbleWidth: 280,
    showAvatar: false,
    avatarSize: 0,
  },
  'whatsapp': {
    background: '#E5DDD5',
    bubbleLeft: { bg: '#FFFFFF', text: '#000000', tail: 'left' },
    bubbleRight: { bg: '#DCF8C6', text: '#000000', tail: 'right' },
    fontFamily: 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
    fontSize: 15,
    nameColor: '#5E5E5E',
    timeColor: '#8E8E93',
    headerBackground: '#075E54',
    headerTextColor: '#FFFFFF',
    statusBarColor: '#000000',
    messageSpacing: 4,
    bubbleRadius: 12,
    bubblePadding: { horizontal: 12, vertical: 8 },
    maxBubbleWidth: 280,
    showAvatar: false,
    avatarSize: 0,
  },
  'whatsapp-dark': {
    background: '#111B1F',
    bubbleLeft: { bg: '#1F2C34', text: '#E9EDEF', tail: 'left' },
    bubbleRight: { bg: '#005C4B', text: '#E9EDEF', tail: 'right' },
    fontFamily: 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
    fontSize: 15,
    nameColor: '#8696A0',
    timeColor: '#8696A0',
    headerBackground: '#1F2C34',
    headerTextColor: '#E9EDEF',
    statusBarColor: '#000000',
    messageSpacing: 4,
    bubbleRadius: 12,
    bubblePadding: { horizontal: 12, vertical: 8 },
    maxBubbleWidth: 280,
    showAvatar: false,
    avatarSize: 0,
  },
  'instagram': {
    background: '#FFFFFF',
    bubbleLeft: { bg: '#F0F0F0', text: '#000000', tail: 'left' },
    bubbleRight: { bg: '#0095F6', text: '#FFFFFF', tail: 'right' },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: 15,
    nameColor: '#8E8E93',
    timeColor: '#8E8E93',
    headerBackground: '#FFFFFF',
    headerTextColor: '#000000',
    statusBarColor: '#000000',
    messageSpacing: 6,
    bubbleRadius: 18,
    bubblePadding: { horizontal: 14, vertical: 10 },
    maxBubbleWidth: 280,
    showAvatar: true,
    avatarSize: 28,
  },
  'instagram-dark': {
    background: '#121212',
    bubbleLeft: { bg: '#262626', text: '#FFFFFF', tail: 'left' },
    bubbleRight: { bg: '#0095F6', text: '#FFFFFF', tail: 'right' },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: 15,
    nameColor: '#8E8E93',
    timeColor: '#8E8E93',
    headerBackground: '#1E1E1E',
    headerTextColor: '#FFFFFF',
    statusBarColor: '#000000',
    messageSpacing: 6,
    bubbleRadius: 18,
    bubblePadding: { horizontal: 14, vertical: 10 },
    maxBubbleWidth: 280,
    showAvatar: true,
    avatarSize: 28,
  },
  'tinder': {
    background: '#FFFFFF',
    bubbleLeft: { bg: '#F7F7F7', text: '#000000', tail: 'left' },
    bubbleRight: { bg: '#FF4A4A', text: '#FFFFFF', tail: 'right' },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: 15,
    nameColor: '#8E8E93',
    timeColor: '#8E8E93',
    headerBackground: '#FFFFFF',
    headerTextColor: '#000000',
    statusBarColor: '#000000',
    messageSpacing: 6,
    bubbleRadius: 20,
    bubblePadding: { horizontal: 14, vertical: 10 },
    maxBubbleWidth: 280,
    showAvatar: true,
    avatarSize: 32,
    groupHeader: true,
  },
  'tinder-dark': {
    background: '#1A1A1A',
    bubbleLeft: { bg: '#2D2D2D', text: '#FFFFFF', tail: 'left' },
    bubbleRight: { bg: '#FF4A4A', text: '#FFFFFF', tail: 'right' },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: 15,
    nameColor: '#8E8E93',
    timeColor: '#8E8E93',
    headerBackground: '#1A1A1A',
    headerTextColor: '#FFFFFF',
    statusBarColor: '#000000',
    messageSpacing: 6,
    bubbleRadius: 20,
    bubblePadding: { horizontal: 14, vertical: 10 },
    maxBubbleWidth: 280,
    showAvatar: true,
    avatarSize: 32,
    groupHeader: true,
  },
  'cantina': {
    background: '#0F0F0F',
    bubbleLeft: { bg: '#1A1A1A', text: '#FFFFFF', tail: 'left' },
    bubbleRight: { bg: '#FF6B35', text: '#FFFFFF', tail: 'right' },
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
    nameColor: '#888888',
    timeColor: '#666666',
    headerBackground: '#0F0F0F',
    headerTextColor: '#FFFFFF',
    statusBarColor: '#000000',
    messageSpacing: 10,
    bubbleRadius: 16,
    bubblePadding: { horizontal: 12, vertical: 8 },
    maxBubbleWidth: 300,
    showAvatar: true,
    avatarSize: 36,
  },
};

/** Wrap text to fit within maxWidth at given font size. */
function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (measureText(testLine, fontSize) > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/** Render a single message bubble as SVG. */
function renderBubble(
  message: { text: string; side: 'left' | 'right'; name?: string },
  style: TemplateStyle,
  isRight: boolean,
  y: number,
  canvasWidth: number,
  characterName?: string
): { svg: string; height: number } {
  const bubbleStyle = isRight ? style.bubbleRight : style.bubbleLeft;
  const paddingX = style.bubblePadding.horizontal;
  const maxTextWidth = style.maxBubbleWidth - paddingX * 2;
  const lines = wrapText(message.text, maxTextWidth, style.fontSize);
  const lineHeight = style.fontSize * 1.3;
  const textWidth = Math.max(0, ...lines.map((line) => measureText(line, style.fontSize)));
  const bubbleWidth = Math.min(style.maxBubbleWidth, textWidth + paddingX * 2);
  const bubbleHeight = lines.length * (style.fontSize * 1.3) + style.bubblePadding.vertical * 2;
  const nameHeight = characterName && !isRight ? 20 : 0;
  const totalHeight = bubbleHeight + nameHeight + (isRight ? 0 : 4);
  // Right-side bubbles hug the right margin; the old code placed them relative
  // to `maxBubbleWidth`, which left every "right" bubble in the middle.
  const x = isRight ? canvasWidth - bubbleWidth - 20 : 20;
  const bubbleX = x;
  const bubbleY = y + (characterName && !isRight ? 20 : 0);

  let svg = '';

  // Name label (for left bubbles with character name)
  if (characterName && !isRight) {
    svg += textToPath(characterName, {
      x: x + paddingX,
      y: y + 14,
      fontSize: 11,
      fill: style.nameColor || '#8E8E93',
    }).svg;
  }

  // Bubble background
  svg += `<rect x="${x}" y="${y + (characterName && !isRight ? 20 : 0)}" ` +
    `width="${bubbleWidth}" height="${bubbleHeight}" ` +
    `rx="${style.bubbleRadius}" ry="${style.bubbleRadius}" ` +
    `fill="${bubbleStyle.bg}"/>`;

  // Tail (simple triangle)
  const tailX = isRight ? x + bubbleWidth : x;
  const tailY = y + (characterName && !isRight ? 20 : 0) + style.bubbleRadius + 4;
  const tailPoints = isRight
    ? `${tailX},${tailY} ${tailX + 12},${tailY + 8} ${tailX},${tailY + 16}`
    : `${tailX},${tailY} ${tailX - 12},${tailY + 8} ${tailX},${tailY + 16}`;
  svg += `<polygon points="${tailPoints}" fill="${bubbleStyle.bg}"/>`;

  // Text lines
  lines.forEach((line, i) => {
    const textX = bubbleX + paddingX;
    const textY = bubbleY + style.bubblePadding.vertical + i * lineHeight + style.fontSize * 0.8;
    svg += textToPath(line, { x: textX, y: textY, fontSize: style.fontSize, fill: bubbleStyle.text }).svg;
  });

  return { svg, height: totalHeight };
}

/** Render the header bar. */
function renderHeader(style: TemplateStyle, options: { template: string; messages: readonly { name?: string; side: 'left' | 'right' }[]; groupName?: string; groupPhoto?: string }, width: number): { svg: string; height: number } {
  const height = 60;
  let svg = `<rect x="0" y="0" width="${width}" height="${height}" fill="${style.headerBackground || style.background}"/>`;
  // Status bar area
  svg += `<rect x="0" y="0" width="${width}" height="24" fill="${style.statusBarColor || style.headerBackground || style.background}"/>`;

  if (style.groupHeader && options.messages[0]?.name) {
    // Group chat header
    const avatarSize = style.avatarSize || 36;
    const avatarX = 16;
    const avatarY = 12;
    const avatarBg = '#FF6B35'; // Default
    svg += `<circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2}" fill="${avatarBg}"/>`;
    svg += textToPath(options.messages[0]?.name || 'Group', {
      x: avatarX + avatarSize + 12,
      y: avatarY + avatarSize / 2 + 5,
      fontSize: 17,
      weight: 600,
      fill: style.headerTextColor || '#000',
    }).svg;
  } else if (options.messages.length > 0 && options.messages[0]?.name) {
    // Single chat header with name
    const avatarSize = style.avatarSize || 36;
    const avatarX = 16;
    const avatarY = 12;
    const avatarBg = '#FF6B35'; // Default
    svg += `<circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2}" fill="${avatarBg}"/>`;
    svg += textToPath(options.messages[0]?.name || 'Contact', {
      x: avatarX + avatarSize + 12,
      y: avatarY + avatarSize / 2 + 5,
      fontSize: 17,
      weight: 600,
      fill: style.headerTextColor || '#000',
    }).svg;
  }
  // Online status
  svg += textToPath('Online', {
    x: width - 60,
    y: 36,
    fontSize: 12,
    fill: style.headerTextColor || '#000',
    opacity: 0.7,
  }).svg;

  return { svg, height };
}

/** Resolve speaker alignment and name from the character list when absent. */
function resolveMessage(
  message: ChatMessage,
  characters: readonly ChatCharacter[],
): { text: string; side: 'left' | 'right'; name?: string } {
  const character =
    message.characterId === undefined ? undefined : characters.find((c) => c.id === message.characterId);
  const side = message.side ?? character?.side ?? 'left';
  const name = message.name ?? character?.name;
  return name === undefined ? { text: message.text, side } : { text: message.text, side, name };
}

/** Render the chat interface as SVG. */
export function renderChatSkin(options: {
  template: string;
  characters: readonly { id: string; name: string; side: 'left' | 'right' }[];
  messages: readonly ChatMessage[];
  groupName?: string;
  groupPhoto?: string;
  tinderMatch?: boolean;
  width?: number;
  height?: number;
}): string {
  const style = (TEMPLATE_STYLES[options.template] ?? TEMPLATE_STYLES['iphone'])!;
  const outputWidth = options.width || BASE_WIDTH;
  const outputHeight = options.height || DEFAULT_HEIGHT;
  const canvasWidth = BASE_WIDTH;
  const canvasHeight = outputHeight / (outputWidth / BASE_WIDTH);
  const messages = options.messages.map((message) => resolveMessage(message, options.characters));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">`;
  svg += `<rect width="${canvasWidth}" height="${canvasHeight}" fill="${style.background}"/>`;

  // Header
  const header = renderHeader(style, {
    template: options.template,
    messages,
    groupName: options.groupName,
    groupPhoto: options.groupPhoto,
  }, canvasWidth);
  svg += header.svg;

  // Messages area
  let y = header.height + 16;
  const characters = options.characters;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    const isRight = message.side === 'right';
    const character = characters.find((c) => c.name === message.name);
    const characterName = character?.name;

    const bubble = renderBubble(message, style, isRight, y, canvasWidth, characterName);
    svg += bubble.svg;
    y += bubble.height;

    if (y > canvasHeight - 100) break; // Prevent overflow
  }

  svg += '</svg>';
  return svg;
}

/**
 * Font inputs handed to resvg for chat-skin PNGs.
 *
 * Chat templates name browser font stacks (`-apple-system`, `Roboto`, ...)
 * that do not exist in the runtime images. Passing the bundled TTFs with
 * `loadSystemFonts: false` makes the generic `sans-serif` entry in those
 * stacks resolve to the bundled Noto families, so Tamil and Latin glyphs are
 * drawn identically on a developer machine and inside the container.
 */
export interface ChatSkinFontOptions {
  fontFiles: string[];
  loadSystemFonts: boolean;
  defaultFontFamily: string;
  sansSerifFamily: string;
  serifFamily: string;
  monospaceFamily: string;
}

/** Hermetic font configuration: bundled files only, no system catalog. */
export function chatSkinFontOptions(): ChatSkinFontOptions {
  return {
    fontFiles: bundledCaptionFontFiles(),
    loadSystemFonts: false,
    defaultFontFamily: DEFAULT_CAPTION_FONT_FAMILY,
    sansSerifFamily: DEFAULT_CAPTION_FONT_FAMILY,
    serifFamily: DEFAULT_CAPTION_FONT_FAMILY,
    monospaceFamily: CAPTION_FONT_FALLBACK_FAMILY,
  };
}

/** Convert SVG to PNG bytes using resvg. */
export async function chatSkinSvgToPng(
  svg: string,
  width: number,
  _height: number,
  font: ChatSkinFontOptions = chatSkinFontOptions(),
): Promise<Uint8Array> {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'transparent',
    font,
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

/** Generate a deterministic seed for chat skin images. */
export function chatSkinSeed(videoId: string, sceneIdx: number, template: string): number {
  const str = `${videoId}:${template}:${sceneIdx}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) >>> 0;
}