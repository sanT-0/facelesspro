/**
 * Script → sentences.
 *
 * The scene planner's hard invariant is `concat(scenes.text) === script` (modulo
 * whitespace), so splitting must never rewrite or drop a character. This module
 * therefore only finds boundaries: a sentence is a slice of the input, trimmed
 * and whitespace-collapsed, and the sentences joined with a space reproduce
 * `normalizeScript(script)`.
 *
 * Tamil and Latin share `.`, `?` and `!`, which makes a naive splitter wrong in
 * both languages: `3.5`, `Rs.500`, `Dr.`, `p.m.`, `A. R. Rahman`, `திரு.` and
 * `... wait` are all mid-sentence periods. The rules below are deliberately
 * small and explained one by one; unknown abbreviations are a known limitation
 * (they end a sentence early, which the planner's repair step can see).
 *
 * Pure: no I/O, no clock, no network.
 */

export interface Sentence {
  /** Trimmed, whitespace-collapsed slice of the normalised script. */
  text: string;
  /** Start offset in `normalizeScript(script)`. */
  start: number;
  /** End offset (exclusive) in `normalizeScript(script)`. */
  end: number;
}

const TERMINATORS = new Set(['.', '!', '?', '…', '।', '॥']);
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '}', '»']);

/**
 * Periods that end a word, not a sentence. Kept short on purpose: every entry
 * is a case actually seen in a script, and an entry that is not needed is a
 * sentence the planner will never split.
 */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'eg',
  'ie',
  'approx',
  'no',
  'nos',
  'fig',
  'inc',
  'ltd',
  'pvt',
  'rs',
  'vol',
  'pp',
  'al',
  'hr',
  'min',
  'sec',
  'km',
  'kg',
  'cm',
  'mm',
  'ml',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
]);

const TAMIL_ABBREVIATIONS = new Set(['திரு', 'திருமதி', 'செல்வி', 'டாக்டர்', 'பேரா', 'உம்', 'கி.பி', 'கி.மு']);

// Tamil vowel signs and the virama are marks, not letters — trimming the token
// at a mark would turn `திரு` into `ரு` and lose the abbreviation.
const LETTER_OR_DOT = /[\p{L}\p{M}.]$/u;

