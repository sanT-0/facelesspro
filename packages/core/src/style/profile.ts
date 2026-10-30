/**
 * Pure helpers for the style merge — docs/04 §4.
 *
 * Deliberately dependency-free: `packages/core` may not import
 * `@facelesspro/contracts` (AGENTS.md), so this file defines the small
 * structural inputs it needs and the schema-validated merge lives in
 * `apps/worker/src/art-style/merge.ts`. Contract types are assignable to these
 * shapes, which is what keeps the split honest without duplication.
 *
 * No I/O, no clock, no RNG:
 * - the ink colour is the darkest **measured** palette entry, never a guess;
 * - the seed is FNV-1a over the prompt-relevant fields, so the same reference
 *   always produces the same preview seeds.
 */

/** The only palette field these helpers need. `StylePalette` satisfies it. */
export interface PaletteHexes {
  readonly hex: readonly string[];
}

/** Fields a seed is allowed to depend on: everything that shapes an image. */
export interface StyleSeedInput {
  medium: string;
  promptPrefix: string;
  palette: PaletteHexes;
  line: { readonly weight: string; readonly color: string; readonly texture: string };
  shading: string;
  background: string;
  composition: string;
  characters: ReadonlyArray<{ readonly id: string; readonly description: string }>;
  typography: { readonly present: boolean; readonly style?: string | undefined };
  negative: string;
}

/** Rec. 709 weights; mirrored from `stats.ts` to keep this file standalone. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * Darkest measured colour, lowercased. Ties keep the earlier palette entry,
 * which is the higher-weight one, so the choice is deterministic.
 */
export function lineColorFor(palette: PaletteHexes): string {
  if (palette.hex.length === 0) {
    throw new TypeError('lineColorFor needs at least one palette colour');
  }

  let best = palette.hex[0]!;
  let bestLuma = lumaFromHex(best);
  for (let index = 1; index < palette.hex.length; index += 1) {
    const candidate = palette.hex[index]!;
    const candidateLuma = lumaFromHex(candidate);
    if (candidateLuma < bestLuma) {
      best = candidate;
      bestLuma = candidateLuma;
    }
  }
  return best.toLowerCase();
}

/** Redundant locally on purpose: no import from `./stats`, no cycle risk. */
function lumaFromHex(hex: string): number {
  const value = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!value) throw new TypeError(`lineColorFor expects #rrggbb, got ${hex}`);
  const rgb = Number.parseInt(value[1]!, 16);
  return (
    LUMA_R * ((rgb >> 16) & 0xff) +
    LUMA_G * ((rgb >> 8) & 0xff) +
    LUMA_B * (rgb & 0xff)
  );
}

/**
 * Deterministic 1..2 147 483 647 seed.
 *
 * FNV-1a over a fixed field order. Palette **hexes only** (sorted, deduped):
 * weights are measurements and drift in the fourth decimal, which must not
 * change a preview seed.
 */
export function seedBaseFor(input: StyleSeedInput): number {
  const palette = [...new Set(input.palette.hex.map((hex) => hex.toLowerCase()))].sort();
  const canonical = JSON.stringify([
    input.medium,
    input.promptPrefix,
    palette,
    input.line.weight,
    input.line.color.toLowerCase(),
    input.line.texture,
    input.shading,
    input.background,
    input.composition,
    input.characters.map((character) => [character.id, character.description]),
    input.typography.present,
    input.typography.style ?? null,
    input.negative,
  ]);

  return (fnv1a(canonical) % 2_147_483_646) + 1;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
