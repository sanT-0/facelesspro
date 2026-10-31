/** Self-hosted ComfyUI workflow adapter (docs/06 §1.2 local fallback). */

import { readFile } from 'node:fs/promises';

import {
  generatedImageSchema,
  imageCapabilitiesSchema,
  imageGenerationRequestSchema,
} from '@facelesspro/contracts';
import type { ImageCapabilities, ImageGenerationRequest } from '@facelesspro/contracts';

import type { ImagePort } from '../ports/image';
import { UpstreamError, isRetryableHttpStatus } from '../planner/http';
import { IMAGE_NATIVE_DIMENSIONS } from './dimensions';
import { isPng, normalizeImageToPng } from './normalize';
import type { NormalizeImage } from './normalize';

const ADAPTER = 'comfyui' as const;
export const DEFAULT_COMFYUI_URL = 'http://127.0.0.1:8188';
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024;

export const COMFYUI_WORKFLOW_TOKENS = {
  prompt: '__FACELESSPRO_PROMPT__',
  negativePrompt: '__FACELESSPRO_NEGATIVE_PROMPT__',
  seed: '__FACELESSPRO_SEED__',
  width: '__FACELESSPRO_WIDTH__',
  height: '__FACELESSPRO_HEIGHT__',
} as const;

export const COMFYUI_IMAGE_CAPABILITIES: ImageCapabilities = imageCapabilitiesSchema.parse({
  maxSide: 1024,
  sizes: ['landscape', 'portrait'],
  style: 'profile',
  seed: true,
});

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type Wait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export interface ComfyUIImageOptions {
  readonly baseUrl?: string;
  /** API-format workflow object. Mutually exclusive with `workflowPath`. */
  readonly workflow?: unknown;
  /** API-format workflow JSON. Mutually exclusive with `workflow`. */
  readonly workflowPath?: string;
  /** Node whose history output must contain exactly one image. */
  readonly outputNodeId: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxResponseBytes?: number;
  /** Injected so hermetic tests never open a socket. */
  readonly fetchImpl?: typeof fetch;
  /** Injected so polling tests await state rather than sleeping. */
  readonly wait?: Wait;
  /** Injected in tests; production converts the downloaded raster with ffmpeg. */
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
    throw new TypeError('ComfyUI URL must be a valid HTTP or HTTPS URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('ComfyUI URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new TypeError('ComfyUI URL must not contain credentials');
  }
  if (url.search || url.hash) {
    throw new TypeError('ComfyUI URL must not contain a query or fragment');
  }
  return url.toString().replace(/\/+$/u, '');
}

export function comfyUIImageOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): ComfyUIImageOptions {
  const workflowPath = env.COMFYUI_WORKFLOW?.trim();
  const outputNodeId = env.COMFYUI_OUTPUT_NODE?.trim();
  const missing = [
    workflowPath ? null : 'COMFYUI_WORKFLOW',
    outputNodeId ? null : 'COMFYUI_OUTPUT_NODE',
  ].filter((name): name is string => name !== null);
  if (!workflowPath || !outputNodeId) {
    throw new Error(`comfyui image is not configured: missing ${missing.join(', ')}`);
  }

  return {
    baseUrl: normalizeBaseUrl(env.COMFYUI_URL?.trim() || DEFAULT_COMFYUI_URL),
    workflowPath,
    outputNodeId,
    timeoutMs: integerSetting(env.COMFYUI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 'ComfyUI timeout'),
    pollIntervalMs: integerSetting(
      env.COMFYUI_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      'ComfyUI poll interval',
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson(value: unknown, path: string, depth = 0): JsonValue {
  if (depth > 64) throw new TypeError(`${path} exceeds the workflow nesting limit`);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cloneJson(item, `${path}[${index}]`, depth + 1));
  }
  if (isRecord(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = cloneJson(item, `${path}.${key}`, depth + 1);
    }
    return result;
  }
  throw new TypeError(`${path} is not JSON data`);
}

type TokenName = keyof typeof COMFYUI_WORKFLOW_TOKENS;
type TokenCounts = Record<TokenName, number>;

function occurrences(value: string, token: string): number {
  return value.split(token).length - 1;
}

function substituteValue(
  value: unknown,
  request: ImageGenerationRequest,
  counts: TokenCounts,
  path: string,
  depth = 0,
): JsonValue {
  if (depth > 64) throw new TypeError(`${path} exceeds the workflow nesting limit`);
  if (typeof value === 'string') {
    const numericValues: ReadonlyArray<readonly [TokenName, number]> = [
      ['seed', request.seed],
      ['width', IMAGE_NATIVE_DIMENSIONS[request.size].width],
      ['height', IMAGE_NATIVE_DIMENSIONS[request.size].height],
    ];
    for (const [name, replacement] of numericValues) {
      const token = COMFYUI_WORKFLOW_TOKENS[name];
      if (value.includes(token)) {
        if (value !== token) {
          throw new TypeError(`${name} placeholder must be the exact value at ${path}`);
        }
        counts[name] += 1;
        return replacement;
      }
    }

    let result = value;
    const textValues: ReadonlyArray<readonly [TokenName, string]> = [
      ['prompt', request.prompt],
      ['negativePrompt', request.negativePrompt],
    ];
    for (const [name, replacement] of textValues) {
      const token = COMFYUI_WORKFLOW_TOKENS[name];
      const count = occurrences(result, token);
      if (count > 0) {
        counts[name] += count;
        result = result.split(token).join(replacement);
      }
    }
    return result;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      substituteValue(item, request, counts, `${path}[${index}]`, depth + 1),
    );
  }
  if (isRecord(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = substituteValue(item, request, counts, `${path}.${key}`, depth + 1);
    }
    return result;
  }
  throw new TypeError(`${path} is not JSON data`);
}