export function normalizeScript(script: string): string {
  if (typeof script !== 'string') {
    throw new TypeError('normalizeScript expects a string');
  }
  return script
    .replace(/[\u200b\ufeff]/gu, '')
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu, ' ')
    .replace(/[\u201c\u201d\u201e\u201f]/gu, '"')
    .replace(/[\u2018\u2019\u201a\u201b]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

export function splitSentences(script: string): Sentence[] {
  if (typeof script !== 'string') {
    throw new TypeError('splitSentences expects a string');
  }
  const boundaries = findBoundaries(script);
  const pieces: string[] = [];
  let from = 0;
  for (const boundary of boundaries) {
    const piece = normalizeScript(script.slice(from, boundary));
    if (piece.length > 0) pieces.push(piece);
    from = boundary;
  }
  const tail = normalizeScript(script.slice(from));
  if (tail.length > 0) pieces.push(tail);

  const sentences: Sentence[] = [];
  let offset = 0;
  for (const text of pieces) {
    sentences.push({ text, start: offset, end: offset + text.length });
    offset += text.length + 1; // the joining space
  }
  return sentences;
}

/** End offsets (exclusive) in the *original* script. */
function findBoundaries(script: string): number[] {
  const boundaries: number[] = [];
  let i = 0;
  while (i < script.length) {
    const char = script[i] as string;

    // An override marker is one authored unit: a period inside `[[en:…]]` is
    // part of the text the author forced into English, not a scene cut.
    if (char === '[' && script[i + 1] === '[') {
      const close = script.indexOf(']]', i + 2);
      i = close === -1 ? i + 2 : close + 2;
      continue;
    }

    if (char === '\n' || char === '\r') {
      const end = runEnd(script, i, (c) => c === '\n' || c === '\r' || c === ' ' || c === '\t');
      const newlines = script.slice(i, end).replace(/[^\n\r]/gu, '').length;
      // One newline is a soft wrap in a pasted script; a blank line is a break.
      if (newlines >= 2 && hasTextBefore(script, i)) boundaries.push(end);
      i = end;
      continue;
    }

    if (!TERMINATORS.has(char)) {
      i += 1;
      continue;
    }

    const boundary = boundaryEnd(script, i);
    if (boundary.end !== null) boundaries.push(boundary.end);
    i = Math.max(boundary.resume, i + 1);
  }
  return boundaries;
}

/**
 * Where the sentence that ends at `i` ends (`end`), and where scanning resumes
 * (`resume`). Consumes repeated terminators and closing quotes/brackets
 * (`stop."`), which belong to the sentence they close.
 */
function boundaryEnd(script: string, i: number): { end: number | null; resume: number } {
  const char = script[i] as string;

  if (char === '.') {
    const dotsEnd = runEnd(script, i, (c) => c === '.');
    if (dotsEnd - i >= 2) {
      // `...` is only a boundary when a new sentence starts after it, and the
      // whole run must be consumed either way or its last dot would be judged
      // on its own.
      const end = startsSentence(script, dotsEnd) ? consumeClosers(script, dotsEnd) : null;
      return { end, resume: dotsEnd };
    }
  }

  if (char === '…') {
    return {
      end: startsSentence(script, i + 1) ? consumeClosers(script, i + 1) : null,
      resume: i + 1,
    };
  }

  if (char === '!' || char === '?' || char === '।' || char === '॥') {
    const end = consumeClosers(script, i + 1);
    // `"…?" என்று கேட்டார்` — the quotative closes the quote, not the sentence.
    if (startsQuotative(script, end)) return { end: null, resume: end };
    return { end, resume: end };
  }

  if (isAbbreviationBefore(script, i)) return { end: null, resume: i + 1 };
  const end = consumeClosers(script, i + 1);
  if (startsQuotative(script, end)) return { end: null, resume: end };
  return { end, resume: end };
}

/** Skip further `.!?` and closing quotes — `A!?`, `"stop."`, `(done.)`. */
function consumeClosers(script: string, from: number): number {
  return runEnd(script, from, (c) => TERMINATORS.has(c) || CLOSERS.has(c));
}

/**
 * Tamil quotatives: `"…?" என்று கேட்டார்` is one sentence. The word after the
 * closing quote is part of the same clause, so a terminator in front of it is
 * not a sentence edge. Only whole words match — `எனக்கு` is a different word.
 */
const QUOTATIVE = /^(?:என்று|என்றார்|என்றாள்|என்றது|என்றால்|என்பது|என்ற)(?![\p{L}\p{M}])/u;

function startsQuotative(script: string, from: number): boolean {
  let i = from;
  while (i < script.length && isSpace(script[i] as string)) i += 1;
  return QUOTATIVE.test(script.slice(i));
}

/** Does a new sentence start after `from`, ignoring spaces and closers? */
function startsSentence(script: string, from: number): boolean {
  let i = from;
  while (i < script.length) {
    const char = script[i] as string;
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || CLOSERS.has(char)) {
      i += 1;
      continue;
    }
    if (startsQuotative(script, i)) return false;
    return /[A-Z\p{Script=Tamil}]/u.test(char);
  }
  return true; // end of script: the ellipsis closes the last sentence
}

/** `3.5`, `Rs.500`, `Dr.`, `p.m.`, `A. R.`, `திரு.` — but not `stop.` */
function isAbbreviationBefore(script: string, i: number): boolean {
  const prev = script[i - 1];
  const next = script[i + 1];
  if (isDigit(prev) && isDigit(next)) return true;

  // No space after the period: a numeral (`Rs.500`) or a glued token, either
  // way not a sentence edge.
  if (next !== undefined && !isSpace(next) && !CLOSERS.has(next) && !TERMINATORS.has(next)) {
    return true;
  }

  let start = i;
  while (start > 0 && LETTER_OR_DOT.test(script[start - 1] as string)) start -= 1;
  const token = script.slice(start, i).replace(/\.+$/u, '');
  if (token.length === 0) return false;
  if (token.includes('.')) return true; // p.m, e.g, U.S
  if (Array.from(token).length === 1) return true; // initials: A. R. Rahman
  if (ABBREVIATIONS.has(token.toLowerCase())) return true;
  return TAMIL_ABBREVIATIONS.has(token);
}

function hasTextBefore(script: string, i: number): boolean {
  return script.slice(0, i).trim().length > 0;
}

function runEnd(script: string, from: number, accept: (char: string) => boolean): number {
  let i = from;
  while (i < script.length && accept(script[i] as string)) i += 1;
  return i;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isSpace(char: string): boolean {
  return /\s/u.test(char);
}
