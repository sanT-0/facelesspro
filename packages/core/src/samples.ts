/**
 * Where a voice's sample set lives on disk.
 *
 * The path is the identity: one directory per voice pair, named after the pair
 * id, under a single root. `samples/tts/valluvar`, `samples/tts/pallavi`, … — so
 * `TTS_PAIR=pallavi` writes `samples/tts/pallavi` without an extra env var, and
 * reading a set's name tells you which voice produced it.
 *
 * The id is validated here rather than trusted: an engine voice id, an absolute
 * path or a traversal would either scatter the sets or write outside the root.
 * A pair id is a catalogue key — lowercase segments joined by single dashes.
 */

export const SAMPLE_ROOT = 'samples/tts';

const PAIR_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function sampleSetDir(pairId: string): string {
  if (!PAIR_ID.test(pairId)) {
    throw new Error(
      `not a pair id: ${JSON.stringify(pairId)} — expected lowercase ids such as ` +
        '"valluvar", "pallavi", "indicf5-ta"',
    );
  }
  return `${SAMPLE_ROOT}/${pairId}`;
}
