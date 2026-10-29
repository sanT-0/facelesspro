import { describe, expect, it, vi } from 'vitest';

import { createPlannerChainFromEnv } from './factory';

const word = 'வார்த்தை';
/** 25 Tamil words ≈ 11.5 s: one valid scene. */
const SENTENCE = `${Array.from({ length: 25 }, () => word).join(' ')}.`;

const answer = JSON.stringify({
  scenes: [{ text: SENTENCE, imagePrompt: 'a desk by a window', motion: 'none', emphasis: [] }],
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const warnings = () => {
  const messages: string[] = [];
  return { messages, logger: (message: string) => messages.push(message) };
};

describe('createPlannerChainFromEnv', () => {
  it('plans with the heuristic alone when PLANNER is unset, and says so', async () => {
    const { messages, logger } = warnings();
    const chain = createPlannerChainFromEnv({ env: {}, logger });

    const plan = await chain.plan({ script: SENTENCE });

    expect(plan.adapter).toBe('heuristic');
    expect(plan.degradedFrom).toEqual([]);
    expect(messages.join('\n')).toMatch(/PLANNER is not set/u);
  });

  it('ignores an unknown adapter name with a warning', async () => {
    const { messages, logger } = warnings();
    const chain = createPlannerChainFromEnv({ env: { PLANNER: 'bogus,heuristic' }, logger });

    const plan = await chain.plan({ script: SENTENCE });

    expect(plan.adapter).toBe('heuristic');
    expect(messages.join('\n')).toContain('unknown adapter "bogus"');
  });

  it('skips a provider whose credentials are missing instead of failing at request time', async () => {
    const { messages, logger } = warnings();
    const chain = createPlannerChainFromEnv({ env: { PLANNER: 'cloudflare,heuristic' }, logger });

    const plan = await chain.plan({ script: SENTENCE });

    expect(plan.adapter).toBe('heuristic');
    expect(messages.join('\n')).toContain('"cloudflare" is not available');
    expect(messages.join('\n')).toContain('CLOUDFLARE_ACCOUNT_ID');
  });

  it('preserves the configured order; the first healthy adapter plans the video', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ result: { response: answer } }),
    ) as unknown as typeof fetch;
    const chain = createPlannerChainFromEnv({
      env: {
        PLANNER: 'cloudflare,heuristic',
        CLOUDFLARE_ACCOUNT_ID: 'acct-1',
        CLOUDFLARE_API_TOKEN: 'token-1',
      },
      logger: () => {},
      fetchImpl,
    });

    const plan = await chain.plan({ script: SENTENCE });

    expect(plan.adapter).toBe('cloudflare');
    expect(plan.degradedFrom).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('degrades an upstream 500 to the next adapter and records it', async () => {
    const fetchImpl = (async () =>
      new Response('upstream exploded', { status: 500 })) as unknown as typeof fetch;
    const chain = createPlannerChainFromEnv({
      env: { PLANNER: 'groq,heuristic', GROQ_API_KEY: 'gsk-1' },
      logger: () => {},
      fetchImpl,
    });

    const plan = await chain.plan({ script: SENTENCE });

    expect(plan.adapter).toBe('heuristic');
    expect(plan.degradedFrom).toEqual(['groq']);
  });

  it('falls back to the heuristic when every named provider is unavailable', async () => {
    const { messages, logger } = warnings();
    const chain = createPlannerChainFromEnv({
      env: { PLANNER: 'cloudflare,groq' },
      logger,
    });

    const plan = await chain.plan({ script: SENTENCE });

    expect(plan.adapter).toBe('heuristic');
    expect(plan.degradedFrom).toEqual([]);
    expect(messages.join('\n')).toContain('no configured PLANNER adapter is available');
  });

  it('does not consult the real environment when one is injected', async () => {
    const previous = process.env.PLANNER;
    process.env.PLANNER = 'groq';
    process.env.GROQ_API_KEY = 'from-process';
    try {
      const { messages, logger } = warnings();
      const chain = createPlannerChainFromEnv({ env: {}, logger });
      const plan = await chain.plan({ script: SENTENCE });
      expect(plan.adapter).toBe('heuristic');
      expect(messages.join('\n')).toMatch(/PLANNER is not set/u);
    } finally {
      if (previous === undefined) delete process.env.PLANNER;
      else process.env.PLANNER = previous;
      delete process.env.GROQ_API_KEY;
    }
  });
});
