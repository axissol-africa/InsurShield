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
  await page.getByRole('button', { name: /Choose Global/ }).first().click();

  await expect(page).toHaveURL(/payment/);
  await expect(page.getByRole('heading', { name: 'Confirm and pay' })).toBeVisible();
  await expect(page.getByText('Your policy with Global Guard Insurance')).toBeVisible();
  await page.getByRole('button', { name: /^Pay ZMW/ }).click();

  await expect(page).toHaveURL(/confirmation/);
  await expect(page.getByRole('heading', { name: "You're covered" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('BAA 1234')).toBeVisible();

  // Policy is in the account
  await page.getByRole('button', { name: 'My account' }).click();
  await expect(page).toHaveURL(/account/);
  await expect(page.getByRole('heading', { name: 'Policies' })).toBeVisible();
  await expect(page.getByText('Global Guard Insurance', { exact: true }).first()).toBeVisible();
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
    store.version = 4;
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
    store.version = 4;
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
