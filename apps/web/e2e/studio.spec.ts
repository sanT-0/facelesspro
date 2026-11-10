import { expect, test } from '@playwright/test';

import {
  API_KEY,
  STYLE_ID,
  VIDEO_ID,
  installFakeApi,
  signInAs,
} from './helpers';

const TAMIL_SCRIPT = 'தமிழ் மொழி அழகானது. இது ஒரு சோதனை காட்சி.';

test.beforeEach(async ({ page }) => {
  await installFakeApi(page);
  await signInAs(page, API_KEY);
});

test('studio creates a video from a Tamil script', async ({ page }) => {
  await page.goto('/studio');

  // Art styles and voices come from the API, not from hard-coded HTML.
  await expect(page.locator('#art-style option')).toHaveCount(1);
  await expect(page.locator('#voice-id option')).toHaveCount(3);

  await page.getByLabel('Script').fill(TAMIL_SCRIPT);
  await page.locator('#art-style').selectOption(STYLE_ID);
  await page.locator('#size').selectOption('portrait');
  await page.locator('#speed').selectOption('slow');
  await page.getByLabel('Enable captions').check();

  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/v1/ai-videos-v3'),
  );
  await page.getByRole('button', { name: 'Create video' }).click();

  const body = JSON.parse((await createRequest).postData() ?? '{}') as Record<string, unknown>;
  expect(body).toMatchObject({
    artStyleId: STYLE_ID,
    script: TAMIL_SCRIPT,
    size: 'portrait',
    speed: 'slow',
    captions: true,
  });
  // Tamil text must survive the form untouched.
  expect(body['script']).toBe(TAMIL_SCRIPT);

  await expect(page.getByText('Video created!')).toBeVisible();
  await expect(page.getByText(`ID: ${VIDEO_ID}`)).toBeVisible();
});

test('job view polls to completion and offers the download', async ({ page }) => {
  await page.goto('/studio');
  await page.getByLabel('Script').fill(TAMIL_SCRIPT);
  await page.locator('#art-style').selectOption(STYLE_ID);
  await page.getByRole('button', { name: 'Create video' }).click();
  await expect(page.getByText('Video created!')).toBeVisible();

  await page.getByRole('link', { name: 'Follow progress' }).click();
  await expect(page).toHaveURL(new RegExp(`/videos/${VIDEO_ID}$`));

  // First read is processing, the 5 s poll returns completed.
  await expect(page.locator('#status-badge')).toHaveText('processing');

  const download = page.getByRole('link', { name: 'Download MP4' });
  await expect(download).toBeVisible({ timeout: 15_000 });
  await expect(download).toHaveAttribute(
    'href',
    'https://cdn.example.com/videos/facelesspro.mp4',
  );
  await expect(download).toHaveAttribute('download', /facelesspro-.*\.mp4$/);
  await expect(page.locator('#video-preview')).toBeVisible();
  await expect(page.getByText('completed').first()).toBeVisible();
});

test('mobile: the script-to-create flow fits 375 px @mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/studio');

  await expect(page.getByLabel('Script')).toBeVisible();
  await page.getByLabel('Script').fill(TAMIL_SCRIPT);
  await page.locator('#art-style').selectOption(STYLE_ID);
  await page.getByRole('button', { name: 'Create video' }).click();
  await expect(page.getByText('Video created!')).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
});
