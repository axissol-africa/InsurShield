// @ts-check
import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.PLAYWRIGHT_REAL_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1';

/**
 * This deliberately stops at the first public journey step. The API suite
 * creates protected data flows; this test proves the shipped browser client
 * reaches the real Nest API (including CORS and its HTTP adapter) rather than
 * silently falling back to local prototype data. Until RTSA approves a live
 * integration, an unavailable lookup must lead customers to manual entry.
 */
test('real API lookup falls back to manual vehicle entry until RTSA is connected', async ({ page }) => {
  await page.goto('/vehicle-identification');
  await page.getByLabel('Licence plate number').fill('BAA 1234');

  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === 'GET'
      && candidate.url().startsWith(`${API_BASE_URL}/vehicles/lookup?`),
  );
  await page.getByRole('button', { name: 'Find vehicle' }).click();

  await expect((await response).status()).toBe(503);
  await expect(page.getByRole('alert')).toContainText('Vehicle lookup is not connected yet');
  await page.getByRole('button', { name: 'Enter details manually' }).click();
  await expect(page.getByRole('tab', { name: 'Manual entry' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByLabel(/Chassis number/)).toBeVisible();
});
