/**
 * Number, currency, percentage and time expansion.
 *
 * Runs **before** segmentation: the tokenizer treats digits as separators, so a
 * number is invisible to the language labeller. That means the language of a
 * number has to be inferred from the words around it — which is what
 * `expandNumbersContextual()` does.
 *
 * Why it matters: a Tamil voice reading `2024` as "two zero two four" is
 * instantly wrong. `இரண்டாயிரத்து இருபத்துநான்கு` is the whole point.
 *
 * Written-number convention: Tamil compounds are written joined
 * (`இருபத்துநான்கு`), which is the common newspaper form. English uses Indian
 * grouping (lakh/crore), because the narration is aimed at an Indian audience.
 */

import { segmentText } from './segmenter';
import type { Lang, OverrideSpan } from './types';

export type NumberLang = Lang;

const TA_BELOW_100: readonly string[] = [
  'பூஜ்ஜியம்',
  'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது',
  'பத்து', 'பதினொன்று', 'பன்னிரண்டு', 'பதின்மூன்று', 'பதினான்கு', 'பதினைந்து',
  'பதினாறு', 'பதினேழு', 'பதினெட்டு', 'பத்தொன்பது',
  'இருபது', 'இருபத்தொன்று', 'இருபத்திரண்டு', 'இருபத்துமூன்று', 'இருபத்துநான்கு',
  'இருபத்தைந்து', 'இருபத்தாறு', 'இருபத்தேழு', 'இருபத்தெட்டு', 'இருபத்தொன்பது',
  'முப்பது', 'முப்பத்தொன்று', 'முப்பத்திரண்டு', 'முப்பத்துமூன்று', 'முப்பத்துநான்கு',
  'முப்பத்தைந்து', 'முப்பத்தாறு', 'முப்பத்தேழு', 'முப்பத்தெட்டு', 'முப்பத்தொன்பது',
  'நாற்பது', 'நாற்பத்தொன்று', 'நாற்பத்திரண்டு', 'நாற்பத்துமூன்று', 'நாற்பத்துநான்கு',
  'நாற்பத்தைந்து', 'நாற்பத்தாறு', 'நாற்பத்தேழு', 'நாற்பத்தெட்டு', 'நாற்பத்தொன்பது',
  'ஐம்பது', 'ஐம்பத்தொன்று', 'ஐம்பத்திரண்டு', 'ஐம்பத்துமூன்று', 'ஐம்பத்துநான்கு',
  'ஐம்பத்தைந்து', 'ஐம்பத்தாறு', 'ஐம்பத்தேழு', 'ஐம்பத்தெட்டு', 'ஐம்பத்தொன்பது',
  'அறுபது', 'அறுபத்தொன்று', 'அறுபத்திரண்டு', 'அறுபத்துமூன்று', 'அறுபத்துநான்கு',
  'அறுபத்தைந்து', 'அறுபத்தாறு', 'அறுபத்தேழு', 'அறுபத்தெட்டு', 'அறுபத்தொன்பது',
  'எழுபது', 'எழுபத்தொன்று', 'எழுபத்திரண்டு', 'எழுபத்துமூன்று', 'எழுபத்துநான்கு',
  'எழுபத்தைந்து', 'எழுபத்தாறு', 'எழுபத்தேழு', 'எழுபத்தெட்டு', 'எழுபத்தொன்பது',
  'எண்பது', 'எண்பத்தொன்று', 'எண்பத்திரண்டு', 'எண்பத்துமூன்று', 'எண்பத்துநான்கு',
  'எண்பத்தைந்து', 'எண்பத்தாறு', 'எண்பத்தேழு', 'எண்பத்தெட்டு', 'எண்பத்தொன்பது',
  'தொண்ணூறு', 'தொண்ணூற்றொன்று', 'தொண்ணூற்றிரண்டு', 'தொண்ணூற்றுமூன்று',
  'தொண்ணூற்றுநான்கு', 'தொண்ணூற்றைந்து', 'தொண்ணூற்றாறு', 'தொண்ணூற்றேழு',
  'தொண்ணூற்றெட்டு', 'தொண்ணூற்றொன்பது',
];

const TA_HUNDRED: readonly string[] = [
  '',
  'நூறு', 'இருநூறு', 'முந்நூறு', 'நானூறு', 'ஐந்நூறு', 'அறுநூறு', 'எழுநூறு',
  'எண்ணூறு', 'தொள்ளாயிரம்',
];

