import { expect, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { startProductionServer } from './service-worker/production-server.js';

test.describe.configure({ mode: 'serial' });

let server;

test.beforeEach(async () => {
  server = await startProductionServer();
});

test.afterEach(async () => {
  await server.close();
});

async function waitForController(page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
}

async function cacheEntries(page) {
  return page.evaluate(async () => Promise.all(
    (await caches.keys()).map(async name => ({
      name,
      urls: (await (await caches.open(name)).keys()).map(request => request.url),
    })),
  ));
}

async function updateWorker(page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const nextController = new Promise(resolve =>
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    await registration.update();
    await nextController;
  });
}

test('mobile initial loads stay within the JavaScript budget and defer portal code', async ({ browser }) => {
  await server.build('mobile-budget', '/api/v1', { mode: 'release' });
  for (const [path, heading, chunk] of [
    ['/', 'Know the cover. Then choose the quote.', 'LandingPage'],
    ['/insurance-type', 'Choose your cover', 'InsuranceTypePage'],
    ['/support', 'Contact your insurer', 'SupportPage'],
  ]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401 }));
      const scripts = new Set();
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === server.origin && /^\/assets\/.*\.js$/.test(url.pathname)) scripts.add(url.href);
      });
      await page.goto(server.origin + path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 15000 });
      const initialScripts = [...scripts];
      expect(initialScripts).toContainEqual(expect.stringContaining('/assets/public-page-preloads-'));
      expect(initialScripts).toContainEqual(expect.stringContaining(`/assets/${chunk}-`));
      const sizes = await Promise.all(initialScripts.map(async (url) => {
        const response = await context.request.get(url, { headers: { 'Accept-Encoding': 'br' } });
        expect(response.ok()).toBe(true);
        expect(response.headers()['content-encoding']).toBe('br');
        return gzipSync(await response.body()).length;
      }));
      const worker = await context.request.get(`${server.origin}/sw.js`);
      expect(await worker.text()).not.toMatch(/\/assets\/[^"']+\.(?:br|gz)["']/);
      const compressedBytes = sizes.reduce((total, bytes) => total + bytes, 0);
      expect(compressedBytes, `initial gzip JavaScript bytes for ${path}`).toBeGreaterThan(0);
      expect(compressedBytes, `initial gzip JavaScript bytes for ${path}`).toBeLessThan(210 * 1024);
      expect(initialScripts.join(' ')).not.toMatch(/AdminDashboard|InsurerDashboard/);
    } finally {
      await context.close();
    }
  }
});

