/**
 * Portable caption sidecars: SRT, WebVTT, ASS and versioned JSON.
 *
 * Cue grouping remains in `captions.ts`; this module never reflows or rewrites
 * Tamil text. SRT/VTT append an already-selected presentation emoji to a copy
 * of the final line. JSON keeps it in its own field. ASS delegates to the
 * existing karaoke writer.
 *
 * Pure: no I/O, no clock, no network.
 */

import { buildAss } from './ass';
import type { AssDimensions, AssStyleSpec } from './ass';
import { clusterCount } from './captions';
import type { CaptionCue, CaptionWord } from './captions';

/** Mirrors `captionExportFormatSchema` in `@facelesspro/contracts`. */
export const CAPTION_EXPORT_FORMATS = ['srt', 'vtt', 'ass', 'json'] as const;
export type CaptionExportFormat = (typeof CAPTION_EXPORT_FORMATS)[number];

export interface CaptionJsonWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionJsonCue {
  index: number;
  startMs: number;
  endMs: number;
  lines: string[];
  words: CaptionJsonWord[];
  emoji?: string;
}

/** Mirrors `captionJsonExportSchema`; parity is pinned in the worker tests. */
export interface CaptionJsonDocument {
  version: 1;
  durationMs: number;
  cues: CaptionJsonCue[];
}

export interface CaptionExportOptions {
  /** Required only for ASS, because its header carries PlayResX/PlayResY. */
  dimensions?: AssDimensions;
  style?: AssStyleSpec;
}

export interface CaptionExport {
  format: CaptionExportFormat;
  extension: CaptionExportFormat;
  mimeType: string;
  contents: string;
}

function validateTimestamp(milliseconds: number): void {
  if (!Number.isInteger(milliseconds) || milliseconds < 0) {
    throw new Error(`caption timestamp must be a non-negative integer (got ${milliseconds})`);
  }
}

function timecode(milliseconds: number, separator: ',' | '.'): string {
  validateTimestamp(milliseconds);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  const millis = milliseconds % 1000;
  return (
    `${hours.toString().padStart(2, '0')}:` +
    `${minutes.toString().padStart(2, '0')}:` +
    `${seconds.toString().padStart(2, '0')}${separator}` +
    millis.toString().padStart(3, '0')
  );
}

export function toSrtTimecode(milliseconds: number): string {
  return timecode(milliseconds, ',');
}

export function toVttTimecode(milliseconds: number): string {
  return timecode(milliseconds, '.');
}

function validateWord(word: CaptionWord, cueIndex: number, wordIndex: number): void {
  if (word.text === '' || /[\r\n]/.test(word.text)) {
    throw new Error(`caption cue ${cueIndex} word ${wordIndex} must be non-empty with no newline`);
  }
  validateTimestamp(word.startMs);
  validateTimestamp(word.endMs);
  if (word.endMs < word.startMs) {
    throw new Error(`caption cue ${cueIndex} word ${wordIndex} has invalid timing`);
  }
}

/** One validation pass shared by every export, including ASS dispatch. */
function validateCues(cues: readonly CaptionCue[]): void {
  if (cues.length === 0) throw new Error('caption export called with no cues');

  for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
    const cue = cues[cueIndex];
    if (cue === undefined) continue;
    validateTimestamp(cue.startMs);
    validateTimestamp(cue.endMs);
    if (cue.endMs <= cue.startMs) {
      throw new Error(`caption cue ${cueIndex + 1} has invalid timing`);
    }
    if (cue.lines.length === 0 || cue.words.length === 0) {
      throw new Error(`caption cue ${cueIndex + 1} must contain lines and words`);
    }
    if (cue.lines.some((line) => line === '' || /[\r\n]/.test(line))) {
      throw new Error(`caption cue ${cueIndex + 1} lines must be non-empty with no newline`);
    }
    for (let wordIndex = 0; wordIndex < cue.words.length; wordIndex += 1) {
      const word = cue.words[wordIndex];
      if (word === undefined) continue;
      validateWord(word, cueIndex + 1, wordIndex + 1);
      const previous = cue.words[wordIndex - 1];
      if (previous !== undefined && word.startMs < previous.endMs) {
        throw new Error(`caption cue ${cueIndex + 1} words overlap`);
      }
    }
    const first = cue.words[0];
    const last = cue.words[cue.words.length - 1];
    if (first?.startMs !== cue.startMs || last?.endMs !== cue.endMs) {
      throw new Error(`caption cue ${cueIndex + 1} timing must match its first and last word`);
    }
    if (cue.lines.join(' ') !== cue.words.map((word) => word.text).join(' ')) {
      throw new Error(`caption cue ${cueIndex + 1} lines do not reconstruct its words`);
    }
    if (cue.emoji !== undefined) {
      if (/[\r\n]/.test(cue.emoji) || clusterCount(cue.emoji) !== 1) {
        throw new Error(`caption cue ${cueIndex + 1} emoji must be one grapheme cluster`);
      }
    }
    const previousCue = cues[cueIndex - 1];
    if (previousCue !== undefined && cue.startMs < previousCue.endMs) {
      throw new Error(`caption cue ${cueIndex + 1} overlaps the previous cue`);
    }
  }
}

