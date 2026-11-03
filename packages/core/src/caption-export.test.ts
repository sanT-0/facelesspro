/** Caption sidecar contract (roadmap P4 task 7). */

import { describe, expect, it } from 'vitest';

import type { CaptionCue } from './captions';
import {
  CAPTION_EXPORT_FORMATS,
  buildCaptionJson,
  buildCaptionJsonDocument,
  buildSrt,
  buildVtt,
  exportCaptions,
  toSrtTimecode,
  toVttTimecode,
} from './caption-export';

const cues: CaptionCue[] = [
  {
    lines: ['தமிழ் captions', 'work!'],
    words: [
      { text: 'தமிழ்', startMs: 0, endMs: 300 },
      { text: 'captions', startMs: 300, endMs: 700 },
      { text: 'work!', startMs: 700, endMs: 1000 },
    ],
    startMs: 0,
    endMs: 1000,
    emoji: '🔥',
  },
  {
    lines: ['நன்றி நண்பர்களே.'],
    words: [
      { text: 'நன்றி', startMs: 1250, endMs: 1600 },
      { text: 'நண்பர்களே.', startMs: 1600, endMs: 2000 },
    ],
    startMs: 1250,
    endMs: 2000,
  },
];

describe('caption export vocabulary and timecodes', () => {
  it('pins all four public formats', () => {
    expect(CAPTION_EXPORT_FORMATS).toEqual(['srt', 'vtt', 'ass', 'json']);
  });

  it('writes SRT commas and VTT periods at millisecond precision', () => {
    expect(toSrtTimecode(3_661_234)).toBe('01:01:01,234');
    expect(toVttTimecode(3_661_234)).toBe('01:01:01.234');
    expect(toSrtTimecode(100 * 60 * 60 * 1000)).toBe('100:00:00,000');
  });

  it('rejects a fractional or negative timestamp', () => {
    expect(() => toSrtTimecode(-1)).toThrow(/timestamp/i);
    expect(() => toVttTimecode(1.5)).toThrow(/timestamp/i);
  });
});

describe('buildSrt', () => {
  it('writes numbered blocks, lines and the opt-in emoji', () => {
    expect(buildSrt(cues)).toBe(
      '1\n' +
        '00:00:00,000 --> 00:00:01,000\n' +
        'தமிழ் captions\n' +
        'work! 🔥\n\n' +
        '2\n' +
        '00:00:01,250 --> 00:00:02,000\n' +
        'நன்றி நண்பர்களே.\n',
    );
  });

  it('does not mutate cue lines when appending presentation emoji', () => {
    const before = structuredClone(cues);
    buildSrt(cues);
    expect(cues).toEqual(before);
    expect(cues[0]?.lines).toEqual(['தமிழ் captions', 'work!']);
  });
});

describe('buildVtt', () => {
  it('writes WEBVTT plus numbered cues with dot timecodes', () => {
    expect(buildVtt(cues)).toBe(
      'WEBVTT\n\n' +
        '1\n' +
        '00:00:00.000 --> 00:00:01.000\n' +
        'தமிழ் captions\n' +
        'work! 🔥\n\n' +
        '2\n' +
        '00:00:01.250 --> 00:00:02.000\n' +
        'நன்றி நண்பர்களே.\n',
    );
  });
});

describe('caption JSON', () => {
  it('returns a versioned document with words, lines and separate emoji', () => {
    expect(buildCaptionJsonDocument(cues)).toEqual({
      version: 1,
      durationMs: 2000,
      cues: [
        {
          index: 1,
          startMs: 0,
          endMs: 1000,
          lines: ['தமிழ் captions', 'work!'],
          words: cues[0]?.words,
          emoji: '🔥',
        },
        {
          index: 2,
          startMs: 1250,
          endMs: 2000,
          lines: ['நன்றி நண்பர்களே.'],
          words: cues[1]?.words,
        },
      ],
    });
  });

  it('serialises stable pretty JSON with one trailing newline', () => {
    const first = buildCaptionJson(cues);
    expect(buildCaptionJson(cues)).toBe(first);
    expect(first.endsWith('\n')).toBe(true);
    expect(first.endsWith('\n\n')).toBe(false);
    expect(JSON.parse(first)).toEqual(buildCaptionJsonDocument(cues));
  });
});

describe('exportCaptions', () => {
  it('dispatches text formats with stable extension and MIME metadata', () => {
    expect(exportCaptions(cues, 'srt')).toEqual({
      format: 'srt',
      extension: 'srt',
      mimeType: 'application/x-subrip; charset=utf-8',
      contents: buildSrt(cues),
    });
    expect(exportCaptions(cues, 'vtt')).toMatchObject({
      format: 'vtt',
      extension: 'vtt',
      mimeType: 'text/vtt; charset=utf-8',
    });
    expect(exportCaptions(cues, 'json')).toMatchObject({
      format: 'json',
      extension: 'json',
      mimeType: 'application/json; charset=utf-8',
    });
  });

  it('dispatches ASS through the existing karaoke writer', () => {
    const exported = exportCaptions(cues, 'ass', {
      dimensions: { width: 1920, height: 1080 },
      style: { fontSize: 64, emoji: true },
    });
    expect(exported).toMatchObject({
      format: 'ass',
      extension: 'ass',
      mimeType: 'text/x-ssa; charset=utf-8',
    });
    expect(exported.contents).toContain('[V4+ Styles]');
    expect(exported.contents).toContain('{\\k30}தமிழ்');
    expect(exported.contents).toContain('{\\fnNoto Emoji}🔥');
  });

  it('requires dimensions only for ASS and rejects an unknown runtime format', () => {
    expect(() => exportCaptions(cues, 'ass')).toThrow(/dimensions/i);
    expect(() => exportCaptions(cues, 'txt' as 'srt')).toThrow(/format/i);
  });
});

describe('caption export validation', () => {
  it('rejects empty output and malformed/non-monotonic cues', () => {
    expect(() => buildSrt([])).toThrow(/no cues/i);
    expect(() => buildVtt([{ ...cues[0]!, endMs: 0 }])).toThrow(/timing/i);
    expect(() =>
      buildCaptionJson([
        cues[0]!,
        {
          ...cues[1]!,
          startMs: 900,
          lines: ['x'],
          words: [{ text: 'x', startMs: 900, endMs: 2000 }],
        },
      ]),
    ).toThrow(/overlap/i);
  });

  it('rejects lines that no longer reconstruct their words', () => {
    expect(() => buildSrt([{ ...cues[0]!, lines: ['rewritten'] }])).toThrow(/lines/i);
  });

  it('rejects a multi-cluster or newline emoji', () => {
    expect(() => buildVtt([{ ...cues[0]!, emoji: '🔥🔥' }])).toThrow(/emoji/i);
    expect(() => buildVtt([{ ...cues[0]!, emoji: '\n' }])).toThrow(/emoji/i);
  });
});
