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

test('public insurer profile uses the live API and handles a profile that has no approval', async ({ page }) => {
  const id = '10000000-0000-4000-8000-000000000017';
  const request = page.waitForResponse((response) => response.url() === `${API_BASE_URL}/insurer-profiles/${id}` && response.request().method() === 'GET');
  await page.goto(`/insurers/${id}`);
  await expect((await request).status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Profile not available', exact: true })).toBeVisible();
});

for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`customers can read a verified review and reply at ${size.width}px`, async ({ page }) => {
    const id = '10000000-0000-4000-8000-000000000017';
    await page.setViewportSize(size);
    const cors = {
      'access-control-allow-origin': 'http://127.0.0.1:5181',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type, x-insurshield-user',
    };
    await page.route(`${API_BASE_URL}/insurer-profiles/${id}`, async (route) => {
      await route.fulfill({ headers: cors, json: {
        insurerId: id, name: 'Example Assurance', tradingName: null, status: 'Active',
        licence: { number: 'TEST-17', current: true, expiresAt: null },
        profile: { brandName: 'Example Assurance', description: 'Cover for cars and light trucks.', serviceInformation: 'Contact our service desk.' },
        products: [], productsTruncated: false,
      } });
    });
    await page.route(`**/reviews/public/${id}?*`, (route) => route.fulfill({ headers: cors, json: {
      items: [{ id, rating: 4, text: 'The insurer explained the cover clearly.', publishedAt: '2026-11',
        response: { text: 'Thank you for the feedback.', publishedAt: '2026-11' } }],
      hasMore: false, page: 1,
    } }));
    await page.goto(`/insurers/${id}`);
    await expect(page.getByRole('heading', { name: 'Verified policy purchase reviews' })).toBeVisible();
    await expect(page.getByText('4 out of 5 stars')).toBeVisible();
    await expect(page.getByText('Thank you for the feedback.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
  });
}
