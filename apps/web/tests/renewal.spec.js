// @ts-check
import { test, expect } from '@playwright/test';
import { tinyImage, vehiclePhoto } from './fixtures/photos';

test('My Account renewal submits selected products with the original policy reference in the insurer queue', async ({ page }) => {
  test.setTimeout(60000);
  const policyNumber = 'PA-RENEWAL-001';
  const endDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await page.goto('/');
  await page.evaluate(({ policyNumber, endDate }) => {
    localStorage.clear();
    const customer = { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' };
    localStorage.setItem('insurshield-storage', JSON.stringify({
      version: 5,
      state: {
        customer, isAuthenticated: true, consentAccepted: true,
        quoteRequests: [],
        policies: [{
          policyNumber, status: 'Active', insurer: 'Prestige Assurance',
          customerEmail: customer.email, customerPhone: customer.phone,
          vehicle: '2020 Toyota Hilux',
          vehicleDetails: { plateNumber: 'REN 1234', make: 'Toyota', model: 'Hilux', year: '2020' },
          vehicleValue: 250000, vehicleUsage: 'Individual', coverage: 'Comprehensive',
          premium: 11250, coverageDurationId: '4q', policyDates: { endDate },
        }],
      },
    }));
  }, { policyNumber, endDate });

  await page.goto('/account?section=policies');
  await expect(page.getByRole('listitem').filter({ hasText: policyNumber })).toBeVisible();
  await page.getByRole('link', { name: 'Renew', exact: true }).click();
  await expect(page).toHaveURL(/renewal/);
  await expect(page.getByText(policyNumber, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Renew this policy' }).click();

  await expect(page).toHaveURL(/quote-request/);
  await expect(page.getByText('2020 Toyota Hilux').first()).toBeVisible();
  await expect(page.getByText('REN 1234').first()).toBeVisible();
  await expect(page.getByText('0 of 7 captured')).toBeVisible();
  const product = page.getByRole('checkbox', { name: /^Select .+ from Prestige Assurance$/ });
  await product.check();
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(tinyImage('whitebook.png'));
  for (let index = 1; index <= 7; index += 1) await inputs.nth(index).setInputFiles(vehiclePhoto(`renewal-${index}.png`));
  await expect(page.getByText('7 of 7 captured')).toBeVisible();
  await page.getByText('I confirm the vehicle and contact information').click();
  await page.getByRole('button', { name: 'Request quotes for 1 product', exact: true }).click();
  await expect(page).toHaveURL(/quotes-comparison/);
  await expect(page.getByRole('button', { name: 'Awaiting insurer quote' })).toHaveCount(1);

  const request = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('insurshield-storage')).state;
    return state.quoteRequests.find((record) => record.id === state.activeQuoteRequestId);
  });
  expect(request.renewalOfPolicyNumber).toBe(policyNumber);
  expect(request.selectedProducts).toHaveLength(1);
  expect(request.selectedProducts[0].insurerName).toBe('Prestige Assurance');
  const localStartDate = await page.evaluate((startDate) => {
    const date = new Date(startDate);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }, request.policyDates.startDate);
  expect(localStartDate).toBe(endDate);

  // Only change identity: the queue must receive lineage from the submitted request.
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage'));
    store.state.staffSession = { role: 'insurer', name: 'Prestige Assurance' };
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  });
  await page.goto('/insurer');
  const row = page.getByRole('row').filter({ hasText: request.id });
  await expect(row).toHaveCount(1);
  await expect(row.getByText(`Renewal of ${policyNumber}`, { exact: false })).toBeVisible();
  await row.getByRole('button', { name: 'Send quote', exact: true }).click();
  await expect(page.getByText(`Renewal of ${policyNumber}`, { exact: false })).toBeVisible();
});
