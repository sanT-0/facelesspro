import { IMAGE_STYLES } from '@facelesspro/contracts';
import { describe, expect, it } from 'vitest';

import { v2StyleProfile } from './style';

describe('v2StyleProfile', () => {
  it('expands every V2 preset into a valid, distinct StyleProfile', () => {
    const prompts = new Set<string>();
    const seeds = new Set<number>();

    for (const imageStyle of IMAGE_STYLES) {
      const profile = v2StyleProfile(imageStyle, 'portrait');
      // The schema enforces line.color ∈ palette, weight/texture vocabularies,
      // prompt/length caps and the measured aspect geometry.
      expect(profile.source).toEqual({ adapter: 'heuristic', degradedFrom: [] });
      expect(profile.typography).toEqual({ present: false });
      expect(profile.medium.length).toBeGreaterThan(0);
      expect(profile.promptPrefix.length).toBeLessThanOrEqual(400);
      prompts.add(profile.promptPrefix);
      seeds.add(profile.seedBase);
    }

    expect(prompts.size).toBe(IMAGE_STYLES.length);
    expect(seeds.size).toBe(IMAGE_STYLES.length);
  });

  it('is deterministic: the same preset and size always expand identically', () => {
    expect(v2StyleProfile('CINEMATIC', 'landscape')).toEqual(
      v2StyleProfile('CINEMATIC', 'landscape'),
    );
  });

  it('measures the requested orientation while keeping the described style', () => {
    const portrait = v2StyleProfile('CUTE_ANIME', 'portrait');
    const landscape = v2StyleProfile('CUTE_ANIME', 'landscape');

    expect(portrait.measured.aspect).toMatchObject({
      width: 1080,
      height: 1920,
      orientation: 'portrait',
    });
    expect(landscape.measured.aspect).toMatchObject({
      width: 1920,
      height: 1080,
      orientation: 'landscape',
    });
    expect(portrait.promptPrefix).toBe(landscape.promptPrefix);
    expect(portrait.palette).toEqual(landscape.palette);
  });

  it('keeps a distinct palette and line treatment per preset', () => {
    const comic = v2StyleProfile('COMIC', 'portrait');
    const noir = v2StyleProfile('DARK_COMIC', 'portrait');

    expect(comic.line.color).toBe('#17151f');
    expect(noir.line.color).toBe('#050607');
    expect(comic.palette.hex).not.toEqual(noir.palette.hex);
    expect(noir.shading).toBe('cel');
    expect(v2StyleProfile('CINEMATIC', 'portrait').line.weight).toBe('none');
  });
});
