/**
 * Production script → narration + per-section visual direction.
 *
 * A user pasting a "video prompt" (headings, `**Visual:**` directions,
 * `**Voiceover:**` blocks, an end-screen CTA) is not handing us a narration
 * script: reading the stage directions aloud is the bug this module fixes.
 *
 * The split is deliberately conservative. It only recognises the shape when the
 * text actually contains a `Visual:` marker **and** a `Voiceover:`/`Narration:`
 * marker, so an ordinary script — even one containing the word "visual" — is
 * returned untouched (`null`). Everything after `Voiceover:` up to the next
 * section is narration, with markdown, emoji, end-screen lines and CTA strips
 * removed. The sections keep their `[start–end]` ranges for callers that want
 * them; scene timings still come from the real speech, never from these labels.
 *
 * Pure: no I/O, no clock, no network.
 */

export interface ProductionSection {
  /** Heading text without the time range, e.g. "THE HOOK"; may be empty. */
  readonly heading: string;
  /** Visual direction for this section, whitespace-collapsed. */
  readonly visual: string;
  /** Only the spoken text; markdown, quotes, emoji and CTA removed. */
  readonly narration: string;
  /** `[m:ss–m:ss]` start in ms, or `null` when the heading had no range. */
  readonly startMs: number | null;
  readonly endMs: number | null;
}

export interface ProductionScript {
  /** The leading `#` heading, when there is one. */
  readonly title: string;
  readonly sections: readonly ProductionSection[];
  /** Sections' narration joined with blank lines — the script to narrate. */
  readonly narration: string;
}

/** `[0:00–0:30]`, `0:00-0:30`, with or without brackets. */
const TIME_RANGE = /^\s*\[?\s*(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})\s*\]?\s*(.*)$/u;
const HEADING = /^\s{0,3}(#{1,6})\s*(.+?)\s*$/u;
const VISUAL_MARKER = /\bVisual\s*:/iu;
const VOICE_MARKER = /\b(?:Voiceover|Narration)\s*:/iu;

interface RawSection {
  heading: string;
  startMs: number | null;
  endMs: number | null;
  lines: string[];
}

/**
 * Parse a production script, or return `null` when the text is an ordinary
 * narration script (no `Visual:` + `Voiceover:` pair, or no spoken text).
 */
export function parseProductionScript(text: string): ProductionScript | null {
  if (typeof text !== 'string') throw new TypeError('parseProductionScript expects a string');

  const normalized = text.replace(/\r\n?/gu, '\n');
  const plain = normalized.replace(/\*\*/gu, '');
  if (!VISUAL_MARKER.test(plain) || !VOICE_MARKER.test(plain)) return null;

  const lines = normalized.split('\n');
  const sections: RawSection[] = [];
  let title = '';
  let current: RawSection | null = null;

  const start = (heading: string, startMs: number | null, endMs: number | null): void => {
    current = { heading, startMs, endMs, lines: [] };
    sections.push(current);
  };

  // Start with a default section in case the first content is not a heading.
  start('', null, null);

  for (const line of lines) {
    const heading = HEADING.exec(line);
    const bareTime = heading === null ? TIME_RANGE.exec(line) : null;

    if (heading !== null) {
      const hashes = heading[1] ?? '';
      const content = (heading[2] ?? '').trim();
      const range = TIME_RANGE.exec(content);
      if (range !== null) {
        start((range[5] ?? '').trim(), toMs(range[1], range[2]), toMs(range[3], range[4]));
      } else if (
        hashes.length === 1 &&
        sections.length === 1 &&
        current !== null &&
        (current as RawSection).heading === '' &&
        title.length === 0
      ) {
        // A single leading `#` is the video title; `##`/`###` headings are
        // sections even when they come first, so a no-title script still parses.
        title = content;
      } else {
        start(content, null, null);
      }
      continue;
    }

    if (bareTime !== null) {
      start(
        (bareTime[5] ?? '').trim(),
        toMs(bareTime[1], bareTime[2]),
        toMs(bareTime[3], bareTime[4]),
      );
      continue;
    }

    current!.lines.push(line);
  }

  const parsed: ProductionSection[] = [];
  for (const section of sections) {
    const body = section.lines.join('\n').replace(/\*\*/gu, '');
    const voice = VOICE_MARKER.exec(body);
    if (voice === null) continue;

    const visualMatch = body.match(
      /\bVisual\s*:\s*([\s\S]*?)(?=\n\s*(?:Voiceover|Narration)\s*:|$)/iu,
    );
    const narration = cleanNarration(body.slice((voice.index ?? 0) + voice[0].length));
    if (narration.length === 0) continue;

    const visual = cleanInline(visualMatch?.[1] ?? '') || section.heading || 'a scene from the narration';
    parsed.push({
      heading: section.heading,
      visual,
      narration,
      startMs: section.startMs,
      endMs: section.endMs,
    });
  }

  if (parsed.length === 0) return null;

  return {
    title,
    sections: parsed,
    narration: parsed.map((section) => section.narration).join('\n\n'),
  };
}

function toMs(minutes: string | undefined, seconds: string | undefined): number | null {
  if (minutes === undefined || seconds === undefined) return null;
  return (Number(minutes) * 60 + Number(seconds)) * 1000;
}

/** Collapse to one line and drop emphasis/backticks. */
function cleanInline(text: string): string {
  return text
    .replace(/\*\*|__|`/gu, '')
    .replace(/[*#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Spoken text only: drop end-screen/CTA lines, markdown, emoji, and the outer
 * quotes a `Voiceover:` block is usually wrapped in.
 */
function cleanNarration(raw: string): string {
  const kept = raw
    .split('\n')
    .filter((line) => !isEndScreen(line) && !isCta(line))
    .join('\n');

  const text = kept
    .replace(/\*\*|__|`/gu, '')
    .replace(/[*#]/gu, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  return stripOuterQuotes(text);
}

function isEndScreen(line: string): boolean {
  return /^\s*\**\s*\[?\s*END\s+SCREEN\s*\]?\s*\**\s*$/iu.test(line);
}

/**
 * `LIKE 👍 | SHARE | SUBSCRIBE` is a CTA, but `share this video` inside the
 * narration is a sentence. Only a line made entirely of CTA words (and the
 * separators/emoji around them) is dropped.
 */
function isCta(line: string): boolean {
  if (!line.includes('|') && !/\p{Extended_Pictographic}/u.test(line)) return false;
  const words = line
    .replace(/[^\p{L}\s]/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) return false;
  return words.every((word) =>
    ['like', 'share', 'subscribe', 'comment', 'follow', 'bell'].includes(word.toLowerCase()),
  );
}

function stripOuterQuotes(text: string): string {
  for (const [open, close] of [
    ['"', '"'],
    ['“', '”'],
    ['„', '“'],
    ["'", "'"],
  ] as const) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim();
    }
  }
  return text;
}
