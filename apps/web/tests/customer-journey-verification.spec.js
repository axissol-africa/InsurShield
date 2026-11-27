import { test, expect } from '@playwright/test';

const journeys = [
  { label: 'Start a new quote', path: '/insurance-type', heading: 'Choose your cover', intro: 'Have your vehicle registration, value and intended use ready.' },
  { label: 'Recover a request', path: '/account?section=quotes', heading: 'Quote activity', intro: 'Use the account you submitted with to find your saved requests.' },
  { label: 'Renew a policy', path: '/renewal', heading: 'Renew a policy', intro: 'Renewing starts a fresh product comparison.' },
  { label: 'Start a claim', path: '/claims?action=claim', heading: 'Start a claim', intro: 'Have your policy, incident date, vehicle details and supporting evidence ready.' },
  { label: 'Apply for NCD', path: '/claims?action=ncd', heading: 'Apply for a No Claim Discount', intro: 'Tell us about your claim-free history.' },
  { label: 'Request an inspection', path: '/inspections', heading: 'Vehicle inspections', intro: 'Have your vehicle registration, preferred date, location and contact number ready' },
  { label: 'Contact an insurer', path: '/support', heading: 'Contact your insurer', intro: 'Choose your insurer and have your policy or claim reference ready' },
];
const customer = { fullName: 'Journey Test Customer', email: 'journey@example.test', phone: '0970123456' };

async function signInMock(page) {
  await expect(page.getByRole('navigation', { name: 'Customer journeys' })).toBeVisible();
  await page.evaluate((identity) => {
    const saved = JSON.parse(localStorage.getItem('insurshield-storage'));
    Object.assign(saved.state, { customer: identity, isAuthenticated: true, consentAccepted: true });
    localStorage.setItem('insurshield-storage', JSON.stringify(saved));
  }, customer);
}

async function fitsViewport(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), page.url()).toBe(true);
}

for (const viewport of [{ width: 320, height: 740 }, { width: 1280, height: 800 }]) {
  test.describe(`${viewport.width}px entry points`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });
    for (const journey of journeys) {
      test(`${journey.label}: correct destination, introduction and no overflow`, async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await signInMock(page);
        await page.reload({ waitUntil: 'domcontentloaded' });
        const entry = page.getByRole('navigation', { name: 'Customer journeys' }).getByRole('link', { name: journey.label, exact: true });
        await expect(entry).toHaveAttribute('href', journey.path);
        await entry.click();
        await expect(page).toHaveURL(new RegExp(`${journey.path.replace(/[?]/g, '\\?')}$`));
        await expect(page.getByRole('heading', { name: journey.heading, exact: true }).first()).toBeVisible();
        await expect(page.getByText(journey.intro, { exact: false }).first()).toBeVisible();
        await fitsViewport(page);
        await page.screenshot({ path: test.info().outputPath(`journey-${viewport.width}.png`), fullPage: true });
      });
    }
  });
}

test.describe('guest boundaries', () => {
  for (const path of ['/quote-request', '/quotes-comparison', '/payment', '/confirmation', '/account?section=quotes', '/notifications', '/renewal', '/claims?action=claim', '/claims?action=ncd', '/inspections', '/service-requests', '/service-requests/new', '/service-requests/example']) {
    test(`${path} requires identity and preserves the destination`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(`/create-account?next=${encodeURIComponent(path)}`);
      await expect(page.getByRole('heading', { name: /Sign in to InsurShield|Create your account/i }).first()).toBeVisible();
      await expect(page.getByText(customer.fullName, { exact: true })).toHaveCount(0);
    });
  }
  test('capture query cannot unlock account records', async ({ page }) => {
    await page.goto('/account?capture=untrusted', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/create-account?next=%2Faccount%3Fcapture%3Duntrusted');
  });
});

test('small viewport keyboard navigation, focus and Escape dismissal', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // macOS WebKit uses Option-Tab to include links in keyboard navigation.
  await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Mobile' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Mobile' })).toHaveCount(0);
  await expect(menu).toBeFocused();
  const first = page.getByRole('link', { name: 'Start a new quote', exact: true });
  await first.focus();
  await expect(first).toBeFocused();
  const focus = await first.evaluate((element) => ({ outline: getComputedStyle(element).outlineStyle, shadow: getComputedStyle(element).boxShadow }));
  expect(focus.outline !== 'none' || focus.shadow !== 'none').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Choose your cover' })).toBeVisible();
  await page.getByRole('radio', { name: 'Comprehensive' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Third party only' })).toBeChecked();
});

test('reduced motion stops decorative loops while keeping all entry actions available', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Customer journeys' })).toBeVisible();
  const looping = await page.locator('.dot-pulse, .feature-ticker, .tile-float, .partner-marquee').evaluateAll((elements) => elements.filter((element) => {
    const style = getComputedStyle(element);
    return style.animationName !== 'none' && style.animationIterationCount === 'infinite' && style.animationPlayState !== 'paused';
  }).map((element) => element.className));
  expect(looping).toEqual([]);
});

test('blocked media and delayed documents retain usable public navigation', async ({ page }) => {
  let blocked = 0;
  await page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (['image', 'font'].includes(type)) { blocked += 1; return route.abort('failed'); }
    if (type === 'document') await new Promise((resolve) => setTimeout(resolve, 250));
    return route.continue();
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Customer journeys' })).toBeVisible();
  await page.getByRole('link', { name: 'Contact an insurer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contact your insurer' })).toBeVisible();
  await fitsViewport(page);
  expect(blocked).toBeGreaterThan(0);
});


test('claim inputs have accessible names and the police report works with Space', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await signInMock(page);
  await page.goto('/claims?action=claim', { waitUntil: 'domcontentloaded' });
  for (const name of ['Full Name *', 'Mobile Number *', 'Vehicle Registration / Plate Number *', 'Coverage Type *', 'Insurance Company *', 'Claim Type *', 'Date of Incident *', 'Estimated Loss (ZMW)', 'Incident Location *', 'Describe What Happened *']) {
    await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  }
  const police = page.getByRole('checkbox', { name: /Police Report Filed/ });
  await police.focus();
  await page.keyboard.press('Space');
  await expect(police).toBeChecked();
  await expect(page.getByLabel('Police case or report number')).toBeVisible();
  await fitsViewport(page);
});
