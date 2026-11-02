/**
 * Advanced SubStation Alpha (ASS) writer.
 *
 * Converts caption cues into the deterministic text file consumed by
 * ffmpeg/libass. Cue grouping and wrapping live in `captions.ts`; this module
 * only serialises those decisions and adds per-word karaoke timings.
 *
 * Pure: no I/O, no clock, no network.
 */

import type { CaptionCue, CaptionWord } from './captions';

export interface AssDimensions {
  width: number;
  height: number;
}

/** The CaptionSpec fields that affect an ASS file. */
export interface AssStyleSpec {
  fontFamily?: string;
  fontSize?: number;
  uppercase?: boolean;
  position?: 'top' | 'center' | 'bottom';
  highlightColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
}

const DEFAULT_FONT = 'Noto Sans Tamil';
const DEFAULT_HIGHLIGHT = '#FFD400';
const DEFAULT_OUTLINE = '#101010';

const STYLE_FORMAT = [
  'Name',
  'Fontname',
  'Fontsize',
  'PrimaryColour',
  'SecondaryColour',
  'OutlineColour',
  'BackColour',
  'Bold',
  'Italic',
  'Underline',
  'StrikeOut',
  'ScaleX',
  'ScaleY',
  'Spacing',
  'Angle',
  'BorderStyle',
  'Outline',
  'Shadow',
  'Alignment',
  'MarginL',
  'MarginR',
  'MarginV',
  'Encoding',
] as const;

const EVENT_FORMAT = [
  'Layer',
  'Start',
  'End',
  'Style',
  'Name',
  'MarginL',
  'MarginR',
  'MarginV',
  'Effect',
  'Text',
] as const;

/** Convert `#RRGGBB` to opaque ASS `&HAABBGGRR`. */
export function assColour(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) {
    throw new Error(`invalid ASS colour "${hex}": expected #RRGGBB`);
  }
  const red = match[1];
  const green = match[2];
  const blue = match[3];
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`invalid ASS colour "${hex}": expected #RRGGBB`);
  }
  return `&H00${blue}${green}${red}`.toUpperCase();
}

