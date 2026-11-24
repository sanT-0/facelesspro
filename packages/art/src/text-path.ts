/**
 * Text → SVG path conversion, shaped by HarfBuzz.
 *
 * SVG `<text>` is unusable for Tamil here: resvg (the only SVG rasteriser we
 * ship) gives every cluster that ends in a reordered vowel sign — ே ை ொ ோ ௌ
 * — a zero advance, so the next word is drawn on top of it. HarfBuzz shapes
 * the same text correctly (libass proves it on the caption path), so chat
 * skins are emitted as glyph outlines instead: measure with HarfBuzz, lay out
 * with our own advances, rasterise with resvg, which only sees `<path>`.
 *
 * Everything is synchronous: fonts are read once and cached, and HarfBuzz is
 * a wasm module initialised at import.
 */

import { readFileSync } from 'node:fs';

import * as hb from 'harfbuzzjs';

import { bundledCaptionFontFiles } from './fonts';

interface LoadedFont {
  readonly file: string;
  readonly face: hb.Face;
  readonly font: hb.Font;
  readonly upem: number;
  /** Keeps the backing store alive for the lifetime of the face. */
  readonly blob: hb.Blob;
  readonly weight: number;
}

const FONT_CACHE = new Map<string, LoadedFont>();

/**
 * Preference order for a run of text. Noto Sans Tamil carries Latin too, so it
 * is the primary; Noto Sans covers any Latin glyph the Tamil face lacks; Noto
 * Emoji catches emoji. All three are monochrome outline fonts.
 */
const FONT_ORDER = ['NotoSansTamil-Variable.ttf', 'NotoSans-Variable.ttf', 'NotoEmoji-Variable.ttf'] as const;

function loadFont(file: string, weight: number): LoadedFont {
  const key = `${file}\u0000${weight}`;
  const cached = FONT_CACHE.get(key);
  if (cached !== undefined) return cached;

  const blob = new hb.Blob(readFileSync(file));
  const face = new hb.Face(blob);
  const font = new hb.Font(face);
  if (weight !== 400) {
    font.setVariations([new hb.Variation('wght', weight)]);
  }
  const loaded: LoadedFont = { file, face, font, upem: face.upem, blob, weight };
  FONT_CACHE.set(key, loaded);
  return loaded;
}

function candidateFonts(weight: number): LoadedFont[] {
  const files = bundledCaptionFontFiles();
  const byName = new Map(files.map((file) => [file.split('/').pop() ?? file, file]));
  const ordered = FONT_ORDER.map((name) => byName.get(name)).filter((file): file is string => file !== undefined);
  // Any bundled font the order above does not name still gets a chance.
  for (const file of files) if (!ordered.includes(file)) ordered.push(file);
  return ordered.map((file) => loadFont(file, weight));
}

function graphemeClusters(text: string): string[] {
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

interface ShapedRun {
  readonly font: LoadedFont;
  readonly infos: readonly hb.GlyphInfo[];
  readonly positions: readonly hb.GlyphPosition[];
}

function shapeRun(text: string, font: LoadedFont): ShapedRun {
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  buffer.setDirection(hb.Direction.LTR);
  hb.shape(font.font, buffer);
  return { font, infos: buffer.getGlyphInfos(), positions: buffer.getGlyphPositions() };
}

const NOTDEF = 0;

function hasMissingGlyph(run: ShapedRun): boolean {
  return run.infos.some((info) => info.codepoint === NOTDEF);
}

/**
 * Split text into runs that each shape without a missing glyph.
 *
 * The whole string is tried with the primary font first so Tamil words keep
 * their cross-cluster shaping (ligatures, reordering). Only when a glyph is
 * missing does it fall back to per-grapheme font selection, merging adjacent
 * clusters so a run is still shaped as one unit.
 */
function resolveRuns(text: string, weight: number): ShapedRun[] {
  const candidates = candidateFonts(weight);
  const primary = candidates[0];
  if (primary === undefined || text.length === 0) return [];

  const whole = shapeRun(text, primary);
  if (!hasMissingGlyph(whole)) return [whole];

  const runs: Array<{ font: LoadedFont; text: string }> = [];
  for (const cluster of graphemeClusters(text)) {
    const chosen =
      candidates.find((candidate) => !hasMissingGlyph(shapeRun(cluster, candidate))) ?? primary;
    const last = runs.at(-1);
    if (last !== undefined && last.font === chosen) last.text += cluster;
    else runs.push({ font: chosen, text: cluster });
  }
  return runs.map((run) => shapeRun(run.text, run.font));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface TextPathOptions {
  /** Left edge of the text. */
  x: number;
  /** Baseline of the text. */
  y: number;
  fontSize: number;
  /** CSS colour for the glyphs. Paths inherit it from the wrapping group. */
  fill?: string;
  /** Fill opacity, 0–1. */
  opacity?: number;
  /** Variable-font weight, 100–900. Default 400. */
  weight?: number;
}

export interface TextPathResult {
  /** `<path>` elements positioned at absolute coordinates. */
  svg: string;
  /** Advance width in the same units as `fontSize`. */
  width: number;
}

/** Shape `text` and return SVG outlines plus the advance width. */
export function textToPath(text: string, options: TextPathOptions): TextPathResult {
  const weight = options.weight ?? 400;
  const runs = resolveRuns(text, weight);
  const paths: string[] = [];
  let x = options.x;

  for (const run of runs) {
    const scale = options.fontSize / run.font.upem;
    for (let i = 0; i < run.infos.length; i += 1) {
      const info = run.infos[i];
      const position = run.positions[i];
      if (info === undefined || position === undefined) continue;
      const d = run.font.font.glyphToPath(info.codepoint);
      if (d.length > 0) {
        const px = x + position.xOffset * scale;
        const py = options.y - position.yOffset * scale;
        paths.push(`<path transform="translate(${round(px)} ${round(py)}) scale(${round(scale)} ${round(-scale)})" d="${d}"/>`);
      }
      x += position.xAdvance * scale;
    }
  }

  const fill = options.fill;
  const attrs = [
    fill === undefined ? '' : ` fill="${fill}"`,
    options.opacity === undefined ? '' : ` opacity="${options.opacity}"`,
  ].join('');
  const svg = paths.length === 0 ? '' : `<g${attrs}>${paths.join('')}</g>`;

  return { svg, width: x - options.x };
}

/** Advance width of `text` at `fontSize`, shaped the same way it is drawn. */
export function measureText(text: string, fontSize: number, weight = 400): number {
  let width = 0;
  for (const run of resolveRuns(text, weight)) {
    const scale = fontSize / run.font.upem;
    for (const position of run.positions) width += position.xAdvance * scale;
  }
  return width;
}
