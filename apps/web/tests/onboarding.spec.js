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
    store.state.staffSession = { role: r, name: n, isSuperAdmin: r === 'admin', staffRole: r === 'insurer' ? 'INSURER_ADMIN' : undefined };
    store.version = 5;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  }, [role, name]);
};

test('admin onboards an insurer with an uploaded logo', async ({ page }) => {
  await seedStaff('admin', 'Admin')({ page });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Insurers', exact: true }).click();
  await page.getByRole('button', { name: 'Add insurer' }).click();

  await page.getByPlaceholder('e.g. Prestige Assurance Limited').fill('Zambezi General Insurance Limited');
  await page.getByPlaceholder('Name shown to customers').fill('Zambezi General');
  await page.getByPlaceholder('e.g. PIA/GI/2026/017').fill('PIA/GI/2026/031');
  await page.locator('input[type="date"]').fill('2027-06-30');
  await page.getByPlaceholder('e.g. Mrs. Chanda Mwale').fill('Chanda Mwale');
  await page.getByPlaceholder('e.g. Motor Claims Manager').fill('Motor Claims Manager');
  await page.getByPlaceholder('+260 211 …').fill('+260 211 999 000');
  await page.getByPlaceholder('claims@insurer.zm').fill('claims@zambezi.zm');
  await page.getByPlaceholder('e.g. 4.0').fill('4.1');
  await page.locator('input[type="file"]').setInputFiles(logoFile);
  await expect(page.getByAltText('Company logo preview')).toBeVisible();
  await page.getByRole('button', { name: 'Save insurer for review' }).click();

  await expect(page.getByRole('heading', { name: 'Review onboarding' })).toBeVisible();
  await expect(page.getByLabel('Insurer under review').locator('option:checked')).toHaveText(/Zambezi General Insurance Limited/);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('insurshield-storage')).state.insurersList
    .find((insurer) => insurer.name === 'Zambezi General Insurance Limited'));
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
  // The form shows the premium back before sending, so the confirmation is what proves it went.
  await expect(page.getByText('Quote sent', { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Quotes sent' }).getByText('ZMW 10,650.00')).toBeVisible();

  await page.goto('/quotes-comparison');
  await expect(page.getByText('PA-Q-2026-00412').first()).toBeVisible();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'View quotation' }).first().click()]);
  // Headless Chromium downloads PDFs rather than rendering them; the popup itself proves the document opened.
  expect(popup).toBeTruthy();
});