/** ASS timestamps are `H:MM:SS.CC`; sub-centisecond time is truncated. */
export function toAssTimecode(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error(`invalid ASS timestamp: ${milliseconds}`);
  }
  const totalCentiseconds = Math.floor(milliseconds / 10);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}.${twoDigits(centiseconds)}`;
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, '0');
}

function alignmentFor(position: AssStyleSpec['position']): number {
  if (position === 'top') return 8;
  if (position === 'center') return 5;
  return 2;
}

function validateDimensions(dimensions: AssDimensions): void {
  if (
    !Number.isInteger(dimensions.width) ||
    dimensions.width <= 0 ||
    !Number.isInteger(dimensions.height) ||
    dimensions.height <= 0
  ) {
    throw new Error('ASS dimensions must be positive integers');
  }
}

function validateStyle(spec: AssStyleSpec): void {
  if (spec.fontFamily !== undefined) {
    if (spec.fontFamily.trim() === '' || /[,\r\n]/.test(spec.fontFamily)) {
      throw new Error('ASS fontFamily must be non-empty and contain no comma or newline');
    }
  }
  if (
    spec.fontSize !== undefined &&
    (!Number.isFinite(spec.fontSize) || spec.fontSize <= 0)
  ) {
    throw new Error('ASS fontSize must be positive');
  }
  if (
    spec.outlineWidth !== undefined &&
    (!Number.isFinite(spec.outlineWidth) ||
      spec.outlineWidth < 0 ||
      spec.outlineWidth > 20)
  ) {
    throw new Error('ASS outlineWidth must be between 0 and 20');
  }
}

function validateWord(word: CaptionWord): void {
  if (word.text === '' || /[\r\n]/.test(word.text)) {
    throw new Error('ASS caption words must be non-empty and contain no newline');
  }
  if (
    !Number.isFinite(word.startMs) ||
    !Number.isFinite(word.endMs) ||
    word.startMs < 0 ||
    word.endMs < word.startMs
  ) {
    throw new Error(`invalid caption word timing for "${word.text}"`);
  }
}

/** Prevent input text from becoming an ASS override or a forced line break. */
function escapeAssText(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}');
}

/**
 * Find which word indexes end a line. `captions.ts` creates every line by
 * joining whole words with one space, so this also checks that the cue was not
 * mutated between grouping and serialisation.
 */
function lineEndIndexes(cue: CaptionCue): ReadonlySet<number> {
  const ends = new Set<number>();
  let lineIndex = 0;
  let current: string[] = [];
  for (let wordIndex = 0; wordIndex < cue.words.length; wordIndex += 1) {
    const word = cue.words[wordIndex];
    if (word === undefined) continue;
    current.push(word.text);
    const expected = cue.lines[lineIndex];
    if (expected === undefined) {
      throw new Error('caption cue words do not match its lines');
    }
    const joined = current.join(' ');
    if (joined === expected) {
      ends.add(wordIndex);
      lineIndex += 1;
      current = [];
    } else if (!expected.startsWith(`${joined} `)) {
      throw new Error('caption cue words do not match its lines');
    }
  }
  if (current.length !== 0 || lineIndex !== cue.lines.length) {
    throw new Error('caption cue words do not match its lines');
  }
  return ends;
}

function karaokeText(cue: CaptionCue, uppercase: boolean): string {
  const lineEnds = lineEndIndexes(cue);
  const parts: string[] = [];
  for (let index = 0; index < cue.words.length; index += 1) {
    const word = cue.words[index];
    if (word === undefined) continue;
    validateWord(word);
    const durationCs = Math.max(1, Math.round((word.endMs - word.startMs) / 10));
    const presented = uppercase ? word.text.toUpperCase() : word.text;
    parts.push(`{\\k${durationCs}}${escapeAssText(presented)}`);
    if (index < cue.words.length - 1) {
      parts.push(lineEnds.has(index) ? '\\N' : ' ');
    }
  }
  return parts.join('');
}

function styleLine(
  dimensions: AssDimensions,
  spec: AssStyleSpec,
): string {
  const fontSize = spec.fontSize ?? Math.max(24, Math.round(dimensions.height * 0.067));
  const outline = spec.outlineWidth ?? 3;
  const horizontalMargin = Math.max(20, Math.round(dimensions.width * 0.05));
  const verticalMargin = Math.max(20, Math.round(dimensions.height * 0.06));
  const fields: readonly (string | number)[] = [
    'Faceless',
    spec.fontFamily ?? DEFAULT_FONT,
    fontSize.toFixed(1),
    assColour(spec.highlightColor ?? DEFAULT_HIGHLIGHT),
    '&H00FFFFFF',
    assColour(spec.outlineColor ?? DEFAULT_OUTLINE),
    '&H80000000',
    -1,
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    1,
    outline.toFixed(1),
    0,
    alignmentFor(spec.position),
    horizontalMargin,
    horizontalMargin,
    verticalMargin,
    1,
  ];
  return `Style: ${fields.join(',')}`;
}

function dialogueLine(cue: CaptionCue, uppercase: boolean): string {
  if (cue.words.length === 0 || cue.lines.length === 0) {
    throw new Error('ASS caption cue must contain words and lines');
  }
  const first = cue.words[0];
  const last = cue.words[cue.words.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('ASS caption cue must contain words');
  }
  if (cue.startMs !== first.startMs || cue.endMs !== last.endMs) {
    throw new Error('ASS cue timing must match its first and last word');
  }
  return [
    'Dialogue: 0',
    toAssTimecode(cue.startMs),
    toAssTimecode(cue.endMs),
    'Faceless',
    '',
    '',
    '',
    '',
    '',
    karaokeText(cue, uppercase),
  ].join(',');
}

/** Serialise caption cues as a complete UTF-8 ASS v4+ document. */
export function buildAss(
  cues: readonly CaptionCue[],
  dimensions: AssDimensions,
  spec: AssStyleSpec = {},
): string {
  if (cues.length === 0) {
    throw new Error('buildAss: called with no cues');
  }
  validateDimensions(dimensions);
  validateStyle(spec);
  // Validate colours even when no caller later inspects the style line.
  const style = styleLine(dimensions, spec);
  const dialogue = cues.map((cue) => dialogueLine(cue, spec.uppercase ?? false));
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'Collisions: Normal',
    `PlayResX: ${dimensions.width}`,
    `PlayResY: ${dimensions.height}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 2',
    '',
    '[V4+ Styles]',
    `Format: ${STYLE_FORMAT.join(', ')}`,
    style,
    '',
    '[Events]',
    `Format: ${EVENT_FORMAT.join(', ')}`,
    ...dialogue,
    '',
  ].join('\n');
}