const TA_HUNDRED_LINK: readonly string[] = [
  '',
  'நூற்று', 'இருநூற்று', 'முந்நூற்று', 'நானூற்று', 'ஐநூற்று', 'அறுநூற்று',
  'எழுநூற்று', 'எண்ணூற்று', 'தொள்ளாயிரத்து',
];

const EN_BELOW_20: readonly string[] = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];

const EN_TENS: readonly string[] = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

/** Largest value we will spell out; beyond this the digits are left alone. */
const MAX_SAFE = 1e9;

function englishBelow100(n: number): string {
  if (n < 20) return EN_BELOW_20[n]!;
  const tens = EN_TENS[Math.floor(n / 10)]!;
  const unit = n % 10;
  return unit === 0 ? tens : `${tens}-${EN_BELOW_20[unit]!}`;
}

function englishBelow1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return englishBelow100(rest);
  const head = `${EN_BELOW_20[hundreds]!} hundred`;
  return rest === 0 ? head : `${head} ${englishBelow100(rest)}`;
}

function englishInteger(n: number): string {
  if (n < 1000) return englishBelow1000(n);
  if (n < 1e5) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const head = `${englishBelow100(thousands)} thousand`;
    return rest === 0 ? head : `${head} ${englishBelow1000(rest)}`;
  }
  if (n < 1e7) {
    const lakhs = Math.floor(n / 1e5);
    const rest = n % 1e5;
    const head = `${englishBelow100(lakhs)} lakh`;
    return rest === 0 ? head : `${head} ${englishInteger(rest)}`;
  }
  const crores = Math.floor(n / 1e7);
  const rest = n % 1e7;
  const head = `${englishBelow100(crores)} crore`;
  return rest === 0 ? head : `${head} ${englishInteger(rest)}`;
}

/**
 * Year reading: `2024` → "twenty twenty-four", `1999` → "nineteen ninety-nine",
 * `1500` → "fifteen hundred", `2005` → "twenty oh five".
 */
function englishYear(n: number): string {
  if (n % 1000 === 0) return `${englishBelow100(n / 1000)} thousand`;
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) return `${englishBelow100(high)} hundred`;
  if (low < 10) return `${englishBelow100(high)} oh ${englishBelow100(low)}`;
  return `${englishBelow100(high)} ${englishBelow100(low)}`;
}

/** `இருபது` → `இருபதாயிரம்`, `நான்கு` → `நாலாயிரம்`. */
const IRREGULAR_THOUSANDS: Readonly<Record<number, string>> = {
  2: 'இரண்டாயிரம்',
  3: 'மூவாயிரம்',
  4: 'நாலாயிரம்',
  5: 'ஐயாயிரம்',
};

function thousandsStem(n: number): string {
  const irregular = IRREGULAR_THOUSANDS[n];
  if (irregular !== undefined) return irregular;
  const word = TA_BELOW_100[n]!;
  const trimmed = word.endsWith('ு') ? word.slice(0, -1) : word;
  return `${trimmed}ாயிரம்`;
}

/** `இரண்டாயிரம்` → `இரண்டாயிரத்து`, `ஐந்நூறு` → `ஐந்நூற்று`. */
function tamilLink(word: string): string {
  if (word.endsWith('ம்')) return `${word.slice(0, -2)}த்து`;
  if (word.endsWith('ு')) return `${word.slice(0, -1)}ற்று`;
  return word;
}

function tamilInteger(n: number): string {
  if (n < 100) return TA_BELOW_100[n]!;
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    if (rest === 0) return TA_HUNDRED[hundreds]!;
    return `${TA_HUNDRED_LINK[hundreds]!} ${TA_BELOW_100[rest]!}`;
  }
  if (n < 1e5) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const base = thousands === 1 ? 'ஆயிரம்' : thousandsStem(thousands);
    if (rest === 0) return base;
    return `${tamilLink(base)} ${tamilInteger(rest)}`;
  }
  if (n < 1e7) {
    const lakhs = Math.floor(n / 1e5);
    const rest = n % 1e5;
    const stem = lakhs === 1 ? 'ஒரு லட்சம்' : `${TA_BELOW_100[lakhs]!} லட்சம்`;
    if (rest === 0) return stem;
    return `${tamilLink(stem)} ${tamilInteger(rest)}`;
  }
  const crores = Math.floor(n / 1e7);
  const rest = n % 1e7;
  const stem = crores === 1 ? 'ஒரு கோடி' : `${TA_BELOW_100[crores]!} கோடி`;
  if (rest === 0) return stem;
  return `${tamilLink(stem)} ${tamilInteger(rest)}`;
}

