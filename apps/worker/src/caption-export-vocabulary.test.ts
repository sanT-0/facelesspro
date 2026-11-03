/** Cross-package parity for dependency-free core caption exports. */

import { describe, expect, it } from 'vitest';

import {
  captionExportFormatSchema,
  captionJsonExportSchema,
} from '@facelesspro/contracts';
import {
  CAPTION_EXPORT_FORMATS,
  buildCaptionJsonDocument,
  type CaptionCue,
} from '@facelesspro/core';

const cues: CaptionCue[] = [
  {
    lines: ['தமிழ் captions'],
    words: [
      { text: 'தமிழ்', startMs: 0, endMs: 400 },
      { text: 'captions', startMs: 400, endMs: 1000 },
    ],
    startMs: 0,
    endMs: 1000,
  },
];

describe('caption export vocabulary ↔ contracts', () => {
  it('uses exactly the public format vocabulary', () => {
    expect(CAPTION_EXPORT_FORMATS).toEqual(captionExportFormatSchema.options);
  });

  it('emits JSON that parses through the shared strict schema', () => {
    expect(captionJsonExportSchema.parse(buildCaptionJsonDocument(cues))).toEqual(
      buildCaptionJsonDocument(cues),
    );
  });
});
