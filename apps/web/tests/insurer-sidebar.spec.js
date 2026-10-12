// @ts-check
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    store.state.staffSession = { role: 'insurer', name: 'Prestige Assurance' };
    store.version = 5;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  await page.goto('/insurer');
});

test('insurer sidebar collapses and navigation follows browser history', async ({ page }) => {
  const navigation = page.getByRole('navigation', { name: 'Insurer navigation' });
  const overview = navigation.getByRole('link', { name: 'Overview', exact: true });
  const claims = navigation.getByRole('link', { name: 'Claims', exact: true });
  await expect(overview).toHaveAttribute('aria-current', 'page');
  const expandedWidth = (await navigation.boundingBox()).width;

  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect.poll(async () => (await navigation.boundingBox()).width).toBeLessThan(expandedWidth);
  await expect(claims).toBeVisible();
  await claims.click();
  await expect(page).toHaveURL(/\/insurer\?view=claims$/);
  await expect(claims).toHaveAttribute('aria-current', 'page');
  await expect(overview).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: /CLM-774510/ })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/insurer$/);
  await expect(overview).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect.poll(async () => (await navigation.boundingBox()).width).toBe(expandedWidth);
});

test.describe('mobile insurer sidebar', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('menu closes on selection and Escape, restoring access to its trigger', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Toggle navigation' });
    const navigation = page.getByRole('navigation', { name: 'Insurer navigation' });
    await expect(navigation).not.toBeVisible();
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await navigation.getByRole('link', { name: 'Cover guides', exact: true }).click();
    await expect(page).toHaveURL(/\/insurer\?view=guides$/);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByLabel('Plan name *')).toBeVisible();

    await trigger.click();
    await expect(navigation.getByRole('link', { name: 'Cover guides', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
