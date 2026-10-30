/**
 * Model text → `StyleVisionAnswer`.
 *
 * Models are chatty: they wrap JSON in ``` fences, prefix it with "Here is the
 * description:", and sometimes append a sentence after the object. Extraction
 * is therefore tolerant of surrounding text but strict about the object's
 * contents. An invalid enum or a missing key is fatal: a half-described style
 * would be merged as if it were observed, and the heuristic fallback is more
 * honest than that.
 *
 * Unknown keys are stripped by the schema rather than rejected — a model that
 * volunteers `palette` or `line.color` is being helpful, not breaking the
 * contract. See `packages/contracts/src/style-vision.ts`.
 */

import { styleVisionAnswerSchema } from '@facelesspro/contracts';
import type { StyleVisionAnswer } from '@facelesspro/contracts';

/** A model answer that parsed as JSON but did not match the contract. */
export class VisionResponseError extends Error {
  override readonly name = 'VisionResponseError';
  /** The contract issues, already joined for the chain's error message. */
  readonly detail: string;
  /** First 200 characters of the raw answer, enough to diagnose without logging it all. */
  readonly excerpt: string;

  constructor(detail: string, raw: string) {
    super(`vision answer did not match the contract: ${detail}`);
    this.detail = detail;
    this.excerpt = raw.slice(0, 200);
  }
}

/**
 * Pull the JSON object out of a possibly fenced or prose-wrapped answer.
 *
 * @throws VisionResponseError when there is no object to parse.
 */
function extractJson(text: string): string {
  let candidate = text.trim();
  if (candidate.length === 0) {
    throw new VisionResponseError('answer was empty', text);
  }

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(candidate);
  if (fence?.[1]) candidate = fence[1].trim();

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new VisionResponseError('answer contained no JSON object', text);
  }
  return candidate.slice(start, end + 1);
}

/**
 * Parse and validate a model answer.
 *
 * @throws VisionResponseError when the text is not JSON or does not satisfy
 *         `styleVisionAnswerSchema`.
 */
export function parseVisionAnswer(text: string): StyleVisionAnswer {
  if (typeof text !== 'string') {
    throw new VisionResponseError('answer was not a string', String(text));
  }
  const json = extractJson(text);

  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    throw new VisionResponseError(
      `answer was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      text,
    );
  }

  const result = styleVisionAnswerSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new VisionResponseError(detail, text);
  }
  return result.data;
}
