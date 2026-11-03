/**
 * The composer's vocabulary is a restatement of the public contracts, because
 * `packages/core` has no dependencies. This is the one place both packages are
 * importable together, so drift fails here instead of at render time.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_SCENES,
  RESOLUTIONS,
  SCENE_MOTIONS,
  frameRateSchema,
  renderFormatSchema,
  resolutionSchema,
  sizeSchema,
} from '@facelesspro/contracts';
import {
  MAX_RENDER_SCENES,
  RENDER_FRAME_RATES,
  RENDER_FORMATS,
  RENDER_MOTIONS,
  RENDER_RESOLUTIONS,
  RENDER_SIZES,
} from '@facelesspro/core';

describe('composer vocabulary ↔ contracts', () => {
  it('uses the same motions, formats, sizes, resolutions and scene cap', () => {
    expect(RENDER_MOTIONS).toEqual(SCENE_MOTIONS);
    expect(RENDER_FORMATS).toEqual(renderFormatSchema.options);
    expect(RENDER_SIZES).toEqual(sizeSchema.options);
    expect(RENDER_RESOLUTIONS).toEqual(RESOLUTIONS);
    expect(MAX_RENDER_SCENES).toBe(MAX_SCENES);
  });

  it('accepts exactly the contract frame rates', () => {
    for (const fps of RENDER_FRAME_RATES) {
      expect(frameRateSchema.safeParse(fps).success).toBe(true);
    }
    expect(frameRateSchema.safeParse(24).success).toBe(false);
    expect(frameRateSchema.safeParse(120).success).toBe(false);
  });

  it('accepts exactly the contract resolutions', () => {
    for (const resolution of RENDER_RESOLUTIONS) {
      expect(resolutionSchema.safeParse(resolution).success).toBe(true);
    }
    expect(resolutionSchema.safeParse(720).success).toBe(false);
  });
});
