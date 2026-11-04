import { expect, test } from '@playwright/test';
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
    await registration?.update();
  });
}

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
  ).toEqual([`insurshield-shell-${upgradedBuild.buildId}`]);

  const entries = await cacheEntries(page);
  expect(entries.map(cache => cache.name)).toEqual([`insurshield-shell-${upgradedBuild.buildId}`]);
  expect(entries[0].urls).not.toContainEqual(expect.stringContaining('/api/v1/customer'));

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

  const secondBuild = await server.build('second');
  expect(secondBuild.buildId).not.toBe(firstBuild.buildId);
  await updateWorker(page);
  await Promise.all([page, secondPage].map(workerPage => expect.poll(
    () => workerPage.evaluate(async () => (await caches.keys()).sort()),
    { timeout: 10_000 },
  ).toEqual([`insurshield-shell-${secondBuild.buildId}`])));

  await expect(page.evaluate(() => sessionStorage.getItem('service-worker-test-loads'))).resolves.toBe('1');
  await expect(secondPage.evaluate(() => sessionStorage.getItem('service-worker-test-loads'))).resolves.toBe('1');

  const [firstShell, secondShell] = await Promise.all([
    page.evaluate(() => fetch('/index.html').then(response => response.text())),
    secondPage.evaluate(() => fetch('/index.html').then(response => response.text())),
  ]);
  expect(firstShell).toContain('name="service-worker-build" content="second"');
  expect(secondShell).toContain('name="service-worker-build" content="second"');

  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await offlinePage.goto(`${server.origin}/offline`);
  await expect(offlinePage.locator('meta[name="service-worker-build"]')).toHaveAttribute('content', 'second');
  await expect(offlinePage.locator('#root')).toBeAttached();
});
