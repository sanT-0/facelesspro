/**
 * Inline language overrides: `[[ta:…]]`, `[[en:…]]`, `[[tl:…]]`.
 *
 * These exist for two reasons:
 *  - the editor's voice-plan inspector needs to force a single run's voice
 *    without rewriting the script;
 *  - debugging a misroute should not require a code change.
 *
 * The parser is deliberately forgiving. Anything it does not understand is
 * left in the text verbatim, so a half-typed marker can never silently delete
 * the author's words.
 */

import { segmentText } from './segmenter';
import type { Lang, OverrideSpan, SegmentOptions, TextRun } from './types';

export interface ParsedOverrides {
  /** Input with every well-formed marker removed. */
  text: string;
  /** Forced spans, in `text` coordinates, sorted by `start`. */
  spans: OverrideSpan[];
}

/** Cheap pre-check so the common (marker-free) path stays single-pass. */
export function hasOverrides(input: string): boolean {
  return input.includes('[[');
}

function langForKind(kind: string): Lang {
  return kind.toLowerCase() === 'en' ? 'en' : 'ta';
}

/**
 * Strip `[[kind:content]]` markers and record the span each one covers.
 *
 * A marker is only consumed when it is closed and has non-empty content.
 * `[[ta:]]`, `[[xx:…]]` and `[[ta:…` are left as literal text.
 */
export function parseOverrides(input: string): ParsedOverrides {
  if (!hasOverrides(input)) return { text: input, spans: [] };

  // Content may not contain `[[`, so a half-written marker can never swallow
  // the next one; it is simply left as text.
  const marker = /\[\[(ta|en|tl):((?:(?!\[\[)[\s\S])*?)\]\]/gi;
  const spans: OverrideSpan[] = [];
  let text = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = marker.exec(input)) !== null) {
    const whole = match[0]!;
    const kind = match[1]!;
    const content = match[2]!;
    const at = match.index;

    // Malformed-but-matching marker: keep it, keep scanning.
    if (content.length === 0) {
      text += input.slice(cursor, at + whole.length);
      cursor = at + whole.length;
      continue;
    }

    text += input.slice(cursor, at);
    const start = text.length;
    text += content;
    spans.push({ start, end: text.length, lang: langForKind(kind) });
    cursor = at + whole.length;
  }

  text += input.slice(cursor);
  return { text, spans };
}

export interface OverrideSegmentation extends ParsedOverrides {
  runs: TextRun[];
}

/**
 * Parse markers, then segment the cleaned text with the forced spans applied.
 * This is the single call the pipeline (and the editor) should use.
 */
export function segmentWithOverrides(
  input: string,
  options: SegmentOptions = {},
): OverrideSegmentation {
  const { text, spans } = parseOverrides(input);
  const runs = segmentText(
    text,
    spans.length === 0 ? options : { ...options, overrides: spans },
  );
  return { text, spans, runs };
}
