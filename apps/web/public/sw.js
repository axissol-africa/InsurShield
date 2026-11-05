// These placeholders are replaced by the production Vite build. Keeping the
// worker as a public-file template preserves its stable `/sw.js` URL while
// ensuring each deployment has a distinct worker and matching shell cache.
const BUILD_ID = '__INSURSHIELD_BUILD_ID__';
const SHELL_ASSETS = JSON.parse('__INSURSHIELD_SHELL_ASSETS__');
const API_BASE_URL = '__INSURSHIELD_API_BASE_URL__';
const CACHE_NAME = `insurshield-shell-${BUILD_ID}`;
const SHELL_PATHS = new Set(SHELL_ASSETS.map(asset => new URL(asset, self.location.origin).pathname));
const apiBase = new URL(API_BASE_URL, self.location.origin);
const apiPath = apiBase.pathname.replace(/\/+$/, '') || '/';

function isSameOriginApiRequest(url) {
  if (apiBase.origin !== self.location.origin || url.origin !== apiBase.origin) return false;
  return apiPath === '/' || url.pathname === apiPath || url.pathname.startsWith(`${apiPath}/`);
}

function isShellAsset(url) {
  return url.search === '' && SHELL_PATHS.has(url.pathname);
}

async function offlineShell() {
  const cache = await caches.open(CACHE_NAME);
  return cache.match('/index.html');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_ASSETS.map(asset => new Request(asset, { cache: 'reload' })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith('insurshield-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isSameOriginApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await offlineShell()) ?? Response.error()));
    return;
  }

  if (!isShellAsset(url)) return;

  event.respondWith(caches.open(CACHE_NAME).then(async cache => (
    await cache.match(request) ?? fetch(request)
  )));
});
