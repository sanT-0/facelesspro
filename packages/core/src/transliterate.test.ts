import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSLITERATION,
  TRANSLITERATION_DATA,
  createTransliterationDict,
  transliterateRuns,
  transliterateTanglish,
  transliterateText,
  transliterateWord,
  transliterationSource,
} from './transliterate';
import { normalizeWord } from './lexicon';
import { segmentText } from './segmenter';

const TAMIL_ONLY = /^[\u0b80-\u0bff]+$/u;
const VIRAMA = '\u0bcd';
const DOUBLE_VIRAMA = new RegExp(`${VIRAMA}${VIRAMA}`, 'u');

describe('tanglish-ta data file', () => {
  const entries = Object.entries(TRANSLITERATION_DATA.words);

  it('is versioned and meets the golden-table target', () => {
    expect(TRANSLITERATION_DATA.version).toBeGreaterThanOrEqual(1);
    expect(entries.length).toBeGreaterThanOrEqual(300);
  });

  it('uses normalised keys, so lookup is case- and punctuation-free', () => {
    for (const [key] of entries) {
      expect(normalizeWord(key)).toBe(key);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('maps every key to Tamil script only', () => {
    for (const [key, value] of entries) {
      expect(value, `value for "${key}"`).toMatch(TAMIL_ONLY);
    }
  });

  it('contains no doubled virama, which would mean a broken final consonant', () => {
    for (const [key, value] of entries) {
      expect(DOUBLE_VIRAMA.test(value), `"${key}" -> "${value}"`).toBe(false);
    }
  });

  it('has no key that is also a protected English word', () => {
    // A word cannot be both "always English" and "always Tamil".
    const protectedWords = new Set([
      'van', 'man', 'an', 'the', 'can', 'pan', 'pen', 'ten', 'men', 'fan',
      'come', 'name', 'game', 'time', 'team', 'rate', 'date', 'sale', 'state',
      'plan', 'point', 'work', 'word', 'will', 'well', 'all', 'call', 'small',
    ]);
    for (const [key] of entries) {
      expect(protectedWords.has(key), `"${key}" is protected English`).toBe(false);
    }
  });
});

describe('transliterateWord — dictionary', () => {
  const golden: readonly (readonly [string, string])[] = [
    ['vanakkam', 'வணக்கம்'],
    ['machan', 'மச்சான்'],
    ['epdi', 'எப்படி'],
    ['irukka', 'இருக்க'],
    ['thambi', 'தம்பி'],
    ['nalla', 'நல்ல'],
    ['romba', 'ரொம்ப'],
    ['konjam', 'கொஞ்சம்'],
    ['kaasu', 'காசு'],
    ['veedu', 'வீடு'],
    ['velai', 'வேலை'],
    ['panam', 'பணம்'],
    ['enna', 'என்ன'],
    ['yaaru', 'யாரு'],
    ['innaiku', 'இன்னைக்கு'],
    ['naan', 'நான்'],
    ['neenga', 'நீங்க'],
    ['pannunga', 'பண்ணுங்க'],
    ['sollu', 'சொல்லு'],
    ['thallu', 'தள்ளு'],
    ['podu', 'போடு'],
    ['porom', 'போறோம்'],
    ['veetla', 'வீட்ல'],
    ['ponnu', 'பொண்ணு'],
    ['onnu', 'ஒண்ணு'],
    ['moonu', 'மூணு'],
    ['mukkiyam', 'முக்கியம்'],
    ['nandri', 'நன்றி'],
    ['kudumbam', 'குடும்பம்'],
    ['santhosham', 'சந்தோஷம்'],
  ];

  for (const [roman, tamil] of golden) {
    it(`${roman} → ${tamil}`, () => {
      expect(transliterateWord(roman)).toBe(tamil);
    });
  }

  it('ignores case', () => {
    expect(transliterateWord('Vanakkam')).toBe('வணக்கம்');
    expect(transliterateWord('VANAKKAM')).toBe('வணக்கம்');
  });

  it('keeps surrounding punctuation exactly where it was', () => {
    expect(transliterateWord('vanakkam,')).toBe('வணக்கம்,');
    expect(transliterateWord('"epdi?"')).toBe('"எப்படி?"');
    expect(transliterateWord('(nalla)')).toBe('(நல்ல)');
  });

  it('honours a custom dictionary', () => {
    const dict = createTransliterationDict({ thalapathy: 'தளபதி' });
    expect(transliterateWord('thalapathy', dict)).toBe('தளபதி');
    expect(transliterateWord('vanakkam', dict)).toBe('வணக்கம்');
  });

  it('lets a custom entry override the default', () => {
    const dict = createTransliterationDict({ vanakkam: 'வணக்கும்' });
    expect(transliterateWord('vanakkam', dict)).toBe('வணக்கும்');
    expect(transliterateWord('vanakkam')).toBe('வணக்கம்');
  });
});

describe('transliterateWord — rule engine (words not in the dictionary)', () => {
  // Only cases the rules can genuinely decide are asserted exactly.
  const golden: readonly (readonly [string, string])[] = [
    ['karumbu', 'கரும்பு'],
    ['palam', 'பலம்'],
    ['mazhai', 'மழை'],
    ['vazhi', 'வழி'],
    ['kai', 'கை'],
    ['vai', 'வை'],
    ['paal', 'பால்'],
    ['neer', 'நீர்'],
    ['magan', 'மகன்'],
  ];

  for (const [roman, tamil] of golden) {
    it(`${roman} → ${tamil}`, () => {
      expect(transliterateWord(roman)).toBe(tamil);
    });
  }

  it('writes a word-final n as ன், never as doubled marks', () => {
    const out = transliterateWord('magan');
    expect(out.endsWith('ன்')).toBe(true);
    expect(out).not.toContain('\u0ba8\u0bcd\u0bcd');
    expect(DOUBLE_VIRAMA.test(out)).toBe(false);
  });

  it('assimilates a nasal to the consonant that follows it', () => {
    expect(transliterateWord('thambi')).toBe('தம்பி'); // dictionary, same rule
    expect(transliterateWord('karumbu')).toContain('ம்ப'); // n/m before b
    expect(transliterateWord('thangai')).toBe('தங்கை'); // dictionary
  });

  it('emits Tamil script only for a pure Latin word', () => {
    for (const word of ['karumbu', 'palam', 'mazhai', 'kadhal', 'thozhan']) {
      expect(transliterateWord(word)).toMatch(TAMIL_ONLY);
    }
  });
});

describe('transliterateWord — safety', () => {
  it('returns non-Latin input untouched', () => {
    expect(transliterateWord('தமிழ்')).toBe('தமிழ்');
    expect(transliterateWord('12345')).toBe('12345');
    expect(transliterateWord('😀')).toBe('😀');
    expect(transliterateWord('—')).toBe('—');
    expect(transliterateWord('')).toBe('');
  });

  it('never throws', () => {
    const nasty = [
      '',
      '   ',
      '\u0000',
      '\ud800', // lone surrogate
      'a'.repeat(500),
      '😀vanakkam😀',
      'தமிழ்vanakkam',
      '...',
      '[[ta:x]]',
    ];
    for (const input of nasty) {
      expect(() => transliterateWord(input)).not.toThrow();
    }
  });

  it('reports where a word came from', () => {
    expect(transliterationSource('vanakkam')).toBe('dictionary');
    expect(transliterationSource('karumbu')).toBe('rules');
    expect(transliterationSource('தமிழ்')).toBe('none');
  });
});

describe('transliterateText (raw)', () => {
  it('rewrites every Latin word and leaves the rest alone', () => {
    expect(transliterateText('vanakkam machan, epdi irukka?')).toBe(
      'வணக்கம் மச்சான், எப்படி இருக்க?',
    );
  });

  it('leaves Tamil script and numbers alone', () => {
    expect(transliterateText('நேரம் 5 vanakkam')).toBe('நேரம் 5 வணக்கம்');
  });

  it('documents its footgun: it rewrites English too', () => {
    // This is why the pipeline must use transliterateTanglish().
    expect(transliterateText('money')).not.toBe('money');
  });
});

describe('transliterateRuns', () => {
  it('rewrites the Tanglish run and leaves English alone', () => {
    const runs = segmentText('vanakkam machan, today we talk about money');
    const out = transliterateRuns(runs);
    expect(out[0]).toMatchObject({ lang: 'ta', text: 'வணக்கம் மச்சான்,' });
    expect(out[1]).toMatchObject({ lang: 'en', text: 'today we talk about money' });
  });

  it('does not touch a native Tamil run', () => {
    const runs = segmentText('இன்னைக்கு நாம பாக்கப் போறது');
    const out = transliterateRuns(runs);
    expect(out[0]!.text).toBe('இன்னைக்கு நாம பாக்கப் போறது');
  });

  it('rewrites romanised words inside a merged Tamil run', () => {
    // The segmenter merges adjacent same-language runs, so a Tamil run can hold
    // both native script and Tanglish. Its `script` is then `tamil`; skipping it
    // would send Latin letters to the Tamil voice.
    const runs = segmentText('vanakkam machan, இன்னைக்கு நாம் பாக்கப் போறது');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.script).toBe('tamil');

    const out = transliterateRuns(runs);
    expect(out[0]!.text).not.toMatch(/[A-Za-z]/u);
    expect(out[0]!.text).toContain('இன்னைக்கு');
  });

  it('leaves a Latin run forced to Tamil alone', () => {
    const out = transliterateRuns([{ text: 'hello world', lang: 'ta', script: 'latin' }]);
    expect(out[0]).toEqual({ text: 'hello world', lang: 'ta', script: 'latin' });
  });
});

describe('transliterateTanglish — the safe pipeline entry point', () => {
  it('never rewrites English', () => {
    const input = 'vanakkam machan, today we talk about money';
    const out = transliterateTanglish(input);
    expect(out.text).toContain('today we talk about money');
    expect(out.text).toContain('வணக்கம்');
    expect(out.runs.map((r) => r.lang)).toEqual(['ta', 'en']);
  });

  it('never rewrites native Tamil', () => {
    const input = 'இன்னைக்கு நாம பாக்கப் போறது, the biggest mistake';
    const out = transliterateTanglish(input);
    expect(out.text).toContain('இன்னைக்கு நாம பாக்கப் போறது');
    expect(out.text).toContain('the biggest mistake');
  });

  it('produces the expected mixed narration', () => {
    const out = transliterateTanglish('vanakkam machan, epdi irukka? today we talk');
    expect(out.runs.map((r) => r.text)).toEqual([
      'வணக்கம் மச்சான், எப்படி இருக்க?',
      'today we talk',
    ]);
  });

  it('keeps run order and counts stable', () => {
    const input = 'இன்னைக்கு vanakkam about money';
    const before = segmentText(input);
    const after = transliterateTanglish(input).runs;
    expect(after).toHaveLength(before.length);
    expect(after.map((r) => r.lang)).toEqual(before.map((r) => r.lang));
  });

  it('is a no-op for pure English', () => {
    const input = 'today we talk about money';
    expect(transliterateTanglish(input).text).toBe(input);
  });

  it('is a no-op for pure Tamil', () => {
    const input = 'இன்னைக்கு நாம பாக்கப் போறது';
    expect(transliterateTanglish(input).text).toBe(input);
  });

  it('uses the default dictionary', () => {
    expect(DEFAULT_TRANSLITERATION.get('vanakkam')).toBe('வணக்கம்');
  });

  it('consumes inline overrides instead of transliterating the markers', () => {
    const out = transliterateTanglish(
      'romba mukkiyam: [[en:vanakkam]] is a greeting, [[tl:vanakkam]] is how you say it.',
    );
    // No marker may survive anywhere in the output.
    expect(out.text).not.toContain('[[');
    expect(out.text).not.toContain(']]');

    // [[en:…]] stays Latin; [[tl:…]] becomes Tamil.
    expect(out.runs.map((r) => `${r.lang}/${r.script}`)).toEqual([
      'ta/tanglish',
      'en/latin',
      'ta/tanglish',
      'en/latin',
    ]);
    expect(out.text).toContain('vanakkam is a greeting');
    expect(out.text).toContain('வணக்கம்');
    expect(out.spans).toHaveLength(2);
  });

  it('reports override spans in the cleaned text', () => {
    const out = transliterateTanglish('say [[ta:vanakkam]] now');
    expect(out.spans).toHaveLength(1);
    expect(out.text).not.toContain('[[');
    expect(out.text).toContain('வணக்கம்');
  });
});