/** Clone and fill a ComfyUI API-format graph without stringifying user text into JSON. */
export function renderComfyUIWorkflow(
  template: unknown,
  input: ImageGenerationRequest,
  outputNodeId: string,
): Record<string, JsonValue> {
  const request = imageGenerationRequestSchema.parse(input);
  if (!isRecord(template) || Object.keys(template).length === 0) {
    throw new TypeError('ComfyUI workflow must be a non-empty object');
  }
  const outputId = outputNodeId.trim();
  if (outputId.length === 0) throw new TypeError('ComfyUI output node id must not be empty');
  if (!Object.hasOwn(template, outputId)) {
    throw new TypeError(`ComfyUI output node ${outputId} is missing`);
  }

  const counts: TokenCounts = { prompt: 0, negativePrompt: 0, seed: 0, width: 0, height: 0 };
  const workflow: Record<string, JsonValue> = {};
  for (const [nodeId, rawNode] of Object.entries(template)) {
    if (!isRecord(rawNode)) throw new TypeError(`ComfyUI node ${nodeId} must be an object`);
    if (typeof rawNode.class_type !== 'string' || rawNode.class_type.trim().length === 0) {
      throw new TypeError(`ComfyUI node ${nodeId} must have a class_type`);
    }
    if (!isRecord(rawNode.inputs)) {
      throw new TypeError(`ComfyUI node ${nodeId} must have an inputs object`);
    }
    const cloned = cloneJson(rawNode, `workflow.${nodeId}`);
    if (!isRecord(cloned)) throw new TypeError(`ComfyUI node ${nodeId} must be an object`);
    cloned.inputs = substituteValue(rawNode.inputs, request, counts, `workflow.${nodeId}.inputs`);
    workflow[nodeId] = cloned as JsonObject;
  }

  for (const name of Object.keys(counts) as TokenName[]) {
    if (counts[name] === 0) {
      throw new TypeError(`ComfyUI workflow is missing the ${name} placeholder`);
    }
  }
  return workflow;
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

const defaultWait: Wait = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

async function fetchResponse(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  try {
    const response = await fetchImpl(url, { ...init, signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new UpstreamError(
        ADAPTER,
        `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        { status: response.status, retryable: isRetryableHttpStatus(response.status) },
      );
    }
    return response;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const aborted = signal.aborted || (error instanceof Error && error.name === 'AbortError');
    throw new UpstreamError(
      ADAPTER,
      aborted
        ? `request timed out after ${timeoutMs} ms`
        : `request failed: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  }
}

async function jsonBody(
  response: Response,
  label: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new UpstreamError(ADAPTER, `request timed out after ${timeoutMs} ms`, {
        retryable: true,
      });
    }
    throw new UpstreamError(
      ADAPTER,
      `${label} was not JSON: ${error instanceof Error ? error.message : String(error)}`,
      { status: response.status, retryable: false },
    );
  }
}

function excerpt(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 300);
  if (isRecord(value) && typeof value.message === 'string') return value.message.slice(0, 300);
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return String(value).slice(0, 300);
  }
}

