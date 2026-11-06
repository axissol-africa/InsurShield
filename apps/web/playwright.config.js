// @ts-check
import { defineConfig, devices } from '@playwright/test';

const serviceWorkerOnly = process.argv.some((argument, index) => (
  argument === '--project=service-worker' || (argument === 'service-worker' && process.argv[index - 1] === '--project')
));
const realApiOnly = process.argv.some((argument, index) => (
  argument === '--project=real-api' || (argument === 'real-api' && process.argv[index - 1] === '--project')
));
const realApiBaseUrl = process.env.PLAYWRIGHT_REAL_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  // These journey tests deliberately persist and rehydrate browser state. Keep
  // the default deterministic on developer machines and CI; a faster local
  // run can still opt in explicitly with PLAYWRIGHT_WORKERS.
  workers: process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: 'http://localhost:5180',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The real-api project owns its HTTP-adapter test. Keeping it out of
      // mock mode makes both environments independently meaningful.
      testIgnore: ['service-worker.spec.js', 'real-api.spec.js'],
    },
    {
      // Service-worker checks need a production build and their own same-origin
      // API fixture, so they must not run against the mock-mode dev server.
      name: 'service-worker',
      testMatch: 'service-worker.spec.js',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The CI job starts the Nest app and this project proves a browser page
      // uses it rather than the browser-storage prototype adapter.
      name: 'real-api',
      testMatch: 'real-api.spec.js',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5181' },
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: serviceWorkerOnly ? undefined : realApiOnly ? {
    command: 'npm run dev -- --port 5181 --strictPort',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_API_MODE: 'http',
      VITE_API_BASE_URL: realApiBaseUrl,
    },
  } : {
    command: 'npm run dev -- --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    // These specs seed browser storage and assert on what the app does with
    // it, so they run against the mock adapter whatever a developer happens to
    // have in .env.local. The backend has its own tests.
    env: { VITE_API_MODE: 'mock' },
  },
});

