import { expect, test } from '@playwright/test';

import { API_KEY, OTHER_KEY, installFakeApi } from './helpers';

test.describe('sign-in', () => {
  test('protected pages redirect to the sign-in page', async ({ page }) => {
    await installFakeApi(page);

    await page.goto('/studio');

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('rejects a key the API does not accept and stores nothing', async ({ page }) => {
    await installFakeApi(page);

    await page.goto('/sign-in');
    await page.getByLabel('API key').fill(OTHER_KEY);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toContainText('not accepted');
    await expect(page).toHaveURL(/\/sign-in$/);
    const stored = await page.evaluate(() => window.localStorage.getItem('facelesspro_token'));
    expect(stored).toBeNull();
  });

  test('stores a valid key and opens the studio', async ({ page }) => {
    await installFakeApi(page);

    await page.goto('/sign-in');
    await page.getByLabel('API key').fill(API_KEY);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole('heading', { name: 'Create a video' })).toBeVisible();
    await expect(page.getByText('Test Workspace')).toBeVisible();

    const stored = await page.evaluate(() => window.localStorage.getItem('facelesspro_token'));
    expect(stored).toBe(API_KEY);

    // A reload keeps the session.
    await page.reload();
    await expect(page).toHaveURL(/\/studio$/);
  });
});