function tamilDecimal(intPart: number, fraction: string): string {
  const units: string[] = [];
  for (const digit of fraction) units.push(TA_BELOW_100[Number(digit)]!);
  return `${tamilInteger(intPart)} புள்ளி ${units.join(' ')}`;
}

function englishDecimal(intPart: number, fraction: string): string {
  const units: string[] = [];
  for (const digit of fraction) units.push(EN_BELOW_20[Number(digit)]!);
  return `${englishInteger(intPart)} point ${units.join(' ')}`;
}

export interface NumberWordsOptions {
  /** Read 4-digit values as years (`twenty twenty-four`). Default `true`. */
  year?: boolean;
}

/** Spell a non-negative number. Fractional digits are read one at a time. */
export function numberToWords(
  value: number,
  lang: NumberLang,
  options: NumberWordsOptions = {},
): string {
  if (!Number.isFinite(value) || value < 0 || value >= MAX_SAFE) return String(value);
  const whole = Math.trunc(value);

  if (lang === 'ta') return tamilInteger(whole);

  const isYear =
    options.year !== false && whole >= 1100 && whole <= 2099 && whole % 1000 !== 0;
  return isYear ? englishYear(whole) : englishInteger(whole);
}

/** s `2,024.5` → `2024|5`. Returns null when the text is not a plain number. */
function parseNumberText(raw: string): { value: number; fraction: string } | null {
  const cleaned = raw.replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/u.test(cleaned)) return null;
  const [intPart, fraction = ''] = cleaned.split('.');
  const value = Number(intPart);
  if (!Number.isSafeInteger(value) || value < 0 || value >= MAX_SAFE) return null;
  return { value, fraction };
}

function spell(
  parsed: { value: number; fraction: string },
  lang: NumberLang,
  kind: 'plain' | 'currency' | 'percent' | 'time',
  options: NumberWordsOptions,
): string {
  const { value, fraction } = parsed;

  const words =
    fraction.length > 0
      ? lang === 'ta'
        ? tamilDecimal(value, fraction)
        : englishDecimal(value, fraction)
      : numberToWords(value, lang, kind === 'plain' ? options : { year: false });

  if (kind === 'currency') return lang === 'ta' ? `${words} ரூபாய்` : `${words} rupees`;
  if (kind === 'percent') return lang === 'ta' ? `${words} சதவீதம்` : `${words} percent`;
  return words;
}

// Currency prefix, number, optional unit suffix. The lookbehind stops us from
// rewriting digits that are part of an identifier (`mp3`, `h264`, `v2`).
const NUMBER_TOKEN =
  /(?<![A-Za-z0-9])(?:(₹|Rs\.?|INR)\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(%|percent|am|pm|a\.m\.|p\.m\.))?(?![A-Za-z0-9])/giu;

interface NumberMatch {
  start: number;
  end: number;
  parsed: { value: number; fraction: string };
  kind: 'plain' | 'currency' | 'percent' | 'time';
  meridiem?: 'am' | 'pm';
}

function findNumbers(text: string): NumberMatch[] {
  const out: NumberMatch[] = [];
  NUMBER_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = NUMBER_TOKEN.exec(text)) !== null) {
    const [, prefix, digits, suffix] = match;
    if (digits === undefined) continue;
    const parsed = parseNumberText(digits);
    if (parsed === null) continue;

    let kind: NumberMatch['kind'] = 'plain';
    let meridiem: NumberMatch['meridiem'];
    if (prefix !== undefined) kind = 'currency';
    else if (suffix !== undefined) {
      const unit = suffix.toLowerCase();
      if (unit === '%' || unit === 'percent') {
        kind = 'percent';
      } else {
        kind = 'time';
        meridiem = unit.startsWith('a') ? 'am' : 'pm';
      }
    }

    out.push({ start: match.index, end: match.index + match[0].length, parsed, kind, meridiem });
  }
  return out;
}

function renderMatch(
  match: NumberMatch,
  lang: NumberLang,
  options: NumberWordsOptions,
): string {
  const words = spell(match.parsed, lang, match.kind, options);

  if (match.kind === 'time') {
    // `3pm` → `மூன்று மணி` / `three p m`
    const suffix = match.meridiem === 'am' ? 'a m' : 'p m';
    return lang === 'ta' ? `${words} மணி` : `${words} ${suffix}`;
  }
  return words;
}

/**
 * Expand every number in `text` using one language.
 */
export function expandNumbers(
  text: string,
  lang: NumberLang,
  options: NumberWordsOptions = {},
): string {
  const matches = findNumbers(text);
  if (matches.length === 0) return text;

  let out = '';
  let cursor = 0;
  for (const match of matches) {
    out += text.slice(cursor, match.start);
    out += renderMatch(match, lang, options);
    cursor = match.end;
  }
  return out + text.slice(cursor);
}

