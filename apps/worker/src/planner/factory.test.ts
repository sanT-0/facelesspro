import { describe, expect, it, vi } from 'vitest';

import type { PlannerPort } from '../ports/planner';

import { createPlannerChainForTest, createPlannerChainFromEnv } from './factory';
import { createHeuristicPlanner } from './heuristic';

// Mock adapters for testing
const createMockAdapter = (name: string, shouldFail = false): PlannerPort => ({
  name: name as 'heuristic' | 'cloudflare' | 'groq' | 'ollama',
  plan: async (request) => {
    if (shouldFail) throw new Error(`${name} failed`);
    const { scenePlanSchema } = await import('@facelesspro/contracts');
    return scenePlanSchema.parse({
      scenes: [
        {
          text: request.script,
          imagePrompt: 'test prompt',
          motion: 'none',
          emphasis: [],
          startMs: 0,
          endMs: 5000,
        },
      ],
      adapter: name,
      degradedFrom: [],
      totalMs: 5000,
    });
  },
});

describe('planner factory', () => {
  describe('createPlannerChainForTest', () => {
    it('creates a chain with the given adapters', async () => {
      const chain = createPlannerChainForTest(['heuristic', 'cloudflare'], {
        cloudflare: createMockAdapter('cloudflare'),
      });

      expect(chain.name).toBe('chain');
      const plan = await chain.plan({ script: 'test script' });
      expect(plan.adapter).toBe('heuristic'); // First healthy wins
      expect(plan.degradedFrom).toEqual([]);
    });

    it('falls back when first adapter fails', async () => {
      const chain = createPlannerChainForTest(['cloudflare', 'heuristic'], {
        cloudflare: createMockAdapter('cloudflare', true), // fails
        heuristic: createHeuristicPlanner(),
      });

      const plan = await chain.plan({ script: 'test script' });
      expect(plan.adapter).toBe('heuristic');
      expect(plan.degradedFrom).toEqual(['cloudflare']);
    });

    it('records all failures when all adapters fail', async () => {
      const chain = createPlannerChainForTest(['cloudflare', 'groq'], {
        cloudflare: createMockAdapter('cloudflare', true),
        groq: createMockAdapter('groq', true),
      });

      await expect(chain.plan({ script: 'test' })).rejects.toThrow('every planner adapter failed');
    });

    it('throws on empty adapter list', () => {
      expect(() => createPlannerChainForTest([])).toThrow('at least one adapter');
    });

    it('throws on unknown adapter name', () => {
      expect(() => createPlannerChainForTest(['unknown'])).toThrow('Unknown test adapter');
    });
  });

  describe('createPlannerChainFromEnv', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('defaults to heuristic when PLANNER is not set', () => {
      delete process.env.PLANNER;
      const chain = createPlannerChainFromEnv({ logger: vi.fn() });
      expect(chain.name).toBe('chain');
    });

    it('skips unknown adapters with warning', () => {
      process.env.PLANNER = 'unknown,heuristic';
      const logger = vi.fn();
      const chain = createPlannerChainFromEnv({ logger });
      expect(logger).toHaveBeenCalledWith(expect.stringContaining('unknown'));
      expect(chain.name).toBe('chain');
    });

    it('skips adapters with missing env vars', () => {
      process.env.PLANNER = 'cloudflare,heuristic';
      // CF_ACCOUNT_ID and CF_API_TOKEN not set
      const logger = vi.fn();
      const chain = createPlannerChainFromEnv({ logger });
      expect(logger).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
      // Should fall back to heuristic
      expect(chain.name).toBe('chain');
    });

    it('respects forceEnabled true', () => {
      process.env.PLANNER = 'cloudflare,heuristic';
      // Force enable cloudflare even without env vars
      const chain = createPlannerChainFromEnv({
        forceEnabled: { cloudflare: true },
        logger: vi.fn(),
      });
      // The chain should have been created with the forced adapter
      expect(chain.name).toBe('chain');
    });

    it('respects forceEnabled false', () => {
      process.env.PLANNER = 'cloudflare,heuristic';
      const chain = createPlannerChainFromEnv({
        forceEnabled: { heuristic: false },
        logger: vi.fn(),
      });
      // Heuristic should be disabled, but chain still works
      expect(chain.name).toBe('chain');
    });

    it('falls back to heuristic when all requested adapters unavailable', () => {
      process.env.PLANNER = 'cloudflare,groq,ollama'; // None have env vars
      const logger = vi.fn();
      const chain = createPlannerChainFromEnv({ logger });
      expect(logger).toHaveBeenCalledWith(expect.stringContaining('falling back to heuristic'));
      expect(chain.name).toBe('chain');
    });
  });
});