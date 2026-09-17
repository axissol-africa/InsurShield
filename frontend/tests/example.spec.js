// @ts-check
import { test, expect } from '@playwright/test';

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/InsurShield/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Compare motor insurance quotes');
});
