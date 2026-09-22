// @ts-check
import { test, expect } from '@playwright/test';

// 1×1 PNG — enough for the photo stamping canvas to decode.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const image = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
});

test('guest is asked to sign in before requesting quotes, then completes a purchase', async ({ page }) => {
  // Cover
  await page.goto('/insurance-type');
  await page.getByRole('radio', { name: /Third party only/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Vehicle via RTSA lookup
  await expect(page).toHaveURL(/vehicle-identification/);
  await page.getByPlaceholder('e.g. BAA 1234').fill('BAA 1234');
  await page.getByRole('button', { name: 'Find vehicle' }).click();
  await expect(page.getByText('Vehicle found — check the details')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm & continue' }).click();
  await expect(page.getByText('Enter the current market value')).toBeVisible();
  await page.getByPlaceholder('e.g. 200000').fill('250000');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm & continue' }).click();

  // Usage → account gate
  await expect(page).toHaveURL(/vehicle-usage/);
  await page.getByRole('radio', { name: /Taxis/ }).click();
  await page.getByRole('button', { name: 'Continue to quote request' }).click();
  await expect(page).toHaveURL(/create-account\?next=%2Fquote-request/);
  await expect(page.getByText('Your vehicle details are saved')).toBeVisible();
  await page.getByRole('button', { name: 'Use demo credentials' }).click();
  await page.getByRole('button', { name: 'Log in' }).click();

  // Request page: estimates reflect value + usage; validation lists every gap
  await expect(page).toHaveURL(/quote-request/);
  await expect(page.getByText('Indicative premiums for your vehicle')).toBeVisible();
  await expect(page.getByText('ZMW 14,400.00')).toBeVisible(); // 250 000 × 4.5 % × taxi factor
  await page.getByRole('button', { name: /Send request to 5 insurers/ }).click();
  await expect(page.getByText('Add your White Book')).toBeVisible();
  await expect(page.getByText('Capture 7 more inspection photos.')).toBeVisible();
  await expect(page.getByText('Accept the declaration')).toBeVisible();

  // Documents
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(image('whitebook.png'));
  for (let index = 1; index <= 7; index += 1) await inputs.nth(index).setInputFiles(image(`shot-${index}.png`));
  await expect(page.getByText('7 of 7 captured')).toBeVisible();
  await page.getByText('I confirm the vehicle and contact information').click();
  await page.getByRole('button', { name: /Send request to 5 insurers/ }).click();

  // Compare → pay → confirm
  await expect(page).toHaveURL(/quotes-comparison/);
  await expect(page.getByRole('heading', { name: 'Compare your quotes' })).toBeVisible();
  await expect(page.getByText('0 of 5 insurers have replied')).toBeVisible();
  await page.getByRole('button', { name: /Choose Prestige/ }).first().click();

  await expect(page).toHaveURL(/payment/);
  await expect(page.getByRole('heading', { name: 'Confirm and pay' })).toBeVisible();
  await expect(page.getByText('Your policy with Prestige Assurance')).toBeVisible();
  await page.getByRole('button', { name: /^Pay ZMW/ }).click();

  await expect(page).toHaveURL(/confirmation/);
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('BAA 1234')).toBeVisible();

  // The paid quote is waiting for the insurer's certificate
  await page.getByRole('button', { name: 'My account' }).click();
  await expect(page).toHaveURL(/account/);
  await expect(page.getByText('Policy certificate being prepared')).toBeVisible();

  // Insurer issues the certificate from its own system (the demo portal acts as Prestige Assurance)
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage'));
    store.state.staffSession = { role: 'insurer', name: 'Prestige Assurance' };
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  await page.goto('/insurer');
  await page.getByRole('tab', { name: /Paid policies/ }).click();
  await page.getByRole('button', { name: /Review & issue policy/ }).first().click();
  await page.locator('input[type="file"]').setInputFiles(image('certificate.png'));
  await page.getByRole('button', { name: /Issue active policy/ }).click();
  await expect(page.getByText('Official policy issued').first()).toBeVisible();

  // Customer now holds an active policy with the certificate
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Policies' })).toBeVisible();
  await expect(page.getByText('Prestige Assurance', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Policy certificate/ })).toBeVisible();
});

test('insurer reply replaces the estimate on the comparison page', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    Object.assign(store.state, {
      customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' },
      isAuthenticated: true, consentAccepted: true,
      quoteRequests: [{
        id: 'QR-TEST', status: 'Submitted', submittedAt: new Date().toISOString(),
        customer: { email: 'mwiza.banda@insurshield.zm' },
        insurers: ['Prestige Assurance', 'Global Guard Insurance'], insurerIds: ['1', '2'],
        insurerQuotes: { 'Prestige Assurance': { premium: 10900, notes: 'Includes windscreen', sentAt: new Date().toISOString() } },
        vehicle: '2020 Toyota Hilux', vehicleValue: 250000, vehicleUsage: 'Individual', coverageDurationId: '4q', policyDates: null,
      }],
      activeQuoteRequestId: 'QR-TEST',
    });
    store.version = 5;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  await page.goto('/quotes-comparison');
  await expect(page.getByText('1 of 2 insurers have replied')).toBeVisible();
  await expect(page.getByText('ZMW 10,900.00').first()).toBeVisible();
  await expect(page.getByText('Final quote from insurer').first()).toBeVisible();
  await expect(page.getByText('Includes windscreen').first()).toBeVisible();
});

