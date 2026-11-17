/**
 * AI Video V2's 16 fixed image styles (docs/01 §3.2).
 *
 * V2 has no `artStyleId`: the caller picks a preset name and the preset *is*
 * the style. Rather than a parallel prompt format, each preset expands into the
 * same `StyleProfile` V3 uses, so the planner, image prompts, palette
 * correction and redraw all keep one code path and one set of invariants.
 *
 * The presets are FacelessPro's own descriptions. Their names are the public
 * V2 vocabulary, not a claim about any particular studio's work: every
 * `medium`/`promptPrefix` below names generic visual properties (palette, line,
 * shading, composition) that an image model can act on.
 *
 * Pure and deterministic: no clock, no randomness, no I/O.
 */

import { styleProfileSchema } from '@facelesspro/contracts';
import type {
  ImageStyle,
  Size,
  StyleLineTexture,
  StyleLineWeight,
  StyleProfile,
  StyleShading,
} from '@facelesspro/contracts';

interface Preset {
  /** ≤80 characters; a short medium clause, not a sentence. */
  readonly medium: string;
  /** ≤400 characters, comma-separated, safe to start an image prompt. */
  readonly promptPrefix: string;
  /** Four colours in order; weights sum to 1. */
  readonly palette: readonly [string, string, string, string];
  readonly weights: readonly [number, number, number, number];
  /** Must be one of `palette`. */
  readonly lineColor: string;
  readonly lineWeight: StyleLineWeight;
  readonly lineTexture: StyleLineTexture;
  readonly shading: StyleShading;
  /** ≤200 characters. */
  readonly background: string;
  /** ≤200 characters. */
  readonly composition: string;
  /** ≤300 characters. */
  readonly negative: string;
  /** 0..1, feeds the measured block the palette-correction pass reads. */
  readonly saturation: number;
  readonly contrast: number;
  readonly brightness: number;
}

