/** Cloudflare Workers AI Flux Schnell image adapter (docs/06 §1.2 rank 1). */

import {
  generatedImageSchema,
  imageCapabilitiesSchema,
  imageGenerationRequestSchema,
} from '@facelesspro/contracts';
import type { ImageCapabilities } from '@facelesspro/contracts';

import type { ImagePort } from '../ports/image';
import { UpstreamError, postJson } from '../planner/http';
import { IMAGE_NATIVE_DIMENSIONS } from './dimensions';
import { isPng, normalizeImageToPng } from './normalize';
import type { NormalizeImage } from './normalize';

const ADAPTER = 'cloudflare' as const;
export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const DEFAULT_STEPS = 4;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_PROVIDER_IMAGE_BYTES = 25 * 1024 * 1024;

export const CLOUDFLARE_IMAGE_CAPABILITIES: ImageCapabilities =
  imageCapabilitiesSchema.parse({
    maxSide: 1024,
    sizes: ['landscape', 'portrait'],
    style: 'profile',
    seed: true,
  });

export interface CloudflareImageOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly model?: string;
  readonly steps?: number;
  readonly timeoutMs?: number;
  /** Injected so hermetic tests never open a socket. */
  readonly fetchImpl?: typeof fetch;
  /** Injected in unit tests; production centre-crops JPEG → contract PNG with ffmpeg. */
  readonly normalize?: NormalizeImage;
}

function integerSetting(
  value: string | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum?: number,
): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new TypeError(`${label} must be an integer`);
  if (parsed < minimum || (maximum !== undefined && parsed > maximum)) {
    throw new RangeError(
      `${label} must be ${maximum === undefined ? `at least ${minimum}` : `${minimum}..${maximum}`}`,
    );
  }
  return parsed;
}

export function cloudflareImageOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): CloudflareImageOptions {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const missing = [
    accountId ? null : 'CLOUDFLARE_ACCOUNT_ID',
    apiToken ? null : 'CLOUDFLARE_API_TOKEN',
  ].filter((name): name is string => name !== null);
  if (!accountId || !apiToken) {
    throw new Error(`cloudflare image is not configured: missing ${missing.join(', ')}`);
  }

  return {
    accountId,
    apiToken,
    model: env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_CLOUDFLARE_IMAGE_MODEL,
    steps: integerSetting(env.CLOUDFLARE_IMAGE_STEPS, DEFAULT_STEPS, 'Cloudflare image steps', 1, 8),
    timeoutMs: integerSetting(
      env.CLOUDFLARE_IMAGE_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      'Cloudflare image timeout',
      1,
    ),
  };
}

function imageTextFrom(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== 'object' || result === null) return null;
  const image = (result as { image?: unknown }).image;
  return typeof image === 'string' ? image : null;
}

function looksLikeSupportedImage(bytes: Uint8Array): boolean {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = isPng(bytes);
  const webp =
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP';
  return jpeg || png || webp;
}

function decodeProviderImage(value: string): Uint8Array {
  const encoded = value.trim();
  if (encoded.length === 0) throw new Error('response contained an empty image');
  if (encoded.length > Math.ceil((MAX_PROVIDER_IMAGE_BYTES * 4) / 3) + 4) {
    throw new Error(`response image exceeds ${MAX_PROVIDER_IMAGE_BYTES} bytes`);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || encoded.length % 4 === 1) {
    throw new Error('response image is not valid base64');
  }

  const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4);
  const bytes = Buffer.from(padded, 'base64');
  if (
    bytes.length === 0 ||
    bytes.toString('base64').replace(/=+$/u, '') !== encoded.replace(/=+$/u, '')
  ) {
    throw new Error('response image is not canonical base64');
  }
  if (!looksLikeSupportedImage(bytes)) {
    throw new Error('response image is not JPEG, PNG or WebP');
  }
  return bytes;
}

export function createCloudflareImageAdapter(
  options: CloudflareImageOptions = cloudflareImageOptionsFromEnv(),
): ImagePort {
  const model = options.model ?? DEFAULT_CLOUDFLARE_IMAGE_MODEL;
  const steps = options.steps ?? DEFAULT_STEPS;
  if (!Number.isInteger(steps) || steps < 1 || steps > 8) {
    throw new RangeError('Cloudflare image steps must be an integer in 1..8');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError('Cloudflare image timeout must be a positive integer');
  }
  const normalize = options.normalize ?? normalizeImageToPng;

  return {
    name: ADAPTER,
    capabilities: CLOUDFLARE_IMAGE_CAPABILITIES,
    async draw(input) {
      const request = imageGenerationRequestSchema.parse(input);
      const payload = await postJson({
        url: `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run/${model}`,
        headers: { Authorization: `Bearer ${options.apiToken}` },
        body: {
          // Flux Schnell has no separate negative-prompt field. The planner's
          // final composed prompt already carries the style's negative clause.
          prompt: request.prompt,
          // The official usage example accepts seed even though the linked raw
          // JSON schema currently omits it; a live test must keep this honest.
          seed: request.seed,
          steps,
        },
        adapter: ADAPTER,
        timeoutMs,
        fetchImpl: options.fetchImpl,
      });

      const encoded = imageTextFrom(payload);
      if (encoded === null) {
        throw new UpstreamError(ADAPTER, 'response contained no result.image', {
          retryable: false,
        });
      }

      let providerBytes: Uint8Array;
      try {
        providerBytes = decodeProviderImage(encoded);
      } catch (error) {
        throw new UpstreamError(
          ADAPTER,
          error instanceof Error ? error.message : String(error),
          { retryable: false },
        );
      }

      const dimensions = IMAGE_NATIVE_DIMENSIONS[request.size];
      let bytes: Uint8Array;
      try {
        bytes = await normalize(providerBytes, dimensions);
        if (!isPng(bytes)) throw new Error('normalization returned non-PNG bytes');
      } catch (error) {
        throw new UpstreamError(
          ADAPTER,
          `image normalization failed: ${error instanceof Error ? error.message : String(error)}`,
          { retryable: false },
        );
      }

      return generatedImageSchema.parse({
        adapter: ADAPTER,
        degradedFrom: [],
        mimeType: 'image/png',
        size: request.size,
        ...dimensions,
        seed: request.seed,
        bytes,
      });
    },
  };
}
