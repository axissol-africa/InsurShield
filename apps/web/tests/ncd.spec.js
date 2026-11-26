import { test, expect } from '@playwright/test';

const customer = { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' };
const application = { id: 'NCD-B16', applicationNumber: 'NCD-B16', insurer: 'Prestige Assurance', fullName: customer.fullName, phone: customer.phone, policyNumber: 'PA-B16', yearsClaimFree: 2, discountPercentage: 17, status: 'Submitted', submittedAt: '2026-11-01T00:00:00Z', verificationRevision: 0, evidence: [] };

for (const width of [1280, 375]) {
  test(`NCD verification and approval at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(({ customer, application }) => {
      localStorage.setItem('insurshield-storage', JSON.stringify({ version: 5, state: {
        customer, isAuthenticated: true, consentAccepted: true,
        staffSession: { role: 'insurer', name: 'Prestige Assurance' }, ncdApplications: [application],
      } }));
    }, { customer, application });
    await page.goto('/insurer?view=ncd');
    await page.getByRole('button', { name: /Review & decide Mwiza/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Reason for decision' }).fill('Provide your policy history.');
    await dialog.getByRole('radio', { name: /^Request verification evidence/ }).click();
    await page.screenshot({ path: testInfo.outputPath('insurer-review.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.goto('/claims');
    await page.getByRole('tab', { name: /NCD|No-claim/i }).click();
    await page.getByRole('button', { name: /NCD-B16/ }).click();
    await expect(page.getByText('Potential Discount').locator('..')).toContainText('17%');
    await expect(page.getByText('Insurer reason:').locator('..')).toContainText('Provide your policy history.');
    await page.getByLabel('Verification evidence files').setInputFiles({ name: 'history.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 policy history') });
    await expect(page.locator('main > div').first()).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('customer-verification.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Submit verification evidence' }).click();
    await expect(page.getByRole('button', { name: 'history.pdf' })).toBeVisible();
    await expect(page.getByLabel('Verification evidence files')).toHaveCount(0);
    await page.goto('/insurer?view=ncd');
    await page.getByRole('button', { name: /Review & decide Mwiza/ }).click();
    await expect(dialog.getByRole('button', { name: 'history.pdf' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Reason for decision' }).fill('Policy history verified.');
    await dialog.getByRole('radio', { name: /^Approve/ }).click();
    await dialog.getByRole('button', { name: 'Approve & issue code' }).click();
    await expect(dialog).not.toBeVisible();
    await page.goto('/claims');
    await page.getByRole('tab', { name: /NCD|No-claim/i }).click();
    await page.getByRole('button', { name: /NCD-B16/ }).click();
    await expect(page.getByRole('button', { name: 'Copy Code' })).toBeVisible();
    await expect(page.getByText(/^Expires:/)).toBeVisible();
    await expect(page.locator('main > div').first()).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('customer-approved.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
