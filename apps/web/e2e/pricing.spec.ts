/**
 * Public pricing page: it must render without a key, from the shared plan
 * catalog, and it must not invent prices.
 */

import { expect, test } from '@playwright/test';

import { API_KEY, installFakeApi, signInAs } from './helpers';

test('pricing lists every plan from the shared catalog without a key', async ({ page }) => {
  await installFakeApi(page);

  await page.goto('/pricing');

  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
  await expect(page.locator('.plan-card')).toHaveCount(6);

  const free = page.locator('[data-plan="free"]');
  await expect(free).toContainText('10');
  await expect(free).toContainText('1080p');

  const max = page.locator('[data-plan="max"]');
  await expect(max).toContainText('1800');
  await expect(max).toContainText('2160p');
  await expect(max).toContainText('10');

  const selfhost = page.locator('[data-plan="selfhost"]');
  await expect(selfhost.getByText('Unlimited')).toHaveCount(2);
  await expect(selfhost).toContainText('Self-hosted');

  // No fabricated pricing: the page says so instead of showing a number.
  await expect(page.getByText(/ships no price list/)).toBeVisible();
});

test('pricing is reachable from the header and calls the studio to action', async ({ page }) => {
  await installFakeApi(page);
  await signInAs(page, API_KEY);

  await page.goto('/pricing');
  await page.getByRole('link', { name: 'Pricing' }).click();

  await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a video' })).toBeVisible();

  await page.getByRole('button', { name: 'Create a video' }).click();
  await expect(page.getByRole('heading', { name: 'Create a video' })).toBeVisible();
});
