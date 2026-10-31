import { describe, expect, it } from 'vitest';

import { parseVisionAnswer, VisionResponseError } from './parse';

const answer = {
  medium: 'flat vector cartoon',
  promptPrefix: 'flat 2d cartoon illustration, thick black outlines',
  line: { weight: 'thick', texture: 'clean' },
  shading: 'cel',
  background: 'simple gradient, low detail',
  composition: 'centered subject, eye-level, medium shot',
  characters: [{ id: 'hero', description: 'young man, red hoodie' }],
  typography: { present: false },
  negative: 'photo, 3d render, text, watermark',
};

const json = () => JSON.stringify(answer);

describe('parseVisionAnswer', () => {
  it('parses a plain JSON object', () => {
    const parsed = parseVisionAnswer(json());
    expect(parsed.medium).toBe('flat vector cartoon');
    expect(parsed.characters[0]!.id).toBe('hero');
  });

  it('parses a fenced json block', () => {
    const parsed = parseVisionAnswer('```json\n' + json() + '\n```');
    expect(parsed.shading).toBe('cel');
  });

  it('parses a fenced block without a language tag', () => {
    const parsed = parseVisionAnswer('```\n' + json() + '\n```');
    expect(parsed.line.weight).toBe('thick');
  });

  it('ignores prose before and after the object', () => {
    const parsed = parseVisionAnswer(`Here is the description:\n${json()}\nHope that helps.`);
    expect(parsed.negative).toContain('watermark');
  });

  it('strips a volunteered palette instead of failing', () => {
    const parsed = parseVisionAnswer(
      JSON.stringify({ ...answer, palette: { hex: ['#000000'], weights: [1] } }),
    );
    expect(parsed).not.toHaveProperty('palette');
  });

  it('strips a volunteered line colour but keeps the line', () => {
    const parsed = parseVisionAnswer(
      JSON.stringify({ ...answer, line: { ...answer.line, color: '#141414' } }),
    );
    expect(parsed.line).toEqual({ weight: 'thick', texture: 'clean' });
  });

  it('rejects an empty answer', () => {
    expect(() => parseVisionAnswer('   ')).toThrow(/answer was empty/);
  });

  it('rejects text with no JSON object', () => {
    expect(() => parseVisionAnswer('I cannot describe this image.')).toThrow(
      /contained no JSON object/,
    );
  });

  it('rejects malformed JSON', () => {
    expect(() => parseVisionAnswer('{"medium": ,}')).toThrow(/not valid JSON/);
  });

  it('rejects an unknown shading value with the field in the message', () => {
    const error = (() => {
      try {
        parseVisionAnswer(JSON.stringify({ ...answer, shading: 'anime' }));
      } catch (thrown) {
        return thrown;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(VisionResponseError);
    expect((error as VisionResponseError).detail).toContain('shading');
  });

  it('rejects an unknown line weight', () => {
    expect(() =>
      parseVisionAnswer(JSON.stringify({ ...answer, line: { weight: 'bold', texture: 'clean' } })),
    ).toThrow(VisionResponseError);
  });

  it('rejects a missing required key', () => {
    const withoutNegative: Record<string, unknown> = { ...answer };
    delete withoutNegative.negative;
    expect(() => parseVisionAnswer(JSON.stringify(withoutNegative))).toThrow(/negative/);
  });

  it('rejects duplicate character ids', () => {
    expect(() =>
      parseVisionAnswer(
        JSON.stringify({
          ...answer,
          characters: [
            { id: 'hero', description: 'a' },
            { id: 'hero', description: 'b' },
          ],
        }),
      ),
    ).toThrow(/duplicate character id/);
  });

  it('rejects typography present without a style', () => {
    expect(() =>
      parseVisionAnswer(JSON.stringify({ ...answer, typography: { present: true } })),
    ).toThrow(/typography.style is required/);
  });

  it('keeps a short excerpt for diagnosis and never the whole answer', () => {
    const raw = JSON.stringify({ ...answer, shading: 'anime' }) + 'x'.repeat(500);
    const error = (() => {
      try {
        parseVisionAnswer(raw);
      } catch (thrown) {
        return thrown as VisionResponseError;
      }
      return null;
    })();

    expect(error!.excerpt.length).toBe(200);
  });
});
