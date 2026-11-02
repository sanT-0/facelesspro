/**
 * ASS writer contract (roadmap P4 task 2).
 *
 * The ASS output is the renderer's input, so the tests pin the exact text a
 * later real-ffmpeg golden render will burn. Everything here is deterministic:
 * karaoke `\k` spans are centiseconds with half-up rounding (min 1), colours
 * are ASS `&HAABBGGRR` (BGR-packed — NOT the `#RRGGBB` the template carries),
 * and Tamil text is never rewritten — only uppercase (a no-op on Tamil) and
 * brace escaping (`\{` `\}`, libass 0.15+), both presentation-mandated.
 *
 * Pure: no I/O, no clock, no network.
 */

import { describe, expect, it } from 'vitest';
import { buildAss, assColour, toAssTimecode } from './ass';
import { buildCaptionCues } from './captions';
import type { CaptionWord } from './captions';

const word = (text: string, startMs: number, endMs: number): CaptionWord => ({
  text,
  startMs,
  endMs,
});

interface AssSpec {
  uppercase?: boolean;
  position?: 'top' | 'center' | 'bottom';
  highlightColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  fontFamily?: string;
}

function assFor(
  words: CaptionWord[],
  dims?: { width: number; height: number },
  spec: AssSpec = {},
) {
  const cues = buildCaptionCues(words, {
    wordLimit: 8,
    maxLines: 2,
    maxCharsPerLine: 40,
  });
  return buildAss(cues, dims ?? { width: 1920, height: 1080 }, spec);
}

/** ASS V4+ styles are positional CSV, in the order declared by Format. */
function styleFields(ass: string): string[] {
  const line = ass.split('\n').find((candidate) => candidate.startsWith('Style: '));
  if (line === undefined) throw new Error('ASS output has no Style line');
  return line.slice('Style: '.length).split(',');
}

describe('assColour', () => {
  it('converts #RRGGBB to the ASS &HAABBGGRR form (BGR!)', () => {
    // #FFD400: R=FF G=D4 B=00 → BGR 00 D4 FF.
    expect(assColour('#FFD400')).toBe('&H0000D4FF');
    expect(assColour('#999999')).toBe('&H00999999');
  });

  it('alpha is always 00 (captions are opaque, burned in at render)', () => {
    expect(assColour('#0066FF')).toBe('&H00FF6600');
  });
});

describe('toAssTimecode', () => {
  it('formats H:MM:SS.CC', () => {
    expect(toAssTimecode(0)).toBe('0:00:00.00');
    expect(toAssTimecode(1600)).toBe('0:00:01.60');
    expect(toAssTimecode(65999)).toBe('0:01:05.99');
    expect(toAssTimecode(3661230)).toBe('1:01:01.23');
  });
});

describe('buildAss', () => {
  it('writes a valid minimal ASS header with PlayRes and ScaledBorderAndShadow', () => {
    const ass = assFor([word('வணக்கம்.', 0, 500)]);
    expect(ass.startsWith('[Script Info]')).toBe(true);
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('PlayResY: 1080');
    expect(ass).toContain('ScaledBorderAndShadow: yes');
    expect(ass).toContain('WrapStyle: 2'); // wrapping is ours (cue builder), ASS adds none
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
  });

  it('renders one Dialogue per cue with cue start/end times', () => {
    const ass = assFor([
      word('the', 0, 400),
      word('biggest', 400, 800),
      word('mistake.', 800, 1600),
      word('First', 1600, 2400),
      word('learn.', 2400, 3200),
    ]);
    // Clause punctuation closes the first cue early (cue-builder rule).
    expect(ass).toContain(
      'Dialogue: 0,0:00:00.00,0:00:01.60,Faceless,,,,,,{\\k40}the {\\k40}biggest {\\k80}mistake.',
    );
    expect(ass).toContain('Dialogue: 0,0:00:01.60,0:00:03.20,Faceless,,,,,,{\\k80}First {\\k80}learn.');
  });

  it('emits karaoke \k spans in centiseconds, rounding half-up, min 1', () => {
    const ass = assFor([word('வணக்கம்', 0, 50), word('வா.', 50, 154)]);
    // 50ms → 5cs; 104ms → 10.4 → rounds to 10.
    expect(ass).toContain('{\\k5}வணக்கம் {\\k10}வா.');
  });

  it('joins wrapped lines with \\N and keeps karaoke spans aligned', () => {
    const words = [
      word('beginners', 0, 300),
      word('struggle', 300, 700),
      word('with', 700, 900),
      word('cash.', 900, 1300),
    ];
    const cues = buildCaptionCues(words, {
      wordLimit: 8,
      maxLines: 2,
      maxCharsPerLine: 15,
    });
    // The builder makes this a two-line cue: "beginners" / "struggle with";
    // "cash." gets its own cue because two lines cannot fit three words.
    expect(cues[0]?.lines).toEqual(['beginners', 'struggle with']);
    const ass = buildAss(cues, { width: 1080, height: 1920 });
    expect(ass).toContain('{\\k30}beginners\\N{\\k40}struggle {\\k20}with');
  });

  it('applies spec.uppercase to presentation only', () => {
    const ass = assFor(
      [word('tanglish', 0, 300), word('தமிழ்.', 300, 800)],
      undefined,
      { uppercase: true },
    );
    expect(ass).toContain('{\\k30}TANGLISH {\\k50}தமிழ்.');
  });

  it('escapes braces so libass never reads ASR text as overrides', () => {
    const ass = assFor([word('{hot}', 0, 400)]);
    expect(ass).toContain('{\\k40}\\{hot\\}');
  });

  it('maps the template position to its ASS alignment', () => {
    expect(styleFields(assFor([word('x.', 0, 100)], undefined, { position: 'bottom' }))[18]).toBe('2');
    expect(styleFields(assFor([word('x.', 0, 100)], undefined, { position: 'center' }))[18]).toBe('5');
    expect(styleFields(assFor([word('x.', 0, 100)], undefined, { position: 'top' }))[18]).toBe('8');
  });

  it('carries template colours into the style line (BGR-packed) and outline width', () => {
    const ass = assFor([word('x.', 0, 100)], undefined, {
      highlightColor: '#FFD400',
      outlineColor: '#101010',
      outlineWidth: 3,
    });
    const fields = styleFields(ass);
    expect(fields[3]).toBe('&H0000D4FF'); // primary (sung/highlight) in BGR
    expect(fields[5]).toBe('&H00101010'); // outline
    expect(fields[16]).toBe('3.0');
  });

  it("uses the template font name, default 'Noto Sans Tamil'", () => {
    expect(styleFields(assFor([word('தமிழ்.', 0, 100)]))[1]).toBe('Noto Sans Tamil');
    expect(styleFields(
      assFor([word('தமிழ்.', 0, 100)], undefined, { fontFamily: 'Noto Sans' }),
    )[1]).toBe('Noto Sans');
  });

  it('rejects an empty cue list rather than writing a header-only file', () => {
    expect(() =>
      buildAss([], { width: 1920, height: 1080 }, {}),
    ).toThrow(/no cues/i);
  });
});