const PRESETS: Record<ImageStyle, Preset> = {
  CREEPY_COMIC: {
    medium: 'scratchy horror comic ink',
    promptPrefix:
      'uneasy horror comic illustration, scratchy black ink, cold desaturated palette, heavy shadows, ominous negative space',
    palette: ['#14161a', '#3b4652', '#7d2a35', '#d8cfc0'],
    weights: [0.4, 0.25, 0.2, 0.15],
    lineColor: '#14161a',
    lineWeight: 'thick',
    lineTexture: 'sketchy',
    shading: 'cel',
    background: 'fog, bare branches, deep doorways, unlit corridors',
    composition: 'low angles, subject pushed to one edge, wide empty space',
    negative: 'cute, pastel, bright daylight, text, watermark, logo',
    saturation: 0.3,
    contrast: 0.62,
    brightness: 0.28,
  },
  '90s_DISNEY': {
    medium: 'hand-drawn 1990s cel animation',
    promptPrefix:
      'warm 1990s hand-drawn animation still, rounded shapes, confident ink outline, painted cel shadows, storybook colour',
    palette: ['#2b1d16', '#c9772e', '#f2c14e', '#79a8a9'],
    weights: [0.2, 0.3, 0.3, 0.2],
    lineColor: '#2b1d16',
    lineWeight: 'medium',
    lineTexture: 'clean',
    shading: 'cel',
    background: 'painted village, rolling hills, warm interiors',
    composition: 'centred hero, open sky, clear silhouette',
    negative: 'photo, 3d render, neon, text, watermark, logo',
    saturation: 0.66,
    contrast: 0.4,
    brightness: 0.62,
  },
  STUDIO_GHIBLI: {
    medium: 'hand-painted pastoral animation',
    promptPrefix:
      'hand-painted pastoral animation background, soft gouache texture, layered greens, gentle light, lived-in detail',
    palette: ['#26331f', '#5c7a3a', '#a9c27a', '#e8d7a8'],
    weights: [0.25, 0.3, 0.25, 0.2],
    lineColor: '#26331f',
    lineWeight: 'thin',
    lineTexture: 'painterly',
    shading: 'soft',
    background: 'meadows, old houses, drifting clouds, quiet weather',
    composition: 'wide establishing view, human figure small in the frame',
    negative: 'photo, harsh contrast, neon, text, watermark, logo',
    saturation: 0.48,
    contrast: 0.3,
    brightness: 0.66,
  },
  ADULT_CARTOON: {
    medium: 'flat satirical adult animation',
    promptPrefix:
      'flat satirical cartoon still, thick uniform outline, muted office palette, deadpan staging, simplified faces',
    palette: ['#1d1d1f', '#6b7280', '#c2a878', '#e7e2d8'],
    weights: [0.35, 0.25, 0.2, 0.2],
    lineColor: '#1d1d1f',
    lineWeight: 'thick',
    lineTexture: 'clean',
    shading: 'flat',
    background: 'suburban interiors, desks, beige walls, parking lots',
    composition: 'eye-level two-shot, flat perspective, dead centre',
    negative: 'realistic anatomy, painterly, text, watermark, logo',
    saturation: 0.3,
    contrast: 0.34,
    brightness: 0.6,
  },
  SIMPSONS: {
    medium: 'yellow-skewed suburban cartoon',
    promptPrefix:
      'suburban cartoon still, yellow-skewed skin tones, bold rounded outline, saturated primary colours, everyday chaos',
    palette: ['#241a10', '#f2c531', '#4f9ed6', '#e8e3d2'],
    weights: [0.2, 0.35, 0.25, 0.2],
    lineColor: '#241a10',
    lineWeight: 'medium',
    lineTexture: 'clean',
    shading: 'flat',
    background: 'tract houses, lawns, kitchens, school corridors',
    composition: 'ensemble staging, wide room, strong horizon line',
    negative: 'photo, 3d render, desaturated, text, watermark, logo',
    saturation: 0.72,
    contrast: 0.36,
    brightness: 0.62,
  },
  CINEMATIC: {
    medium: 'photoreal cinematic film still',
    promptPrefix:
      'cinematic film still, photoreal lighting, shallow depth of field, anamorphic flare, production design, film grain',
    palette: ['#0e1116', '#31404f', '#b06a3b', '#d9c8ab'],
    weights: [0.3, 0.3, 0.2, 0.2],
    lineColor: '#0e1116',
    lineWeight: 'none',
    lineTexture: 'unknown',
    shading: 'gradient',
    background: 'practical lights, weather, lived-in locations',
    composition: 'rule of thirds, foreground framing, motivated light',
    negative: 'cartoon, illustration, flat shading, text, watermark, logo',
    saturation: 0.38,
    contrast: 0.58,
    brightness: 0.36,
  },
  CUTE_ANIME: {
    medium: 'soft pastel anime illustration',
    promptPrefix:
      'soft pastel anime illustration, large expressive eyes, delicate line, airy highlights, gentle bloom',
    palette: ['#3a2c3f', '#a97fb5', '#f4b8c8', '#fff1e6'],
    weights: [0.2, 0.25, 0.3, 0.25],
    lineColor: '#3a2c3f',
    lineWeight: 'thin',
    lineTexture: 'clean',
    shading: 'soft',
    background: 'flower fields, classrooms, sunset rooftops, soft clouds',
    composition: 'close portrait, off-centre subject, generous sky',
    negative: 'photo, harsh shadows, horror, text, watermark, logo',
    saturation: 0.55,
    contrast: 0.26,
    brightness: 0.74,
  },
  ULTRA_REALISM: {
    medium: 'hyperreal photographic still',
    promptPrefix:
      'hyperreal photograph, natural skin texture, precise materials, soft studio light, high dynamic range',
    palette: ['#15120f', '#5d5148', '#a99b8a', '#efe9e0'],
    weights: [0.25, 0.3, 0.25, 0.2],
    lineColor: '#15120f',
    lineWeight: 'none',
    lineTexture: 'unknown',
    shading: 'gradient',
    background: 'real rooms, real streets, believable clutter',
    composition: 'clean subject separation, natural perspective, balanced frame',
    negative: 'cartoon, comic, painting, text, watermark, logo',
    saturation: 0.28,
    contrast: 0.42,
    brightness: 0.52,
  },
  DARK_COMIC: {
    medium: 'high-contrast noir comic',
    promptPrefix:
      'noir comic panel, hard black shadows, single warm light source, rain-slick streets, heavy inking',
    palette: ['#050607', '#20262e', '#5e6a75', '#c9b28c'],
    weights: [0.45, 0.3, 0.15, 0.1],
    lineColor: '#050607',
    lineWeight: 'thick',
    lineTexture: 'rough',
    shading: 'cel',
    background: 'night alleys, venetian blinds, wet asphalt, smoke',
    composition: 'strong diagonals, silhouettes, deep foreground shadow',
    negative: 'pastel, daylight, cute, text, watermark, logo',
    saturation: 0.25,
    contrast: 0.7,
    brightness: 0.22,
  },
  'B&W_COMIC': {
    medium: 'monochrome ink comic',
    promptPrefix:
      'black and white ink comic, dense hatching, crisp white paper, grey wash, printed texture',
    palette: ['#0b0b0b', '#3a3a3a', '#8f8f8f', '#f4f1ea'],
    weights: [0.3, 0.25, 0.2, 0.25],
    lineColor: '#0b0b0b',
    lineWeight: 'thick',
    lineTexture: 'rough',
    shading: 'cel',
    background: 'city streets, interiors, rain, dramatic clouds',
    composition: 'bold shapes, graphic balance, strong focal point',
    negative: 'colour, photo, 3d render, text, watermark, logo',
    saturation: 0,
    contrast: 0.66,
    brightness: 0.48,
  },
  COMIC: {
    medium: 'bright four-colour comic',
    promptPrefix:
      'four-colour comic illustration, bold outline, flat saturated fills, halftone dots, dynamic action staging',
    palette: ['#17151f', '#d63b2f', '#2f62c9', '#f2c94c'],
    weights: [0.2, 0.3, 0.3, 0.2],
    lineColor: '#17151f',
    lineWeight: 'thick',
    lineTexture: 'clean',
    shading: 'flat',
    background: 'city rooftops, laboratories, dramatic skies',
    composition: 'low hero angle, action lines, strong silhouette',
    negative: 'photo, muted palette, 3d render, text, watermark, logo',
    saturation: 0.78,
    contrast: 0.48,
    brightness: 0.58,
  },
  SATIRICAL_2D: {
    medium: 'editorial 2D caricature',
    promptPrefix:
      'editorial caricature illustration, exaggerated proportions, fine ink line, spot colour, wry staging',
    palette: ['#1b1a17', '#7c6f5c', '#c4553b', '#efe6d5'],
    weights: [0.3, 0.25, 0.2, 0.25],
    lineColor: '#1b1a17',
    lineWeight: 'medium',
    lineTexture: 'sketchy',
    shading: 'flat',
    background: 'newsroom desks, city squares, cluttered offices',
    composition: 'face-forward caricature, symbolic props, clean backdrop',
    negative: 'photo, glossy 3d, anime, text, watermark, logo',
    saturation: 0.42,
    contrast: 0.44,
    brightness: 0.64,
  },
  PIXAR: {
    medium: 'polished 3D animation still',
    promptPrefix:
      'polished 3D animation still, soft global illumination, appealing rounded forms, detailed materials, warm key light',
    palette: ['#32251c', '#b86b3f', '#6fa3b8', '#f3ddbd'],
    weights: [0.2, 0.3, 0.25, 0.25],
    lineColor: '#32251c',
    lineWeight: 'none',
    lineTexture: 'clean',
    shading: 'soft',
    background: 'stylised interiors, toy-scale props, warm practical light',
    composition: 'cinematic staging, strong depth, expressive silhouette',
    negative: '2d flat, photoreal human, harsh shadows, text, watermark, logo',
    saturation: 0.6,
    contrast: 0.38,
    brightness: 0.64,
  },
  '18TH_CENTURY_HISTORICAL': {
    medium: '18th-century oil painting',
    promptPrefix:
      '18th-century oil painting, chiaroscuro, visible brushwork, aged varnish, formal historical staging',
    palette: ['#17120d', '#4a3524', '#8a6a45', '#d8c19a'],
    weights: [0.3, 0.3, 0.22, 0.18],
    lineColor: '#17120d',
    lineWeight: 'none',
    lineTexture: 'painterly',
    shading: 'painterly',
    background: 'candlelit rooms, drapery, old portraits, heavy furniture',
    composition: 'three-quarter portrait, dark surround, single lit subject',
    negative: 'modern clothing, neon, photo, text, watermark, logo',
    saturation: 0.34,
    contrast: 0.6,
    brightness: 0.34,
  },
  POLISHED_CARTOON: {
    medium: 'clean modern vector cartoon',
    promptPrefix:
      'clean vector cartoon, even outline, smooth gradients, friendly rounded geometry, bright accents',
    palette: ['#20242b', '#5577c9', '#f0a35e', '#f6f3ec'],
    weights: [0.2, 0.3, 0.25, 0.25],
    lineColor: '#20242b',
    lineWeight: 'medium',
    lineTexture: 'clean',
    shading: 'gradient',
    background: 'simple rooms, city parks, tidy streets, open sky',
    composition: 'centred subject, generous margins, clear read at small sizes',
    negative: 'sketchy line, gritty texture, photo, text, watermark, logo',
    saturation: 0.6,
    contrast: 0.34,
    brightness: 0.7,
  },
  COMIC_REALISM: {
    medium: 'realistic painted comic art',
    promptPrefix:
      'painterly realistic comic art, anatomically grounded figures, dramatic light, textured brush finish, muted depth',
    palette: ['#121417', '#3f4a55', '#8a6f58', '#cfc6b8'],
    weights: [0.3, 0.28, 0.22, 0.2],
    lineColor: '#121417',
    lineWeight: 'thin',
    lineTexture: 'painterly',
    shading: 'painterly',
    background: 'urban streets, industrial interiors, overcast weather',
    composition: 'cinematic panel, figures in depth, readable silhouette',
    negative: 'flat cartoon, chibi, neon, text, watermark, logo',
    saturation: 0.32,
    contrast: 0.54,
    brightness: 0.4,
  },
};

