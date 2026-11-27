import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Separate browser matrix so the release lane does not change existing suites.
export default defineConfig({
  ...base,
  testMatch: 'customer-journey-verification.spec.js',
  testIgnore: [],
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { ...base.use, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { ...base.webServer, reuseExistingServer: false },
});
