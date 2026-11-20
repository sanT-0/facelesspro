import { describe, expect, it } from 'vitest';

import type { UpstreamError } from './http';
import {
  buildDescribePrompt,
  createOllamaDescriber,
  ollamaDescribeOptionsFromEnv,
  parseDescribeLines,
} from './describe';

const fetchAnswering = (content: string) =>
  (async () =>
    new Response(JSON.stringify({ message: { content } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

describe('parseDescribeLines', () => {
  it('strips numbering and keeps the answer order', () => {
    expect(
      parseDescribeLines('1. A house at dusk.\n2) A lamp in the window.\n3: A boy reading.', 3),
    ).toEqual(['A house at dusk.', 'A lamp in the window.', 'A boy reading.']);
  });

  it('copes with the doubled punctuation a model sometimes emits', () => {
    expect(parseDescribeLines('1. . A house at dusk.', 1)).toEqual(['A house at dusk.']);
  });

  it('accepts bare sentences only when nothing is numbered', () => {
    expect(parseDescribeLines('A house.\nA lamp.', 2)).toEqual(['A house.', 'A lamp.']);
  });

  it('rejects a wrong count instead of shifting descriptions onto scenes', () => {
    expect(() => parseDescribeLines('1. A house.', 2)).toThrow(/expected 2 scene descriptions/u);
  });

  it('rejects an empty answer', () => {
    expect(() => parseDescribeLines('   ', 1)).toThrow(/expected 1 scene descriptions/u);
  });

  it('caps one description at a word boundary', () => {
    const long = `${'word '.repeat(200)}end`;
    const [description] = parseDescribeLines(`1. ${long}`, 1);
    expect(description!.length).toBeLessThanOrEqual(320);
    expect(description!.endsWith(' ')).toBe(false);
  });
});

describe('buildDescribePrompt', () => {
  it('numbers the scenes and asks for English lines only', () => {
    const prompt = buildDescribePrompt(['ஒரு வீடு', 'Today it rained.']);
    expect(prompt).toContain('1. ஒரு வீடு');
    expect(prompt).toContain('2. Today it rained.');
    expect(prompt).toContain('in ENGLISH only');
    expect(prompt).toContain('exactly 2 lines');
  });
});

describe('ollamaDescribeOptionsFromEnv', () => {
  it('reuses the planner model and timeout when no override is given', () => {
    expect(
      ollamaDescribeOptionsFromEnv({
        OLLAMA_BASE_URL: 'http://127.0.0.1:1234',
        OLLAMA_PLANNER_MODEL: 'qwen2.5:7b-instruct',
        OLLAMA_PLANNER_TIMEOUT_MS: '900000',
      }),
    ).toEqual({
      baseUrl: 'http://127.0.0.1:1234',
      model: 'qwen2.5:7b-instruct',
      timeoutMs: 900_000,
    });
  });

  it('prefers the describe overrides and defaults the rest', () => {
    expect(ollamaDescribeOptionsFromEnv({ OLLAMA_DESCRIBE_MODEL: 'tiny' })).toEqual({
      baseUrl: 'http://localhost:11434',
      model: 'tiny',
      timeoutMs: 300_000,
    });
  });
});

describe('createOllamaDescriber', () => {
  it('posts the numbered scenes and returns one description per scene', async () => {
    let body: unknown;
    const describer = createOllamaDescriber({
      model: 'qwen2.5:7b-instruct',
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as unknown;
        return new Response(
          JSON.stringify({ message: { content: '1. A house.\n2. A lamp.' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    });

    await expect(describer(['ஒரு வீடு', 'விளக்கு'])).resolves.toEqual(['A house.', 'A lamp.']);
    expect(body).toMatchObject({ model: 'qwen2.5:7b-instruct', stream: false });
  });

  it('fails with a typed upstream error when the answer is unusable', async () => {
    const describer = createOllamaDescriber({
      fetchImpl: fetchAnswering('1. only one'),
    });
    await expect(describer(['a', 'b'])).rejects.toMatchObject<Partial<UpstreamError>>({
      name: 'UpstreamError',
      adapter: 'ollama-describe',
      retryable: false,
    });
  });

  it('fails when the service answers without content', async () => {
    const describer = createOllamaDescriber({
      fetchImpl: fetchAnswering(''),
    });
    await expect(describer(['a'])).rejects.toThrow(/contained no text/u);
  });
});