function promptIdFrom(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new UpstreamError(ADAPTER, 'prompt response was not an object', { retryable: false });
  }
  if (payload.error !== undefined) {
    throw new UpstreamError(ADAPTER, `workflow rejected: ${excerpt(payload.error)}`, {
      retryable: false,
    });
  }
  if (typeof payload.prompt_id !== 'string' || payload.prompt_id.trim().length === 0) {
    throw new UpstreamError(ADAPTER, 'prompt response contained no prompt_id', {
      retryable: false,
    });
  }
  return payload.prompt_id;
}

interface OutputImage {
  readonly filename: string;
  readonly subfolder: string;
  readonly type: 'output' | 'temp';
}

function outputFromHistory(
  payload: unknown,
  promptId: string,
  outputNodeId: string,
): OutputImage | null {
  if (!isRecord(payload)) {
    throw new UpstreamError(ADAPTER, 'history response was not an object', { retryable: false });
  }
  const entry = payload[promptId];
  if (entry === undefined) return null;
  if (!isRecord(entry)) {
    throw new UpstreamError(ADAPTER, 'history entry was not an object', { retryable: false });
  }

  const status = isRecord(entry.status) ? entry.status : null;
  const statusText = typeof status?.status_str === 'string' ? status.status_str : null;
  if (statusText === 'error' || statusText === 'failed') {
    throw new UpstreamError(
      ADAPTER,
      `execution ${statusText}: ${excerpt(status?.messages ?? status)}`,
      { retryable: false },
    );
  }

  if (entry.outputs === undefined) {
    if (status?.completed === true) {
      throw new UpstreamError(ADAPTER, 'completed history entry contained no outputs', {
        retryable: false,
      });
    }
    return null;
  }
  if (!isRecord(entry.outputs)) {
    throw new UpstreamError(ADAPTER, 'history outputs were not an object', { retryable: false });
  }
  const node = entry.outputs[outputNodeId];
  if (!isRecord(node)) {
    if (status?.completed === true || statusText === 'success' || Object.keys(entry.outputs).length > 0) {
      throw new UpstreamError(ADAPTER, `configured output node ${outputNodeId} produced no output`, {
        retryable: false,
      });
    }
    return null;
  }
  if (!Array.isArray(node.images) || node.images.length !== 1) {
    throw new UpstreamError(ADAPTER, `configured output node must produce exactly one image`, {
      retryable: false,
    });
  }
  const image = node.images[0];
  if (
    !isRecord(image) ||
    typeof image.filename !== 'string' ||
    image.filename.length === 0 ||
    image.filename.includes('\0') ||
    typeof image.subfolder !== 'string' ||
    image.subfolder.includes('\0') ||
    (image.type !== 'output' && image.type !== 'temp')
  ) {
    throw new UpstreamError(ADAPTER, 'configured output node returned invalid image metadata', {
      retryable: false,
    });
  }
  return { filename: image.filename, subfolder: image.subfolder, type: image.type };
}

class ProviderImageError extends Error {
  override readonly name = 'ProviderImageError';
}

type RasterMime = 'image/jpeg' | 'image/png' | 'image/webp';