/** Stable per-preset seed so a retry draws the same scene, never a new roll. */
function seedFor(index: number): number {
  return 1000 + index * 7919;
}

function stat(mean: number): { mean: number; p95: number } {
  return { mean, p95: Math.min(1, mean + 0.15) };
}

/**
 * Expand a V2 preset into the same StyleProfile V3 stores.
 *
 * `size` only changes the measured aspect block (and therefore the safe-area
 * geometry); the described style is identical in both orientations.
 */
/**
 * A stable UUID for a preset.
 *
 * Every rendered frame set records a `styleId`, but V2 presets have no
 * `art_style` row. A deterministic UUID (FNV-1a over the preset name, shaped
 * like a v4 id) keeps the manifest schema strict and makes the same preset
 * recognisable across videos and machines without pretending a row exists.
 */
export function v2StyleId(imageStyle: ImageStyle): string {
  let hash = 0x811c9dc5;
  for (const character of imageStyle) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const bytes: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    hash ^= index + 0x9e3779b9;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    bytes.push((hash >>> ((index % 4) * 8)) & 0xff);
  }
  // Version 4 and RFC 4122 variant bits, so `z.uuid()` accepts it.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function v2StyleProfile(imageStyle: ImageStyle, size: Size): StyleProfile {
  const index = (Object.keys(PRESETS) as ImageStyle[]).indexOf(imageStyle);
  const preset = PRESETS[imageStyle];
  if (preset === undefined || index < 0) {
    throw new Error(`unknown image style ${imageStyle}`);
  }

  const width = size === 'landscape' ? 1920 : 1080;
  const height = size === 'landscape' ? 1080 : 1920;
  const [hex0, hex1, hex2, hex3] = preset.palette;
  const [w0, w1, w2, w3] = preset.weights;

  return styleProfileSchema.parse({
    version: 1,
    medium: preset.medium,
    promptPrefix: preset.promptPrefix,
    palette: {
      hex: [hex0, hex1, hex2, hex3],
      weights: [w0, w1, w2, w3],
    },
    line: {
      weight: preset.lineWeight,
      color: preset.lineColor,
      texture: preset.lineTexture,
    },
    shading: preset.shading,
    background: preset.background,
    composition: preset.composition,
    characters: [],
    typography: { present: false },
    negative: preset.negative,
    seedBase: seedFor(index),
    measured: {
      line: {
        strokeDensity:
          preset.lineWeight === 'none'
            ? 0
            : preset.lineWeight === 'thin'
              ? 0.012
              : preset.lineWeight === 'medium'
                ? 0.03
                : 0.07,
        edgeEnergy:
          preset.lineWeight === 'none'
            ? 0.002
            : preset.lineWeight === 'thin'
              ? 0.025
              : preset.lineWeight === 'medium'
                ? 0.06
                : 0.13,
      },
      tone: {
        saturation: stat(preset.saturation),
        contrast: stat(preset.contrast),
        brightness: stat(preset.brightness),
      },
      aspect: { width, height, ratio: width / height, orientation: size },
      safeArea: { edgeContentRatio: 0.05, margin: 0.08 },
      frameCount: 1,
    },
    source: { adapter: 'heuristic', degradedFrom: [] },
  });
}
