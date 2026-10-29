/**
 * Script-aware text segmentation for Tamil + English narration.
 *
 * The splitter is intentionally conservative: it only decides which voice a
 * piece of text should be spoken with. It never rewrites the text.
 */

import { DEFAULT_LEXICON, isTanglishWord } from './lexicon';
import type {
  Lang,
  Lexicon,
  OverrideSpan,
  ScriptKind,
  SegmentOptions,
  TextRun,
} from './types';

export { DEFAULT_TANGLISH } from './lexicon';

const TAMIL_START = 0x0b80;
const TAMIL_END = 0x0bff;
const ZERO_WIDTH = new Set(['\u200c', '\u200d']);

function isTamilChar(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  return (cp >= TAMIL_START && cp <= TAMIL_END) || ZERO_WIDTH.has(ch);
}

function isLatinLetter(ch: string): boolean {
  return /^[A-Za-z\u00c0-\u024f]$/u.test(ch);
}

/** Combining marks that belong to a Latin base letter. */
function isLatinMark(ch: string): boolean {
  return /^[\u0300-\u036f]$/u.test(ch);
}

function isWordChar(ch: string): boolean {
  return isTamilChar(ch) || isLatinLetter(ch) || isLatinMark(ch);
}

interface Token {
  text: string;
  kind: 'word' | 'sep';
  /** Offset of the token in the input, in UTF-16 code units. */
  start: number;
  /** End offset (exclusive). */
  end: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let buffer = '';
  let bufferKind: Token['kind'] | null = null;
  let bufferStart = 0;
  let index = 0;

  for (const ch of input) {
    const kind: Token['kind'] = isWordChar(ch) ? 'word' : 'sep';
    if (bufferKind === kind) {
      buffer += ch;
      index += ch.length;
      continue;
    }
    if (buffer.length > 0 && bufferKind !== null) {
      tokens.push({ text: buffer, kind: bufferKind, start: bufferStart, end: index });
    }
    buffer = ch;
    bufferKind = kind;
    bufferStart = index;
    index += ch.length;
  }

  if (buffer.length > 0 && bufferKind !== null) {
    tokens.push({ text: buffer, kind: bufferKind, start: bufferStart, end: index });
  }
  return tokens;
}

function hasTamilChar(word: string): boolean {
  for (const ch of word) {
    if (isTamilChar(ch)) return true;
  }
  return false;
}

/**
 * Script of a forced span. Tamil is written in Tamil script when the span
 * contains Tamil letters, and in Latin letters otherwise — which is exactly
 * what `[[ta:…]]` over an English-looking word means.
 */
function scriptForOverride(word: string, lang: Lang): ScriptKind {
  if (lang === 'en') return 'latin';
  return hasTamilChar(word) ? 'tamil' : 'tanglish';
}

function classifyWord(
  word: string,
  lexicon: Lexicon,
  useMorphology: boolean,
): { lang: Lang; script: ScriptKind } {
  if (hasTamilChar(word)) return { lang: 'ta', script: 'tamil' };
  if (isTanglishWord(word, lexicon, useMorphology)) {
    return { lang: 'ta', script: 'tanglish' };
  }
  return { lang: 'en', script: 'latin' };
}

function strongestScript(a: ScriptKind, b: ScriptKind): ScriptKind {
  if (a === 'tamil' || b === 'tamil') return 'tamil';
  if (a === 'tanglish' || b === 'tanglish') return 'tanglish';
  return 'latin';
}

/**
 * Split text into consecutive runs that can each be synthesized with a single
 * voice.
 *
 * Guarantees:
 * - no run has empty (or whitespace-only) `text`
 * - no two consecutive runs share the same `lang`
 * - concatenating the runs preserves every non-whitespace character
 */
export function segmentText(
  input: string,
  options: SegmentOptions = {},
): TextRun[] {
  const lexicon: Lexicon =
    options.lexicon ??
    (options.tanglish === undefined
      ? DEFAULT_LEXICON
      : { ...DEFAULT_LEXICON, words: options.tanglish });
  const useMorphology = options.morphology ?? true;
  const overrides: readonly OverrideSpan[] = options.overrides ?? [];
  const tokens = tokenize(input);

  const runs: TextRun[] = [];
  let pendingSeparator = '';
  let current: TextRun | null = null;
  let spanCursor = 0;

  const flush = (): void => {
    if (current === null) return;
    const text = current.text.trim();
    if (text.length > 0) {
      runs.push({ ...current, text });
    }
    current = null;
  };

  for (const token of tokens) {
    if (token.kind === 'sep') {
      if (current !== null) {
        current.text += token.text;
      } else {
        pendingSeparator += token.text;
      }
      continue;
    }

    // Spans and tokens are both ordered, so one cursor is enough.
    while (spanCursor < overrides.length && overrides[spanCursor]!.end <= token.start) {
      spanCursor += 1;
    }
    const span = overrides[spanCursor];
    const forced =
      span !== undefined && span.start <= token.start && token.end <= span.end
        ? { lang: span.lang, script: scriptForOverride(token.text, span.lang) }
        : null;

    const { lang, script } = forced ?? classifyWord(token.text, lexicon, useMorphology);

    if (current !== null && current.lang === lang) {
      current.text += token.text;
      current.script = strongestScript(current.script, script);
      continue;
    }

    flush();
    current = {
      lang,
      script,
      text: pendingSeparator + token.text,
    };
    pendingSeparator = '';
  }

  flush();
  return runs;
}
