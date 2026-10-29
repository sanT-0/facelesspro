/**
 * Tanglish (romanised Tamil) → Tamil script.
 *
 * Why this exists: a `ta-IN` neural voice reads Latin letters with English
 * phonetics. `vanakkam` must reach the voice as `வணக்கம்` or it is not Tamil
 * any more.
 *
 * Design note, learned the hard way: Tanglish is **not** a consistent
 * romanisation. `sollu` needs `ொ` but `podu` needs `ோ`; `pannu` needs `ண்ண`
 * but `enna` needs `ன்ன`; `sollu` needs `ல்ல` but `thallu` needs `ள்ள`. The
 * same letters spell different Tamil. So:
 *
 *   1. **dictionary first** (`data/tanglish-ta.json`) — the source of truth,
 *      user-editable, covers the high-frequency words that actually matter;
 *   2. **rules second** — a best-effort fallback for the long tail (names,
 *      slang, new words) so a new word is never left unreadable.
 *
 * The rule engine's job is "a Tamil speaker understands it", not "textbook
 * orthography". When it is wrong, add a dictionary row — that is one line of
 * data, not another special case in the code.
 */

import rawData from '../data/tanglish-ta.json' with { type: 'json' };
import { normalizeWord } from './lexicon';
import { segmentWithOverrides } from './overrides';
import type { OverrideSpan, SegmentOptions, TextRun } from './types';

const VIRAMA = '\u0BCD';

export interface TransliterationData {
  version: number;
  updated: string;
  note?: string;
  words: Record<string, string>;
}

export type TransliterationDict = ReadonlyMap<string, string>;

export const TRANSLITERATION_DATA = rawData as TransliterationData;

export const DEFAULT_TRANSLITERATION: TransliterationDict = new Map(
  Object.entries(TRANSLITERATION_DATA.words),
);

/** Build a dictionary from the defaults, with later entries winning. */
export function createTransliterationDict(
  extra: Record<string, string> | Iterable<readonly [string, string]> = {},
): TransliterationDict {
  const out = new Map<string, string>(DEFAULT_TRANSLITERATION);
  const entries =
    Symbol.iterator in extra ? extra : Object.entries(extra as Record<string, string>);
  for (const [word, tamil] of entries) {
    const key = normalizeWord(word);
    if (key.length > 0 && tamil.length > 0) out.set(key, tamil);
  }
  return out;
}

interface ConsonantToken {
  roman: string;
  tamil: string;
}

interface VowelToken {
  roman: string;
  /** Matra that attaches to a preceding consonant. Empty for inherent `a`. */
  matra: string;
  /** Standalone form used at the start of a word or after another vowel. */
  independent: string;
}

// Longest-first: the matcher takes the first entry that fits.
const CONSONANTS: readonly ConsonantToken[] = [
  { roman: 'zh', tamil: 'ழ' },
  { roman: 'th', tamil: 'த' },
  { roman: 'dh', tamil: 'த' },
  { roman: 'sh', tamil: 'ஷ' },
  { roman: 'ch', tamil: 'ச' },
  { roman: 'nh', tamil: 'ண' },
  { roman: 'kh', tamil: 'க' },
  { roman: 'gh', tamil: 'க' },
  { roman: 'bh', tamil: 'ப' },
  { roman: 'ph', tamil: 'ப' },
  { roman: 'lh', tamil: 'ள' },
  { roman: 'rh', tamil: 'ற' },
  { roman: 'k', tamil: 'க' },
  { roman: 'g', tamil: 'க' },
  { roman: 'c', tamil: 'ச' },
  { roman: 'j', tamil: 'ஜ' },
  { roman: 't', tamil: 'ட' },
  { roman: 'd', tamil: 'ட' },
  { roman: 'n', tamil: 'ந' },
  { roman: 'p', tamil: 'ப' },
  { roman: 'b', tamil: 'ப' },
  { roman: 'm', tamil: 'ம' },
  { roman: 'y', tamil: 'ய' },
  { roman: 'r', tamil: 'ர' },
  { roman: 'l', tamil: 'ல' },
  { roman: 'v', tamil: 'வ' },
  { roman: 's', tamil: 'ச' },
  { roman: 'h', tamil: 'ஹ' },
  { roman: 'f', tamil: 'ஃப' },
  { roman: 'z', tamil: 'ஜ' },
];

