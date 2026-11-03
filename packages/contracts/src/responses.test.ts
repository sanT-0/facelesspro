import { describe, expect, it } from 'vitest';

import { captionTemplateListSchema } from './responses';

describe('caption template responses', () => {
  it('uses the shared non-zero caption template id contract', () => {
    const template = { name: 'Built-in', spec: {} };
    expect(
      captionTemplateListSchema.safeParse({
        templates: [{ ...template, id: -1 }, { ...template, id: 1 }],
      }).success,
    ).toBe(true);
    expect(
      captionTemplateListSchema.safeParse({
        templates: [{ ...template, id: 0 }],
      }).success,
    ).toBe(false);
  });
});
