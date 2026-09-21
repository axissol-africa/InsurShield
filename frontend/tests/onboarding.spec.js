// @ts-check
import { test, expect } from '@playwright/test';
import path from 'node:path';

const SCRATCH = '/private/tmp/claude-501/-Users-flaviourchipamba-Documents-GitHub-InsurShield/e4c399ef-17cf-4f1b-a98a-7154290c8cd5/scratchpad';

const seedStaff = (role, name) => async ({ page }) => {
  await page.goto('/');
  await page.evaluate(([r, n]) => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    store.state.staffSession = { role: r, name: n };
    store.version = 4;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  }, [role, name]);
};

test('admin onboards an insurer with an uploaded logo', async ({ page }) => {
  await seedStaff('admin', 'Admin')({ page });
  await page.goto('/admin');
  await page.getByText('Manage Insurers', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Insurer' }).click();

  await page.getByPlaceholder('e.g. Prestige Assurance Limited').fill('Zambezi General Insurance Limited');
  await page.getByPlaceholder('Name shown to customers').fill('Zambezi General');
  await page.getByPlaceholder('e.g. PIA/GI/2026/017').fill('PIA/GI/2026/031');
  await page.locator('input[type="date"]').fill('2027-06-30');
  await page.getByPlaceholder('+260 211 …').fill('+260 211 999 000');
  await page.getByPlaceholder('claims@insurer.zm').fill('claims@zambezi.zm');
  await page.getByPlaceholder('e.g. 4.0').fill('4.1');
  await page.locator('input[type="file"]').setInputFiles(path.join(SCRATCH, 'logo.png'));
  await expect(page.getByAltText('Company logo preview')).toBeVisible();
  await page.getByRole('button', { name: 'Onboard insurance company' }).click();

  await expect(page.getByRole('heading', { name: 'Manage Insurers' })).toBeVisible();
  await expect(page.getByText('Zambezi General Insurance Limited')).toBeVisible();
  await expect(page.getByText('PIA/GI/2026/031')).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('insurshield-storage')).state.insurersList.at(-1));
  expect(stored.logoUrl).toMatch(/^data:image\/png/);
  expect(stored.contact.email).toBe('claims@zambezi.zm');
  expect(stored.quoteValidityDays).toBe(5);
});

test('insurer uploads a quotation document and the customer can open it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    Object.assign(store.state, {
      staffSession: { role: 'insurer', name: 'Prestige Assurance' },
      customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' }, isAuthenticated: true, consentAccepted: true,
      quoteRequests: [{ id: 'QR-DOC', status: 'Submitted', submittedAt: new Date().toISOString(), customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' },
        insurers: ['Prestige Assurance'], insurerIds: ['1'], insurerQuotes: {}, vehicle: '2020 Toyota Hilux', vehicleDetails: { plateNumber: 'BAA 1234' }, vehicleValue: 250000, vehicleUsage: 'Individual', insuranceType: 'Comprehensive', coverageDurationId: '4q', policyDates: null, inspectionShots: ['insp_front'] }],
      activeQuoteRequestId: 'QR-DOC',
    });
    store.version = 4;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  await page.goto('/insurer');
  await page.getByRole('button', { name: 'Send quote' }).first().click();
  await expect(page.getByText('7 live photos attached').or(page.getByText('1 live photos attached'))).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(path.join(SCRATCH, 'quote.pdf'));
  await expect(page.getByText('quote.pdf')).toBeVisible();
  await page.getByPlaceholder('e.g. PA-Q-2026-00412').fill('PA-Q-2026-00412');
  await page.getByPlaceholder('e.g. 12000').fill('10650');
  await page.getByRole('button', { name: 'Send quote to customer' }).click();
  await expect(page.getByText('Quoted ZMW 10,650.00')).toBeVisible();

  await page.goto('/quotes-comparison');
  await expect(page.getByText('PA-Q-2026-00412').first()).toBeVisible();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'View quotation' }).first().click()]);
  // Headless Chromium downloads PDFs rather than rendering them; the popup itself proves the document opened.
  expect(popup).toBeTruthy();
});