export interface ExpandContextualOptions extends NumberWordsOptions {
  /** Used when there is no word on either side to ask. Default `en`. */
  defaultLang?: NumberLang;
}

const CLAUSE_BREAK = /[.!?।…,;:]/u;

/** Text between the nearest clause breaks on both sides of a number. */
function clauseWindow(
  text: string,
  match: NumberMatch,
  nextStart: number,
): string {
  const before = text.slice(0, match.start);
  let start = 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    if (CLAUSE_BREAK.test(before[i]!)) {
      start = i + 1;
      break;
    }
  }

  const after = text.slice(match.end, nextStart);
  const stop = after.search(CLAUSE_BREAK);
  return `${before.slice(start)} ${stop === -1 ? after : after.slice(0, stop)}`;
}

/**
 * Language of a number: the majority language of its own clause, not the word
 * immediately before it.
 *
 * A single English loanword must not flip the whole clause: in
 * `எங்கள் business ₹1,20,000 லாபம்` the number is Tamil even though the word in
 * front of it is English. Ties fall back to the nearest preceding word, then the
 * nearest following word, then `defaultLang`.
 */
function matchLang(
  text: string,
  matches: readonly NumberMatch[],
  index: number,
): NumberLang | null {
  const match = matches[index]!;
  const window = clauseWindow(text, match, matches[index + 1]?.start ?? text.length);

  let ta = 0;
  let en = 0;
  for (const run of segmentText(window)) {
    const words = run.text.split(/\s+/u).filter((word) => /\p{L}/u.test(word)).length;
    if (run.lang === 'ta') ta += words;
    else en += words;
  }
  if (ta > en) return 'ta';
  if (en > ta) return 'en';

  const previous = segmentText(text.slice(0, match.start)).at(-1);
  if (previous !== undefined) return previous.lang;

  const after = text.slice(match.end, matches[index + 1]?.start ?? text.length);
  return segmentText(after)[0]?.lang ?? null;
}

/**
 * Expand each number in the language of its own clause.
 *
 * `₹500 கொடுங்க` → Tamil, `it costs ₹500` → English, in the same string.
 * The language comes from the nearest preceding word, then the nearest
 * following word, then `defaultLang`.
 */
export function expandNumbersContextual(
  text: string,
  options: ExpandContextualOptions = {},
): string {
  const matches = findNumbers(text);
  if (matches.length === 0) return text;

  const { defaultLang = 'en', ...words } = options;

  let out = '';
  let cursor = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    out += text.slice(cursor, match.start);
    out += renderMatch(match, matchLang(text, matches, i) ?? defaultLang, words);
    cursor = match.end;
  }
  return out + text.slice(cursor);
}

export interface ExpandedWithSpans {
  text: string;
  /** Forced spans moved onto the expanded text. */
  spans: OverrideSpan[];
}

/**
 * Expand numbers on marker-stripped text, honouring forced-language spans.
 *
 * Two things have to happen together: `[[en:2024]]` must be read as English even
 * inside a Tamil sentence, and every span after an expansion must move by the
 * number of characters that expansion added. Doing them in separate passes is
 * how overrides silently drift onto the wrong words.
 */
export function expandNumbersSpanned(
  text: string,
  spans: readonly OverrideSpan[],
  options: ExpandContextualOptions = {},
): ExpandedWithSpans {
  const matches = findNumbers(text);
  if (matches.length === 0) return { text, spans: [...spans] };

  const { defaultLang = 'en', ...words } = options;

  const langOf = (index: number): NumberLang => {
    const match = matches[index]!;
    const forced = spans.find(
      (span) => span.start <= match.start && match.start < span.end,
    );
    return forced?.lang ?? matchLang(text, matches, index) ?? defaultLang;
  };

  const changes: { start: number; delta: number }[] = [];
  let out = '';
  let cursor = 0;

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    const rendered = renderMatch(match, langOf(i), words);
    out += text.slice(cursor, match.start) + rendered;
    cursor = match.end;

    const change = rendered.length - (match.end - match.start);
    if (change !== 0) {
      changes.push({ start: match.start, delta: change });
    }
  }
  out += text.slice(cursor);

  const shift = (position: number): number => {
    let total = 0;
    for (const change of changes) {
      if (change.start < position) total += change.delta;
      else break;
    }
    return total;
  };

  return {
    text: out,
    spans: spans.map((span) => ({
      ...span,
      start: span.start + shift(span.start),
      end: span.end + shift(span.end),
    })),
  };
}
