// @ts-check
import { test, expect } from '@playwright/test';

// In-memory fixtures: a 1×1 PNG and the smallest valid PDF, so the suite needs no files on disk.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const logoFile = { name: 'logo.png', mimeType: 'image/png', buffer: PNG };
const quoteFile = { name: 'quote.pdf', mimeType: 'application/pdf', buffer: PDF };

const seedStaff = (role, name) => async ({ page }) => {
  await page.goto('/');
  await page.evaluate(([r, n]) => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    store.state.staffSession = { role: r, name: n };
    store.version = 5;
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
  await page.locator('input[type="file"]').setInputFiles(logoFile);
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
    store.version = 5;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  await page.goto('/insurer');
  await page.getByRole('button', { name: 'Send quote' }).first().click();
  await expect(page.getByText('7 live photos attached').or(page.getByText('1 live photos attached'))).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(quoteFile);
  await expect(page.getByText('quote.pdf')).toBeVisible();
  await page.getByPlaceholder('e.g. PA-Q-2026-00412').fill('PA-Q-2026-00412');
  await page.getByPlaceholder('e.g. 21000').fill('10650');
  await page.getByRole('button', { name: 'Send quote to customer' }).click();
  await expect(page.getByText('Quoted ZMW 10,650.00')).toBeVisible();

  await page.goto('/quotes-comparison');
  await expect(page.getByText('PA-Q-2026-00412').first()).toBeVisible();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'View quotation' }).first().click()]);
  // Headless Chromium downloads PDFs rather than rendering them; the popup itself proves the document opened.
  expect(popup).toBeTruthy();
});

test('admin can edit, deactivate and delete an insurer, and deactivated insurers get no requests', async ({ page }) => {
  await seedStaff('admin', 'Admin')({ page });
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage'));
    Object.assign(store.state, { customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' }, isAuthenticated: true, consentAccepted: true,
      vehicleDetails: { plateNumber: 'BAA 1234', make: 'Toyota', model: 'Hilux', year: '2020' }, vehicleValue: 250000, vehicleUsage: 'Individual', insuranceType: 'Comprehensive' });
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/admin');
  await page.getByText('Manage Insurers', { exact: true }).click();

  const rows = page.locator('div.divide-y > div');
  await page.getByRole('button', { name: 'More actions for Metro Safe Assurance' }).click();
  await page.getByRole('menuitem', { name: /Deactivate/ }).click();
  await page.getByRole('button', { name: 'More actions for Metro Safe Assurance' }).click();
  await expect(page.getByRole('menuitem', { name: /Reactivate/ })).toBeVisible();
  await page.getByRole('heading', { name: 'Manage Insurers' }).click(); // click outside closes the menu
  await page.getByRole('button', { name: 'More actions for Madison General' }).click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await expect(rows.filter({ hasText: 'Madison General' }).getByText('Deleted')).toBeVisible();

  await rows.filter({ hasText: 'Prestige Assurance' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Edit Prestige Assurance/ })).toBeVisible();
  await page.getByPlaceholder('e.g. PIA/GI/2026/017').fill('PIA/GI/2026/001');
  await page.getByRole('button', { name: 'Update insurer' }).click();
  await expect(page.getByText('PIA/GI/2026/001')).toBeVisible();

  await page.goto('/quote-request');
  await expect(page.getByText('One request goes to all 3 insurers')).toBeVisible();
  await page.goto('/support');
  await expect(page.getByText('Madison General')).toHaveCount(0);
});

test('insurer can find a claim by its number and mark it received', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    Object.assign(store.state, { staffSession: { role: 'insurer', name: 'Prestige Assurance' },
      claims: [{ id: 'CLM-654321', claimNumber: 'CLM-654321', status: 'Notified', submittedAt: new Date().toISOString(), insurer: 'Prestige Assurance', type: 'Theft', fullName: 'Mwiza Banda', phone: '0970123456', email: 'mwiza.banda@insurshield.zm', plate: 'BAA 1234', vehicle: '2020 Toyota Hilux', incidentDate: '2026-09-20', location: 'Woodlands', description: 'Stolen overnight.', estimatedLoss: '95000', policeReport: true, policeReportNumber: 'ZP/2026/1' }] });
    store.version = 5;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  await page.goto('/insurer');
  await page.getByRole('tab', { name: /Claims/ }).click();
  await page.getByPlaceholder('Find by claim number, name or plate').fill('654321');
  await page.getByRole('button', { name: /CLM-654321/ }).click();
  await expect(page.getByText('ZP/2026/1')).toBeVisible();
  await expect(page.getByText('mwiza.banda@insurshield.zm').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mark as received' }).click();
  await expect(page.getByText('Received by insurer').first()).toBeVisible();
});

test('a paid quote needs the insurer certificate before it becomes an active policy for the customer', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    const store = { state: { staffSession: { role: 'insurer', name: 'Prestige Assurance' }, customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' }, isAuthenticated: true, consentAccepted: true }, version: 5 };
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });

  // The demo paid quote is waiting for its certificate and is not yet a policy for the customer.
  await page.goto('/account');
  await expect(page.getByText('Policy certificate being prepared')).toBeVisible();
  await expect(page.getByText('Policies you buy through InsurShield will appear here.')).toBeVisible();

  await page.goto('/insurer');
  await page.getByRole('tab', { name: /Paid policies/ }).click();
  await expect(page.getByText('PA-2026-011293')).toBeVisible();
  await page.getByRole('button', { name: 'Review & issue policy' }).click();
  await expect(page.getByText('TXN-MTN-1789714666139')).toBeVisible();

  await page.getByRole('button', { name: /Issue active policy/ }).click();
  await expect(page.getByRole('alert')).toHaveText(/Upload the official policy certificate/);
  await page.getByPlaceholder('e.g. PA-2026-00412').fill('PA-2026-00412');
  await page.locator('input[type="file"]').setInputFiles(quoteFile);
  await page.getByRole('button', { name: /Issue active policy/ }).click();
  await expect(page.getByText('Official policy issued')).toBeVisible();
  await expect(page.getByRole('button', { name: 'View certificate' })).toBeVisible();

  await page.goto('/account');
  await expect(page.getByText('Policy certificate being prepared')).toHaveCount(0);
  await expect(page.getByText('PA-2026-011293')).toBeVisible();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /Policy certificate/ }).click()]);
  expect(popup).toBeTruthy();
});

test('an insurer quote needs the quotation document and a premium', async ({ page }) => {
  await seedStaff('insurer', 'Prestige Assurance')({ page });
  await page.goto('/insurer');
  await page.getByRole('button', { name: 'Send quote' }).first().click();
  const premium = page.getByPlaceholder('e.g. 21000');
  await premium.fill('0');
  expect(await premium.evaluate((input) => input.validity.rangeUnderflow)).toBe(true); // browser blocks a zero premium
  await premium.fill('100');
  await page.getByRole('button', { name: 'Send quote to customer' }).click();
  await expect(page.getByRole('alert')).toHaveText(/Attach the final quotation/);
  await page.locator('input[type="file"]').setInputFiles(quoteFile);
  await page.getByRole('button', { name: 'Use estimate' }).click();
  await expect(premium).not.toHaveValue('100');
  await page.getByRole('button', { name: 'Send quote to customer' }).click();
  await expect(page.getByText(/Quoted ZMW/).first()).toBeVisible();
});
