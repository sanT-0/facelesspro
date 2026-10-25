/**
 * Script-aware text segmentation for Tamil + English narration.
 *
 * The splitter is intentionally conservative: it only decides which voice a
 * piece of text should be spoken with. It never rewrites the text.
 */

import type { Lang, ScriptKind, SegmentOptions, TextRun } from './types';

const TAMIL_START = 0x0b80;
const TAMIL_END = 0x0bff;
const ZERO_WIDTH = new Set(['\u200c', '\u200d']);

/**
 * Common romanised Tamil words. Kept deliberately small and unambiguous:
 * words that are also normal English ("van", "man", "an") are excluded so we
 * do not misroute English narration to the Tamil voice.
 */
export const DEFAULT_TANGLISH: ReadonlySet<string> = new Set([
  'vanakkam', 'vanakam', 'machan', 'machi', 'thambi', 'thangachi',
  'anna', 'akka', 'appa', 'amma', 'ayya', 'naan', 'nee', 'neenga',
  'avan', 'ava', 'avanga', 'ivan', 'ivanga', 'adhu', 'idhu', 'adhukku',
  'idhukku', 'adhaan', 'idhaan', 'ellam', 'ellaam', 'romba', 'rombha',
  'konjam', 'nalla', 'nalladhu', 'mosam', 'semma', 'seri', 'sari',
  'illa', 'illai', 'irukku', 'iruku', 'irukkum', 'irundhu', 'irunga',
  'pannu', 'pannunga', 'pannuvom', 'panniten', 'panniruken', 'sollu',
  'sollunga', 'solren', 'sonna', 'ketta', 'kekka', 'kelunga', 'paaru',
  'paakka', 'paarunga', 'podu', 'podunga', 'pottu', 'poidu', 'pochu',
  'vanthu', 'vandhu', 'poga', 'pogalam', 'vaanga', 'venum', 'vendam',
  'mudiyum', 'mudiyadhu', 'theriyum', 'theriyadhu', 'puriyum', 'puriyala',
  'enna', 'epdi', 'eppadi', 'yaaru', 'yaar', 'enga', 'inga', 'anga',
  'eppo', 'ippo', 'appo', 'apram', 'aprom', 'onnu', 'rendu', 'moonu',
  'naalu', 'anju', 'aaru', 'ezhu', 'ettu', 'onbadhu', 'pathu', 'nooru',
  'aayiram', 'kaasu', 'panam', 'velai', 'veedu', 'veetla', 'pasanga',
  'pothu', 'sethu', 'setha', 'saavu', 'sethuru', 'thaan', 'dhaan',
  'kooda', 'kuda', 'mattum', 'ponnu', 'paiyan', 'payan', 'periya',
  'chinna', 'pudhu', 'palaya', 'mela', 'keela', 'ulle', 'velila',
  'nethu', 'innaiku', 'naalai', 'kaalaila', 'raathiri', 'panam',
]);

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

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '');
}

interface Token {
  text: string;
  kind: 'word' | 'sep';
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let buffer = '';
  let bufferKind: Token['kind'] | null = null;

  for (const ch of input) {
    const kind: Token['kind'] = isWordChar(ch) ? 'word' : 'sep';
    if (bufferKind === kind) {
      buffer += ch;
      continue;
    }
    if (buffer.length > 0 && bufferKind !== null) {
      tokens.push({ text: buffer, kind: bufferKind });
    }
    buffer = ch;
    bufferKind = kind;
  }

  if (buffer.length > 0 && bufferKind !== null) {
    tokens.push({ text: buffer, kind: bufferKind });
  }
  return tokens;
}

function classifyWord(
  word: string,
  lexicon: ReadonlySet<string>,
): { lang: Lang; script: ScriptKind } {
  for (const ch of word) {
    if (isTamilChar(ch)) return { lang: 'ta', script: 'tamil' };
  }
  if (lexicon.has(normalizeWord(word))) {
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
  const lexicon = options.tanglish ?? DEFAULT_TANGLISH;
  const tokens = tokenize(input);

  const runs: TextRun[] = [];
  let pendingSeparator = '';
  let current: TextRun | null = null;

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

    const { lang, script } = classifyWord(token.text, lexicon);

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
