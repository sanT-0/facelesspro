import { expect, test } from '@playwright/test';

import { API_KEY, VIDEO_ID, installFakeApi, signInAs } from './helpers';

test('editor lists scenes, exposes a voice-plan slot, and queues a render', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.getByRole('heading', { name: /Editor/ })).toBeVisible();
  await expect(page.getByText('தமிழ் முதல் காட்சி')).toBeVisible();
  await expect(page.getByText('இரண்டாவது காட்சி')).toBeVisible();
  await expect(page.locator('.scene-item')).toHaveCount(2);

  await page.locator('#render-resolution').selectOption('2160');
  await page.locator('#render-fps').selectOption('60');
  await page.locator('#render-format').selectOption('greenscreen');

  const renderRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith(`/v1/videos/${VIDEO_ID}/render`),
  );
  await page.getByRole('button', { name: 'Render video' }).click();

  const body = JSON.parse((await renderRequest).postData() ?? '{}') as Record<string, unknown>;
  expect(body).toEqual({ resolution: 2160, frameRate: 60, format: 'greenscreen' });

  await expect(page.getByText('Render queued')).toBeVisible();
  await expect(page.getByText('2160p · 60 fps · greenscreen')).toBeVisible();
});
