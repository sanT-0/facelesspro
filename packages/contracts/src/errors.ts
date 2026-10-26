/**
 * The error envelope every endpoint returns (docs/07 §1.2).
 *
 * `code` is the stable part: clients branch on it, never on `message`. `field`
 * is present when the failure belongs to one input, so an editor can highlight
 * it without parsing prose.
 */

import { z } from 'zod';

export const ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'insufficient_credits',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'unprocessable',
  'rate_limited',
  'upstream_failed',
  /** Not in the parity table: an unexpected failure still needs a code. */
  'internal',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorBodySchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string().min(1),
    field: z.string().min(1).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

/** HTTP status for each code. One map, so no handler invents its own. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_request: 400,
  unauthorized: 401,
  insufficient_credits: 402,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unprocessable: 422,
  rate_limited: 429,
  upstream_failed: 502,
  internal: 500,
};

export function statusForError(code: ErrorCode): number {
  return ERROR_STATUS[code];
}

/** Build the envelope. Keeps `field` out of the JSON when absent. */
export function apiError(
  code: ErrorCode,
  message: string,
  field?: string,
): ApiErrorBody {
  return { error: field === undefined ? { code, message } : { code, message, field } };
}
