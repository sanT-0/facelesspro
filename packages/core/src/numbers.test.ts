import { describe, expect, it } from 'vitest';
import {
  expandNumbers,
  expandNumbersContextual,
  numberToWords,
} from './numbers';

const TAMIL_ONLY = /^[\u0b80-\u0bff\s]+$/u;
const VIRAMA = '\u0bcd';
const DOUBLE_VIRAMA = new RegExp(`${VIRAMA}${VIRAMA}`, 'u');

describe('numberToWords — Tamil 0..99', () => {
  const golden: readonly (readonly [number, string])[] = [
    [0, 'பூஜ்ஜியம்'],
    [1, 'ஒன்று'],
    [2, 'இரண்டு'],
    [9, 'ஒன்பது'],
    [10, 'பத்து'],
    [11, 'பதினொன்று'],
    [12, 'பன்னிரண்டு'],
    [19, 'பத்தொன்பது'],
    [20, 'இருபது'],
    [21, 'இருபத்தொன்று'],
    [24, 'இருபத்துநான்கு'],
    [29, 'இருபத்தொன்பது'],
    [30, 'முப்பது'],
    [40, 'நாற்பது'],
    [50, 'ஐம்பது'],
    [60, 'அறுபது'],
    [70, 'எழுபது'],
    [80, 'எண்பது'],
    [90, 'தொண்ணூறு'],
    [99, 'தொண்ணூற்றொன்பது'],
  ];

  for (const [value, words] of golden) {
    it(`${value} → ${words}`, () => {
      expect(numberToWords(value, 'ta')).toBe(words);
    });
  }
});

describe('numberToWords — Tamil 100..', () => {
  const golden: readonly (readonly [number, string])[] = [
    [100, 'நூறு'],
    [101, 'நூற்று ஒன்று'],
    [200, 'இருநூறு'],
    [500, 'ஐந்நூறு'],
    [900, 'தொள்ளாயிரம்'],
    [999, 'தொள்ளாயிரத்து தொண்ணூற்றொன்பது'],
    [1000, 'ஆயிரம்'],
    [1001, 'ஆயிரத்து ஒன்று'],
    [2000, 'இரண்டாயிரம்'],
    [3000, 'மூவாயிரம்'],
    [4000, 'நாலாயிரம்'],
    [5000, 'ஐயாயிரம்'],
    [5001, 'ஐயாயிரத்து ஒன்று'],
    [2024, 'இரண்டாயிரத்து இருபத்துநான்கு'],
    [20000, 'இருபதாயிரம்'],
    [99999, 'தொண்ணூற்றொன்பதாயிரத்து தொள்ளாயிரத்து தொண்ணூற்றொன்பது'],
    [100000, 'ஒரு லட்சம்'],
    [120000, 'ஒரு லட்சத்து இருபதாயிரம்'],
    [250000, 'இரண்டு லட்சத்து ஐம்பதாயிரம்'],
    [2500000, 'இருபத்தைந்து லட்சம்'],
    [10000000, 'ஒரு கோடி'],
    [20000000, 'இரண்டு கோடி'],
  ];

  for (const [value, words] of golden) {
    it(`${value} → ${words}`, () => {
      expect(numberToWords(value, 'ta')).toBe(words);
    });
  }

  it('emits Tamil script only, with no doubled virama', () => {
    for (let value = 0; value < 3000; value += 1) {
      const words = numberToWords(value, 'ta');
      expect(words, String(value)).toMatch(TAMIL_ONLY);
      expect(DOUBLE_VIRAMA.test(words), `${value} → ${words}`).toBe(false);
    }
  });

  it('reads a 4-digit year as a plain Tamil number, not digit-by-digit', () => {
    expect(numberToWords(2024, 'ta')).toBe('இரண்டாயிரத்து இருபத்துநான்கு');
    expect(numberToWords(2024, 'ta', { year: false })).toBe(
      'இரண்டாயிரத்து இருபத்துநான்கு',
    );
  });
});

