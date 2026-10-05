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
  await page.getByRole('button', { name: 'Insurers', exact: true }).click();
  await page.getByRole('button', { name: 'Add insurer' }).click();

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

  await expect(page.getByRole('button', { name: 'Add insurer' })).toBeVisible();
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
  await expect(page.getByText('ZMW 10,650.00').first()).toBeVisible();

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
  await page.getByRole('button', { name: 'Insurers', exact: true }).click();

  const rows = page.locator('div.divide-y > div');
  await page.getByRole('button', { name: 'More actions for Metro Safe Assurance' }).click();
  await page.getByRole('menuitem', { name: /Deactivate/ }).click();
  await page.getByRole('button', { name: 'More actions for Metro Safe Assurance' }).click();
  await expect(page.getByRole('menuitem', { name: /Reactivate/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add insurer' }).hover(); // moving away closes the menu
  await page.mouse.click(4, 4);
  await page.getByRole('button', { name: 'More actions for Madison General' }).click();
  await page.getByRole('menuitem', { name: /Remove/ }).click();
  // Removal is confirmed in the app's own dialog, which spells out what is kept.
  await expect(page.getByRole('heading', { name: /Remove Madison General/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove insurer' }).click();
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
  await expect(page.getByText('Certificate being prepared')).toBeVisible();
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
  await expect(page.getByText('Certificate being prepared')).toHaveCount(0);
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
  await expect(page.getByText(/^ZMW /).first()).toBeVisible();
});

test('an insurer states its cover in the shared form, and the customer reads that same document', async ({ page }) => {
  await seedStaff('insurer', 'Prestige Assurance')({ page });
  await page.goto('/insurer');
  await page.getByRole('tab', { name: /Cover guides/ }).click();

  // Catalogue insurers arrive published, so the form opens complete.
  await expect(page.getByText('11 of 11 answered')).toBeVisible();

  // Change one answer and watch it reach the customer's document.
  await page.getByLabel('Plan name *').fill('Comprehensive Platinum');
  await page.getByRole('button', { name: 'Preview as a customer' }).click();
  await expect(page.getByRole('heading', { name: 'Comprehensive Platinum' })).toBeVisible();

  await page.getByRole('button', { name: 'Back to the form' }).click();
  await page.getByRole('button', { name: /Update the guide/ }).click();
  await expect(page.getByText(/Published\. Customers comparing/)).toBeVisible();

  // Third party answers the same questions, so the two documents line up.
  await page.getByRole('tab', { name: /Third party only/ }).click();
  await expect(page.getByLabel('Plan name *')).toBeVisible();
  await expect(page.getByLabel('Claims contact *')).toBeVisible();
});

test('a guide must be complete before that cover type can be quoted', async ({ page }) => {
  await seedStaff('insurer', 'Prestige Assurance')({ page });
  await page.goto('/insurer');
  await page.getByRole('tab', { name: /Cover guides/ }).click();

  // Empty one required answer: the guide stops being publishable, and says why.
  await page.getByLabel('Claims contact *').fill('');
  await page.getByRole('button', { name: /Update the guide/ }).click();
  // Both the summary and the field itself say so, which is what makes a long
  // form navigable.
  await expect(page.getByText('Answer the highlighted questions before publishing this guide.')).toBeVisible();
  await expect(page.getByText('“Claims contact” is needed.')).toBeVisible();
});

test('a guide published before benefits became plain lines opens as readable text', async ({ page }) => {
  await seedStaff('insurer', 'Prestige Assurance')({ page });
  // The shape guides were saved in when a benefit and its limit were two
  // separate boxes. Loaded carelessly these reach a text input as
  // "[object Object]".
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage'));
    store.state.insurersList = [{
      id: '1',
      name: 'Prestige Assurance',
      ratePercentage: 4.5,
      quoteValidityDays: 7,
      coverage: 'Comprehensive Gold Plan',
      coverGuides: {
        Comprehensive: {
          coverType: 'Comprehensive',
          planName: 'Comprehensive Gold Plan',
          summary: 'Full cover for your vehicle and for damage you cause to others.',
          coveredItems: [{ item: 'Own damage', limit: 'Market value' }, { item: 'Theft and fire', limit: '' }],
          exclusions: ['Driving without a valid licence'],
          notifyWithinDays: '7',
          howToNotify: 'Call the claims line.',
          documentsRequired: ['Police report'],
          claimsContact: '+260 211 255 100',
          settlementTime: '14 working days',
          territorialLimit: 'Zambia',
          ncdAccepted: true,
          quoteValidityDays: '7',
        },
      },
    }];
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });

  await page.goto('/insurer');
  await page.getByRole('tab', { name: /Cover guides/ }).click();

  const benefits = page.getByRole('textbox', { name: /Covered benefits/ }).or(page.locator('input[placeholder^="e.g. Medical expenses"]'));
  await expect(benefits.first()).toHaveValue('Own damage — Market value');
  await expect(benefits.nth(1)).toHaveValue('Theft and fire');
  await expect(page.locator('input[value="[object Object]"]')).toHaveCount(0);

  // And it reads correctly as a customer document too.
  await page.getByRole('button', { name: 'Preview as a customer' }).click();
  await expect(page.getByText('Own damage — Market value')).toBeVisible();
});
