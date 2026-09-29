// @ts-check
import { test, expect } from '@playwright/test';

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/InsurShield/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every insurer.');
  await expect(page.getByRole('button', { name: /Get insurance/ }).first()).toBeVisible();
});