describe('numberToWords — English', () => {
  const golden: readonly (readonly [number, string])[] = [
    [0, 'zero'],
    [7, 'seven'],
    [13, 'thirteen'],
    [20, 'twenty'],
    [21, 'twenty-one'],
    [99, 'ninety-nine'],
    [100, 'one hundred'],
    [101, 'one hundred one'],
    [999, 'nine hundred ninety-nine'],
    [1000, 'one thousand'],
    [1500, 'fifteen hundred'],
    [1999, 'nineteen ninety-nine'],
    [2000, 'two thousand'],
    [2005, 'twenty oh five'],
    [2024, 'twenty twenty-four'],
    [9999, 'nine thousand nine hundred ninety-nine'],
    [20000, 'twenty thousand'],
    [100000, 'one lakh'],
    [120000, 'one lakh twenty thousand'],
    [2500000, 'twenty-five lakh'],
    [10000000, 'one crore'],
  ];

  for (const [value, words] of golden) {
    it(`${value} → ${words}`, () => {
      expect(numberToWords(value, 'en')).toBe(words);
    });
  }

  it('can turn the year heuristic off', () => {
    expect(numberToWords(2024, 'en', { year: false })).toBe(
      'two thousand twenty-four',
    );
  });

  it('leaves out-of-range and non-finite values as digits', () => {
    expect(numberToWords(Number.NaN, 'en')).toBe('NaN');
    expect(numberToWords(Infinity, 'en')).toBe('Infinity');
    expect(numberToWords(1e9, 'en')).toBe('1000000000');
    expect(numberToWords(-5, 'en')).toBe('-5');
  });
});

describe('expandNumbers — the docs/08 matrix', () => {
  it('2024', () => {
    expect(expandNumbers('2024', 'ta')).toBe('இரண்டாயிரத்து இருபத்துநான்கு');
    expect(expandNumbers('2024', 'en')).toBe('twenty twenty-four');
  });

  it('₹500', () => {
    expect(expandNumbers('₹500', 'ta')).toBe('ஐந்நூறு ரூபாய்');
    expect(expandNumbers('₹500', 'en')).toBe('five hundred rupees');
  });

  it('3pm', () => {
    expect(expandNumbers('3pm', 'ta')).toBe('மூன்று மணி');
    expect(expandNumbers('3pm', 'en')).toBe('three p m');
  });

  it('3am keeps the meridiem', () => {
    expect(expandNumbers('3am', 'en')).toBe('three a m');
  });

  it('50%', () => {
    expect(expandNumbers('50%', 'ta')).toBe('ஐம்பது சதவீதம்');
    expect(expandNumbers('50%', 'en')).toBe('fifty percent');
  });

  it('1,20,000 (Indian grouping)', () => {
    expect(expandNumbers('1,20,000', 'ta')).toBe('ஒரு லட்சத்து இருபதாயிரம்');
    expect(expandNumbers('1,20,000', 'en')).toBe('one lakh twenty thousand');
  });
});

