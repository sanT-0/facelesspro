import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImageGenerationRequest, StyleProfile } from '@facelesspro/contracts';

import { UpstreamError } from '../planner/http';
import {
  COMFYUI_IMAGE_CAPABILITIES,
  COMFYUI_WORKFLOW_TOKENS,
  DEFAULT_COMFYUI_URL,
  comfyUIImageOptionsFromEnv,
  createComfyUIImageAdapter,
  renderComfyUIWorkflow,
} from './comfyui';
import { IMAGE_NATIVE_DIMENSIONS } from './dimensions';

const style: StyleProfile = {
  version: 1,
  medium: 'flat vector illustration',
  promptPrefix: 'flat vector scene, bold geometric shapes',
  palette: { hex: ['#14213d', '#fca311', '#ffffff'], weights: [0.5, 0.3, 0.2] },
  line: { weight: 'thick', color: '#14213d', texture: 'clean' },
  shading: 'flat',
  background: 'simple background',
  composition: 'centred subject',
  characters: [],
  typography: { present: false },
  negative: 'photo, 3d render, text, watermark, logo, signature',
  seedBase: 1234,
  measured: {
    line: { strokeDensity: 0.04, edgeEnergy: 0.08 },
    tone: {
      saturation: { mean: 0.5, p95: 0.8 },
      contrast: { mean: 0.2, p95: 0.5 },
      brightness: { mean: 0.6, p95: 0.9 },
    },
    aspect: { width: 1920, height: 1080, ratio: 1.7778, orientation: 'landscape' },
    safeArea: { edgeContentRatio: 0.04, margin: 0.08 },
    frameCount: 8,
  },
  source: { adapter: 'heuristic', degradedFrom: [] },
};

const request: ImageGenerationRequest = {
  prompt: 'flat vector scene, தமிழ் freelancer at a desk, no text',
  negativePrompt: style.negative,
  seed: 42,
  size: 'landscape',
  style,
};

