/**
 * Caption cue builder — narration word timings → display cues.
 *
 *docs/04 §5: cues are grouped by template rules (max chars per line, max
 * lines, max words), with punctuation priority and a hard rule from
 * AGENTS.md: a line break never splits a Tamil grapheme cluster. The builder
 * therefore only ever breaks *between* words, and measures what a renderer
 * will see in grapheme clusters via `Intl.Segmenter`, not raw code units —
 * `க்ஷ` is 3 code units but 2 clusters (`க்` + `ஷ`), and a combining mark is
 * never counted on its own.
 *
 * Grouping is the sole purpose here; the ASS writer (later task) consumes
 * `Cue.words` for karaoke `\k` spans. Presentational concerns (uppercase,
 * fonts, colours) belong to the template spec, not to this module.
 *
 * Punctuation priority closes a cue early: when the speaker's sentence or
 * clause ends inside the window, the cue ends there too, so a subtitle never
 * straddles a spoken sentence boundary by accident of timing.
 *
 * The builder never emits a cue it cannot render: if a window does not fit
 * `maxLines` lines it shrinks the window, down to a single word. The only
 * hard errors are empty input and a single word wider than one line.
 *
 * Trailing punctuation travel test must never be broken: words are kept
 * verbatim, in order, so joining every cue's lines with spaces reproduces the
 * input sequence.
 *
 * Pure: no I/O, no clock, no network.
 */

export interface CaptionWord {
  /** As spoken and transcribed, punctuation attached. */
  text: string;
  /** Global times, already `run.start + word.local` from the narrator. */
  startMs: number;
  endMs: number;
}

export interface CaptionCue {
  /** 1–`maxLines` display lines; `readableCueText(cue)` joins them. */
  lines: string[];
  /** The words laid out into `lines`, in input order. */
  words: CaptionWord[];
  /** `words[0].startMs`. */
  startMs: number;
  /** Last word's `endMs`. */
  endMs: number;
  /**
   * Opt-in decoration from `sprinkleEmoji` (one grapheme cluster). Kept out of
   * `lines`/`words` so text reconstruction is unaffected.
   */
  emoji?: string;
}

export interface CaptionCueOptions {
  /** Words shown at once (template `wordLimit`). */
  wordLimit: number;
  /** Display lines allowed per cue (template `maxLines`). */
  maxLines: number;
  /** Line width in grapheme clusters, matching what the renderer draws. */
  maxCharsPerLine: number;
}

/** Punctuation that ends a spoken clause; a cue closes right after it. */
const CLAUSE_END = /[.!?,;:?…।॥"”’»)\]]$/;

let graphemeSegmenter: Intl.Segmenter | undefined;

/**
 * Visual width of `text` in grapheme clusters. A Tamil cluster (`க்ஷ`,
 * `நாம்`) is one cell even though it is several code units; without this,
 * every Tamil caption line-width decision would be wrong by 2–3×.
 */
export function clusterCount(text: string): number {
  graphemeSegmenter ??= new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  });
  let count = 0;
  for (const _cluster of graphemeSegmenter.segment(text)) count += 1;
  return count;
}

/** Greedy wrap: fill each line, move whole words down when they overflow. */
function wrapWords(
  words: readonly string[],
  maxCharsPerLine: number,
  maxLines: number,
): string[] | null {
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const joined = current === '' ? word : `${current} ${word}`;
    if (clusterCount(joined) <= maxCharsPerLine) {
      current = joined;
      continue;
    }
    if (clusterCount(word) > maxCharsPerLine) return null;
    if (current !== '') lines.push(current);
    current = word;
  }
  if (current !== '') lines.push(current);
  return lines.length <= maxLines ? lines : null;
}

interface WordGroup {
  words: CaptionWord[];
  lines: string[];
}

/** Largest fitting group starting at `start`, honouring punctuation priority. */
function nextGroup(
  words: readonly CaptionWord[],
  start: number,
  options: CaptionCueOptions,
  wordWidths: readonly number[],
): { group: WordGroup; end: number } {
  // Punctuation priority: the window ends at the first clause-ending word,
  // unless the window would then be empty.
  let limit = Math.min(start + options.wordLimit, words.length);
  for (let i = start; i < limit; i += 1) {
    if (CLAUSE_END.test(words[i]?.text ?? '')) {
      limit = Math.min(i + 1, words.length);
      break;
    }
  }
  if (limit === start) {
    limit = start + 1;
  }

  // Fit the largest window that renders within the constraints, shrinking
  // rather than overflowing. The single-word floor is where we fail loudly.
  for (let end = limit; end > start; end -= 1) {
    const slice = words.slice(start, end);
    const lines = wrapWords(
      slice.map((w) => w.text),
      options.maxCharsPerLine,
      options.maxLines,
    );
    if (lines !== null) {
      return { group: { words: slice, lines }, end };
    }
  }

  const word = words[start]?.text ?? '';
  const width = wordWidths[start] ?? clusterCount(word);
  throw new Error(
    `caption word "${word}" is wider than maxCharsPerLine (${width} > ${options.maxCharsPerLine}); it cannot be displayed without breaking a grapheme cluster`,
  );
}

/**
 * Build display cues from global narration word timings. Throws when the
 * input is empty or a word is wider than one line; never drops or rewrites a
 * word (join every cue's lines with spaces to reconstruct the input words).
 */
export function buildCaptionCues(
  words: readonly CaptionWord[],
  options: CaptionCueOptions,
): CaptionCue[] {
  if (words.length === 0) {
    throw new Error('buildCaptionCues: called with no words');
  }

  const wordWidths = words.map((w) => clusterCount(w.text));
  const cues: CaptionCue[] = [];
  let start = 0;
  while (start < words.length) {
    const { group, end } = nextGroup(words, start, options, wordWidths);
    const first = group.words[0];
    const last = group.words[group.words.length - 1];
    if (first === undefined || last === undefined) {
      throw new Error('buildCaptionCues: group produced no words');
    }
    cues.push({
      lines: group.lines,
      words: group.words,
      startMs: first.startMs,
      endMs: last.endMs,
    });
    start = end;
  }
  return cues;
}

/** Convenience for the renderer: the cue as one string, lines space-joined. */
export function readableCueText(cue: CaptionCue): string {
  return cue.lines.join(' ');
}
