import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`portfolio search, filters and privacy download at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      const customer = { fullName: 'Portfolio Customer', email: 'portfolio@example.com' };
      localStorage.setItem('insurshield-storage', JSON.stringify({ version: 5, state: {
        customer, isAuthenticated: true, consentAccepted: true, quoteRequests: [],
        policies: [{ policyNumber: 'POL-PORTFOLIO', customerEmail: customer.email, vehicle: 'Toyota Hilux', insurer: 'Test insurer', status: 'Active', premium: 1000 }],
      } }));
    });
    await page.goto('/account');
    const search = page.getByRole('searchbox', { name: 'Search portfolio' });
    await expect(search).toBeVisible();
    await search.fill('missing');
    await expect(page.getByText('No records match these filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('combobox', { name: 'Record type' }).click();
    await page.getByRole('option', { name: 'Policies', exact: true }).click();
    await page.getByRole('combobox', { name: 'Status', exact: true }).click();
    await page.getByRole('option', { name: 'Active', exact: true }).click();
    await expect(page.getByText('1 matching record', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View policy', exact: true })).toHaveAttribute('href', '/account?section=policies');
    await page.screenshot({ path: test.info().outputPath(`portfolio-${viewport.width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto('/account?section=documents');
    await expect(page.getByText('No documents yet.')).toBeVisible();
    await page.goto('/account?section=privacy');
    await expect(page.getByText(/Closure is blocked while cover/)).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my data' }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('insurshield-my-data.json');
    await expect(page.getByRole('status')).toContainText('Your data download is ready.');
    await page.screenshot({ path: test.info().outputPath(`privacy-${viewport.width}.png`), fullPage: true });
  });
}
