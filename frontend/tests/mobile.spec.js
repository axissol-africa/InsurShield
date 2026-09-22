// @ts-check
import { test, expect } from '@playwright/test';

// Phone-sized viewport for every test in this file.
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const CUSTOMER = { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' };

const seed = (page, state) => page.evaluate((extra) => {
  localStorage.setItem('insurshield-storage', JSON.stringify({ state: extra, version: 5 }));
}, state);

/** Nothing on the page may be wider than the phone screen (the home-page partner marquee scrolls by design). */
const expectNoHorizontalOverflow = async (page) => {
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(width[0], `${page.url()} scrolls horizontally`).toBeLessThanOrEqual(width[1]);
};

/** Every icon must render as a glyph (about one em wide), never as its ligature name spelled out. */
const expectIconsRendered = async (page) => {
  await expect(page.locator('html')).toHaveClass(/icons-ready/);
  const spelledOut = await page.evaluate(() =>
    [...document.querySelectorAll('.material-symbols-outlined')]
      .filter((el) => el.getClientRects().length > 0)
      // Measure the glyph run itself, not the box (stretched flex children are wider than their text).
      .filter((el) => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().width > parseFloat(getComputedStyle(el).fontSize) * 1.6; })
      .map((el) => el.textContent.trim()),
  );
  expect(spelledOut, `${page.url()} shows icon names as text`).toEqual([]);
};

test('icons come from the self-hosted subset and never show as text', async ({ page }) => {
  const fontRequests = [];
  page.on('request', (request) => { if (/fonts\.gstatic\.com.*(Material|kit=)|material-symbols/i.test(request.url())) fontRequests.push(request.url()); });
  await page.goto('/');
  await seed(page, { customer: CUSTOMER, isAuthenticated: true, consentAccepted: true });
  for (const path of ['/', '/account', '/claims', '/support']) {
    await page.goto(path);
    await expectIconsRendered(page);
  }
  expect(fontRequests.some((url) => url.includes('/fonts/material-symbols-subset.woff2'))).toBe(true);
  expect(fontRequests.filter((url) => url.includes('gstatic'))).toEqual([]);
});

test('customer pages fit a phone screen and the menu opens with a backdrop', async ({ page }) => {
  await page.goto('/');
  await seed(page, { customer: CUSTOMER, isAuthenticated: true, consentAccepted: true, vehicleDetails: { plateNumber: 'BAA 1234', make: 'Toyota', model: 'Hilux', year: '2020' }, vehicleValue: 250000, vehicleUsage: 'Individual', insuranceType: 'Comprehensive' });
  for (const path of ['/', '/insurance-type', '/vehicle-identification', '/vehicle-usage', '/quote-request', '/account', '/claims', '/support', '/create-account']) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
    await expectIconsRendered(page);
  }

  await page.goto('/account');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const menu = page.getByRole('navigation', { name: 'Mobile' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Signed in as Mwiza Banda')).toBeVisible();
  await menu.getByRole('link', { name: 'Contact' }).click();
  await expect(page).toHaveURL(/support/);
  await expect(menu).toHaveCount(0);
});

test('staff portal top bar and tabs work on a phone', async ({ page }) => {
  await page.goto('/');
  await seed(page, { staffSession: { role: 'insurer', name: 'Prestige Assurance' } });
  await page.goto('/insurer');
  await expectNoHorizontalOverflow(page);
  await expectIconsRendered(page);

  const header = page.locator('header');
  await expect(page.getByTestId('portal-role')).toHaveText(/Insurer/);
  await expect(header.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Customer site' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);

  // All four tabs are on screen without scrolling the tab strip.
  for (const name of ['Overview', 'Paid policies', 'Claims', 'NCD']) await expect(page.getByRole('tab', { name: new RegExp(name) })).toBeInViewport();
  await page.getByRole('tab', { name: /Claims/ }).click();
  await page.getByRole('button', { name: /CLM-774510/ }).click();
  await expect(page.getByRole('button', { name: 'Mark as received' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/admin');
  await seed(page, { staffSession: { role: 'admin', name: 'Super Admin' } });
  await page.goto('/admin');
  await expect(page.getByTestId('portal-role')).toHaveText(/Staff/);
  await page.getByText('Manage Insurers', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add Insurer' })).toBeInViewport();
  await expectNoHorizontalOverflow(page);

  await header.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/admin-login/);
});
