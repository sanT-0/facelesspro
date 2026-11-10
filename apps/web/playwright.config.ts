/**
 * Playwright configuration for the FacelessPro web app.
 *
 * The dev server bundles with esbuild and serves the app; the specs intercept
 * `/v1/**` in the browser, so no API, database or worker is needed and the
 * suite runs offline and fast. Live API verification is a separate script.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 3103;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@mobile/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@mobile/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: { PORT: String(PORT) },
  },
});