test('admin can edit insurers and submits lifecycle changes for independent approval', async ({ page }) => {
  await seedStaff('admin', 'Admin')({ page });
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage'));
    Object.assign(store.state, { customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' }, isAuthenticated: true, consentAccepted: true,
      vehicleDetails: { plateNumber: 'BAA 1234', make: 'Toyota', model: 'Hilux', year: '2020' }, vehicleValue: 250000, vehicleUsage: 'Individual', insuranceType: 'Comprehensive' });
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Insurers', exact: true }).click();

  const rows = page.locator('div.divide-y > div');
  await page.getByRole('button', { name: 'More actions for Metro Safe Assurance' }).click();
  await page.getByRole('menuitem', { name: /Deactivate/ }).click();
  await expect(page.getByText(/sent for independent approval/i)).toBeVisible();
  await expect(rows.filter({ hasText: 'Metro Safe Assurance' }).getByText('Active', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add insurer' }).hover(); // moving away closes the menu
  await page.mouse.click(4, 4);
  await page.getByRole('button', { name: 'More actions for Madison General' }).click();
  await page.getByRole('menuitem', { name: /Remove/ }).click();
  // Removal is confirmed in the app's own dialog, which spells out what is kept.
  await expect(page.getByRole('heading', { name: /Request removal of Madison General/ })).toBeVisible();
  await page.getByRole('button', { name: 'Request removal' }).click();
  await expect(rows.filter({ hasText: 'Madison General' }).getByText('Active', { exact: true })).toBeVisible();

  await rows.filter({ hasText: 'Prestige Assurance' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Edit Prestige Assurance/ })).toBeVisible();
  await page.getByPlaceholder('e.g. PIA/GI/2026/017').fill('PIA/GI/2026/001');
  await page.getByRole('button', { name: 'Update insurer' }).click();
  await expect(page.getByText('PIA/GI/2026/001')).toBeVisible();

  await page.goto('/quote-request');
  await expect(page.getByRole('button', { name: 'See cover guides from 5 insurers' })).toBeVisible();
  await page.goto('/support');
  await expect(page.getByText('Madison General')).toBeVisible();
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
  await page.getByRole('link', { name: 'Claims', exact: true }).click();
  await page.getByPlaceholder('Claim number, name or plate').fill('654321');
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
  await expect(page.getByText('Certificate being prepared').first()).toBeVisible();
  await page.goto('/account?section=certificates');
  await expect(page.getByText('QR-1789714666139', { exact: true })).toBeVisible();
  await expect(page.getByText('Preparing', { exact: true })).toBeVisible();
  await page.goto('/account?section=policies');
  await expect(page.getByText('Policies you buy through InsurShield will appear here.')).toBeVisible();

  await page.goto('/insurer');
  await page.getByRole('link', { name: 'Paid policies', exact: true }).click();
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
  await expect(page.getByText('Certificate being prepared')).toHaveCount(0);
  await page.goto('/account?section=certificates');
  await expect(page.getByText('No paid quotes are waiting for a policy certificate.')).toBeVisible();
  await page.goto('/account?section=policies');
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
  await expect(page.getByText('Quote sent', { exact: true })).toBeVisible();
});

test('an insurer revises product terms and previews the customer cover guide', async ({ page }) => {
  await seedStaff('insurer', 'Prestige Assurance')({ page });
  await page.goto('/insurer');
  await page.getByRole('link', { name: 'Product terms', exact: true }).click();

  // Catalogue terms arrive reviewed. Changing them always begins a new draft
  // so a later edit can never rewrite the version customers already saw.
  await page.getByRole('button', { name: 'Create revised draft' }).first().click();
  await expect(page.getByLabel('Plan name *')).toBeVisible();

  // Change one answer and preview the exact guide a customer will compare.
  await page.getByLabel('Plan name *').fill('Comprehensive Platinum');
  await page.getByRole('button', { name: 'Preview as a customer' }).click();
  await expect(page.getByRole('heading', { name: 'Comprehensive Platinum' })).toBeVisible();

  await page.getByRole('button', { name: 'Back to the form' }).click();
  await page.getByRole('button', { name: 'Save guide draft' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('insurshield.mock.products.v1') || '[]')
    .some((product) => product.versions.some((version) => version.status === 'DRAFT' && version.coverGuide?.planName === 'Comprehensive Platinum')));
});

test('a product version cannot be submitted until its cover guide is complete', async ({ page }) => {
  await seedStaff('insurer', 'Prestige Assurance')({ page });
  await page.goto('/insurer');
  await page.getByRole('link', { name: 'Product terms', exact: true }).click();

  await page.getByRole('button', { name: 'Create revised draft' }).first().click();
  // Drafts may be saved while incomplete, but platform review is blocked until
  // every comparison field has an answer.
  await page.getByLabel('Claims contact *').fill('');
  await page.getByRole('button', { name: 'Save guide draft' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('alert')).toHaveText('Complete the cover guide before submitting this product for review.');
});

test('a legacy product guide renders structured benefits as readable text', async ({ page }) => {
  await seedStaff('insurer', 'Prestige Assurance')({ page });
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage'));
    const insurer = store.state.insurersList.find((entry) => entry.name === 'Prestige Assurance');
    const timestamp = new Date().toISOString();
    // Earlier guide saves expressed benefits as { item, limit }. Versioned
    // products still need to display those records without exposing an object
    // string in an editable field.
    localStorage.setItem('insurshield.mock.products.v1', JSON.stringify([{
      id: 'PROD-LEGACY', insurerId: insurer.id, code: 'LEGACY-COMP', coverType: 'COMPREHENSIVE', createdAt: timestamp, updatedAt: timestamp,
      versions: [{
        id: 'PV-LEGACY', versionNumber: 1, status: 'DRAFT', name: 'Comprehensive Gold Plan', coverType: 'COMPREHENSIVE',
        coverGuide: {
          planName: 'Comprehensive Gold Plan', summary: 'Full cover for your vehicle and for damage you cause to others.',
          coveredItems: [{ item: 'Own damage', limit: 'Market value' }, { item: 'Theft and fire', limit: '' }], exclusions: ['Driving without a valid licence'],
          notifyWithinDays: '7', howToNotify: 'Call the claims line.', documentsRequired: ['Police report'], claimsContact: '+260 211 255 100',
          settlementTime: '14 working days', territorialLimit: 'Zambia', ncdAccepted: true, quoteValidityDays: '7',
        },
        inspection: { rule: 'NOT_REQUIRED', timing: null, method: null }, effectiveFrom: '2026-01-01', effectiveUntil: null, createdAt: timestamp, updatedAt: timestamp,
      }],
    }]));
  });

  await page.goto('/insurer');
  await page.getByRole('link', { name: 'Product terms', exact: true }).click();

  const benefits = page.getByRole('textbox', { name: /Covered benefits/ }).or(page.locator('input[placeholder^="e.g. Medical expenses"]'));
  await expect(benefits.first()).toHaveValue('Own damage — Market value');
  await expect(benefits.nth(1)).toHaveValue('Theft and fire');
  await expect(page.locator('input[value="[object Object]"]')).toHaveCount(0);

  // And it reads correctly as a customer document too.
  await page.getByRole('button', { name: 'Preview as a customer' }).click();
  await expect(page.getByText('Own damage — Market value')).toBeVisible();
});