const VOWELS: readonly VowelToken[] = [
  { roman: 'aa', matra: 'ா', independent: 'ஆ' },
  { roman: 'ee', matra: 'ீ', independent: 'ஈ' },
  { roman: 'ii', matra: 'ீ', independent: 'ஈ' },
  { roman: 'oo', matra: 'ூ', independent: 'ஊ' },
  { roman: 'uu', matra: 'ூ', independent: 'ஊ' },
  { roman: 'ai', matra: 'ை', independent: 'ஐ' },
  { roman: 'au', matra: 'ௌ', independent: 'ஔ' },
  { roman: 'a', matra: '', independent: 'அ' },
  { roman: 'e', matra: 'ெ', independent: 'எ' },
  { roman: 'i', matra: 'ி', independent: 'இ' },
  { roman: 'o', matra: 'ொ', independent: 'ஒ' },
  { roman: 'u', matra: 'ு', independent: 'உ' },
];

const NASALS = new Set(['ங', 'ஞ', 'ண', 'ந', 'ன', 'ம']);

/**
 * The nasal that Tamil orthography requires before a given consonant.
 * `vanakkam` is `வணக்கம்` for lexical reasons the rules cannot infer, so this
 * only covers the mechanical cases.
 */
const CODA_NASAL: ReadonlyMap<string, string> = new Map([
  ['க', 'ங'],
  ['ச', 'ஞ'],
  ['ஜ', 'ஞ'],
  ['ஷ', 'ஞ'],
  ['ட', 'ண'],
  ['த', 'ந'],
  ['ப', 'ம'],
  ['ம', 'ம'],
  ['ய', 'ன'],
  ['ர', 'ன'],
  ['ல', 'ன'],
  ['வ', 'ன'],
  ['ழ', 'ன'],
  ['ற', 'ன'],
]);

function matchConsonant(text: string, at: number): ConsonantToken | null {
  for (const token of CONSONANTS) {
    if (text.startsWith(token.roman, at)) return token;
  }
  return null;
}

function matchVowel(text: string, at: number): VowelToken | null {
  for (const token of VOWELS) {
    if (text.startsWith(token.roman, at)) return token;
  }
  return null;
}

/**
 * Rule-based transliteration of a single word.
 *
 * State machine: a consonant is held as `pending` until a vowel attaches to
 * it. A second consonant while one is still pending means the pending one is
 * a coda, so it is flushed with a virama (and, for nasals, corrected to the
 * homorganic nasal the following consonant demands).
 */
function ruleTransliterate(word: string): string {
  const lower = word.toLowerCase();
  let out = '';
  let pending: string | null = null;
  let index = 0;

  while (index < lower.length) {
    const consonant = matchConsonant(lower, index);

    if (consonant !== null) {
      if (pending !== null) {
        out += flushCoda(pending, consonant.tamil);
      }
      pending = consonant.tamil;
      index += consonant.roman.length;
      continue;
    }

    const vowel = matchVowel(lower, index);

    if (vowel !== null) {
      if (pending !== null) {
        out += pending + vowel.matra;
        pending = null;
      } else {
        out += vowel.independent;
      }
      index += vowel.roman.length;
      continue;
    }

    // Unknown character: close the syllable and copy it through.
    if (pending !== null) {
      out += pending + VIRAMA;
      pending = null;
    }
    out += word.charAt(index);
    index += 1;
  }

  if (pending !== null) out += finalConsonant(pending) + VIRAMA;
  return out;
}

/**
 * Word-final consonant. Tamil writes final `n` with `ன்`, not `ந்`:
 * `en` is `என்`, `avan` is `அவன்`, `thirudan` is `திருடன்`.
 */
function finalConsonant(held: string): string {
  // Bare letter: the caller appends the virama.
  return held === 'ந' ? 'ன' : held;
}

/** Close a held consonant because another consonant follows it. */
function flushCoda(held: string, next: string): string {
  // Geminates: nn and rr are written with their own letter in colloquial Tamil.
  if (held === 'ந' && next === 'ந') return 'ண்ண';
  if (held === 'ர' && next === 'ர') return 'ற்ற';
  if (NASALS.has(held)) {
    const nasal = CODA_NASAL.get(next);
    if (nasal !== undefined) return nasal + VIRAMA;
  }
  return held + VIRAMA;
}

