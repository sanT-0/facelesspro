import { describe, expect, it, vi } from 'vitest';

import {
  cloudflareOptionsFromEnv,
  createCloudflarePlanner,
} from './cloudflare';
import { createGroqPlanner, groqOptionsFromEnv } from './groq';
import { UpstreamError } from './http';
import { PlannerResponseError } from './model';
import { createOllamaPlanner, ollamaOptionsFromEnv } from './ollama';

const word = 'வார்த்தை';
/** 25 Tamil words ≈ 11.5 s: a single valid scene. */
const SENTENCE = `${Array.from({ length: 25 }, () => word).join(' ')}.`;

const answer = (text = SENTENCE, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    scenes: [{ text, imagePrompt: 'a desk by a window', motion: 'none', emphasis: [], ...extra }],
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('model planner adapters', () => {
  describe('cloudflare', () => {
    const options = {
      accountId: 'acct-1',
      apiToken: 'token-1',
      model: '@cf/meta/llama-3.1-8b-instruct',
    };

    it('calls the account-scoped model URL and returns a plan', async () => {
      const fetchImpl = vi.fn(async () => json({ result: { response: answer() } })) as unknown as typeof fetch;
      const planner = createCloudflarePlanner({ ...options, fetchImpl });

      const plan = await planner.plan({ script: SENTENCE });

      expect(planner.name).toBe('cloudflare');
      expect(plan.adapter).toBe('cloudflare');
      expect(plan.scenes[0]!.text).toBe(SENTENCE);

      const [url, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock
        .calls[0]!;
      expect(url).toBe(
        'https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/@cf/meta/llama-3.1-8b-instruct',
      );
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      expect(body.messages[1]!.content).toContain(SENTENCE);
    });

    it('fails permanently when the response carries no text', async () => {
      const fetchImpl = (async () => json({ result: {} })) as unknown as typeof fetch;
      const error = await createCloudflarePlanner({ ...options, fetchImpl })
        .plan({ script: SENTENCE })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).retryable).toBe(false);
      expect((error as UpstreamError).message).toContain('no text');
    });

    it('propagates a rate limit as retryable', async () => {
      const fetchImpl = (async () =>
        new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
      const error = await createCloudflarePlanner({ ...options, fetchImpl })
        .plan({ script: SENTENCE })
        .catch((thrown: unknown) => thrown);

      expect((error as UpstreamError).retryable).toBe(true);
    });

    it('surfaces a bad answer as a response error, not an upstream failure', async () => {
      const fetchImpl = (async () =>
        json({ result: { response: answer(SENTENCE, { motion: 'spin' }) } })) as unknown as typeof fetch;
      const error = await createCloudflarePlanner({ ...options, fetchImpl })
        .plan({ script: SENTENCE })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(PlannerResponseError);
      expect((error as PlannerResponseError).kind).toBe('invalid-shape');
    });

    it('re-asks once, with the violation, and returns the repaired plan', async () => {
      const prompts: string[] = [];
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
        prompts.push(body.messages[1]!.content);
        const response = prompts.length === 1 ? answer('வணக்கம்.') : answer();
        return json({ result: { response } });
      }) as unknown as typeof fetch;

      const plan = await createCloudflarePlanner({ ...options, fetchImpl }).plan({
        script: SENTENCE,
      });

      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain('YOUR PREVIOUS ANSWER WAS REJECTED');
      expect(prompts[1]).toContain('does not reassemble the script');
      expect(plan.scenes[0]!.text).toBe(SENTENCE);
    });
  });

  describe('cloudflareOptionsFromEnv', () => {
    it('names every missing variable', () => {
      expect(() => cloudflareOptionsFromEnv({})).toThrow(
        /CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN/u,
      );
      expect(() => cloudflareOptionsFromEnv({ CLOUDFLARE_ACCOUNT_ID: 'a' })).toThrow(
        /CLOUDFLARE_API_TOKEN/u,
      );
    });

    it('reads the model and timeout overrides', () => {
      expect(
        cloudflareOptionsFromEnv({
          CLOUDFLARE_ACCOUNT_ID: 'a',
          CLOUDFLARE_API_TOKEN: 'b',
          CLOUDFLARE_PLANNER_MODEL: '@cf/custom',
          CLOUDFLARE_PLANNER_TIMEOUT_MS: '5000',
        }),
      ).toMatchObject({ model: '@cf/custom', timeoutMs: 5000 });
    });
  });

  describe('groq', () => {
    const options = { apiKey: 'gsk-1', model: 'llama-3.1-8b-instant' };

    it('calls chat completions with JSON mode and returns a plan', async () => {
      const fetchImpl = vi.fn(async () =>
        json({ choices: [{ message: { content: answer() } }] }),
      ) as unknown as typeof fetch;
      const planner = createGroqPlanner({ ...options, fetchImpl });

      const plan = await planner.plan({ script: SENTENCE });
      expect(plan.adapter).toBe('groq');

      const [url, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock
        .calls[0]!;
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
      const body = JSON.parse(String(init.body)) as {
        model: string;
        response_format: { type: string };
      };
      expect(body.model).toBe('llama-3.1-8b-instant');
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('honours a base URL override without a trailing slash', async () => {
      const fetchImpl = vi.fn(async () =>
        json({ choices: [{ message: { content: answer() } }] }),
      ) as unknown as typeof fetch;
      await createGroqPlanner({ ...options, baseUrl: 'http://localhost:9000/v1///', fetchImpl }).plan({
        script: SENTENCE,
      });
      const [url] = (fetchImpl as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0]!;
      expect(url).toBe('http://localhost:9000/v1/chat/completions');
    });

    it('treats a bad key as permanent', async () => {
      const fetchImpl = (async () =>
        new Response('invalid api key', { status: 401 })) as unknown as typeof fetch;
      const error = await createGroqPlanner({ ...options, fetchImpl })
        .plan({ script: SENTENCE })
        .catch((thrown: unknown) => thrown);
      expect((error as UpstreamError).retryable).toBe(false);
    });

    it('re-asks once, with the violation, and returns the repaired plan', async () => {
      const prompts: string[] = [];
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
        prompts.push(body.messages[1]!.content);
        const content = prompts.length === 1 ? answer('வணக்கம்.') : answer();
        return json({ choices: [{ message: { content } }] });
      }) as unknown as typeof fetch;

      const plan = await createGroqPlanner({ ...options, fetchImpl }).plan({ script: SENTENCE });

      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain('YOUR PREVIOUS ANSWER WAS REJECTED');
      expect(plan.scenes[0]!.text).toBe(SENTENCE);
    });

    it('requires an API key', () => {
      expect(() => groqOptionsFromEnv({})).toThrow(/GROQ_API_KEY/u);
    });
  });

  describe('ollama', () => {
    it('calls /api/chat with JSON mode and no stream, and returns a plan', async () => {
      const fetchImpl = vi.fn(async () =>
        json({ message: { content: answer() } }),
      ) as unknown as typeof fetch;
      const planner = createOllamaPlanner({ fetchImpl });

      const plan = await planner.plan({ script: SENTENCE });
      expect(plan.adapter).toBe('ollama');

      const [url, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock
        .calls[0]!;
      expect(url).toBe('http://localhost:11434/api/chat');
      const body = JSON.parse(String(init.body)) as { format: string; stream: boolean };
      expect(body.format).toBe('json');
      expect(body.stream).toBe(false);
    });

    it('treats a refused connection as retryable — Ollama may simply not be running yet', async () => {
      const fetchImpl = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      const error = await createOllamaPlanner({ fetchImpl })
        .plan({ script: SENTENCE })
        .catch((thrown: unknown) => thrown);
      expect((error as UpstreamError).retryable).toBe(true);
    });

    it('re-asks once, with the violation, and returns the repaired plan', async () => {
      const prompts: string[] = [];
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
        prompts.push(body.messages[1]!.content);
        const content = prompts.length === 1 ? answer('வணக்கம்.') : answer();
        return json({ message: { content } });
      }) as unknown as typeof fetch;

      const plan = await createOllamaPlanner({ fetchImpl }).plan({ script: SENTENCE });

      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain('YOUR PREVIOUS ANSWER WAS REJECTED');
      expect(plan.scenes[0]!.text).toBe(SENTENCE);
    });

    it('defaults to a long timeout for a cold local model', () => {
      expect(ollamaOptionsFromEnv({}).timeoutMs).toBe(120_000);
    });
  });
});
