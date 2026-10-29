/**
 * Tanglish (romanised Tamil) lexicon.
 *
 * The word list lives in `data/tanglish.json` so it can be edited without
 * touching code. Routing is deliberately conservative: an exact match on a
 * curated word wins, and inflection is only accepted when the *stem* is a
 * known Tamil root, so English words that happen to end in a Tamil suffix are
 * left alone.
 */

import rawData from '../data/tanglish.json' with { type: 'json' };
import type { Lexicon } from './types';

export interface TanglishData {
  version: number;
  updated: string;
  note?: string;
  words: string[];
  roots: string[];
  suffixes: string[];
  protected: string[];
}

/** Minimum stem length before an inflection is trusted. */
const MIN_ROOT_LENGTH = 3;

/**
 * Words are compared in lower case, letters only: `Vanakkam!` and
 * `vanakkam,` must both hit the lexicon.
 */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/gu, '');
}

function toSet(words: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const word of words) {
    const normalized = normalizeWord(word);
    if (normalized.length > 0) out.add(normalized);
  }
  return out;
}

export const TANGLISH_DATA = rawData as TanglishData;

const DEFAULT_SUFFIXES: readonly string[] = [
  ...new Set(
    TANGLISH_DATA.suffixes
      .map((suffix) => normalizeWord(suffix))
      .filter((suffix) => suffix.length > 0),
  ),
].sort((a, b) => b.length - a.length);

export const DEFAULT_LEXICON: Lexicon = {
  words: toSet(TANGLISH_DATA.words),
  roots: toSet(TANGLISH_DATA.roots),
  suffixes: DEFAULT_SUFFIXES,
  protected: toSet(TANGLISH_DATA.protected),
};

/** Backwards-compatible alias: the built-in word set on its own. */
export const DEFAULT_TANGLISH: ReadonlySet<string> = DEFAULT_LEXICON.words;

export interface LexiconOverrides {
  words?: Iterable<string>;
  roots?: Iterable<string>;
  suffixes?: readonly string[];
  protected?: Iterable<string>;
}

/** Build a lexicon from the defaults, replacing only the collections given. */
export function createLexicon(overrides: LexiconOverrides = {}): Lexicon {
  return {
    words:
      overrides.words === undefined
        ? DEFAULT_LEXICON.words
        : toSet([...overrides.words]),
    roots:
      overrides.roots === undefined
        ? DEFAULT_LEXICON.roots
        : toSet([...overrides.roots]),
    suffixes:
      overrides.suffixes === undefined
        ? DEFAULT_LEXICON.suffixes
        : [...new Set(overrides.suffixes.map(normalizeWord).filter(Boolean))].sort(
            (a, b) => b.length - a.length,
          ),
    protected:
      overrides.protected === undefined
        ? DEFAULT_LEXICON.protected
        : toSet([...overrides.protected]),
  };
}

/** Add words/roots on top of an existing lexicon without mutating it. */
export function extendLexicon(
  base: Lexicon,
  extra: LexiconOverrides,
): Lexicon {
  return {
    words: extra.words === undefined ? base.words : toSet([...base.words, ...extra.words]),
    roots: extra.roots === undefined ? base.roots : toSet([...base.roots, ...extra.roots]),
    suffixes: extra.suffixes === undefined ? base.suffixes : [...base.suffixes, ...extra.suffixes],
    protected:
      extra.protected === undefined
        ? base.protected
        : toSet([...base.protected, ...extra.protected]),
  };
}

/**
 * True when `word` looks like `<known root><known suffix>`.
 *
 * Both halves must be known, so `veetukku` (veetu + kku) matches while
 * `article` (artic + le) does not.
 */
export function hasTanglishInflection(
  word: string,
  lexicon: Lexicon = DEFAULT_LEXICON,
): boolean {
  const normalized = normalizeWord(word);
  if (normalized.length === 0) return false;

  for (const suffix of lexicon.suffixes) {
    if (normalized.length < suffix.length + MIN_ROOT_LENGTH) continue;
    if (!normalized.endsWith(suffix)) continue;
    const root = normalized.slice(0, normalized.length - suffix.length);
    if (lexicon.roots.has(root)) return true;
  }
  return false;
}

/**
 * Decide whether a Latin-script token should be spoken by the Tamil voice.
 *
 * Order matters: the protected list wins over everything, then exact match,
 * then inflection (which can be turned off by the caller).
 */
export function isTanglishWord(
  word: string,
  lexicon: Lexicon = DEFAULT_LEXICON,
  useMorphology = true,
): boolean {
  const normalized = normalizeWord(word);
  if (normalized.length === 0) return false;
  if (lexicon.protected.has(normalized)) return false;
  if (lexicon.words.has(normalized)) return true;
  return useMorphology ? hasTanglishInflection(normalized, lexicon) : false;
}
