import { LANDSCAPE_PREVIEW, PORTRAIT_PREVIEW } from '@facelesspro/core';
import type { NumericStyleProfile, StyleVision } from '@facelesspro/contracts';
import { describe, expect, it } from 'vitest';

import { mergeStyleProfile } from './merge';
import { previewPlan } from './preview-plan';

const baseNumeric: NumericStyleProfile = {
  palette: { hex: ['#1a283f', '#f1bf4d'], weights: [0.7, 0.3] },
  line: { strokeDensity: 0.01, edgeEnergy: 0.02 },
  tone: {
    saturation: { mean: 0.4, p95: 0.5 },
    contrast: { mean: 0.1, p95: 0.2 },
    brightness: { mean: 0.5, p95: 0.6 },
  },
  aspect: { width: 640, height: 360, ratio: 1.7778, orientation: 'landscape' },
  safeArea: { edgeContentRatio: 0.05, margin: 0.08 },
  frameCount: 8,
};

const vision: StyleVision = {
  medium: 'unknown',
  promptPrefix: 'cartoon frame, thin outlines',
  line: { weight: 'thin', texture: 'unknown' },
  shading: 'flat',
  background: 'simple',
  composition: 'centred',
  characters: [],
  typography: { present: false },
  negative: 'photo',
  adapter: 'heuristic',
  degradedFrom: [],
};

const portraitNumeric: NumericStyleProfile = {
  ...baseNumeric,
  aspect: { width: 360, height: 640, ratio: 0.5625, orientation: 'portrait' },
};

const landscape = mergeStyleProfile(baseNumeric, vision);
const portrait = mergeStyleProfile(portraitNumeric, vision);

describe('previewPlan', () => {
  it('renders one landscape grid and clip when only landscape is offered', () => {
    expect(previewPlan(landscape, ['landscape'])).toEqual({
      grid: LANDSCAPE_PREVIEW,
      clip: LANDSCAPE_PREVIEW,
      portrait: null,
    });
  });

  it('adds a 9:16 contact sheet when the style offers portrait', () => {
    expect(previewPlan(landscape, ['landscape', 'portrait'])).toEqual({
      grid: LANDSCAPE_PREVIEW,
      clip: LANDSCAPE_PREVIEW,
      portrait: PORTRAIT_PREVIEW,
    });
  });

  it('does not duplicate a portrait grid when the reference is already portrait', () => {
    expect(previewPlan(portrait, ['portrait'])).toEqual({
      grid: PORTRAIT_PREVIEW,
      clip: PORTRAIT_PREVIEW,
      portrait: null,
    });
  });
});
