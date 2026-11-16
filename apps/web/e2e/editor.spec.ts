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
  await expect(page.getByText('Preview does not change', { exact: false })).toBeVisible();

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

test('editor saves a caption style and re-queues create-captions', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.locator('.caption-cue')).toHaveCount(2);

  await page.locator('#caption-template').selectOption('7');
  await page.locator('#caption-word-limit').fill('2');
  await page.locator('#caption-emoji').check();

  const saveRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().endsWith(`/v1/videos/${VIDEO_ID}/captions`),
  );
  await page.getByRole('button', { name: 'Save style and re-render' }).click();

  const body = JSON.parse((await saveRequest).postData() ?? '{}') as Record<
    string,
    unknown
  >;
  expect(body).toEqual({
    templateId: 7,
    spec: { wordLimit: 2, emoji: true },
  });

  // Saving is not a preview: the 202 puts the video back into processing and
  // the panel says what is being rebuilt.
  await expect(page.locator('#caption-preview-status')).toContainText(
    'Captions and the MP4 rebuild with this style',
  );
  await expect(page.getByRole('button', { name: 'Style saved' })).toBeVisible();
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

test('editor redraws one scene of a completed video', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.locator('.scene-item')).toHaveCount(2);
  const redrawButtons = page.getByRole('button', { name: 'Redraw' });
  await expect(redrawButtons).toHaveCount(2);

  await page.locator('#redraw-prompt').fill('warmer light');

  const redrawRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().endsWith(`/v1/videos/${VIDEO_ID}/scenes/1/redraw`),
  );
  await redrawButtons.nth(1).click();

  const body = JSON.parse((await redrawRequest).postData() ?? '{}') as Record<
    string,
    unknown
  >;
  expect(body).toEqual({ prompt: 'warmer light' });

  await expect(page.locator('#redraw-status')).toContainText('Scene 2 queued');
  // The video is back in `create-images`, so the action disappears until the
  // new still and the re-render finish.
  await expect(page.locator('#editor-status')).toContainText('processing');
  await expect(page.getByRole('button', { name: 'Redraw' })).toHaveCount(0);
});

test('editor re-narrates only the scene text that changed', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  // A completed video exposes one editable textarea per scene.
  const fields = page.locator('[data-scene-text]');
  await expect(fields).toHaveCount(2);
  await expect(fields.nth(1)).toHaveValue('இரண்டாவது காட்சி');

  await fields.nth(1).fill('புதிய இரண்டாம் காட்சி');

  const renarrateRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().endsWith(`/v1/videos/${VIDEO_ID}/narration`),
  );
  await page.getByRole('button', { name: 'Re-narrate changed scenes' }).click();

  const body = JSON.parse((await renarrateRequest).postData() ?? '{}') as Record<
    string,
    unknown
  >;
  // Only the edited scene is sent: the untouched one is a media-cache hit.
  expect(body).toEqual({ scenes: [{ idx: 1, text: 'புதிய இரண்டாம் காட்சி' }] });

  await expect(page.locator('#renarrate-status')).toContainText('Queued.');
  await expect(page.locator('#editor-status')).toContainText('processing');
  // Re-narrate is only offered on a completed video.
  await expect(fields).toHaveCount(0);
});

test('editor does not post a re-narrate when no scene text changed', async ({
  page,
}) => {
  await installFakeApi(page, { completeAfter: 1 });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.locator('[data-scene-text]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Re-narrate changed scenes' }).click();

  await expect(page.locator('#renarrate-status')).toContainText('No scene text changed.');
  await expect(page.locator('#editor-status')).toContainText('completed');
});

test('editor says when the caption track is not ready yet', async ({ page }) => {
  await installFakeApi(page, { completeAfter: 1, captions: false });
  await signInAs(page, API_KEY);

  await page.goto(`/editor?id=${VIDEO_ID}`);

  await expect(page.getByText('Captions are not ready yet.')).toBeVisible();
  await expect(page.locator('.caption-cue')).toHaveCount(0);
});
