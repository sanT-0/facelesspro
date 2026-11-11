/**
 * Accessibility gate: axe must find no **critical** violations on the screens
 * the product lives on. Serious/moderate findings are reported by the axe
 * builder but do not fail the gate (docs/08 §3.10).
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { API_KEY, VIDEO_ID, installFakeApi, signInAs } from './helpers';

test.beforeEach(async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);
});

for (const screen of [
  { name: 'studio', path: '/studio', ready: 'Create a video' },
  { name: 'editor', path: `/editor?id=${VIDEO_ID}`, ready: /Editor/ },
  { name: 'pricing', path: '/pricing', ready: 'Plans' },
] as const) {
  test(`${screen.name} has no critical axe violations`, async ({ page }) => {
    await page.goto(screen.path);
    await expect(
      page.getByRole('heading', { name: screen.ready }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter(
      (violation) => violation.impact === 'critical',
    );

    expect(
      critical.map((violation) => ({
        id: violation.id,
        help: violation.help,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  });
}
