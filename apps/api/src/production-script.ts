/**
 * Production script normalisation at the API boundary.
 *
 * When a client sends a raw production script (headings, `**Visual:**`,
 * `**Voiceover:**`, end-screen CTA), this module parses it into the
 * `script` + `visualSections` shape the worker expects. If the input is
 * already a plain narration script, it is passed through unchanged.
 *
 * Pure: no I/O, no clock, no network.
 */

import { parseProductionScript } from '@facelesspro/core';
import { normalizeScript } from '@facelesspro/core';
import type { CreateAiVideoV3Request } from '@facelesspro/contracts';

export interface NormalisedV3Request {
  /** The narration-only script to be spoken. */
  script: string;
  /** Optional per-section visual direction for image prompts. */
  visualSections: { text: string; visual: string }[] | undefined;
  /** Other fields pass through unchanged. */
  rest: Omit<CreateAiVideoV3Request, 'script' | 'visualSections'>;
}

/**
 * Normalise a V3 create request.
 *
 * - If `visualSections` is already present, validate it reconstructs `script`.
 * - Else if `script` parses as a production script, replace `script` with the
 *   extracted narration and populate `visualSections`.
 * - Otherwise pass through unchanged.
 *
 * Throws on validation failure with a message suitable for a 400 response.
 */
export function normaliseV3Request(input: CreateAiVideoV3Request): NormalisedV3Request {
  const { script, visualSections, ...rest } = input;

  // If visualSections already provided, validate reconstruction.
  if (visualSections !== undefined && visualSections.length > 0) {
    if (script === undefined) {
      throw new Error('script is required when visualSections is provided');
    }
    const joined = visualSections.map((s) => s.text).join(' ');
    if (normalizeScript(joined) !== normalizeScript(script)) {
      throw new Error('visualSections text must join to reconstruct the script');
    }
    return { script: script!, visualSections, rest };
  }

  // No visualSections: try to parse as a production script.
  if (script !== undefined) {
    const parsed = parseProductionScript(script);
    if (parsed !== null) {
      const narration = parsed.narration;
      if (narration.trim().length === 0) {
        throw new Error('production script contains no narratable text');
      }
      const sections = parsed.sections.map((section) => ({
        text: section.narration,
        visual: section.visual,
      }));
      // Validate the parse was faithful.
      const joined = sections.map((s) => s.text).join(' ');
      if (normalizeScript(joined) !== normalizeScript(narration)) {
        throw new Error('parsed narration does not reconstruct cleanly');
      }
      return {
        script: narration,
        visualSections: sections,
        rest,
      };
    }
  }

  // Plain script — pass through.
  return { script: script!, visualSections: undefined, rest };
}