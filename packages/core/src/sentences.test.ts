import { describe, expect, it } from 'vitest';

import { normalizeScript, splitSentences } from './sentences';

const texts = (script: string) => splitSentences(script).map((sentence) => sentence.text);

describe('normalizeScript', () => {
  it('collapses whitespace and keeps emoji', () => {
    expect(normalizeScript('  வணக்கம்   நண்பர்களே.\n\nஇன்று  🙏  பேசுவோம்.  ')).toBe(
      'வணக்கம் நண்பர்களே. இன்று 🙏 பேசுவோம்.',
    );
  });

  it('unifies curly quotes and apostrophes but leaves dashes alone', () => {
    // An em dash is prosody — the listening gate approved a clip that has one —
    // so normalisation must not turn it into a hyphen or drop it.
    expect(normalizeScript('“don’t stop” — he said')).toBe('"don\'t stop" — he said');
  });

  it('removes zero-width spaces and non-breaking spaces', () => {
    expect(normalizeScript('a\u200bb\u00a0c')).toBe('ab c');
  });

  it('is idempotent', () => {
    const once = normalizeScript('  ஒன்று.  இரண்டு!  ');
    expect(normalizeScript(once)).toBe(once);
  });
});

describe('splitSentences', () => {
  it('splits Tamil on its terminators and keeps them', () => {
    expect(texts('வணக்கம். எப்படி இருக்கிறீர்கள்? நலம்!')).toEqual([
      'வணக்கம்.',
      'எப்படி இருக்கிறீர்கள்?',
      'நலம்!',
    ]);
  });

  it('splits English on . ! ?', () => {
    expect(texts('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('does not split a decimal', () => {
    expect(texts('It costs 3.5 dollars. Then 2.75 more.')).toEqual([
      'It costs 3.5 dollars.',
      'Then 2.75 more.',
    ]);
  });

  it('does not split a known abbreviation', () => {
    expect(texts('Dr. Raman met Mr. Kumar at 5 p.m. sharp. They talked.')).toEqual([
      'Dr. Raman met Mr. Kumar at 5 p.m. sharp.',
      'They talked.',
    ]);
    expect(texts('Use Rs.500 for the auto. It is enough.')).toEqual([
      'Use Rs.500 for the auto.',
      'It is enough.',
    ]);
  });

  it('does not split initials', () => {
    expect(texts('A. R. Rahman sang. We listened.')).toEqual([
      'A. R. Rahman sang.',
      'We listened.',
    ]);
  });

  it('does not split a Tamil abbreviation', () => {
    expect(texts('திரு. ராமன் வந்தார். அவர் நலமாக இருக்கிறார்.')).toEqual([
      'திரு. ராமன் வந்தார்.',
      'அவர் நலமாக இருக்கிறார்.',
    ]);
  });

  it('keeps a Tamil quotative with the quote it closes', () => {
    // Quoting is how Tamil puts reported speech together; `என்று` after the
    // closing quote is the same sentence, so cutting there is a mid-clause cut.
    expect(texts('அவர் "நான் வருகிறேன்?" என்று கேட்டார். நான் சொன்னேன்.')).toEqual([
      'அவர் "நான் வருகிறேன்?" என்று கேட்டார்.',
      'நான் சொன்னேன்.',
    ]);
    expect(texts('"முடிந்தது." என்றார். அடுத்து.')).toEqual([
      '"முடிந்தது." என்றார்.',
      'அடுத்து.',
    ]);
    expect(texts('"போகலாமா…" என்று யோசித்தார். பின் போனார்.')).toEqual([
      '"போகலாமா…" என்று யோசித்தார்.',
      'பின் போனார்.',
    ]);
  });

  it('still splits after a quote when no quotative follows', () => {
    expect(texts('அவர் "நான் வருகிறேன்?" நான் சொன்னேன்.')).toEqual([
      'அவர் "நான் வருகிறேன்?"',
      'நான் சொன்னேன்.',
    ]);
  });

  it('does not mistake a word starting with என்ற for a quotative', () => {
    expect(texts('முடிந்தது. என்றும் நினைவில் இருக்கும்.')).toEqual([
      'முடிந்தது.',
      'என்றும் நினைவில் இருக்கும்.',
    ]);
  });

  it('treats an ellipsis as a boundary only before a new sentence', () => {
    expect(texts('I do not know... maybe later. We left.')).toEqual([
      'I do not know... maybe later.',
      'We left.',
    ]);
    expect(texts('I do not know… Maybe later.')).toEqual(['I do not know…', 'Maybe later.']);
  });

  it('keeps closing quotes and brackets with the sentence', () => {
    expect(texts('He said "stop." Then he left.')).toEqual(['He said "stop."', 'Then he left.']);
    expect(texts('(It works.) Next one.')).toEqual(['(It works.)', 'Next one.']);
  });

  it('treats a paragraph break as a boundary', () => {
    expect(texts('Intro:\n\nவணக்கம் நண்பர்களே.\n\nஇன்று பேசுவோம்.')).toEqual([
      'Intro:',
      'வணக்கம் நண்பர்களே.',
      'இன்று பேசுவோம்.',
    ]);
  });

  it('keeps a sentence that has no terminator', () => {
    expect(texts('vanakkam machan')).toEqual(['vanakkam machan']);
  });

  it('does not split inside an override marker', () => {
    expect(texts('[[en: Hello. World.]] தமிழ்.')).toEqual(['[[en: Hello. World.]] தமிழ்.']);
  });

  it('returns nothing for empty input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n\n  ')).toEqual([]);
  });

  it('exposes offsets into the normalised script', () => {
    const script = '  ஒன்று.  இரண்டு!  ';
    const normalised = normalizeScript(script);
    const sentences = splitSentences(script);
    for (const sentence of sentences) {
      expect(normalised.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
    expect(sentences[0]?.start).toBe(0);
    expect(sentences.at(-1)?.end).toBe(normalised.length);
  });

  it('reconstructs the script when joined with a space', () => {
    // The planner's hard invariant: concat(scenes.text) is the script.
    for (const script of [
      'வணக்கம். எப்படி இருக்கிறீர்கள்? நலம்!',
      'One.   Two!\n\nThree?',
      'Dr. Raman came. He left.',
      'vanakkam machan, epdi irukka? today we talk about money.',
      'முதல் வாக்கியம். Second sentence! மூன்றாவது…',
    ]) {
      expect(texts(script).join(' ')).toBe(normalizeScript(script));
    }
  });

  it('never emits an empty sentence', () => {
    for (const script of ['...', '!?', 'a. . b.', '  .  ']) {
      for (const sentence of splitSentences(script)) {
        expect(sentence.text.length).toBeGreaterThan(0);
        expect(sentence.end).toBeGreaterThan(sentence.start);
      }
    }
  });
});