describe('expandNumbers — forms', () => {
  it('handles Rs / INR / percent spellings', () => {
    expect(expandNumbers('Rs.500', 'en')).toBe('five hundred rupees');
    expect(expandNumbers('INR 500', 'en')).toBe('five hundred rupees');
    expect(expandNumbers('50 percent', 'en')).toBe('fifty percent');
    expect(expandNumbers('3 p.m.', 'en')).toBe('three p m');
  });

  it('spells decimals digit by digit after the point', () => {
    expect(expandNumbers('2.5', 'ta')).toBe('இரண்டு புள்ளி ஐந்து');
    expect(expandNumbers('2.5', 'en')).toBe('two point five');
    expect(expandNumbers('19.99', 'en')).toBe('nineteen point nine nine');
  });

  it('does not read a decimal as a year', () => {
    expect(expandNumbers('2024.5', 'en')).toBe(
      'two thousand twenty-four point five',
    );
  });

  it('rewrites every number in one pass', () => {
    expect(expandNumbers('5 and 10', 'en')).toBe('five and ten');
  });

  it('preserves the text between and around numbers byte-for-byte', () => {
    expect(expandNumbers('-- 5 --', 'en')).toBe('-- five --');
    expect(expandNumbers('  ', 'en')).toBe('  ');
    expect(expandNumbers('', 'en')).toBe('');
  });

  it('keeps a comma that follows a number, so the clause pause survives', () => {
    // `\d[\d,]*` used to swallow this comma: the engine then spoke
    // "twenty twenty-five and the budget" with no pause at all.
    expect(expandNumbers('in 2025, we left', 'en')).toBe(
      'in twenty twenty-five, we left',
    );
    expect(expandNumbers('₹50,000, then more', 'en')).toBe(
      'fifty thousand rupees, then more',
    );
  });
});

describe('expandNumbers — must not touch identifiers', () => {
  const untouched = ['mp3', 'h264', 'v2', 'abc123', '2nd', '4k', 'utf8'];

  for (const text of untouched) {
    it(`leaves "${text}" alone`, () => {
      expect(expandNumbers(text, 'en')).toBe(text);
    });
  }
});

describe('expandNumbersContextual', () => {
  it('uses the language of the preceding word', () => {
    expect(expandNumbersContextual('இந்த ஆண்டு 2024 முக்கியம்')).toBe(
      'இந்த ஆண்டு இரண்டாயிரத்து இருபத்துநான்கு முக்கியம்',
    );
    expect(expandNumbersContextual('the year is 2024')).toBe(
      'the year is twenty twenty-four',
    );
  });

  it('mixes languages inside one string', () => {
    expect(
      expandNumbersContextual('சரி ₹500 கொடுங்க, it costs ₹700 anyway'),
    ).toBe('சரி ஐந்நூறு ரூபாய் கொடுங்க, it costs seven hundred rupees anyway');
  });

  it('falls back to the next word when the number leads the text', () => {
    expect(expandNumbersContextual('₹500 கொடுங்க')).toBe(
      'ஐந்நூறு ரூபாய் கொடுங்க',
    );
  });

  it('uses defaultLang when there is nothing to ask', () => {
    expect(expandNumbersContextual('₹500')).toBe('five hundred rupees');
    expect(expandNumbersContextual('₹500', { defaultLang: 'ta' })).toBe(
      'ஐந்நூறு ரூபாய்',
    );
  });

  it('lets a leading number inherit from the clause after it', () => {
    expect(expandNumbersContextual('50% growth')).toBe('fifty percent growth');
  });

  it('ignores a single English loanword when the clause is Tamil', () => {
    // "business" is English, but it is a noun inside a Tamil clause; the number
    // must not flip language because of it.
    expect(
      expandNumbersContextual('எங்கள் business ₹1,20,000 லாபம் ஈட்டியது.'),
    ).toContain('ஒரு லட்சத்து இருபதாயிரம்');
  });

  it('keeps an English number English in an English clause', () => {
    expect(
      expandNumbersContextual('the Chennai office made ₹1,20,000 this year.'),
    ).toContain('one lakh twenty thousand');
  });
});

describe('never throws', () => {
  const hostile = [
    '',
    '   ',
    '🙂🙂🙂',
    '\u0bcd\u0bcd',
    '１２３４',
    '9'.repeat(40),
    '1.2.3',
    ', , ,',
    '₹',
    '3p',
    'NaN',
  ];

  for (const text of hostile) {
    it(`survives ${JSON.stringify(text)}`, () => {
      expect(() => expandNumbers(text, 'en')).not.toThrow();
      expect(() => expandNumbers(text, 'ta')).not.toThrow();
      expect(() => expandNumbersContextual(text)).not.toThrow();
    });
  }
});