/**
 * True when `word` is entirely Latin letters — the only input this module
 * rewrites. Tamil script, digits, emoji and punctuation are left alone.
 */
function isLatinWord(word: string): boolean {
  return /^[A-Za-z\u00c0-\u024f]+$/u.test(word);
}

/**
 * Transliterate one word, preserving any surrounding punctuation.
 * A word with no dictionary entry falls back to the rule engine; a word with
 * no Latin letters is returned untouched.
 */
export function transliterateWord(
  word: string,
  dict: TransliterationDict = DEFAULT_TRANSLITERATION,
): string {
  if (word.length === 0) return word;

  const start = word.search(/[A-Za-z\u00c0-\u024f]/u);
  if (start === -1) return word;
  const endMatch = /[A-Za-z\u00c0-\u024f](?=[^A-Za-z\u00c0-\u024f]*$)/u.exec(word);
  const end = endMatch === null ? word.length : endMatch.index + 1;

  const prefix = word.slice(0, start);
  const core = word.slice(start, end);
  const suffix = word.slice(end);

  const key = normalizeWord(core);
  if (key.length === 0) return word;

  const hit = dict.get(key);
  if (hit !== undefined) return prefix + hit + suffix;

  return prefix + ruleTransliterate(core) + suffix;
}

/**
 * Transliterate every Latin word in a string, leaving everything else
 * (spaces, punctuation, Tamil script, emoji, digits) exactly where it was.
 *
 * WARNING: this rewrites *English too*. For narration use
 * `transliterateTanglish()`, which asks the segmenter which words are
 * actually Tamil. This raw form exists for tests and for the editor's
 * per-run override.
 */
export function transliterateText(
  text: string,
  dict: TransliterationDict = DEFAULT_TRANSLITERATION,
): string {
  return text.replace(
    /[A-Za-z\u00c0-\u024f]+/gu,
    (word) => transliterateWord(word, dict),
  );
}

/**
 * Rewrite only the Tanglish runs. Native Tamil and English are untouched,
 * which is the whole point: only Tanglish was mis-routed to the wrong
 * orthography.
 */
export function transliterateRuns(
  runs: readonly TextRun[],
  dict: TransliterationDict = DEFAULT_TRANSLITERATION,
): TextRun[] {
  return runs.map((run) =>
    // A run that is pure Latin and still routed to Tamil was forced there by
    // `[[ta:…]]`: the author wants the Tamil voice reading English words, not a
    // transliteration. Everything else that is Tamil may contain romanised
    // words, because the segmenter merges adjacent Tamil and Tanglish runs.
    run.script === 'latin' ? run : { ...run, text: transliterateText(run.text, dict) },
  );
}

export interface TanglishNarration {
  /** Runs with every Tanglish run now in Tamil script, order preserved. */
  runs: TextRun[];
  /** The same runs joined back into one string, ready for the media service. */
  text: string;
  /** Inline `[[ta:…]]` spans that were consumed, in `text` coordinates. */
  spans: OverrideSpan[];
}

/**
 * The safe entry point: parse inline overrides, segment, then transliterate
 * only what is Tanglish.
 *
 * It must go through `segmentWithOverrides` — not `segmentText` — or a
 * `[[en:…]]` marker ends up being transliterated as if it were speech.
 */
export function transliterateTanglish(
  text: string,
  options: SegmentOptions = {},
  dict: TransliterationDict = DEFAULT_TRANSLITERATION,
): TanglishNarration {
  const segmented = segmentWithOverrides(text, options);
  const runs = transliterateRuns(segmented.runs, dict);
  return {
    runs,
    text: runs.map((run) => run.text).join(' '),
    spans: segmented.spans,
  };
}

/**
 * Reason a word will not be read correctly, for the editor's audit view.
 * `dictionary` = pinned, `rules` = best effort, `none` = not Latin.
 */
export type TransliterationSource = 'dictionary' | 'rules' | 'none';

export function transliterationSource(
  word: string,
  dict: TransliterationDict = DEFAULT_TRANSLITERATION,
): TransliterationSource {
  if (!isLatinWord(word)) return 'none';
  return dict.has(normalizeWord(word)) ? 'dictionary' : 'rules';
}
