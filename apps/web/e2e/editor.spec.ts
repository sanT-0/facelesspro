import { expect, test } from '@playwright/test';

import { API_KEY, VIDEO_ID, installFakeApi, signInAs } from './helpers';

test('editor lists scenes, voice plan and captions, then queues a render', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.getByRole('heading', { name: /Editor/ })).toBeVisible();
  await expect(page.locator('.scene-item').filter({ hasText: 'தமிழ் முதல் காட்சி' })).toBeVisible();
  await expect(page.locator('.scene-item').filter({ hasText: 'இரண்டாவது காட்சி' })).toBeVisible();
  await expect(page.locator('.scene-item')).toHaveCount(2);

  // The voice plan shows which runs went to Tamil vs English.
  await expect(page.locator('.voice-run')).toHaveCount(2);
  await expect(page.locator('.voice-run').nth(0)).toContainText('TA');
  await expect(page.locator('.voice-run').nth(0)).toContainText('ta-IN-ValluvarNeural');
  await expect(page.locator('.voice-run').nth(1)).toContainText('EN');
  await expect(page.locator('.voice-run').nth(1)).toContainText('Today fire!');
  await expect(page.getByText('2 runs')).toBeVisible();

  // The stored caption track renders with timecodes; each sidecar can be
  // previewed and downloaded without leaving the page.
  await expect(page.locator('.caption-cue')).toHaveCount(2);
  await expect(page.locator('.caption-cue').first()).toContainText('0:00.0 → 0:03.2');
  await expect(page.locator('.caption-cue').first()).toContainText('தமிழ் முதல் காட்சி');

  await page.getByRole('button', { name: 'SRT' }).click();
  await expect(page.locator('#caption-raw')).toContainText('00:00:00,000 --> 00:00:03,200');
  await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute(
    'download',
    'captions.srt',
  );

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

test('editor says when the caption track is not ready yet', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1, captions: false });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.getByText('Captions are not ready yet.')).toBeVisible();
  await expect(page.locator('.caption-cue')).toHaveCount(0);
});
