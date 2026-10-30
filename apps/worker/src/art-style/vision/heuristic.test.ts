import { describe, expect, it } from 'vitest';

import type { NumericStyleProfile } from '@facelesspro/contracts';

import { createHeuristicStyleVision, lineWeightFor, shadingFor } from './heuristic';

interface Overrides {
  strokeDensity?: number;
  edgeEnergy?: number;
  contrast?: number;
  saturation?: number;
  edgeContentRatio?: number;
  orientation?: 'landscape' | 'portrait';
}

function profile(overrides: Overrides = {}): NumericStyleProfile {
  const orientation = overrides.orientation ?? 'landscape';
  const width = orientation === 'landscape' ? 1920 : 1080;
  const height = orientation === 'landscape' ? 1080 : 1920;
  return {
    palette: { hex: ['#1b2a41', '#f2c14e'], weights: [0.6, 0.4] },
    line: {
      strokeDensity: overrides.strokeDensity ?? 0,
      edgeEnergy: overrides.edgeEnergy ?? 0,
    },
    tone: {
      saturation: { mean: overrides.saturation ?? 0.4, p95: 0.8 },
      contrast: { mean: overrides.contrast ?? 0.02, p95: 0.08 },
      brightness: { mean: 0.5, p95: 0.9 },
    },
    aspect: { width, height, ratio: width / height, orientation },
    safeArea: { edgeContentRatio: overrides.edgeContentRatio ?? 0.04, margin: 0.08 },
    frameCount: 8,
  };
}

const request = (numeric: NumericStyleProfile) => ({
  framePaths: ['a.png', 'b.png'],
  numeric,
});

describe('heuristic style vision', () => {
  it('never invents a medium, a texture or characters', async () => {
    const vision = await createHeuristicStyleVision().describe(request(profile()));

    expect(vision.adapter).toBe('heuristic');
    expect(vision.medium).toBe('unknown');
    expect(vision.line.texture).toBe('unknown');
    expect(vision.characters).toEqual([]);
    expect(vision.typography).toEqual({ present: false });
  });

  it('reads thick ink and cel shading from a heavy profile', async () => {
    const vision = await createHeuristicStyleVision().describe(
      request(profile({ strokeDensity: 0.1, edgeEnergy: 0.2, contrast: 0.4, saturation: 0.7 })),
    );

    expect(vision.line.weight).toBe('thick');
    expect(vision.shading).toBe('cel');
    expect(vision.promptPrefix).toContain('thick outlines');
    expect(vision.promptPrefix).toContain('hard-edged cel shading');
    expect(vision.promptPrefix).toContain('high-saturation palette');
  });

  it('reads flat fill from a low-contrast profile', async () => {
    const vision = await createHeuristicStyleVision().describe(
      request(profile({ strokeDensity: 0, edgeEnergy: 0, contrast: 0.01 })),
    );

    expect(vision.line.weight).toBe('none');
    expect(vision.shading).toBe('flat');
    expect(vision.promptPrefix).toContain('no visible outlines');
    expect(vision.promptPrefix).toContain('flat colour areas');
  });

  it('reads a portrait reference from the measured aspect', async () => {
    const vision = await createHeuristicStyleVision().describe(
      request(profile({ orientation: 'portrait' })),
    );

    expect(vision.promptPrefix).toContain('portrait frame');
    expect(vision.composition).toContain('0.56:1');
  });

  it('describes a clean border and a full bleed differently', async () => {
    const clean = await createHeuristicStyleVision().describe(
      request(profile({ edgeContentRatio: 0.01 })),
    );
    const full = await createHeuristicStyleVision().describe(
      request(profile({ edgeContentRatio: 0.4 })),
    );

    expect(clean.background).toContain('simple background');
    expect(clean.composition).toContain('low edge content');
    expect(full.background).toContain('reaching the frame edge');
    expect(full.composition).toContain('high edge content');
  });

  it('is deterministic for the same profile', async () => {
    const adapter = createHeuristicStyleVision();
    const first = await adapter.describe(request(profile({ strokeDensity: 0.03 })));
    const second = await adapter.describe(request(profile({ strokeDensity: 0.03 })));

    expect(second).toEqual(first);
  });
});

describe('lineWeightFor / shadingFor', () => {
  it('uses either ink measurement to choose a weight', () => {
    expect(lineWeightFor(profile({ strokeDensity: 0.07 }))).toBe('thick');
    expect(lineWeightFor(profile({ edgeEnergy: 0.13 }))).toBe('thick');
    expect(lineWeightFor(profile({ strokeDensity: 0.03 }))).toBe('medium');
    expect(lineWeightFor(profile({ edgeEnergy: 0.005 }))).toBe('none');
    expect(lineWeightFor(profile({ edgeEnergy: 0.01 }))).toBe('thin');
  });

  it('leaves the middle of the contrast range unknown', () => {
    expect(shadingFor(0.01)).toBe('flat');
    expect(shadingFor(0.4)).toBe('cel');
    expect(shadingFor(0.15)).toBe('unknown');
  });
});
