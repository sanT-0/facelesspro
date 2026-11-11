/**
 * The plan catalog is shared by the server and the public pricing page, so the
 * numbers the page advertises and the limits a workspace is held to cannot
 * drift. Every definition must satisfy `planSchema`; the map must contain
 * exactly the definitions, in display order.
 */

import { describe, expect, it } from 'vitest';

import { planIdSchema } from './common';
import { planFor, PLAN_DEFINITIONS, PLANS } from './plans';
import { planSchema } from './responses';

describe('plan catalog', () => {
  it('parses every definition through the wire plan shape', () => {
    for (const definition of PLAN_DEFINITIONS) {
      expect(planSchema.parse(definition)).toEqual(definition);
    }
  });

  it('covers every plan id exactly once, in display order', () => {
    const ids = PLAN_DEFINITIONS.map((plan) => plan.id);
    expect(ids).toEqual([
      'free',
      'pro',
      'premium',
      'premium_plus',
      'max',
      'selfhost',
    ]);
    expect([...ids].sort()).toEqual([...planIdSchema.options].sort());
    expect([...PLANS.keys()]).toEqual(ids);
  });

  it('keeps selfhost unlimited and every paid plan numeric', () => {
    for (const definition of PLAN_DEFINITIONS) {
      if (definition.id === 'selfhost') {
        expect(definition.minutesPerMonth).toBeNull();
        expect(definition.creditsPerMonth).toBeNull();
      } else {
        expect(definition.minutesPerMonth).toBeGreaterThan(0);
        expect(definition.creditsPerMonth).toBeGreaterThan(0);
      }
    }
  });

  it('resolves a definition by id and rejects an unknown one', () => {
    expect(planFor('free').maxVideoMinutes).toBe(10);
    expect(() => planFor('enterprise' as never)).toThrow(/unknown plan/);
  });
});
