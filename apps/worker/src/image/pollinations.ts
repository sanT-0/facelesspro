/** Pollinations authenticated image adapter (docs/06 §1.2 rank 2). */

import {
  generatedImageSchema,
  imageCapabilitiesSchema,
  imageGenerationRequestSchema,
} from '@facelesspro/contracts';
import type { ImageCapabilities } from '@facelesspro/contracts';

import type { ImagePort } from '../ports/image';
import { UpstreamError, isRetryableHttpStatus } from '../planner/http';
import { IMAGE_NATIVE_DIMENSIONS } from './dimensions';
import { isPng, normalizeImageToPng } from './normalize';
import type { NormalizeImage } from './normalize';

const ADAPTER = 'pollinations' as const;
export const DEFAULT_POLLINATIONS_BASE_URL = 'https://gen.pollinations.ai/image';
/** Canonical current id of the Flux Schnell model that honours caller seeds. */
export const DEFAULT_POLLINATIONS_IMAGE_MODEL = 'black-forest-labs/flux.1-schnell';
const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_POLLINATIONS_IMAGE_BYTES = 25 * 1024 * 1024;

export const POLLINATIONS_IMAGE_CAPABILITIES: ImageCapabilities =
  imageCapabilitiesSchema.parse({
    maxSide: 1024,
    sizes: ['landscape', 'portrait'],
    style: 'profile',
    seed: true,
  });

export interface PollinationsImageOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  /** Response limit injection keeps cap tests small; production defaults to 25 MiB. */
  readonly maxResponseBytes?: number;
  /** Injected so hermetic tests never open a socket. */
  readonly fetchImpl?: typeof fetch;
  /** Injected in unit tests; production normalizes provider raster bytes with ffmpeg. */
  readonly normalize?: NormalizeImage;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  if (value < 1) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function integerSetting(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  return positiveInteger(Number(value), label);
}

function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError('Pollinations base URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') {
    throw new TypeError('Pollinations base URL must use HTTPS');
  }
  if (url.hostname.toLowerCase() === 'image.pollinations.ai') {
    throw new TypeError('legacy Pollinations endpoint is watermarked and unsupported');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('Pollinations base URL must not contain credentials, query or fragment');
  }
  return url.toString().replace(/\/+$/u, '');
}

export function pollinationsImageOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): PollinationsImageOptions {
  const apiKey = env.POLLINATIONS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('pollinations image is not configured: missing POLLINATIONS_API_KEY');
  }
  return {
    apiKey,
    baseUrl: normalizeBaseUrl(
      env.POLLINATIONS_BASE_URL?.trim() || DEFAULT_POLLINATIONS_BASE_URL,
    ),
    model: env.POLLINATIONS_IMAGE_MODEL?.trim() || DEFAULT_POLLINATIONS_IMAGE_MODEL,
    timeoutMs: integerSetting(
      env.POLLINATIONS_IMAGE_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      'Pollinations image timeout',
    ),
  };
}

type RasterMime = 'image/jpeg' | 'image/png' | 'image/webp';
const ACCEPTED_RASTER_MIMES = new Set<RasterMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

class ProviderResponseError extends Error {
  override readonly name = 'ProviderResponseError';
}

function rasterMimeFromBytes(bytes: Uint8Array): RasterMime | null {
  if (isPng(bytes)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

async function readBoundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const declaredText = response.headers.get('content-length');
  if (declaredText !== null) {
    const declared = Number(declaredText);
    if (Number.isFinite(declared) && declared > maximum) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderResponseError(`response image exceeds ${maximum} bytes`);
    }
  }
  if (response.body === null) throw new ProviderResponseError('response contained no image bytes');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderResponseError(`response image exceeds ${maximum} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (length === 0) throw new ProviderResponseError('response contained no image bytes');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function contentTypeOf(response: Response): RasterMime {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !ACCEPTED_RASTER_MIMES.has(contentType as RasterMime)) {
    throw new ProviderResponseError(
      `response content type is not JPEG, PNG or WebP: ${contentType || 'missing'}`,
    );
  }
  return contentType as RasterMime;
}

function imageUrl(
  baseUrl: string,
  model: string,
  request: ReturnType<typeof imageGenerationRequestSchema.parse>,
): string {
  let encodedPrompt: string;
  try {
    encodedPrompt = encodeURIComponent(request.prompt);
  } catch {
    throw new UpstreamError(ADAPTER, 'prompt is not valid Unicode', { retryable: false });
  }
  const dimensions = IMAGE_NATIVE_DIMENSIONS[request.size];
  const url = new URL(`${baseUrl}/${encodedPrompt}`);
  url.searchParams.set('model', model);
  url.searchParams.set('width', String(dimensions.width));
  url.searchParams.set('height', String(dimensions.height));
  url.searchParams.set('seed', String(request.seed));
  return url.toString();
}

async function providerImage(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maximumBytes: number,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new UpstreamError(
        ADAPTER,
        `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        {
          status: response.status,
          retryable: isRetryableHttpStatus(response.status),
        },
      );
    }

    const contentType = contentTypeOf(response);
    const bytes = await readBoundedBody(response, maximumBytes);
    const actualType = rasterMimeFromBytes(bytes);
    if (actualType === null) {
      throw new ProviderResponseError('response image is not JPEG, PNG or WebP');
    }
    if (actualType !== contentType) {
      throw new ProviderResponseError(
        `response content type ${contentType} does not match ${actualType} bytes`,
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error instanceof ProviderResponseError) {
      throw new UpstreamError(ADAPTER, error.message, { retryable: false });
    }
    const aborted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    throw new UpstreamError(
      ADAPTER,
      aborted
        ? `request timed out after ${timeoutMs} ms`
        : `request failed: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createPollinationsImageAdapter(
  options: PollinationsImageOptions = pollinationsImageOptionsFromEnv(),
): ImagePort {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_POLLINATIONS_BASE_URL);
  const model = (options.model ?? DEFAULT_POLLINATIONS_IMAGE_MODEL).trim();
  if (model.length === 0) throw new TypeError('Pollinations image model must not be empty');
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'Pollinations image timeout');
  const maximumBytes = positiveInteger(
    options.maxResponseBytes ?? MAX_POLLINATIONS_IMAGE_BYTES,
    'Pollinations response byte limit',
  );
  const apiKey = options.apiKey.trim();
  if (apiKey.length === 0) throw new TypeError('Pollinations API key must not be empty');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const normalize = options.normalize ?? normalizeImageToPng;

  return {
    name: ADAPTER,
    capabilities: POLLINATIONS_IMAGE_CAPABILITIES,
    async draw(input) {
      const request = imageGenerationRequestSchema.parse(input);
      const headers: Record<string, string> = {
        Accept: 'image/jpeg, image/png, image/webp',
        Authorization: `Bearer ${apiKey}`,
      };

      const providerBytes = await providerImage(
        imageUrl(baseUrl, model, request),
        headers,
        timeoutMs,
        maximumBytes,
        fetchImpl,
      );
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