function workflowTemplate(): Record<string, unknown> {
  return {
    sampler: {
      class_type: 'KSampler',
      inputs: {
        seed: COMFYUI_WORKFLOW_TOKENS.seed,
        positive: ['positive', 0],
        negative: ['negative', 0],
        latent_image: ['latent', 0],
      },
    },
    latent: {
      class_type: 'EmptyLatentImage',
      inputs: {
        width: COMFYUI_WORKFLOW_TOKENS.width,
        height: COMFYUI_WORKFLOW_TOKENS.height,
        batch_size: 1,
      },
    },
    positive: {
      class_type: 'CLIPTextEncode',
      inputs: { text: `quality, ${COMFYUI_WORKFLOW_TOKENS.prompt}` },
    },
    negative: {
      class_type: 'CLIPTextEncode',
      inputs: { text: COMFYUI_WORKFLOW_TOKENS.negativePrompt },
    },
    save: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'FacelessPro', images: ['decode', 0] },
    },
  };
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const exampleWorkflow = JSON.parse(
  readFileSync(
    new URL('../../../../fixtures/workflows/comfyui-sdxl-api.json', import.meta.url),
    'utf8',
  ),
) as unknown;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function imageResponse(bytes: Uint8Array = jpeg, contentType = 'image/jpeg'): Response {
  return new Response(bytes, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('comfyUIImageOptionsFromEnv', () => {
  it('names every missing workflow setting', () => {
    expect(() => comfyUIImageOptionsFromEnv({})).toThrow(
      /missing COMFYUI_WORKFLOW, COMFYUI_OUTPUT_NODE/,
    );
  });

  it('uses the local server default and honours workflow, endpoint and timing settings', () => {
    expect(
      comfyUIImageOptionsFromEnv({
        COMFYUI_WORKFLOW: ' config/workflow.json ',
        COMFYUI_OUTPUT_NODE: ' save ',
      }),
    ).toEqual({
      baseUrl: DEFAULT_COMFYUI_URL,
      workflowPath: 'config/workflow.json',
      outputNodeId: 'save',
      timeoutMs: 300_000,
      pollIntervalMs: 500,
    });

    expect(
      comfyUIImageOptionsFromEnv({
        COMFYUI_URL: 'https://gpu.example.test/comfy/',
        COMFYUI_WORKFLOW: 'workflow.json',
        COMFYUI_OUTPUT_NODE: '9',
        COMFYUI_TIMEOUT_MS: '90000',
        COMFYUI_POLL_INTERVAL_MS: '250',
      }),
    ).toMatchObject({
      baseUrl: 'https://gpu.example.test/comfy',
      timeoutMs: 90_000,
      pollIntervalMs: 250,
    });
  });

  it('rejects credentials/query in the URL and invalid timing values', () => {
    const base = { COMFYUI_WORKFLOW: 'workflow.json', COMFYUI_OUTPUT_NODE: '9' };
    expect(() =>
      comfyUIImageOptionsFromEnv({ ...base, COMFYUI_URL: 'ftp://127.0.0.1/workflow' }),
    ).toThrow(/HTTP/);
    expect(() =>
      comfyUIImageOptionsFromEnv({ ...base, COMFYUI_URL: 'http://user:pass@127.0.0.1:8188' }),
    ).toThrow(/credentials/);
    expect(() =>
      comfyUIImageOptionsFromEnv({ ...base, COMFYUI_URL: 'http://127.0.0.1:8188?x=1' }),
    ).toThrow(/query/);
    expect(() => comfyUIImageOptionsFromEnv({ ...base, COMFYUI_TIMEOUT_MS: '0' })).toThrow(
      /timeout.*positive/i,
    );
    expect(() => comfyUIImageOptionsFromEnv({ ...base, COMFYUI_POLL_INTERVAL_MS: '1.5' })).toThrow(
      /poll.*integer/i,
    );
  });
});

describe('renderComfyUIWorkflow', () => {
  it('substitutes typed request values without mutating the API-format template', () => {
    const template = workflowTemplate();
    const rendered = renderComfyUIWorkflow(template, request, 'save');

    expect((rendered.sampler as { inputs: { seed: unknown } }).inputs.seed).toBe(42);
    expect((rendered.latent as { inputs: { width: unknown; height: unknown } }).inputs).toMatchObject({
      width: 1024,
      height: 576,
    });
    expect((rendered.positive as { inputs: { text: unknown } }).inputs.text).toBe(
      `quality, ${request.prompt}`,
    );
    expect((rendered.negative as { inputs: { text: unknown } }).inputs.text).toBe(
      request.negativePrompt,
    );
    expect(
      (template.sampler as { inputs: { seed: unknown } }).inputs.seed,
    ).toBe(COMFYUI_WORKFLOW_TOKENS.seed);
  });

  it('renders portrait geometry and every occurrence of a text token', () => {
    const template = workflowTemplate();
    (template.positive as { inputs: Record<string, unknown> }).inputs.text2 =
      COMFYUI_WORKFLOW_TOKENS.prompt;

    const rendered = renderComfyUIWorkflow(template, { ...request, size: 'portrait' }, 'save');

    expect((rendered.latent as { inputs: Record<string, unknown> }).inputs).toMatchObject({
      width: 576,
      height: 1024,
    });
    expect((rendered.positive as { inputs: Record<string, unknown> }).inputs.text2).toBe(
      request.prompt,
    );
  });

  it('keeps the committed SDXL workflow example compatible with the placeholder contract', () => {
    const rendered = renderComfyUIWorkflow(exampleWorkflow, request, '9');

    expect((rendered['3'] as { inputs: Record<string, unknown> }).inputs.seed).toBe(42);
    expect((rendered['5'] as { inputs: Record<string, unknown> }).inputs).toMatchObject({
      width: 1024,
      height: 576,
      batch_size: 1,
    });
    expect((rendered['6'] as { inputs: Record<string, unknown> }).inputs.text).toBe(request.prompt);
    expect((rendered['7'] as { inputs: Record<string, unknown> }).inputs.text).toBe(
      request.negativePrompt,
    );
    expect((rendered['9'] as { class_type: unknown }).class_type).toBe('SaveImage');
  });

  it('rejects malformed graphs, missing placeholders/output and interpolated numeric tokens', () => {
    expect(() => renderComfyUIWorkflow([], request, 'save')).toThrow(/workflow.*object/i);
    expect(() => renderComfyUIWorkflow({ node: { inputs: {} } }, request, 'node')).toThrow(
      /class_type/,
    );
    expect(() => renderComfyUIWorkflow(workflowTemplate(), request, 'missing')).toThrow(
      /output node.*missing/,
    );

    const noNegative = workflowTemplate();
    (noNegative.negative as { inputs: Record<string, unknown> }).inputs.text = 'fixed';
    expect(() => renderComfyUIWorkflow(noNegative, request, 'save')).toThrow(
      /negativePrompt.*placeholder/,
    );

    const badSeed = workflowTemplate();
    (badSeed.sampler as { inputs: Record<string, unknown> }).inputs.seed =
      `seed-${COMFYUI_WORKFLOW_TOKENS.seed}`;
    expect(() => renderComfyUIWorkflow(badSeed, request, 'save')).toThrow(
      /seed.*exact value/i,
    );
  });
});

describe('createComfyUIImageAdapter', () => {
  it('submits, polls history, downloads the configured output and normalizes it', async () => {
    const wait = vi.fn(async () => undefined);
    const normalize = vi.fn(async () => png);
    let historyCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/prompt') return jsonResponse({ prompt_id: 'job-1', number: 3 });
      if (url.pathname === '/history/job-1') {
        historyCalls += 1;
        if (historyCalls === 1) return jsonResponse({});
        return jsonResponse({
          'job-1': {
            status: { status_str: 'success', completed: true, messages: [] },
            outputs: {
              save: { images: [{ filename: 'FacelessPro_00001_.png', subfolder: '', type: 'output' }] },
            },
          },
        });
      }
      if (url.pathname === '/view') return imageResponse();
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    const adapter = createComfyUIImageAdapter({
      baseUrl: 'http://127.0.0.1:8188',
      workflow: workflowTemplate(),
      outputNodeId: 'save',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      wait,
      normalize,
    });

    const image = await adapter.draw(request);

    expect(adapter.name).toBe('comfyui');
    expect(adapter.capabilities).toEqual(COMFYUI_IMAGE_CAPABILITIES);
    expect(image).toMatchObject({
      adapter: 'comfyui',
      degradedFrom: [],
      mimeType: 'image/png',
      size: 'landscape',
      seed: 42,
      ...IMAGE_NATIVE_DIMENSIONS.landscape,
    });
    expect(Buffer.from(image.bytes)).toEqual(png);
    expect(wait).toHaveBeenCalledOnce();
    expect(normalize).toHaveBeenCalledWith(
      new Uint8Array(jpeg),
      IMAGE_NATIVE_DIMENSIONS.landscape,
    );

    const [submitUrl, submitInit] = (fetchImpl.mock.calls[0] ?? []) as unknown as [
      string,
      RequestInit,
    ];
    expect(submitUrl).toBe('http://127.0.0.1:8188/prompt');
    expect(submitInit).toMatchObject({
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    const submitted = JSON.parse(String(submitInit.body)) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(submitted.prompt.sampler?.inputs.seed).toBe(42);
    expect(submitted.prompt.latent?.inputs).toMatchObject({ width: 1024, height: 576 });
    expect(submitted.prompt.positive?.inputs.text).toBe(`quality, ${request.prompt}`);
    expect(submitted.prompt.negative?.inputs.text).toBe(request.negativePrompt);

    const viewCall = fetchImpl.mock.calls.find(([input]) => new URL(String(input)).pathname === '/view');
    expect(viewCall).toBeDefined();
    const viewUrl = new URL(String(viewCall?.[0]));
    expect(Object.fromEntries(viewUrl.searchParams)).toEqual({
      filename: 'FacelessPro_00001_.png',
      subfolder: '',
      type: 'output',
    });
  });

  it('carries portrait dimensions through the workflow and result', async () => {
    let submitted: Record<string, { inputs: Record<string, unknown> }> | undefined;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/prompt') {
        submitted = (JSON.parse(String(init?.body)) as { prompt: typeof submitted }).prompt;
        return jsonResponse({ prompt_id: 'portrait-job' });
      }
      if (url.pathname === '/history/portrait-job') {
        return jsonResponse({
          'portrait-job': {
            status: { status_str: 'success', completed: true },
            outputs: { save: { images: [{ filename: 'p.png', subfolder: 'x', type: 'output' }] } },
          },
        });
      }
      return imageResponse();
    });
    const adapter = createComfyUIImageAdapter({
      workflow: workflowTemplate(),
      outputNodeId: 'save',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      wait: async () => undefined,
      normalize: async () => png,
    });

    const image = await adapter.draw({ ...request, size: 'portrait' });

    expect(submitted?.latent?.inputs).toMatchObject({ width: 576, height: 1024 });
    expect(image).toMatchObject({ size: 'portrait', ...IMAGE_NATIVE_DIMENSIONS.portrait });
  });

  it('treats workflow validation and execution failures as permanent', async () => {
    const validationAdapter = createComfyUIImageAdapter({
      workflow: workflowTemplate(),
      outputNodeId: 'save',
      fetchImpl: (async () =>
        jsonResponse({ error: { message: 'checkpoint missing' }, node_errors: { loader: {} } })) as typeof fetch,
      wait: async () => undefined,
      normalize: async () => png,
    });
    const validationError = await validationAdapter.draw(request).catch((thrown: unknown) => thrown);
    expect(validationError).toBeInstanceOf(UpstreamError);
    expect((validationError as UpstreamError).message).toMatch(/checkpoint missing/);
    expect((validationError as UpstreamError).retryable).toBe(false);

    const executionAdapter = createComfyUIImageAdapter({
      workflow: workflowTemplate(),
      outputNodeId: 'save',
      fetchImpl: (async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        return path === '/prompt'
          ? jsonResponse({ prompt_id: 'failed-job' })
          : jsonResponse({
              'failed-job': {
                status: { status_str: 'error', completed: false, messages: [['execution_error', { node_id: 'sampler' }]] },
                outputs: {},
              },
            });
      }) as typeof fetch,
      wait: async () => undefined,
      normalize: async () => png,
    });
    const executionError = await executionAdapter.draw(request).catch((thrown: unknown) => thrown);
    expect(executionError).toBeInstanceOf(UpstreamError);
    expect((executionError as UpstreamError).message).toMatch(/execution.*error/i);
    expect((executionError as UpstreamError).retryable).toBe(false);
  });

  it('rejects a completed job with a missing or multi-image configured output', async () => {
    for (const outputs of [
      { other: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } },
      {
        save: {
          images: [
            { filename: 'a.png', subfolder: '', type: 'output' },
            { filename: 'b.png', subfolder: '', type: 'output' },
          ],
        },
      },
    ]) {
      const adapter = createComfyUIImageAdapter({
        workflow: workflowTemplate(),
        outputNodeId: 'save',
        fetchImpl: (async (input: string | URL | Request) =>
          new URL(String(input)).pathname === '/prompt'
            ? jsonResponse({ prompt_id: 'job' })
            : jsonResponse({
                job: { status: { status_str: 'success', completed: true }, outputs },
              })) as typeof fetch,
        wait: async () => undefined,
        normalize: async () => png,
      });
      const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).retryable).toBe(false);
      expect((error as UpstreamError).message).toMatch(/output node|exactly one image/i);
    }
  });

  it('classifies network/5xx as retryable and 400 as permanent', async () => {
    for (const [fetchImpl, retryable] of [
      [async () => { throw new Error('connection refused'); }, true],
      [async () => new Response('offline', { status: 503 }), true],
      [async () => new Response('bad workflow', { status: 400 }), false],
    ] as const) {
      const adapter = createComfyUIImageAdapter({
        workflow: workflowTemplate(),
        outputNodeId: 'save',
        fetchImpl: fetchImpl as typeof fetch,
        wait: async () => undefined,
        normalize: async () => png,
      });
      const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).retryable).toBe(retryable);
    }
  });

  it('times out a pending history poll without sleeping', async () => {
    vi.useFakeTimers();
    const adapter = createComfyUIImageAdapter({
      workflow: workflowTemplate(),
      outputNodeId: 'save',
      timeoutMs: 10,
      pollIntervalMs: 500,
      fetchImpl: (async (input: string | URL | Request) =>
        new URL(String(input)).pathname === '/prompt'
          ? jsonResponse({ prompt_id: 'slow-job' })
          : jsonResponse({})) as typeof fetch,
      normalize: async () => png,
    });

    const pending = adapter.draw(request).catch((thrown: unknown) => thrown);
    await vi.advanceTimersByTimeAsync(11);
    const error = await pending;
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).message).toMatch(/timed out after 10 ms/);
    expect((error as UpstreamError).retryable).toBe(true);
  });

  it('classifies a timed-out JSON response body as retryable', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });
    const adapter = createComfyUIImageAdapter({
      workflow: workflowTemplate(),
      outputNodeId: 'save',
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      normalize: async () => png,
    });

    const pending = adapter.draw(request).catch((thrown: unknown) => thrown);
    await vi.advanceTimersByTimeAsync(11);
    const error = await pending;
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).message).toMatch(/timed out after 10 ms/);
    expect((error as UpstreamError).retryable).toBe(true);
  });

  it('bounds output bytes and rejects corrupt normalization permanently', async () => {
    for (const [maxResponseBytes, normalize] of [
      [3, async () => png],
      [1024, async () => Buffer.from('not-png')],
    ] as const) {
      const adapter = createComfyUIImageAdapter({
        workflow: workflowTemplate(),
        outputNodeId: 'save',
        maxResponseBytes,
        fetchImpl: (async (input: string | URL | Request) => {
          const path = new URL(String(input)).pathname;
          if (path === '/prompt') return jsonResponse({ prompt_id: 'job' });
          if (path === '/history/job') {
            return jsonResponse({
              job: {
                status: { status_str: 'success', completed: true },
                outputs: { save: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } },
              },
            });
          }
          return imageResponse();
        }) as typeof fetch,
        wait: async () => undefined,
        normalize,
      });
      const error = await adapter.draw(request).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).retryable).toBe(false);
    }
  });

  it('validates the shared request before submission', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ prompt_id: 'job' }));
    const adapter = createComfyUIImageAdapter({
      workflow: workflowTemplate(),
      outputNodeId: 'save',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      wait: async () => undefined,
      normalize: async () => png,
    });

    await expect(adapter.draw({ ...request, seed: 0 })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
