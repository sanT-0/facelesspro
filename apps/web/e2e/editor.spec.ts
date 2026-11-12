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

test('editor inspects the committed plan and its planner adapter', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
  await expect(page.locator('.plan-adapter')).toContainText('heuristic');
  await expect(page.locator('.plan-scene')).toHaveCount(2);
  await expect(page.locator('.plan-scene').first()).toContainText('kenburns-in');
  await expect(page.locator('.plan-scene').first()).toContainText('தமிழ்');
  await expect(page.locator('.plan-scene').first()).toContainText(
    'a Tamil street at dawn, cinematic',
  );
  await expect(page.locator('.plan-scene').nth(1)).toContainText('pan-left');
});

test('editor previews another caption grouping without persisting it', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.locator('.caption-cue')).toHaveCount(2);
  await expect(page.getByText('Preview only', { exact: false })).toBeVisible();

  await page.locator('#caption-template').selectOption('7');
  await page.locator('#caption-word-limit').fill('2');
  await page.locator('#caption-emoji').check();

  const previewRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().endsWith(`/v1/videos/${VIDEO_ID}/captions/preview`),
  );
  await page.getByRole('button', { name: 'Preview' }).click();

  const body = JSON.parse((await previewRequest).postData() ?? '{}') as Record<
    string,
    unknown
  >;
  expect(body).toEqual({
    templateId: 7,
    spec: { wordLimit: 2, emoji: true },
  });

  // The panel re-renders the preview's three cues, not the stored two.
  await expect(page.locator('.caption-cue')).toHaveCount(3);
  await expect(page.locator('#caption-preview-status')).toContainText('Preview: 3 cues');
  await expect(page.locator('.caption-cue').first()).toContainText('தமிழ் முதல்');
  await expect(page.locator('.caption-cue').first()).toContainText('🔥');
});

test('editor draws the narration waveform and scrubs the playhead', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  const canvas = page.locator('#waveform');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-ready', 'true');

  // A real decode + draw leaves blue waveform pixels, not just the dark canvas.
  const waveformPixels = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const data = target
      .getContext('2d')!
      .getImageData(0, 0, target.width, target.height).data;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 1] ?? 0) > 80) painted += 1;
    }
    return painted;
  });
  expect(waveformPixels).toBeGreaterThan(500);

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // 6.4 s fixture: the midpoint is 3.2 s.
  await expect(page.locator('#playhead-time')).toHaveText('0:03.2');
});

test('editor says when the caption track is not ready yet', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1, captions: false });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.getByText('Captions are not ready yet.')).toBeVisible();
  await expect(page.locator('.caption-cue')).toHaveCount(0);
});