function rasterMime(bytes: Uint8Array): RasterMime | null {
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

async function readBoundedImage(response: Response, maximum: number): Promise<Uint8Array> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'image/jpeg' && contentType !== 'image/png' && contentType !== 'image/webp') {
    throw new ProviderImageError(
      `output content type is not JPEG, PNG or WebP: ${contentType || 'missing'}`,
    );
  }
  const declaredText = response.headers.get('content-length');
  if (declaredText !== null) {
    const declared = Number(declaredText);
    if (Number.isFinite(declared) && declared > maximum) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderImageError(`output image exceeds ${maximum} bytes`);
    }
  }
  if (response.body === null) throw new ProviderImageError('output response contained no bytes');

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
        throw new ProviderImageError(`output image exceeds ${maximum} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length === 0) throw new ProviderImageError('output response contained no bytes');

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const actualType = rasterMime(bytes);
  if (actualType === null) throw new ProviderImageError('output is not JPEG, PNG or WebP');
  if (actualType !== contentType) {
    throw new ProviderImageError(`output content type ${contentType} does not match ${actualType} bytes`);
  }
  return bytes;
}

async function loadWorkflow(path: string): Promise<unknown> {
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_WORKFLOW_BYTES) {
    throw new RangeError(`ComfyUI workflow exceeds ${MAX_WORKFLOW_BYTES} bytes`);
  }
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new TypeError(
      `ComfyUI workflow is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function executeWorkflow(options: {
  baseUrl: string;
  workflow: Record<string, JsonValue>;
  outputNodeId: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maximumBytes: number;
  fetchImpl: typeof fetch;
  wait: Wait;
}): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const submitResponse = await fetchResponse(
      options.fetchImpl,
      endpoint(options.baseUrl, '/prompt'),
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: options.workflow }),
      },
      controller.signal,
      options.timeoutMs,
    );
    const promptId = promptIdFrom(
      await jsonBody(submitResponse, 'prompt response', controller.signal, options.timeoutMs),
    );

    let output: OutputImage | null = null;
    while (output === null) {
      const historyResponse = await fetchResponse(
        options.fetchImpl,
        endpoint(options.baseUrl, `/history/${encodeURIComponent(promptId)}`),
        { method: 'GET', headers: { Accept: 'application/json' } },
        controller.signal,
        options.timeoutMs,
      );
      output = outputFromHistory(
        await jsonBody(historyResponse, 'history response', controller.signal, options.timeoutMs),
        promptId,
        options.outputNodeId,
      );
      if (output === null) await options.wait(options.pollIntervalMs, controller.signal);
    }

    const viewUrl = new URL(endpoint(options.baseUrl, '/view'));
    viewUrl.searchParams.set('filename', output.filename);
    viewUrl.searchParams.set('subfolder', output.subfolder);
    viewUrl.searchParams.set('type', output.type);
    const imageResponse = await fetchResponse(
      options.fetchImpl,
      viewUrl.toString(),
      { method: 'GET', headers: { Accept: 'image/jpeg, image/png, image/webp' } },
      controller.signal,
      options.timeoutMs,
    );
    return await readBoundedImage(imageResponse, options.maximumBytes);
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error instanceof ProviderImageError) {
      throw new UpstreamError(ADAPTER, error.message, { retryable: false });
    }
    const aborted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    throw new UpstreamError(
      ADAPTER,
      aborted
        ? `request timed out after ${options.timeoutMs} ms`
        : `request failed: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createComfyUIImageAdapter(
  options: ComfyUIImageOptions = comfyUIImageOptionsFromEnv(),
): ImagePort {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_COMFYUI_URL);
  const outputNodeId = options.outputNodeId.trim();
  if (outputNodeId.length === 0) throw new TypeError('ComfyUI output node id must not be empty');
  const hasWorkflow = options.workflow !== undefined;
  const hasWorkflowPath = options.workflowPath !== undefined && options.workflowPath.trim().length > 0;
  if (hasWorkflow === hasWorkflowPath) {
    throw new TypeError('ComfyUI requires exactly one of workflow or workflowPath');
  }

  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'ComfyUI timeout');
  const pollIntervalMs = positiveInteger(
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    'ComfyUI poll interval',
  );
  const maximumBytes = positiveInteger(
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    'ComfyUI response byte limit',
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const wait = options.wait ?? defaultWait;
  const normalize = options.normalize ?? normalizeImageToPng;
  const directWorkflow = hasWorkflow ? cloneJson(options.workflow, 'workflow') : undefined;
  let workflowPromise: Promise<unknown> | undefined;
  const template = async (): Promise<unknown> => {
    if (directWorkflow !== undefined) return directWorkflow;
    workflowPromise ??= loadWorkflow(options.workflowPath!.trim());
    return workflowPromise;
  };

  return {
    name: ADAPTER,
    capabilities: COMFYUI_IMAGE_CAPABILITIES,
    async draw(input) {
      const request = imageGenerationRequestSchema.parse(input);
      let workflow: Record<string, JsonValue>;
      try {
        workflow = renderComfyUIWorkflow(await template(), request, outputNodeId);
      } catch (error) {
        throw new UpstreamError(
          ADAPTER,
          `workflow configuration failed: ${error instanceof Error ? error.message : String(error)}`,
          { retryable: false },
        );
      }

      const providerBytes = await executeWorkflow({
        baseUrl,
        workflow,
        outputNodeId,
        timeoutMs,
        pollIntervalMs,
        maximumBytes,
        fetchImpl,
        wait,
      });
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
