import { test, expect } from '@playwright/test';

const customer = { fullName: 'Mwiza Banda', email: 'mwiza.banda@insurshield.zm', phone: '0970123456' };
const inspection = { id: 'INS-B16-P3', purpose: 'CLAIM_ASSESSMENT', claimNumber: 'CL-B16-P3', policyNumber: 'POL-B16', stage: null, method: 'SELF_CAPTURE', status: 'Requested', vehicleLabel: '2020 Toyota Hilux', vehiclePlate: 'BAA 1234', insurer: 'Prestige Assurance', email: customer.email, phone: customer.phone, fullName: customer.fullName, photos: [], report: null };
for (const width of [1280, 375]) {
  test(`claim inspection evidence and report at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(({ customer, inspection }) => {
      localStorage.setItem('insurshield-storage', JSON.stringify({ version: 5, state: {
        customer, isAuthenticated: true, consentAccepted: true,
        staffSession: { role: 'insurer', name: 'Prestige Assurance' }, inspections: [inspection],
      } }));
    }, { customer, inspection });
    await page.goto('/inspections?claim=CL-B16-P3&inspection=INS-B16-P3');
    await expect(page.getByRole('heading', { name: inspection.id })).toBeVisible();
    for (const label of ['Front view', 'Rear view', 'Left side', 'Right side', 'Dashboard and mileage', 'Engine bay']) {
      await page.getByLabel(label, { exact: true }).setInputFiles({ name: `${label}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64') });
    }
    await page.getByRole('button', { name: 'Submit inspection photos' }).click();
    await expect(page.getByText('Evidence submitted to the insurer.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Front view.png', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('customer-evidence.png'), fullPage: true });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Front view.png', exact: true })).toBeVisible();
    await page.goto('/insurer?view=inspections#inspection-INS-B16-P3');
    await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeDisabled();
    await page.getByLabel('Final inspection report').setInputFiles({ name: 'assessment.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 assessment') });
    await page.getByRole('button', { name: 'Publish final report' }).click();
    await expect(page.getByRole('button', { name: 'assessment.pdf' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('insurer-report.png'), fullPage: true });
    await page.getByRole('button', { name: 'Pass', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Finished inspections' })).toContainText('Approved');
    await page.goto('/inspections?claim=CL-B16-P3&inspection=INS-B16-P3');
    await expect(page.getByRole('button', { name: 'assessment.pdf' })).toBeVisible();
    await expect(page.getByLabel('Front view', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