test('a claim produces a claim number and the insurer contact', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    Object.assign(store.state, { customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' }, isAuthenticated: true, consentAccepted: true });
    store.version = 5;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  await page.goto('/claims');
  await page.getByText('Start a claim', { exact: true }).click();
  await page.getByPlaceholder('e.g. BAA 1234').fill('ABC 999');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Policy Found — ABC 999')).toBeVisible();
  await page.locator('select').nth(0).selectOption('Comprehensive');
  await page.locator('select').nth(2).selectOption('Theft');
  const today = new Date().toISOString().split('T')[0];
  await page.locator('input[type="date"]').fill(today);
  await page.getByPlaceholder(/Great East Road/).fill('Woodlands, Lusaka');
  await page.getByPlaceholder(/Provide a clear/).fill('Stolen overnight.');
  await page.getByRole('button', { name: 'Get my claim number' }).click();
  await expect(page.getByRole('heading', { name: 'Your claim number is ready' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/CLM-\d{6}/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /\+260/ })).toBeVisible();
});

test('expired quotes cannot be paid and re-requesting carries the details over', async ({ page }) => {
  const day = 24 * 60 * 60 * 1000;
  await page.goto('/');
  await page.evaluate(([dayMs]) => {
    const now = Date.now();
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    Object.assign(store.state, {
      customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' }, isAuthenticated: true, consentAccepted: true,
      quoteRequests: [{
        id: 'QR-OLD', status: 'Quoted', submittedAt: new Date(now - 10 * dayMs).toISOString(), expiresAt: new Date(now + 4 * dayMs).toISOString(),
        customer: { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' },
        insurers: ['Prestige Assurance', 'Global Guard Insurance'], insurerIds: ['1', '2'],
        insurerQuotes: {
          'Global Guard Insurance': { premium: 9800, sentAt: new Date(now - 3 * dayMs).toISOString(), validUntil: new Date(now - dayMs).toISOString(), validityDays: 2 },
          'Prestige Assurance': { premium: 10900, sentAt: new Date(now - dayMs).toISOString(), validUntil: new Date(now + 6 * dayMs).toISOString(), validityDays: 7 },
        },
        vehicle: '2020 Toyota Hilux', vehicleDetails: { plateNumber: 'BAA 1234', make: 'Toyota', model: 'Hilux', year: '2020' }, vehicleValue: 250000, vehicleUsage: 'Commercial (Taxis & Yangos)', insuranceType: 'Comprehensive', coverageDurationId: '4q', policyDates: null,
        inspectionShots: ['insp_front'], photosCapturedAt: new Date(now - 10 * dayMs).toISOString(),
      }],
      activeQuoteRequestId: 'QR-OLD',
    });
    store.version = 5;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  }, [day]);

  // The lapsed offer is marked and cannot be chosen; the open one can.
  await page.goto('/quotes-comparison');
  await expect(page.getByText('Expired', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expired · request a new quote' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose Global/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Choose Prestige/ }).first().click();
  await expect(page).toHaveURL(/payment/);

  // The deadline is checked again on the payment page itself.
  await page.evaluate(([dayMs]) => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage'));
    store.state.selectedQuote.validUntil = new Date(Date.now() - dayMs).toISOString();
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  }, [day]);
  await page.goto('/payment');
  await expect(page.getByRole('heading', { name: 'This quote has expired' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pay ZMW/ })).toHaveCount(0);

  // Re-requesting pre-fills the journey from the old request and links the two.
  await page.getByRole('button', { name: 'Get fresh quotes' }).click();
  await expect(page).toHaveURL(/quote-request/);
  await expect(page.getByText('Fresh quotes for QR-OLD.')).toBeVisible();
  await expect(page.getByText('2020 Toyota Hilux').first()).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('insurshield-storage')).state);
  expect(state.requotedFromId).toBe('QR-OLD');
  expect(state.vehicleUsage).toBe('Commercial (Taxis & Yangos)');
  expect(state.vehicleValue).toBe(250000);
});
