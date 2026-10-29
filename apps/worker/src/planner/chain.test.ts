import { scenePlanSchema } from '@facelesspro/contracts';
import type { PlannerAdapter, ScenePlan } from '@facelesspro/contracts';
import { describe, expect, it } from 'vitest';

import type { PlannerPort } from '../ports/planner';
import { PlannerChainError, createPlannerChain } from './chain';
import { createHeuristicPlanner } from './heuristic';

const SCRIPT = 'வணக்கம் நண்பர்களே. இன்று ஒரு சிறிய விஷயம் பேசுவோம்.';

const planFrom = (adapter: PlannerAdapter): ScenePlan =>
  scenePlanSchema.parse({
    scenes: [
      {
        text: SCRIPT,
        imagePrompt: 'a street, no text, no watermark',
        motion: 'none',
        emphasis: [],
        startMs: 0,
        endMs: 5_000,
      },
    ],
    adapter,
    degradedFrom: [],
    totalMs: 5_000,
  });

const ok = (name: PlannerAdapter): PlannerPort => ({
  name,
  plan: () => Promise.resolve(planFrom(name)),
});

const down = (name: PlannerAdapter, message: string): PlannerPort => ({
  name,
  plan: () => Promise.reject(new Error(message)),
});

describe('planner chain', () => {
  it('uses the first healthy adapter and records nothing degraded', async () => {
    const plan = await createPlannerChain([ok('cloudflare'), ok('heuristic')]).plan({ script: SCRIPT });
    expect(plan.adapter).toBe('cloudflare');
    expect(plan.degradedFrom).toEqual([]);
  });

  it('falls back down the chain and records every adapter it skipped', async () => {
    const plan = await createPlannerChain([
      down('cloudflare', '429 rate limited'),
      down('groq', 'timeout after 8000 ms'),
      createHeuristicPlanner(),
    ]).plan({ script: SCRIPT });

    expect(plan.adapter).toBe('heuristic');
    expect(plan.degradedFrom).toEqual(['cloudflare', 'groq']);
    scenePlanSchema.parse(plan);
  });

  it('fails the step only when every adapter fails', async () => {
    const chain = createPlannerChain([
      down('cloudflare', '429 rate limited'),
      down('ollama', 'connection refused'),
    ]);

    const error = await chain.plan({ script: SCRIPT }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PlannerChainError);
    if (!(error instanceof PlannerChainError)) throw error;
    expect(error.failures).toEqual([
      { adapter: 'cloudflare', message: '429 rate limited', retryable: false },
      { adapter: 'ollama', message: 'connection refused', retryable: false },
    ]);
    expect(error.message).toContain('cloudflare');
    expect(error.message).toContain('connection refused');
  });

  it('records a non-Error rejection as text instead of losing it', async () => {
    const chain = createPlannerChain([
      { name: 'groq', plan: () => Promise.reject('quota') },
      down('heuristic', 'no luck'),
    ]);
    const error = await chain.plan({ script: SCRIPT }).catch((thrown: unknown) => thrown);
    if (!(error instanceof PlannerChainError)) throw error;
    expect(error.failures[0]).toEqual({ adapter: 'groq', message: 'quota', retryable: false });
  });

  it('marks the whole failure retryable only when every adapter failed transiently', async () => {
    const transient = (name: PlannerAdapter): PlannerPort => ({
      name,
      plan: () => Promise.reject(Object.assign(new Error('429'), { retryable: true })),
    });

    const allTransient = await createPlannerChain([transient('cloudflare'), transient('groq')])
      .plan({ script: SCRIPT })
      .catch((thrown: unknown) => thrown);
    expect(allTransient).toBeInstanceOf(PlannerChainError);
    expect((allTransient as PlannerChainError).retryable).toBe(true);

    const mixed = await createPlannerChain([transient('cloudflare'), down('groq', '401 bad key')])
      .plan({ script: SCRIPT })
      .catch((thrown: unknown) => thrown);
    expect((mixed as PlannerChainError).retryable).toBe(false);

    const permanent = await createPlannerChain([down('cloudflare', '401 bad key')])
      .plan({ script: SCRIPT })
      .catch((thrown: unknown) => thrown);
    expect((permanent as PlannerChainError).retryable).toBe(false);
  });

  it('rejects an empty chain at construction', () => {
    expect(() => createPlannerChain([])).toThrow(TypeError);
  });
});