/** Copy display lines and append presentation emoji to the final line only. */
function presentationLines(cue: CaptionCue): string[] {
  const lines = [...cue.lines];
  if (cue.emoji === undefined) return lines;
  const lastIndex = lines.length - 1;
  const last = lines[lastIndex];
  if (last === undefined) throw new Error('caption export cue has no lines');
  lines[lastIndex] = `${last} ${cue.emoji}`;
  return lines;
}

function textBlocks(
  cues: readonly CaptionCue[],
  formatTime: (milliseconds: number) => string,
): string {
  validateCues(cues);
  return cues
    .map((cue, index) =>
      [
        String(index + 1),
        `${formatTime(cue.startMs)} --> ${formatTime(cue.endMs)}`,
        ...presentationLines(cue),
      ].join('\n'),
    )
    .join('\n\n');
}

export function buildSrt(cues: readonly CaptionCue[]): string {
  return `${textBlocks(cues, toSrtTimecode)}\n`;
}

export function buildVtt(cues: readonly CaptionCue[]): string {
  return `WEBVTT\n\n${textBlocks(cues, toVttTimecode)}\n`;
}

export function buildCaptionJsonDocument(cues: readonly CaptionCue[]): CaptionJsonDocument {
  validateCues(cues);
  const last = cues[cues.length - 1];
  if (last === undefined) throw new Error('caption export called with no cues');
  return {
    version: 1,
    durationMs: last.endMs,
    cues: cues.map((cue, index) => ({
      index: index + 1,
      startMs: cue.startMs,
      endMs: cue.endMs,
      lines: [...cue.lines],
      words: cue.words.map((word) => ({ ...word })),
      ...(cue.emoji === undefined ? {} : { emoji: cue.emoji }),
    })),
  };
}

export function buildCaptionJson(cues: readonly CaptionCue[]): string {
  return `${JSON.stringify(buildCaptionJsonDocument(cues), null, 2)}\n`;
}

/** Dispatch one requested sidecar with stable metadata for HTTP/file adapters. */
export function exportCaptions(
  cues: readonly CaptionCue[],
  format: CaptionExportFormat,
  options: CaptionExportOptions = {},
): CaptionExport {
  switch (format) {
    case 'srt':
      return {
        format,
        extension: format,
        mimeType: 'application/x-subrip; charset=utf-8',
        contents: buildSrt(cues),
      };
    case 'vtt':
      return {
        format,
        extension: format,
        mimeType: 'text/vtt; charset=utf-8',
        contents: buildVtt(cues),
      };
    case 'json':
      return {
        format,
        extension: format,
        mimeType: 'application/json; charset=utf-8',
        contents: buildCaptionJson(cues),
      };
    case 'ass': {
      validateCues(cues);
      if (options.dimensions === undefined) {
        throw new Error('ASS caption export requires dimensions');
      }
      return {
        format,
        extension: format,
        mimeType: 'text/x-ssa; charset=utf-8',
        contents: buildAss(cues, options.dimensions, options.style),
      };
    }
    default:
      throw new Error(`unsupported caption export format: ${String(format)}`);
  }
}
