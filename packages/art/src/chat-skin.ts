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
  side: 'left' | 'right';
  name?: string;
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

/** Escape text for safe SVG inclusion. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');
}

/** Wrap text to fit within maxWidth at given font size. */
function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    // Approximate character width (roughly 0.6 * fontSize per char)
    const charWidth = fontSize * 0.6;
    if (testLine.length * charWidth > maxWidth && currentLine) {
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
  characterName?: string
): { svg: string; height: number } {
  const bubbleStyle = isRight ? style.bubbleRight : style.bubbleLeft;
  const maxWidth = style.maxBubbleWidth;
  const lines = wrapText(message.text, maxWidth, style.fontSize);
  const lineHeight = style.fontSize * 1.3;
  const bubbleWidth = Math.min(
    maxWidth,
    Math.max(...lines.map((l) => l.length)) * style.fontSize * 0.6 + style.bubblePadding.horizontal * 2
  );
  const bubbleHeight = lines.length * (style.fontSize * 1.3) + style.bubblePadding.vertical * 2;
  const nameHeight = characterName && !isRight ? 20 : 0;
  const totalHeight = bubbleHeight + nameHeight + (isRight ? 0 : 4);
  const x = isRight ? style.maxBubbleWidth - bubbleWidth + 20 : 20;
  const bubbleX = x;
  const bubbleY = y + (characterName && !isRight ? 20 : 0);

  let svg = '';

  // Name label (for left bubbles with character name)
  if (characterName && !isRight) {
    svg += `<text x="${x + style.bubblePadding.horizontal}" y="${y + 14}" ` +
      `font-family="${style.fontFamily}" font-size="11" fill="${style.nameColor || '#8E8E93'}">` +
      `${escapeXml(characterName)}</text>`;
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
    const textX = bubbleX + style.bubblePadding.horizontal;
    const textY = bubbleY + style.bubblePadding.vertical + i * lineHeight + style.fontSize * 0.8;
    svg += `<text x="${textX}" y="${textY}" ` +
      `font-family="${style.fontFamily}" font-size="${style.fontSize}" fill="${bubbleStyle.text}">` +
      `${escapeXml(line)}</text>`;
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
    svg += `<text x="${avatarX + avatarSize + 12}" y="${avatarY + avatarSize / 2 + 5}" ` +
      `font-family="${style.fontFamily}" font-size="17" font-weight="600" fill="${style.headerTextColor || '#000'}">` +
      `${escapeXml(options.messages[0]?.name || 'Group')}</text>`;
  } else if (options.messages.length > 0 && options.messages[0]?.name) {
    // Single chat header with name
    const avatarSize = style.avatarSize || 36;
    const avatarX = 16;
    const avatarY = 12;
    const avatarBg = '#FF6B35'; // Default
    svg += `<circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2}" fill="${avatarBg}"/>`;
    svg += `<text x="${avatarX + avatarSize + 12}" y="${avatarY + avatarSize / 2 + 5}" ` +
      `font-family="${style.fontFamily}" font-size="17" font-weight="600" fill="${style.headerTextColor || '#000'}">` +
      `${escapeXml(options.messages[0]?.name || 'Contact')}</text>`;
  }
  // Online status
  svg += `<text x="${width - 60}" y="36" font-family="${style.fontFamily}" font-size="12" fill="${style.headerTextColor || '#000'}" opacity="0.7">Online</text>`;

  return { svg, height };
}

/** Render the chat interface as SVG. */
export function renderChatSkin(options: {
  template: string;
  characters: readonly { id: string; name: string; side: 'left' | 'right' }[];
  messages: readonly { text: string; side: 'left' | 'right'; name?: string }[];
  groupName?: string;
  groupPhoto?: string;
  tinderMatch?: boolean;
  width?: number;
  height?: number;
}): string {
  const style = (TEMPLATE_STYLES[options.template] ?? TEMPLATE_STYLES['iphone'])!;
  const width = options.width || 375; // iPhone width
  const height = options.height || 667; // iPhone height

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" fill="${style.background}"/>`;

  // Header
  const header = renderHeader(style, {
    template: options.template,
    messages: options.messages,
    groupName: options.groupName,
    groupPhoto: options.groupPhoto,
  }, options.width || 375);
  svg += header.svg;

  // Messages area
  let y = header.height + 16;
  const messages = options.messages;
  const characters = options.characters;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    const isRight = message.side === 'right';
    const character = characters.find((c) => c.name === message.name);
    const characterName = character?.name;

    const bubble = renderBubble(message, style, isRight, y, characterName);
    svg += bubble.svg;
    y += bubble.height;

    if (y > height - 100) break; // Prevent overflow
  }

  svg += '</svg>';
  return svg;
}

/** Convert SVG to PNG bytes using resvg. */
export async function chatSkinSvgToPng(svg: string, width: number, _height: number): Promise<Uint8Array> {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'transparent',
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