test('a route load fails visibly and refresh can recover without leaving the journey', async ({ browser }) => {
  await server.build('route-recovery');
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const path = '/vehicle-identification';
  try {
    const page = await context.newPage();
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401 }));
    const asset = '**/assets/VehicleIdentificationPage-*.js';
    await page.route(asset, (route) => route.abort());

    await page.goto(server.origin + path);
    await expect(page.getByText('This page could not load.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'InsurShield' }).first()).toBeVisible();
    await page.unroute(asset);
    await page.getByRole('button', { name: 'Reload page' }).click();
    await expect(page).toHaveURL(server.origin + path);
    await expect(page.getByLabel('Licence plate number')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('does not intercept or cache same-origin API requests', async ({ page, context }) => {
  await server.build('api');
  server.resetApiRequests();
  await page.goto(`${server.origin}/worker-test`);
  await waitForController(page);

  const apiReads = await page.evaluate(async () => Promise.all([
    fetch('/api/v1/probe').then(response => response.json()),
    fetch('/api/v1/probe').then(response => response.json()),
  ]));

  expect(apiReads).toEqual([{ request: 1 }, { request: 2 }]);
  expect(server.apiRequests.filter(path => path === '/api/v1/probe')).toHaveLength(2);

  const apiPage = await context.newPage();
  await apiPage.goto(`${server.origin}/api/v1/navigate?id=online`);
  await expect(apiPage.locator('body')).toHaveText('API navigation online');

  await context.setOffline(true);
  await expect(apiPage.goto(`${server.origin}/api/v1/navigate?id=offline`)).rejects.toThrow();
  await context.setOffline(false);

  const entries = await cacheEntries(page);
  expect(entries.flatMap(cache => cache.urls)).not.toContainEqual(expect.stringContaining('/api/v1'));
  expect(entries.flatMap(cache => cache.urls)).not.toContainEqual(expect.stringMatching(/\.(?:br|gz)$/));
});

test('replaces the legacy cache and activates the current worker', async ({ page }) => {
  const firstBuild = await server.build('legacy-upgrade');
  await page.goto(`${server.origin}/worker-test`);
  await waitForController(page);

  await page.evaluate(async () => {
    const cache = await caches.open('insurshield-shell-v2');
    await cache.put('/api/v1/customer', new Response('{"customer":"private"}'));
  });

  const upgradedBuild = await server.build('upgraded');
  expect(upgradedBuild.buildId).not.toBe(firstBuild.buildId);
  await updateWorker(page);
  await expect.poll(
    () => page.evaluate(async () => (await caches.keys()).sort()),
    { timeout: 10_000 },
  ).toEqual([`insurshield-shell-${firstBuild.buildId}`, `insurshield-shell-${upgradedBuild.buildId}`].sort());

  const entries = await cacheEntries(page);
  expect(entries.flatMap(cache => cache.urls)).not.toContainEqual(expect.stringContaining('/api/v1/customer'));
  const retained = entries.find(({ name }) => name === `insurshield-shell-${firstBuild.buildId}`);
  expect(retained.urls.length).toBeGreaterThan(0);
  expect(retained.urls.every(url => /\/assets\/[\w.-]+-[\w-]{8}\.(?:js|css)$/.test(url))).toBe(true);

  const shell = await page.evaluate(() => fetch('/index.html').then(response => response.text()));
  expect(shell).toContain('name="service-worker-build" content="upgraded"');
});

test('updates every open tab and uses the current shell offline without reloading tabs', async ({ page, context }) => {
  const firstBuild = await server.build('first');
  await context.addInitScript(() => {
    const key = 'service-worker-test-loads';
    sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? '0') + 1));
  });
  await page.goto(`${server.origin}/worker-test`);
  const secondPage = await context.newPage();
  await secondPage.goto(`${server.origin}/worker-test`);
  await Promise.all([waitForController(page), waitForController(secondPage)]);

  const firstRouteAsset = (await cacheEntries(page))[0].urls.find((url) => /\/assets\/VehicleIdentificationPage-[^/]+\.js$/.test(url));
  expect(firstRouteAsset).toBeTruthy();
  const secondBuild = await server.build('second', undefined, { versionChunks: true });
  expect(secondBuild.buildId).not.toBe(firstBuild.buildId);
  await updateWorker(page);
  await Promise.all([page, secondPage].map(workerPage => expect.poll(
    () => workerPage.evaluate(async () => (await caches.keys()).sort()),
    { timeout: 10_000 },
  ).toEqual([`insurshield-shell-${firstBuild.buildId}`, `insurshield-shell-${secondBuild.buildId}`].sort())));

  await expect(page.evaluate(() => sessionStorage.getItem('service-worker-test-loads'))).resolves.toBe('1');
  await expect(secondPage.evaluate(() => sessionStorage.getItem('service-worker-test-loads'))).resolves.toBe('1');

  await Promise.all([page, secondPage].map(workerPage => expect.poll(
    () => workerPage.evaluate(() => fetch('/index.html').then(response => response.text())),
    { timeout: 15000 },
  ).toContain('name="service-worker-build" content="second"')));

  await context.setOffline(true);
  expect(await page.evaluate(async (url) => (await fetch(url)).ok, firstRouteAsset)).toBe(true);
  const routeAssetAvailable = await page.evaluate(async (buildId) => {
    const cache = await caches.open(`insurshield-shell-${buildId}`);
    const route = (await cache.keys()).find(({ url }) => /\/assets\/VehicleIdentificationPage-[^/]+\.js$/.test(url));
    return route && (await fetch(route.url)).ok;
  }, secondBuild.buildId);
  expect(routeAssetAvailable).toBe(true);
  const offlinePage = await context.newPage();
  await offlinePage.goto(`${server.origin}/offline`);
  await expect(offlinePage.locator('meta[name="service-worker-build"]')).toHaveAttribute('content', 'second');
  await expect(offlinePage.locator('#root')).toBeAttached();
});
