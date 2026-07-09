/*
 * BharatTruck Driver — minimal service worker.
 * Goal: make the app installable + resilient offline for the app shell ONLY.
 * It deliberately does NOT cache API traffic: live GPS pushes and booking calls
 * go to the cross-origin gateway (NEXT_PUBLIC_API_URL) and must always hit the
 * network. This handler only touches same-origin GET requests.
 */
const CACHE = 'bt-driver-shell-v1'
const SHELL = ['/']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // never intercept POST/PATCH (GPS, bookings)

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // let cross-origin API pass through

  if (req.mode === 'navigate') {
    // App shell: network-first, fall back to cache when offline.
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || caches.match('/'))),
    )
    return
  }

  // Same-origin static assets: cache-first, then populate the cache.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => cached),
    ),
  )
})
