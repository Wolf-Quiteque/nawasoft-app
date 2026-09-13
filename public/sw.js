// NAWASOFT service worker.
//
// Strategy, by request type:
//   /_next/static/, /icons/, images  → cache-first. These filenames contain a
//     content hash (or never change), so a cached copy is *always* correct.
//     The previous version fetched them from the network on every launch and
//     only then fell back to the cache, which meant a cold PWA start paid for
//     the whole JS bundle again over mobile data before anything rendered.
//   /api/                            → never touched. This is a live operations
//     tool; a stale ticket count is worse than a spinner.
//   navigations                      → network-first, falling back to a cached
//     offline shell. Pages are server-rendered per user now, so their HTML is
//     deliberately not cached.
const VERSION = 'v2';
const STATIC_CACHE = `nawasoft-static-${VERSION}`;
const SHELL_CACHE = `nawasoft-shell-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const CURRENT_CACHES = [STATIC_CACHE, SHELL_CACHE];

const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll is all-or-nothing; one 404 would leave us with no shell at all.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Lets the browser start the navigation request while the service worker
      // is still booting, instead of after. Worth 100-300ms on a cold launch.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

/** Hashed build output and icons: safe to serve from cache indefinitely. */
function isImmutable(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/.test(url.pathname)
  );
}

/** Only opaque-free, successful, same-origin basic responses are cacheable. */
function isCacheable(response) {
  return response && response.status === 200 && response.type === 'basic';
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function handleNavigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always network, never cached

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else (RSC payloads, the manifest) goes straight to the network,
  // untouched — caching a stale RSC payload would show stale operational data.
});
