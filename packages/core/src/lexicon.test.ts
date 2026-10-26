import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEXICON,
  DEFAULT_TANGLISH,
  TANGLISH_DATA,
  createLexicon,
  extendLexicon,
  hasTanglishInflection,
  isTanglishWord,
  normalizeWord,
} from './lexicon';
import { segmentText } from './segmenter';

describe('tanglish data file', () => {
  it('is versioned and large enough to be useful', () => {
    expect(TANGLISH_DATA.version).toBeGreaterThanOrEqual(1);
    expect(TANGLISH_DATA.words.length).toBeGreaterThanOrEqual(450);
    expect(TANGLISH_DATA.roots.length).toBeGreaterThanOrEqual(20);
    expect(TANGLISH_DATA.suffixes.length).toBeGreaterThanOrEqual(10);
  });

  it('contains only normalisable entries', () => {
    for (const word of TANGLISH_DATA.words) {
      expect(normalizeWord(word).length).toBeGreaterThan(0);
    }
  });

  it('sorts suffixes longest-first so the greedy match is unambiguous', () => {
    const lengths = DEFAULT_LEXICON.suffixes.map((s) => s.length);
    const sorted = [...lengths].sort((a, b) => b - a);
    expect(lengths).toEqual(sorted);
  });

  it('never lists a protected English word as Tanglish', () => {
    for (const word of DEFAULT_LEXICON.protected) {
      expect(DEFAULT_TANGLISH.has(word)).toBe(false);
    }
  });
});

describe('normalizeWord', () => {
  it('lower-cases and strips non-letters', () => {
    expect(normalizeWord('Vanakkam!')).toBe('vanakkam');
    expect(normalizeWord("  machan's ")).toBe('machans');
    expect(normalizeWord('12345')).toBe('');
    expect(normalizeWord('தமிழ்')).toBe('');
  });
});

describe('isTanglishWord — exact match', () => {
  it('matches lexicon words regardless of case or punctuation', () => {
    expect(isTanglishWord('vanakkam')).toBe(true);
    expect(isTanglishWord('Vanakkam')).toBe(true);
    expect(isTanglishWord('VANAKKAM!')).toBe(true);
    expect(isTanglishWord('machan,')).toBe(true);
  });

  it('rejects ordinary English words', () => {
    for (const word of ['budget', 'planning', 'start', 'everything', 'maps', 'english']) {
      expect(isTanglishWord(word)).toBe(false);
    }
  });

  it('rejects empty and non-Latin input without throwing', () => {
    for (const word of ['', '   ', '12345', '😀', 'தமிழ்', '\u200d']) {
      expect(isTanglishWord(word)).toBe(false);
    }
  });
});

describe('isTanglishWord — inflection', () => {
  it('accepts known root + known suffix', () => {
    expect(isTanglishWord('veetukku')).toBe(true);
    expect(isTanglishWord('velaila')).toBe(true);
    expect(isTanglishWord('pannanum')).toBe(true);
    expect(isTanglishWord('sollanum')).toBe(true);
    expect(isTanglishWord('irukkanga')).toBe(true);
  });

  it('reports the same decision through hasTanglishInflection', () => {
    expect(hasTanglishInflection('veetukku')).toBe(true);
    expect(hasTanglishInflection('article')).toBe(false);
  });

  it('rejects English words that merely end in a Tamil suffix', () => {
    for (const word of ['google', 'article', 'state', 'sale', 'name', 'game', 'data', 'episode']) {
      expect(isTanglishWord(word)).toBe(false);
    }
  });

  it('rejects an unknown stem even with a valid suffix', () => {
    expect(isTanglishWord('stuffku')).toBe(false);
    expect(isTanglishWord('serverla')).toBe(false);
    expect(isTanglishWord('daykku')).toBe(false);
  });

  it('ignores stems shorter than three letters', () => {
    expect(isTanglishWord('kku')).toBe(false);
    expect(isTanglishWord('akku')).toBe(false);
  });

  it('can be disabled', () => {
    // `oorukku` is root+suffix only, so it is the honest test of the switch.
    expect(isTanglishWord('oorukku', DEFAULT_LEXICON, false)).toBe(false);
    expect(isTanglishWord('oorukku', DEFAULT_LEXICON, true)).toBe(true);
    // an exact lexicon word still matches with morphology off
    expect(isTanglishWord('vanakkam', DEFAULT_LEXICON, false)).toBe(true);
  });
});

describe('protected words', () => {
  it('win over an exact word match', () => {
    const lexicon = createLexicon({
      words: ['sale', 'vanakkam'],
      protected: ['sale'],
    });
    expect(isTanglishWord('sale', lexicon)).toBe(false);
    expect(isTanglishWord('vanakkam', lexicon)).toBe(true);
  });
});

describe('createLexicon / extendLexicon', () => {
  it('replaces only the collections that were given', () => {
    const lexicon = createLexicon({ words: ['thalapathy'] });
    expect(isTanglishWord('thalapathy', lexicon)).toBe(true);
    expect(isTanglishWord('vanakkam', lexicon)).toBe(false);
    // roots and suffixes are inherited, so inflection still works
    expect(isTanglishWord('veetukku', lexicon)).toBe(true);
  });

  it('extends without mutating the base lexicon', () => {
    const extra = extendLexicon(DEFAULT_LEXICON, {
      words: ['thalapathy'],
      roots: ['thalapathy'],
    });
    expect(isTanglishWord('thalapathy', extra)).toBe(true);
    expect(DEFAULT_TANGLISH.has('thalapathy')).toBe(false);
    expect(isTanglishWord('vanakkam', extra)).toBe(true);
  });
});

describe('segmentText integration with the lexicon', () => {
  it('routes inflected Tanglish to the Tamil voice', () => {
    const runs = segmentText('veetukku poganum, let us go');
    expect(runs[0]).toMatchObject({ lang: 'ta', script: 'tanglish' });
    expect(runs[1]).toMatchObject({ lang: 'en', script: 'latin' });
  });

  it('keeps English that looks Tamil-ish on the English voice', () => {
    const runs = segmentText('the state of the article is on google');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.lang).toBe('en');
  });

  it('honours morphology: false', () => {
    const runs = segmentText('oorukku', { morphology: false });
    expect(runs[0]!.lang).toBe('en');
  });

  it('accepts a full custom lexicon', () => {
    const lexicon = createLexicon({ words: ['thalapathy'], protected: ['vanakkam'] });
    const runs = segmentText('thalapathy vanakkam', { lexicon });
    expect(runs[0]).toMatchObject({ lang: 'ta', script: 'tanglish' });
    expect(runs[1]!.lang).toBe('en');
  });
});
