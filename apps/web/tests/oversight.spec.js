import { test, expect } from '@playwright/test';

async function openAsStaff(page, staffSession, path) {
  await page.goto('/');
  await page.evaluate((session) => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    store.state.staffSession = session;
    store.version = 5;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  }, staffSession);
  await page.goto(path);
}

test('platform staff can navigate compliance sections and get report feedback', async ({ page }) => {
  await openAsStaff(page, { id: 'admin-test', name: 'Platform admin', role: 'admin', staffRole: 'ADMIN' }, '/admin');
  const navigation = page.getByRole('navigation', { name: 'Admin sections' });
  await navigation.getByRole('button', { name: 'Reports and compliance' }).click();
  await expect(page.getByRole('heading', { name: 'Reports and compliance' })).toBeVisible();
  await page.getByRole('button', { name: 'Generate report' }).click();
  await expect(page.getByRole('alert')).toContainText('requires a connected API');

  const tabs = page.getByRole('tablist', { name: 'Reports and compliance' });
  for (const name of ['Content', 'Notifications', 'Privacy', 'Risk review']) {
    const tab = tabs.getByRole('tab', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name })).toBeVisible();
  }
});

test.describe('mobile oversight', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('admin tabs remain reachable on a narrow screen', async ({ page }) => {
    await openAsStaff(page, { id: 'admin-test', name: 'Platform admin', role: 'admin', staffRole: 'ADMIN' }, '/admin');
    await page.getByRole('button', { name: 'Reports and compliance' }).click();
    await page.getByRole('tab', { name: 'Risk review' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Risk review' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });

  test('finance staff see the finance report in the insurer workspace', async ({ page }) => {
    await openAsStaff(page, { id: 'finance-test', name: 'Prestige Assurance', role: 'insurer', staffRole: 'FINANCE' }, '/insurer');
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.getByRole('navigation', { name: 'Insurer navigation' }).getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Insurer finance' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Insurer operations' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
