// @ts-check
import { test, expect } from '@playwright/test';

/** Writes straight into the browser lane's store, as the other mock-lane specs do. */
async function setStore(page, change) {
  await page.evaluate((patch) => {
    const store = JSON.parse(localStorage.getItem('insurshield-storage') || '{"state":{}}');
    Object.assign(store.state, patch);
    store.version = 10;
    localStorage.setItem('insurshield-storage', JSON.stringify(store));
  }, change);
}

const CUSTOMER = { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' };

test('a customer asks for a correction and the insurer records it as done', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await setStore(page, {
    customer: CUSTOMER,
    isAuthenticated: true,
    consentAccepted: true,
    consentTimestamp: '2026-09-01T09:00:00.000Z',
    policies: [{
      policyNumber: 'PA-2026-SR0001',
      status: 'Active',
      customerEmail: CUSTOMER.email,
      customerName: CUSTOMER.fullName,
      insurer: 'Prestige Assurance',
      vehicle: '2021 Toyota Corolla',
      coverage: 'Comprehensive',
      premium: 12000,
      policyDates: { startDate: '2026-01-01', endDate: '2099-12-31' },
      issuedAt: '2026-01-01T08:00:00.000Z',
    }],
    serviceRequests: [],
  });

  // The customer asks from the policy.
  await page.goto('/account?section=policies');
  await page.getByRole('link', { name: /Request a change/ }).click();
  await expect(page).toHaveURL(/\/service-requests\/new\?policy=PA-2026-SR0001/);
  await page.getByRole('radio', { name: /Correct my details/ }).check();
  await page.getByLabel('Tell the insurer what you need').fill('The vehicle colour on my policy should be blue, not white.');
  await page.getByRole('button', { name: 'Send to the insurer' }).click();
  await expect(page.getByRole('heading', { name: 'Correct my details' })).toBeVisible();
  await expect(page.getByText('Sent to the insurer').first()).toBeVisible();
  const reference = (await page.getByText(/^SR-/).first().textContent())?.split(' ')[0];

  // The insurer completes it.
  await setStore(page, { customer: null, isAuthenticated: false, staffSession: { role: 'insurer', name: 'Prestige Assurance' } });
  await page.goto('/insurer?view=service-requests');
  await expect(page.getByText(/Correct my details · Mwiza Banda/)).toBeVisible();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Add an update' }).click();
  await page.getByLabel('Add an update').fill('Checking the colour with the dealer.');
  await page.getByLabel(/Internal note/).check();
  await page.getByRole('button', { name: 'Add the update' }).click();
  await expect(page.getByText('Internal, not shown to the customer')).toBeVisible();
  await page.getByRole('button', { name: 'Record it as done' }).click();
  await page.getByLabel('Record what you did').fill('Your schedule now shows the vehicle as blue.');
  await page.getByRole('button', { name: 'Record it as done' }).last().click();
  await expect(page.getByText('Done', { exact: true }).first()).toBeVisible();

  // The customer sees the outcome, and not the internal note.
  await setStore(page, { staffSession: null, customer: CUSTOMER, isAuthenticated: true });
  await page.goto(`/service-requests/${reference}`);
  await expect(page.getByText('Your schedule now shows the vehicle as blue.').first()).toBeVisible();
  await expect(page.getByText('Done', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Checking the colour with the dealer.')).toHaveCount(0);
});
