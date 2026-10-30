/**
 * The offline vision adapter: measured numbers → a cautious description.
 *
 * It cannot see the frames, so it says exactly that: `medium` is always
 * `"unknown"`, the texture is unknown, and no characters are invented. What it
 * *can* do is turn the numeric profile into clauses that are true by
 * definition — outline weight from stroke density, shading from local contrast,
 * palette character from saturation, edge behaviour from the safe-area proxy.
 *
 * That is the floor of `STYLE=cloudflare,gemini,heuristic`: zero cost, no key,
 * deterministic, and never pretends to be a model. The merge step fills
 * `line.color` from the measured palette either way.
 */

import type {
  NumericStyleProfile,
  StyleLineTexture,
  StyleLineWeight,
  StyleShading,
  StyleVision,
} from '@facelesspro/contracts';

import type { StyleVisionPort } from '../../ports/style-vision';

/** Prompt clauses stay well under the contract's 400-character prefix cap. */
const MAX_PREFIX_CHARS = 400;

export function createHeuristicStyleVision(): StyleVisionPort {
  return {
    name: 'heuristic',
    describe: async ({ numeric }): Promise<StyleVision> => {
      return {
        medium: 'unknown',
        promptPrefix: buildPrefix(numeric),
        line: { weight: lineWeightFor(numeric), texture: textureFor() },
        shading: shadingFor(numeric.tone.contrast.mean),
        background: backgroundFor(numeric.safeArea.edgeContentRatio),
        composition: compositionFor(numeric),
        characters: [],
        typography: { present: false },
        negative: 'photo, 3d render, text, watermark',
        adapter: 'heuristic',
        degradedFrom: [],
      };
    },
  };
}

/**
 * Ink weight from two independent measurements. Either one being high is
 * enough: a thick outline on a small frame can have low edge energy, and a busy
 * thin-line sketch can have high energy.
 */
export function lineWeightFor(numeric: NumericStyleProfile): StyleLineWeight {
  const { strokeDensity, edgeEnergy } = numeric.line;
  if (strokeDensity >= 0.06 || edgeEnergy >= 0.12) return 'thick';
  if (strokeDensity >= 0.02 || edgeEnergy >= 0.04) return 'medium';
  if (strokeDensity >= 0.004 || edgeEnergy >= 0.008) return 'thin';
  return 'none';
}

/**
 * Hard local transitions are what cel shading looks like from a distance; a
 * near-zero local range is flat fill. Anything in between is left unknown
 * rather than guessed.
 */
export function shadingFor(contrastMean: number): StyleShading {
  if (contrastMean >= 0.25) return 'cel';
  if (contrastMean < 0.05) return 'flat';
  return 'unknown';
}

export function textureFor(): StyleLineTexture {
  return 'unknown';
}

function saturationWord(mean: number): string {
  if (mean >= 0.6) return 'high-saturation';
  if (mean >= 0.25) return 'medium-saturation';
  return 'muted';
}

function backgroundFor(edgeContentRatio: number): string {
  if (edgeContentRatio < 0.05) return 'clean, simple background with empty edges';
  if (edgeContentRatio > 0.2) return 'busy background reaching the frame edge';
  return 'background extends to the frame edge';
}

/**
 * Facts only. `edgeContentRatio` is a proxy for safe-area behaviour, not a
 * composition detector (docs/04 §4), so the wording says "edge content" rather
 * than claiming the subject is centred.
 */
function compositionFor(numeric: NumericStyleProfile): string {
  const { orientation, ratio } = numeric.aspect;
  const edge = numeric.safeArea.edgeContentRatio;
  const placement =
    edge < 0.05
      ? 'low edge content, subject kept away from the edges'
      : edge > 0.2
        ? 'high edge content, subject reaches the frame edge'
        : 'moderate edge content';
  return `${orientation} ${ratio.toFixed(2)}:1 frame, ${placement}`;
}

function buildPrefix(numeric: NumericStyleProfile): string {
  const weight = lineWeightFor(numeric);
  const outline =
    weight === 'none'
      ? 'no visible outlines'
      : weight === 'unknown'
        ? 'outlines of unknown weight'
        : `${weight} outlines`;
  const parts = [
    `${numeric.aspect.orientation} frame`,
    outline,
    `${saturationWord(numeric.tone.saturation.mean)} palette`,
    shadingWord(numeric.tone.contrast.mean),
  ];
  return truncate(parts.join(', '), MAX_PREFIX_CHARS);
}

function shadingWord(contrastMean: number): string {
  if (contrastMean >= 0.25) return 'hard-edged cel shading';
  if (contrastMean < 0.05) return 'flat colour areas';
  return 'moderate local contrast';
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}
