/*
 * Right-Stuff Agent IDE — browser demo service worker.
 *
 * The demo is a client-side app, so the only network traffic is its own
 * static bundle. Cache the app shell and hashed assets, keep navigations
 * network-first so a new Vercel deployment is picked up immediately, and
 * fall back to the offline page when the network is unavailable.
 */
const VERSION = "0.4.2";
const CACHE_PREFIX = "right-stuff-agent-ide-";
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const BASE = new URL("./", self.location.href).pathname;
const SHELL = [
  BASE,
  `${BASE}index.html`,
  `${BASE}offline.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}icons/icon-192.png`,
  `${BASE}icons/icon-512.png`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => {
        // Activate immediately on the first visit. Updates wait until the
        // old tabs are closed so an open page does not lose its assets.
        if (!self.registration.active) return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match(`${BASE}index.html`)) ||
      (await cache.match(`${BASE}offline.html`)) ||
      Response.error()
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}
